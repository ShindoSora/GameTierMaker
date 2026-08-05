import os
import uuid
import time
import copy
import logging
import threading
from pathlib import Path
from typing import List, Optional

from .models import (
    ProjectData, Template, TierRow, ImageLibrary, 
    ImageGroup, TierImage, ProjectEncoder
)
from .image_svc import ImageService
from .errors import AppError, RemoteServiceError
from .version import LEGACY_PROJECT_SCHEMA_VERSIONS, PROJECT_SCHEMA_VERSION
from .json_store import (
    JsonStoreError,
    JsonValidationError,
    atomic_write_json,
    cleanup_temporary_files,
    create_snapshot,
    preserve_corrupt_file,
    read_json,
)

SEARCH_RESULTS_GROUP_ID = "default_upload"
SEARCH_RESULTS_GROUP_NAME = "搜索结果的图片"
LOCAL_UPLOAD_GROUP_ID = "local_upload"
LOCAL_UPLOAD_GROUP_NAME = "上传的图片"

logger = logging.getLogger(__name__)


class ProjectSaveError(RuntimeError):
    """项目无法持久化。"""


class ProjectRecoveryRequiredError(ProjectSaveError):
    """项目损坏且没有可用备份，需要用户确认重置。"""


def validate_project_payload(data):
    """兼容旧数据的最小结构验证，阻止明显损坏的数据进入反序列化。"""
    if not isinstance(data, dict):
        raise JsonValidationError("项目根节点必须是对象")
    if "version" not in data:
        raise JsonValidationError("项目缺少 version")
    templates = data.get("templates")
    if not isinstance(templates, list):
        raise JsonValidationError("项目 templates 必须是数组")
    if not templates:
        raise JsonValidationError("项目至少需要一个模板")
    for index, template in enumerate(templates):
        if not isinstance(template, dict):
            raise JsonValidationError(f"模板 {index} 必须是对象")
        if not template.get("id"):
            raise JsonValidationError(f"模板 {index} 缺少 id")
        if not isinstance(template.get("tiers", []), list):
            raise JsonValidationError(f"模板 {index} 的 tiers 必须是数组")
        if not isinstance(template.get("unassigned_images", []), list):
            raise JsonValidationError(f"模板 {index} 的未排序图片必须是数组")

class ProjectManager:
    """
    核心业务控制器
    负责协调 Data Model 和 Image Service
    """
    def __init__(self, root_dir: str):
        self.root_dir = root_dir
        self.data_dir = os.path.join(root_dir, "data")
        self.project_file = os.path.join(self.data_dir, "project.json")
        self.backups_dir = os.path.join(root_dir, "backups")
        os.makedirs(self.data_dir, exist_ok=True)
        os.makedirs(self.backups_dir, exist_ok=True)
        self._save_lock = threading.RLock()
        self._persistence_enabled = True
        self.recovery_status = {
            "status": "ok",
            "recovered": False,
            "message": "",
        }
        cleanup_temporary_files(self.data_dir, "project.json")
        
        self.image_svc = ImageService(self.data_dir)
        self.project_data = ProjectData()
        
        self.current_template: Optional[Template] = None
        
        # 加载或初始化
        self.load_project()

    def _lib(self):
        """返回当前模板的工作图片库。无模板时回退到全局 master。"""
        if self.current_template:
            return self.current_template.hidden_preset
        return self.project_data.shared_image_library

    def load_project(self):
        project_path = Path(self.project_file)
        if not project_path.exists():
            self._init_default_project(persist=True)
            return

        try:
            data = read_json(project_path, validate_project_payload)
            self._deserialize_project(data)
            self._create_startup_snapshot()
            return
        except Exception as exc:
            logger.exception("项目文件加载失败，开始尝试恢复: %s", exc)

        corrupt_copy = None
        try:
            corrupt_copy = preserve_corrupt_file(
                project_path,
                self.backups_dir,
                prefix="project-corrupt",
            )
        except JsonStoreError as exc:
            logger.error("保留损坏项目文件失败: %s", exc)

        candidates = [project_path.with_name(project_path.name + ".bak")]
        candidates.extend(
            sorted(
                Path(self.backups_dir).glob("project-[0-9]*.json"),
                key=lambda item: item.name,
                reverse=True,
            )
        )

        for candidate in candidates:
            if not candidate.exists():
                continue
            try:
                data = read_json(candidate, validate_project_payload)
                self._deserialize_project(data)
                atomic_write_json(
                    project_path,
                    self.project_data,
                    encoder=ProjectEncoder,
                    validator=validate_project_payload,
                    create_backup=False,
                )
                # 同步刷新 .bak，避免之前的损坏备份继续留在恢复链中。
                atomic_write_json(
                    project_path,
                    self.project_data,
                    encoder=ProjectEncoder,
                    validator=validate_project_payload,
                    create_backup=True,
                )
                self.recovery_status = {
                    "status": "ok",
                    "recovered": True,
                    "message": "项目文件损坏，已从最近备份恢复。",
                    "source": candidate.name,
                    "corrupt_copy": corrupt_copy.name if corrupt_copy else None,
                }
                logger.warning("项目已从备份恢复: %s", candidate)
                return
            except Exception as exc:
                logger.warning("备份不可用 %s: %s", candidate, exc)

        # 没有可用备份时只创建内存项目，禁止保存，直到用户明确确认重置。
        self._init_default_project(persist=False)
        self._persistence_enabled = False
        self.recovery_status = {
            "status": "recovery_required",
            "recovered": False,
            "message": "项目文件已损坏且没有可用备份。损坏文件已保留，请确认是否创建空白项目。",
            "corrupt_copy": corrupt_copy.name if corrupt_copy else None,
        }

    def save_project(self):
        if not self._persistence_enabled:
            raise ProjectRecoveryRequiredError(
                "项目处于恢复保护状态，请先确认创建空白项目"
            )
        with self._save_lock:
            try:
                atomic_write_json(
                    self.project_file,
                    self.project_data,
                    encoder=ProjectEncoder,
                    validator=validate_project_payload,
                )
            except JsonStoreError as exc:
                logger.exception("项目保存失败: %s", exc)
                raise ProjectSaveError("项目无法保存，请检查磁盘空间和目录权限") from exc

    def _init_default_project(self, persist: bool = True):
        """初始化默认项目结构"""
        self.project_data = ProjectData()
        self.current_template = None
        self.project_data.global_preset_library.groups = [
            ImageGroup(id=SEARCH_RESULTS_GROUP_ID, name=SEARCH_RESULTS_GROUP_NAME, image_ids=[]),
            ImageGroup(id=LOCAL_UPLOAD_GROUP_ID, name=LOCAL_UPLOAD_GROUP_NAME, image_ids=[]),
        ]

        # 同步初始化 shared_image_library
        self._ensure_library_groups(self._lib())

        # 创建第一个默认模板
        self.create_template(persist=persist)

    def _create_startup_snapshot(self):
        try:
            create_snapshot(
                self.project_file,
                self.backups_dir,
                prefix="project",
                keep=5,
                validator=validate_project_payload,
            )
        except JsonStoreError as exc:
            # 快照失败不阻止打开有效项目，但会记录到日志。
            logger.warning("启动备份创建失败: %s", exc)

    def get_recovery_status(self):
        return dict(self.recovery_status)

    def reset_after_recovery_failure(self):
        """用户明确确认后，解除恢复保护并创建新的空白项目。"""
        if self.recovery_status.get("status") != "recovery_required":
            return False
        with self._save_lock:
            self._persistence_enabled = True
            self._init_default_project(persist=True)
            # 第一次写入会保留损坏的旧 .bak；再保存一次生成有效备份。
            self.save_project()
            self.recovery_status = {
                "status": "ok",
                "recovered": False,
                "reset": True,
                "message": "已创建新的空白项目，损坏文件仍保留在 backups 目录。",
            }
        return True

    def _ensure_library_groups(self, library: ImageLibrary):
        search_group = library.find_group_by_id(SEARCH_RESULTS_GROUP_ID)
        if not search_group:
            for g in library.groups:
                if g.name == LOCAL_UPLOAD_GROUP_NAME:
                    search_group = g
                    break

        if not search_group:
            search_group = ImageGroup(id=SEARCH_RESULTS_GROUP_ID, name=SEARCH_RESULTS_GROUP_NAME, image_ids=[])
            library.groups.insert(0, search_group)
        else:
            search_group.name = SEARCH_RESULTS_GROUP_NAME

        local_group = library.find_group_by_id(LOCAL_UPLOAD_GROUP_ID)
        local_created = False
        if not local_group:
            local_group = ImageGroup(id=LOCAL_UPLOAD_GROUP_ID, name=LOCAL_UPLOAD_GROUP_NAME, image_ids=[])
            local_created = True

            insert_at = 0
            for i, g in enumerate(library.groups):
                if g is search_group:
                    insert_at = i + 1
                    break
            library.groups.insert(insert_at, local_group)
        else:
            local_group.name = LOCAL_UPLOAD_GROUP_NAME

        if local_created and search_group.image_ids:
            local_group.image_ids.extend(search_group.image_ids)
            search_group.image_ids.clear()

    def set_library_group_image_order(self, group_id: str, image_ids: List[str]):
        group = self._lib().find_group_by_id(group_id)
        if not group:
            return
        group.image_ids = list(image_ids)
        self.save_project()

    def search_only(self, query: str):
        """只搜索不下载；预期搜索错误使用类型化异常向上传递。"""
        from src.core.searchGamePng.get_game_image import GetGameJpg
        try:
            searcher = GetGameJpg()
            results = searcher.get_game_image(query)
            if not results or not isinstance(results, list):
                return []
            return results
        except AppError:
            raise
        except Exception as exc:
            logger.exception("游戏封面搜索发生未知错误")
            raise RemoteServiceError(
                "游戏封面搜索失败，请稍后重试",
                code="cover_search_failed",
            ) from exc

    # === 隐藏预设图片库 ===

    def _add_to_hidden_preset(self, image_id: str, group_id: str):
        """将图片按分组存入当前模板的隐藏预设库"""
        if not self.current_template:
            return
        preset = self.current_template.hidden_preset
        group = preset.find_group_by_id(group_id)
        if not group:
            shared = self._lib().find_group_by_id(group_id)
            group_name = shared.name if shared else ""
            group = ImageGroup(id=group_id, name=group_name, image_ids=[])
            preset.groups.append(group)
        if image_id not in group.image_ids:
            group.image_ids.append(image_id)

    def get_hidden_presets_summary(self):
        """返回所有模板的隐藏预设概况（模板名 + 图片总数）"""
        return [
            {
                "template_id": t.id,
                "template_name": t.name,
                "total_images": sum(len(g.image_ids) for g in t.hidden_preset.groups),
                "groups": [
                    {"id": g.id, "name": g.name, "image_ids": g.image_ids}
                    for g in t.hidden_preset.groups
                ],
            }
            for t in self.project_data.templates
        ]

    def import_hidden_preset(self, source_template_id: str):
        """将指定模板的隐藏图片库导入当前模板（按分组追加，不覆盖）。"""
        source = None
        for t in self.project_data.templates:
            if t.id == source_template_id:
                source = t
                break
        if not source:
            raise ValueError(f"模板 {source_template_id} 不存在")

        count = 0
        changed = False
        for src_group in source.hidden_preset.groups:
            # 确保当前模板的隐藏图片库存在对应分组
            target_group = self._lib().find_group_by_id(src_group.id)
            if not target_group:
                # 从源分组名还原分组名
                group_name = src_group.name
                if src_group.id == SEARCH_RESULTS_GROUP_ID:
                    group_name = SEARCH_RESULTS_GROUP_NAME
                elif src_group.id == LOCAL_UPLOAD_GROUP_ID:
                    group_name = LOCAL_UPLOAD_GROUP_NAME
                target_group = ImageGroup(id=src_group.id, name=group_name, image_ids=[])
                self._lib().groups.append(target_group)
                changed = True
                if self.current_template:
                    self.current_template.library_group_states[src_group.id] = True
            for img_id in src_group.image_ids:
                if img_id in self.project_data.shared_images_meta:
                    if img_id not in target_group.image_ids:
                        target_group.image_ids.append(img_id)
                        count += 1
                        changed = True
        if changed:
            self.save_project()
        return count

    def _remove_from_all_hidden_presets(self, image_id: str):
        """从所有模板的隐藏预设中移除指定图片"""
        for t in self.project_data.templates:
            for g in t.hidden_preset.groups:
                if image_id in g.image_ids:
                    g.image_ids.remove(image_id)

    def _source_cache_dir(self, source):
        """源图片缓存目录: data/steam, data/igdb, data/bangumi"""
        d = os.path.join(self.root_dir, "data", source)
        os.makedirs(d, exist_ok=True)
        return d

    def _source_cache_path(self, source, file_id):
        """源缓存文件路径，检测扩展名"""
        base = os.path.join(self._source_cache_dir(source), str(file_id))
        for ext in (".jpg", ".jpeg", ".png", ".webp"):
            p = base + ext
            if os.path.exists(p):
                return p
        return base + ".jpg"

    def download_to_source_cache(self, url, source, file_id, game_name=""):
        """下载到源缓存目录。缓存命中直接返回路径；404 返回 '__404__'；失败返回 ''。"""
        import requests
        import logging
        logger = logging.getLogger(__name__)
        target = self._source_cache_path(source, file_id)
        display_name = (game_name or "").strip() or "未知游戏"
        if os.path.exists(target):
            logger.info("源缓存命中: 游戏=%s, path=%s", display_name, target)
            return target
        if url.startswith("//"):
            url = "https:" + url
        if "t_thumb" in url:
            url = url.replace("t_thumb", "t_1080p")
        try:
            resp = requests.get(url, timeout=30)
            resp.raise_for_status()
            with open(target, "wb") as f:
                f.write(resp.content)
            logger.info("源缓存下载成功: 游戏=%s, url=%s -> %s", display_name, url, target)
            return target
        except requests.exceptions.HTTPError as e:
            if e.response is not None and e.response.status_code == 404:
                logger.info("源缓存 404: 游戏=%s, url=%s", display_name, url)
                return "__404__"
            logger.error("源缓存下载失败: 游戏=%s, url=%s -> %s", display_name, url, e)
            return ""
        except Exception as e:
            logger.error("源缓存下载失败: 游戏=%s, url=%s -> %s", display_name, url, e)
            return ""

    def _detect_source(self, url):
        """根据 URL 判断来源平台"""
        u = url.lower()
        if "steamstatic" in u or "steampowered" in u:
            return "steam"
        if "igdb" in u:
            return "igdb"
        if "bgm.tv" in u or "bangumi" in u:
            return "bangumi"
        if "store-images.s-microsoft.com" in u or "xbox" in u:
            return "xbox"
        return "cache"

    def download_image_to_folder(self, url: str, game_name: str, game_id: str) -> str:
        """下载图片到源缓存目录（自动检测平台）"""
        source = self._detect_source(url)
        if source == "cache":
            source = "cache"
        return self.download_to_source_cache(url, source, game_id, game_name=game_name)

    def clear_all_source_folders(self):
        """清空所有源缓存目录"""
        count = 0
        for source in self._source_folders():
            count += self.clear_source_folder(source)
        return count

    def clear_source_folder(self, folder):
        """清空指定来源的缓存目录，返回删除数量"""
        import shutil
        count = 0
        d = os.path.join(self.root_dir, "data", folder)
        if os.path.exists(d):
            for item in os.listdir(d):
                p = os.path.join(d, item)
                try:
                    if os.path.isfile(p):
                        os.remove(p); count += 1
                    elif os.path.isdir(p):
                        shutil.rmtree(p); count += 1
                except Exception:
                    pass
        return count

    @staticmethod
    def _source_folders():
        """所有图片来源文件夹名"""
        return ("steam", "igdb", "bangumi", "xbox", "cache")

    def reset_all_images(self):
        """清除所有图片数据：库图片、隐藏预设、源缓存、缩略图 —— 恢复初始状态"""
        import shutil
        count = 0

        # 1. 清除所有模板的图片引用
        for template in self.project_data.templates:
            for tier in template.tiers:
                count += len(tier.image_ids)
                tier.image_ids.clear()
            count += len(template.unassigned_images)
            template.unassigned_images.clear()
            # 清除每个模板的工作图片库
            for group in template.hidden_preset.groups:
                count += len(group.image_ids)
                group.image_ids.clear()

        # 2. 清除全局隐藏母版
        for group in self.project_data.shared_image_library.groups:
            count += len(group.image_ids)
            group.image_ids.clear()

        # 3. 清除所有图片元数据
        count += len(self.project_data.shared_images_meta)
        self.project_data.shared_images_meta.clear()

        # 4. 清除源缓存
        count += self.clear_all_source_folders()

        # 5. 清除 images/ 和 thumbnails/ 目录
        for sub in ("images", "thumbnails"):
            d = os.path.join(self.data_dir, sub)
            if os.path.exists(d):
                for item in os.listdir(d):
                    p = os.path.join(d, item)
                    try:
                        if os.path.isfile(p):
                            os.remove(p); count += 1
                        elif os.path.isdir(p):
                            shutil.rmtree(p); count += 1
                    except Exception:
                        pass

        self.save_project()
        return count

    def import_image_to_library(self, file_path: str, add_to_unassigned: bool = False, group_id: str = None, steam_id: str = ""):
        """将本地图片文件导入到当前模板的图片库中

        Args:
            file_path: 本地图片文件的完整路径
            add_to_unassigned: 是否同时添加到未排序列表（上传为True，下载为False）
            group_id: 目标分组ID，默认导入到"搜索结果的图片"分组
            steam_id: 关联的 Steam ID，用于账号管理

        Returns:
            TierImage: 导入的图片对象，如果失败则返回None
        """
        if not self.current_template:
            return None

        try:
            # 1. 物理导入
            rel_path, image_id = self.image_svc.import_image(file_path)
            filename = os.path.basename(file_path)

            # 2. 注册元数据
            img_obj = TierImage(id=image_id, path=rel_path, original_name=filename, steam_id=steam_id)
            self.project_data.shared_images_meta[image_id] = img_obj

            # 3. 确定目标分组
            target_group_id = group_id if group_id else SEARCH_RESULTS_GROUP_ID
            target_group_name = SEARCH_RESULTS_GROUP_NAME
            if group_id:
                # 如果指定了分组，从已有分组中查找名字，找不到就用 group_id 做名字
                existing = self._lib().find_group_by_id(group_id)
                target_group_name = existing.name if existing else group_id

            self._ensure_library_groups(self._lib())
            target_group = self._lib().find_group_by_id(target_group_id)
            if not target_group:
                target_group = ImageGroup(id=target_group_id, name=target_group_name, image_ids=[])
                self._lib().groups.append(target_group)
                if self.current_template:
                    self.current_template.library_group_states[target_group_id] = True
            target_group.image_ids.append(image_id)

            # 3.5 同步存入当前模板的隐藏预设
            self._add_to_hidden_preset(image_id, target_group_id)

            # 4. 可选：添加到未分配图片列表
            if add_to_unassigned and image_id not in self.current_template.unassigned_images:
                self.current_template.unassigned_images.append(image_id)

            self.save_project()
            return img_obj

        except ProjectSaveError:
            raise
        except Exception as e:
            print(f"导入图片失败 {file_path}: {e}")
            return None

    def _deserialize_project(self, data: dict):
        """将字典转换回对象结构 (简化版)"""
        # 实际开发中可以使用 dacite 或 marshmallow 等库
        # 这里手动重建关键部分以恢复类实例的方法
        data = self._migrate_project_payload(data)
        self.project_data = ProjectData()
        self.current_template = None
        self.project_data.version = PROJECT_SCHEMA_VERSION
        self.project_data.current_template_id = data.get("current_template_id")
        
        # 恢复全局预设
        preset_data = data.get("global_preset_library", {})
        groups = [ImageGroup(**g) for g in preset_data.get("groups", [])]
        self.project_data.global_preset_library = ImageLibrary(groups=groups)
        self._ensure_library_groups(self.project_data.global_preset_library)
        
        # 加载共享图片库和元数据（优先使用新字段，向后兼容旧字段）
        shared_lib_data = data.get("shared_image_library")
        if shared_lib_data:
            # 直接从JSON加载共享图片库
            groups = [ImageGroup(**g) for g in shared_lib_data.get("groups", [])]
            self.project_data.shared_image_library = ImageLibrary(groups=groups)
        else:
            # 向后兼容：初始化空共享图片库，然后合并全局预设库
            self.project_data.shared_image_library = ImageLibrary(groups=[])
            for group in self.project_data.global_preset_library.groups:
                existing_group = self.project_data.shared_image_library.find_group_by_id(group.id)
                if existing_group:
                    # 合并图片ID（去重）
                    for img_id in group.image_ids:
                        if img_id not in existing_group.image_ids:
                            existing_group.image_ids.append(img_id)
                else:
                    # 创建新分组（复制但重置展开状态，因为展开状态是模板独立的）
                    new_group = ImageGroup(
                        id=group.id,
                        name=group.name,
                        image_ids=list(group.image_ids),
                        is_expanded=True  # 共享库中展开状态不重要，模板独立状态存储在 library_group_states
                    )
                    self.project_data.shared_image_library.groups.append(new_group)
        
        # 加载共享图片元数据
        shared_meta_data = data.get("shared_images_meta", {})
        self.project_data.shared_images_meta = {k: TierImage(**v) for k, v in shared_meta_data.items()}
        
        # 恢复模板并合并共享数据
        for t_data in data.get("templates", []):
            # 1. 合并 Images Meta
            meta = {k: TierImage(**v) for k, v in t_data.get("images_meta", {}).items()}
            self.project_data.shared_images_meta.update(meta)
            
            # 2. 合并 Image Library 分组
            lib_data = t_data.get("image_library", {})
            lib_groups = [ImageGroup(**g) for g in lib_data.get("groups", [])]
            
            # 提取分组展开状态到模板的 library_group_states
            library_group_states = {}
            for group in lib_groups:
                library_group_states[group.id] = group.is_expanded
                
                # 合并分组到共享图片库
                existing_group = self.project_data.shared_image_library.find_group_by_id(group.id)
                if existing_group:
                    # 合并图片ID（去重）
                    for img_id in group.image_ids:
                        if img_id not in existing_group.image_ids:
                            existing_group.image_ids.append(img_id)
                else:
                    # 创建新分组（复制但重置展开状态，因为展开状态是模板独立的）
                    new_group = ImageGroup(
                        id=group.id,
                        name=group.name,
                        image_ids=list(group.image_ids),
                        is_expanded=True  # 共享库中展开状态不重要，模板独立状态存储在 library_group_states
                    )
                    self.project_data.shared_image_library.groups.append(new_group)
            
            # 3. 恢复 Tiers
            tiers = [TierRow(**tr) for tr in t_data.get("tiers", [])]

            # 3.5 恢复隐藏预设图片库（向后兼容旧数据）
            hidden_preset = ImageLibrary()
            hp_data = t_data.get("hidden_preset")
            if hp_data:
                hidden_preset = ImageLibrary(
                    groups=[ImageGroup(**g) for g in hp_data.get("groups", [])]
                )

            # 4. 创建模板对象（不再包含 image_library 和 images_meta）
            template = Template(
                id=t_data["id"],
                name=t_data["name"],
                created_at=t_data["created_at"],
                tiers=tiers,
                unassigned_images=t_data.get("unassigned_images", []),
                library_group_states=library_group_states,
                hidden_preset=hidden_preset
            )
            self.project_data.templates.append(template)

        # 旧项目可能没有隐藏图片库分组；只补齐基础分组，不再从全局图片库回填图片。
        for template in self.project_data.templates:
            self._ensure_library_groups(template.hidden_preset)
            for group in template.hidden_preset.groups:
                template.library_group_states.setdefault(group.id, False)

        # 确保共享图片库有必要的分组
        self._ensure_library_groups(self.project_data.shared_image_library)
        
        # 设置当前模板
        if self.project_data.current_template_id:
            self.switch_template(self.project_data.current_template_id)
        elif self.project_data.templates:
            self.switch_template(self.project_data.templates[0].id)

    @staticmethod
    def _migrate_project_payload(data: dict) -> dict:
        """Normalize supported project payloads to the current schema version."""
        source_version = str(data.get("version", "1.0"))
        if source_version in LEGACY_PROJECT_SCHEMA_VERSIONS:
            migrated = copy.deepcopy(data)
            migrated["version"] = PROJECT_SCHEMA_VERSION
            return migrated
        if source_version == PROJECT_SCHEMA_VERSION:
            return data
        raise JsonValidationError(f"不支持的项目数据版本: {source_version}")

    # --- 模板管理 ---

    def create_template(self, name: str = None, persist: bool = True) -> Template:
        if not name:
            name = self._generate_unique_template_name()
            
        # 初始 Tiers
        default_tiers = [
            TierRow(id=str(uuid.uuid4()), label="S", color="#FF7F7F"),
            TierRow(id=str(uuid.uuid4()), label="A", color="#FFBF7F"),
            TierRow(id=str(uuid.uuid4()), label="B", color="#FFFF7F"),
            TierRow(id=str(uuid.uuid4()), label="C", color="#7FFFFF"),
            TierRow(id=str(uuid.uuid4()), label="D", color="#7F7FFF"),
        ]
        
        # 新模板只包含两个空的基础图片分组，不继承其他模板或全局母版的图片。
        hidden_preset = ImageLibrary()
        self._ensure_library_groups(hidden_preset)
        library_group_states = {
            group.id: False for group in hidden_preset.groups
        }
        
        new_template = Template(
            id=str(uuid.uuid4()),
            name=name,
            created_at=time.time(),
            tiers=default_tiers,
            unassigned_images=[],  # 新模板没有未分配图片
            library_group_states=library_group_states,
            hidden_preset=hidden_preset,
        )

        self.project_data.templates.append(new_template)
        self.switch_template(new_template.id)
        if persist:
            self.save_project()
        return new_template

    def _generate_unique_template_name(self) -> str:
        existing_names = {t.name for t in self.project_data.templates}
        i = 1
        while f"模板({i})" in existing_names:
            i += 1
        return f"模板({i})"

    def switch_template(self, template_id: str):
        for t in self.project_data.templates:
            if t.id == template_id:
                self.current_template = t
                self.project_data.current_template_id = t.id
                return
        raise ValueError(f"Template {template_id} not found")

    def rename_current_template(self, new_name: str):
        if self.current_template:
            self.current_template.name = new_name
            self.save_project()

    def delete_current_template(self):
        """删除当前模板，并切换到其他模板"""
        if not self.current_template:
            return

        # 1. 从列表中移除
        self.project_data.templates.remove(self.current_template)
        
        # 2. 如果没模板了，创建一个新的默认模板
        if not self.project_data.templates:
            self.create_template()
        else:
            # 3. 切换到第一个模板
            self.switch_template(self.project_data.templates[0].id)
            
        self.save_project()

    def move_library_group(self, from_index: int, to_index: int):
        """移动分组顺序"""
        groups = self._lib().groups
        if 0 <= from_index < len(groups) and 0 <= to_index < len(groups):
            item = groups.pop(from_index)
            groups.insert(to_index, item)
            self.save_project()

    def delete_library_group(self, group_id: str):
        """删除图片库分组，其中的图片移动到第一个分组"""
        groups = self._lib().groups
        if len(groups) <= 1:
            # 只有一个分组时不让删，或者删了也没地方移
            return

        # 找到要删除的分组
        target_group = None
        target_index = -1
        for i, g in enumerate(groups):
            if g.id == group_id:
                target_group = g
                target_index = i
                break
        
        if not target_group:
            return

        # 确定目标分组 (通常是第0个，如果删的是第0个，则移到第1个)
        dest_group_index = 0
        if target_index == 0:
            dest_group_index = 1
        
        dest_group = groups[dest_group_index]
        
        # 移动图片
        dest_group.image_ids.extend(target_group.image_ids)
        
        # 删除分组
        groups.remove(target_group)
        self.save_project()

    def set_library_group_expanded(self, group_id: str, expanded: bool):
        if not self.current_template:
            return
        
        self.current_template.library_group_states[group_id] = expanded
        self.save_project()

    def add_tier_row(self, label: str = "NEW", color: str = "#808080"):
        """添加一个新的等级行"""
        if not self.current_template:
            return
            
        new_row = TierRow(
            id=str(uuid.uuid4()),
            label=label,
            color=color,
            image_ids=[]
        )
        self.current_template.tiers.append(new_row)
        self.save_project()

    def delete_tier_row(self, tier_id: str):
        """删除等级行，其中的图片移到 Unassigned"""
        if not self.current_template:
            return
            
        # 找到要删除的行
        target_row = None
        for row in self.current_template.tiers:
            if row.id == tier_id:
                target_row = row
                break
        
        if target_row:
            # 转移图片到 Unassigned
            self.current_template.unassigned_images.extend(target_row.image_ids)
            self.current_template.tiers.remove(target_row)
            self.save_project()

    def rename_tier_row(self, tier_id: str, new_name: str):
        if not self.current_template:
            return
        for row in self.current_template.tiers:
            if row.id == tier_id:
                row.label = new_name
                self.save_project()
                break

    def set_tier_color(self, tier_id: str, new_color: str):
        if not self.current_template:
            return
        for row in self.current_template.tiers:
            if row.id == tier_id:
                row.color = new_color
                self.save_project()
                break

    def move_tier_row(self, from_index: int, to_index: int):
        if not self.current_template:
            return
        tiers = self.current_template.tiers
        if 0 <= from_index < len(tiers) and 0 <= to_index < len(tiers):
            item = tiers.pop(from_index)
            tiers.insert(to_index, item)
            self.save_project()

    # --- 图片操作 (针对当前模板) ---

    def upload_image(self, file_path: str):
        """上传图片到当前模板的'上传的图片'分组"""
        if not self.current_template:
            return

        # 1. 物理导入
        try:
            rel_path, image_id = self.image_svc.import_image(file_path)
            filename = os.path.basename(file_path)

            # 2. 注册元数据
            img_obj = TierImage(id=image_id, path=rel_path, original_name=filename)
            self.project_data.shared_images_meta[image_id] = img_obj

            # 3. 确保"上传的图片"分组存在——先尝试复用已有分组，没有则新建
            self._ensure_library_groups(self._lib())
            target_group = self._lib().find_group_by_id(LOCAL_UPLOAD_GROUP_ID)
            if not target_group:
                # 兜底：如果 _ensure_library_groups 因任何原因未创建成功，直接创建
                target_group = ImageGroup(id=LOCAL_UPLOAD_GROUP_ID, name=LOCAL_UPLOAD_GROUP_NAME, image_ids=[])
                # 插入到搜索分组之后
                search_group = self._lib().find_group_by_id(SEARCH_RESULTS_GROUP_ID)
                if search_group:
                    insert_at = self._lib().groups.index(search_group) + 1
                    self._lib().groups.insert(insert_at, target_group)
                else:
                    self._lib().groups.append(target_group)
                if self.current_template:
                    self.current_template.library_group_states[LOCAL_UPLOAD_GROUP_ID] = True
            target_group.image_ids.append(image_id)
            # 同步存入当前模板的隐藏预设
            self._add_to_hidden_preset(image_id, LOCAL_UPLOAD_GROUP_ID)

            self.save_project()
            return img_obj
        except ProjectSaveError:
            raise
        except Exception as e:
            print(f"Error uploading {file_path}: {e}")
            return None

    def upload_folder(self, folder_path: str):
        """批量上传文件夹内的所有图片"""
        if not self.current_template or not os.path.isdir(folder_path):
            return

        valid_exts = {'.png', '.jpg', '.jpeg', '.bmp', '.gif', '.webp'}
        count = 0
        
        # 1. 遍历文件夹
        for root, _, files in os.walk(folder_path):
            for file in files:
                ext = os.path.splitext(file)[1].lower()
                if ext in valid_exts:
                    full_path = os.path.join(root, file)
                    # 复用单张上传逻辑，但为了性能可以先不 save_project
                    # 这里为了代码简单直接调用，稍后统一 save
                    self._upload_image_no_save(full_path)
                    count += 1
        
        if count > 0:
            self.save_project()
        return count

    def _upload_image_no_save(self, file_path: str):
        """内部使用的不自动保存的上传方法"""
        try:
            rel_path, image_id = self.image_svc.import_image(file_path)
            filename = os.path.basename(file_path)
            img_obj = TierImage(id=image_id, path=rel_path, original_name=filename)
            self.project_data.shared_images_meta[image_id] = img_obj
            self._ensure_library_groups(self._lib())
            target_group = self._lib().find_group_by_id(LOCAL_UPLOAD_GROUP_ID)
            if not target_group:
                target_group = ImageGroup(id=LOCAL_UPLOAD_GROUP_ID, name=LOCAL_UPLOAD_GROUP_NAME, image_ids=[])
                search_group = self._lib().find_group_by_id(SEARCH_RESULTS_GROUP_ID)
                if search_group:
                    insert_at = self._lib().groups.index(search_group) + 1
                    self._lib().groups.insert(insert_at, target_group)
                else:
                    self._lib().groups.append(target_group)
            target_group.image_ids.append(image_id)
            self._add_to_hidden_preset(image_id, LOCAL_UPLOAD_GROUP_ID)
        except Exception:
            pass

    def delete_image_from_template(self, image_id: str):
        """仅从当前模板中移除图片引用"""
        if not self.current_template:
            return
            
        t = self.current_template
        
        # 1. 检查 Tiers
        for tier in t.tiers:
            if image_id in tier.image_ids:
                tier.image_ids.remove(image_id)
                
        # 2. 检查 Library
        for group in self._lib().groups:
            if image_id in group.image_ids:
                group.image_ids.remove(image_id)
                
        # 3. 检查 Unassigned
        if image_id in t.unassigned_images:
            t.unassigned_images.remove(image_id)
            
        self.save_project()

    def delete_image_globally(self, image_id: str):
        """全局删除图片（所有模板、预设库）"""
        # 0. 从共享数据中移除
        if image_id in self.project_data.shared_images_meta:
            del self.project_data.shared_images_meta[image_id]
        
        # 从共享图片库中移除
        for group in self._lib().groups:
            if image_id in group.image_ids:
                group.image_ids.remove(image_id)
        
        # 1. 从所有模板中移除
        for t in self.project_data.templates:
            # Tiers
            for tier in t.tiers:
                if image_id in tier.image_ids:
                    tier.image_ids.remove(image_id)

            # Unassigned
            if image_id in t.unassigned_images:
                t.unassigned_images.remove(image_id)

                
        # 2. 从全局预设中移除
        for group in self.project_data.global_preset_library.groups:
            if image_id in group.image_ids:
                group.image_ids.remove(image_id)

        # 2.5 从所有模板的隐藏预设中移除
        self._remove_from_all_hidden_presets(image_id)

        # 3. 物理删除本地文件
        self.image_svc.delete_image_files(image_id)

        self.save_project()

    def move_image(self, image_id: str, source_type: str, source_id: str, target_type: str, target_id: str, index: int = -1):
        """
        在图片组、未排序列表和等级行之间移动图片，当前模板中只保留一个位置。
        Types: 'library_group', 'tier', 'unassigned'
        """
        if not self.current_template:
            return

        if target_type not in ('library_group', 'tier', 'unassigned'):
            return

        self._remove_layout_refs(image_id)
        self._remove_library_refs(image_id)
        self._add_image_ref(target_type, target_id, image_id, index)
        self.save_project()

    def _remove_layout_refs(self, image_id: str):
        """从当前模板的等级行和未排序列表移除图片引用。"""
        t = self.current_template
        for tier in (t.tiers if t else []):
            if image_id in tier.image_ids:
                tier.image_ids.remove(image_id)
        if t and image_id in t.unassigned_images:
            t.unassigned_images.remove(image_id)

    def _remove_library_refs(self, image_id: str):
        """从当前模板的所有图片库分组移除图片引用。"""
        for group in self._lib().groups:
            if image_id in group.image_ids:
                group.image_ids.remove(image_id)

    def _add_image_ref(self, zone_type: str, zone_id: str, image_id: str, index: int):
        t = self.current_template
        target_list = None

        if zone_type == 'tier':
            for tier in t.tiers:
                if tier.id == zone_id:
                    target_list = tier.image_ids
                    break
        elif zone_type == 'unassigned':
            target_list = t.unassigned_images
        elif zone_type == 'library_group':
            group = self._lib().find_group_by_id(zone_id)
            if group:
                target_list = group.image_ids

        if target_list is not None:
            # Prevent duplicates: remove if already present before re-inserting
            if image_id in target_list:
                target_list.remove(image_id)
            if index == -1 or index >= len(target_list):
                target_list.append(image_id)
            else:
                target_list.insert(index, image_id)

    # --- 全局预设 ---
    
    def save_current_library_as_preset(self):
        """保存当前模板的图片库状态为全局预设（母版）"""
        if not self.current_template:
            return

        self.project_data.shared_image_library = copy.deepcopy(self._lib())
        self.save_project()

    def get_tier_rows(self) -> List[TierRow]:
        return self.current_template.tiers if self.current_template else []

    def get_library_groups(self) -> List[ImageGroup]:
        return self._lib().groups

    def create_library_group(self, name: str):
        """创建新的图片库分组"""
        import uuid
        new_group = ImageGroup(id=str(uuid.uuid4()), name=name, image_ids=[])
        self._lib().groups.append(new_group)
        # Initialize expanded state for current template
        if self.current_template:
            self.current_template.library_group_states[new_group.id] = True
        self.save_project()
        return new_group

    def clear_group_images(self, group_id: str):
        """清空指定分组的所有图片，同时从 unassigned 和 tiers 中移除"""
        group = self._lib().find_group_by_id(group_id)
        if not group:
            return
        image_ids = list(group.image_ids)
        group.image_ids.clear()
        # Remove from unassigned and all tiers in all templates
        for tmpl in self.project_data.templates:
            tmpl.unassigned_images = [id for id in tmpl.unassigned_images if id not in image_ids]
            for tier in tmpl.tiers:
                tier.image_ids = [id for id in tier.image_ids if id not in image_ids]
        self.save_project()

    def delete_images_by_steam_id(self, steam_id: str) -> int:
        """删除指定 Steam ID 关联的所有图片（不删账号配置）"""
        ids_to_delete = []
        for img_id, meta in self.project_data.shared_images_meta.items():
            if getattr(meta, 'steam_id', '') == steam_id:
                ids_to_delete.append(img_id)
        for img_id in ids_to_delete:
            self.delete_image_globally(img_id)
        self.save_project()
        return len(ids_to_delete)

    def register_remote_images(self, games, steam_id, group_id, replace_group=False):
        """注册或复用平台图片，并把尚未排序的图片放入账号图片组。

        replace_group=True 时只重建未放入布局的分组引用；已经位于未排序列表
        或等级行中的图片保持原位，不会重新出现在图片组。返回识别到的封面数。
        """
        if not self.current_template:
            return 0
        import uuid as _uuid
        count = 0
        changed = False
        group = self._lib().find_group_by_id(group_id)
        if not group:
            group = ImageGroup(id=group_id, name=group_id, image_ids=[])
            self._lib().groups.append(group)
            if self.current_template:
                self.current_template.library_group_states[group_id] = True
            changed = True

        previous_group_ids = set(group.image_ids)
        for image_id in previous_group_ids:
            meta = self.project_data.shared_images_meta.get(image_id)
            if meta and not getattr(meta, 'source_group_id', ''):
                meta.source_group_id = group_id
                changed = True

        layout_image_ids = set(self.current_template.unassigned_images)
        for tier in self.current_template.tiers:
            layout_image_ids.update(tier.image_ids)

        if replace_group and group.image_ids:
            group.image_ids.clear()
            changed = True

        processed_names = set()
        for game in games:
            cover_url = (game.get("cover") or {}).get("url", "")
            if not cover_url:
                continue
            if cover_url.startswith("//"):
                cover_url = "https:" + cover_url
            appid = str(game.get("appid", ""))
            game_name = game.get("name", "")
            target_name = appid + ".jpg"
            if not appid or target_name in processed_names:
                continue
            processed_names.add(target_name)

            # 优先使用已标记的来源身份；兼容旧项目中仅靠 Steam ID、原图片组
            # 或当前布局引用识别的平台图片。
            candidates = []
            for img_id, meta in self.project_data.shared_images_meta.items():
                if meta.original_name != target_name:
                    continue

                source_group_id = getattr(meta, 'source_group_id', '')
                meta_steam_id = getattr(meta, 'steam_id', '')
                priority = None
                if source_group_id == group_id:
                    priority = 0
                elif not source_group_id and img_id in previous_group_ids:
                    priority = 1
                elif not source_group_id and steam_id and meta_steam_id == steam_id:
                    priority = 2
                elif (not source_group_id and not steam_id and not meta_steam_id
                        and img_id in layout_image_ids):
                    priority = 3

                if priority is not None:
                    candidates.append((priority, img_id, meta))

            existing = min(candidates, default=None, key=lambda item: item[0])
            if existing:
                _, image_id, meta = existing
                item_changed = False

                if getattr(meta, 'source_group_id', '') != group_id:
                    meta.source_group_id = group_id
                    item_changed = True

                if game_name and meta.game_name != game_name:
                    meta.game_name = game_name
                    item_changed = True

                if meta.remote_failed:
                    meta.remote_failed = False
                    meta.is_remote = True
                    meta.path = cover_url
                    item_changed = True

                if image_id not in layout_image_ids and image_id not in group.image_ids:
                    group.image_ids.append(image_id)
                    item_changed = True

                if item_changed:
                    changed = True
                count += 1
                continue

            image_id = str(_uuid.uuid4())
            img_obj = TierImage(
                id=image_id, path=cover_url,
                original_name=target_name,
                steam_id=steam_id, source_group_id=group_id, is_remote=True,
                game_name=game_name
            )
            self.project_data.shared_images_meta[image_id] = img_obj
            group.image_ids.append(image_id)
            count += 1
            changed = True

        if changed:
            self.save_project()
        return count

    # def backfill_remote_images(self, steam_id="", limit=0):
    #     """后台下载远程图片到本地。直连失败(404)时用游戏名搜索兜底。
    #     limit>0 时每次最多处理 limit 张。返回 (ok, fail)。"""
    #     import logging
    #     _log = logging.getLogger(__name__)
    #     ok = fail = 0
    #     remote_items = [
    #         (img_id, meta)
    #         for img_id, meta in self.project_data.shared_images_meta.items()
    #         if meta.is_remote and not meta.remote_failed
    #         and (not steam_id or meta.steam_id == steam_id)
    #     ]
    #     batch = remote_items[:limit] if limit > 0 else remote_items
    #     for img_id, meta in batch:
    #         local_path = self.image_svc.download_remote_to_local(img_id, meta.path)
    #         if local_path and local_path != "__404__":
    #             meta.is_remote = False
    #             meta.path = local_path
    #         self.project_data.shared_images_meta[image_id] = img_obj
    #         group.image_ids.append(image_id)
    #         count += 1
    #
    #     if count:
    #         self.save_project()
    #     return count

    def backfill_remote_images(self, steam_id="", limit=0):
        """后台下载远程图片到本地。先将原图存入 source cache，再复制到 images/。
        limit>0 时每次最多处理 limit 张。返回 (ok, fail)。"""
        import logging
        _log = logging.getLogger(__name__)
        ok = fail = 0
        remote_items = [
            (img_id, meta)
            for img_id, meta in self.project_data.shared_images_meta.items()
            if meta.is_remote and not meta.remote_failed
            and (not steam_id or meta.steam_id == steam_id)
        ]
        batch = remote_items[:limit] if limit > 0 else remote_items
        for img_id, meta in batch:
            appid = meta.original_name.replace(".jpg", "").replace(".png", "")
            source = "steam" if meta.steam_id else self._detect_source(meta.path)

            cache_path = self.download_to_source_cache(
                meta.path,
                source,
                appid,
                game_name=meta.game_name,
            )
            if not cache_path or cache_path == "__404__":
                # 下载失败 / 404 → 统一走游戏名搜索兜底
                _log.info(
                    "原封面不可用，开始兜底搜索: 游戏=%s, url=%s",
                    (meta.game_name or "").strip() or "未知游戏",
                    meta.path,
                )
                rescued = self._search_fallback_download(img_id, meta)
                if rescued:
                    ok += 1
                else:
                    meta.remote_failed = True
                    fail += 1
                continue

            local_path = self.image_svc.copy_from_cache(img_id, cache_path)
            if local_path:
                meta.is_remote = False
                meta.path = local_path
                ok += 1
            else:
                meta.remote_failed = True
                fail += 1
        if ok or fail:
            self.save_project()
        remaining = sum(
            1 for m in self.project_data.shared_images_meta.values()
            if m.is_remote and not m.remote_failed
        )
        _log.info("backfill: %d ok, %d fail, %d remaining", ok, fail, remaining)
        return ok, fail

    def _search_fallback_download(self, image_id, meta):
        """搜索兜底：用 game_name 搜索封面，下载到源缓存再导入。成功返回 True。"""
        import logging
        _log = logging.getLogger(__name__)
        name = (meta.game_name or "").strip()
        if not name:
            _log.warning(
                "跳过封面兜底搜索: 缺少游戏名称, image_id=%s, url=%s",
                image_id,
                meta.path,
            )
            return False

        _log.info("调用封面兜底搜索: 游戏=%s", name)
        try:
            results = self.search_only(name)
        except AppError as exc:
            _log.info("封面兜底搜索失败: %s (%s)", name, exc.code)
            return False
        if not results or not isinstance(results, list):
            _log.info("封面兜底搜索无结果: 游戏=%s", name)
            return False

        cover_url = (results[0].get("cover") or {}).get("url", "")
        if not cover_url:
            _log.info("封面兜底结果缺少图片地址: 游戏=%s", name)
            return False

        # 获取 appid 作为缓存文件名
        appid = meta.original_name.replace(".jpg", "")
        if not appid:
            _log.warning("封面兜底下载跳过: 游戏=%s 缺少文件标识", name)
            return False

        # 先存到源缓存
        source = self._detect_source(cover_url)
        cache_path = self.download_to_source_cache(
            cover_url,
            source,
            appid,
            game_name=name,
        )
        if not cache_path or cache_path == "__404__":
            _log.warning(
                "封面兜底候选下载失败: 游戏=%s, url=%s",
                name,
                cover_url,
            )
            return False

        local_path = self.image_svc.copy_from_cache(image_id, cache_path)
        if not local_path:
            _log.warning("封面兜底导入失败: 游戏=%s, cache=%s", name, cache_path)
            return False

        meta.path = local_path
        meta.is_remote = False
        meta.remote_failed = False
        _log.info("封面兜底成功: 游戏=%s, path=%s", name, local_path)
        return True
