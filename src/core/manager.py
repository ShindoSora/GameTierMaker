import os
import uuid
import time
import copy
import logging
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator, List, Optional
from urllib.parse import urlsplit

from .models import (
    ProjectData, Template, TierRow, ImageLibrary, 
    ImageGroup, TierImage, ProjectEncoder
)
from .image_svc import ImageService, SOURCE_CACHE_FOLDERS
from .errors import (
    AppError,
    ImageImportError,
    InvalidInputError,
    RemoteServiceError,
    RemoteTimeoutError,
)
from .image_security import (
    RemoteImageNotFoundError,
    download_public_image,
    safe_cache_key,
    validate_image_file,
)
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
        self._backfill_lock = threading.Lock()
        self._backfill_retry_after: dict[str, float] = {}
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

    def get_template(
        self,
        template_id: str | None = None,
        *,
        required: bool = True,
    ) -> Optional[Template]:
        """按 ID 获取模板；未传 ID 时兼容使用当前模板。"""
        with self._save_lock:
            if template_id:
                template = next(
                    (item for item in self.project_data.templates if item.id == template_id),
                    None,
                )
            else:
                template = self.current_template

            if required and template is None:
                raise InvalidInputError(
                    "模板不存在或已被删除",
                    code="template_not_found",
                )
            return template

    def get_library_for_template(
        self,
        template_id: str | None = None,
    ) -> ImageLibrary:
        """返回指定模板的图片库，不改变全局的当前模板。"""
        template = self.get_template(template_id)
        return template.hidden_preset

    @contextmanager
    def template_scope(
        self,
        template_id: str | None = None,
    ) -> Iterator[Template]:
        """在同一把操作锁内临时使用指定模板，并在结束后恢复。"""
        with self._save_lock:
            template = self.get_template(template_id)
            previous = self.current_template
            previous_id = previous.id if previous else None
            self.current_template = template
            try:
                yield template
            finally:
                self.current_template = next(
                    (
                        item
                        for item in self.project_data.templates
                        if item.id == previous_id
                    ),
                    None,
                )

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
        """仅接受当前分组图片 ID 的完整排列，避免请求丢失或注入引用。"""
        with self._save_lock:
            group = self._lib().find_group_by_id(group_id)
            if not group:
                raise InvalidInputError(
                    "图片分组不存在或已被删除",
                    code="library_group_not_found",
                )
            requested_ids = list(image_ids)
            if (
                len(requested_ids) != len(group.image_ids)
                or len(set(requested_ids)) != len(requested_ids)
                or set(requested_ids) != set(group.image_ids)
            ):
                raise InvalidInputError(
                    "图片顺序必须包含该分组中的全部图片且不能重复",
                    code="invalid_group_image_order",
                )
            group.image_ids = requested_ids
            self.save_project()

    @staticmethod
    def _validate_reorder_indices(
        items: list,
        from_index: int,
        to_index: int,
        *,
        code: str,
    ) -> None:
        if (
            not isinstance(from_index, int)
            or not isinstance(to_index, int)
            or not 0 <= from_index < len(items)
            or not 0 <= to_index < len(items)
        ):
            raise InvalidInputError(
                "排序位置超出范围，请刷新后重试",
                code=code,
            )

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
        with self._save_lock:
            return [
                {
                    "template_id": template.id,
                    "template_name": template.name,
                    "total_images": sum(
                        len(group.image_ids)
                        for group in template.hidden_preset.groups
                    ),
                    "groups": [
                        {
                            "id": group.id,
                            "name": group.name,
                            "image_ids": list(group.image_ids),
                        }
                        for group in template.hidden_preset.groups
                    ],
                }
                for template in self.project_data.templates
            ]

    def import_hidden_preset(self, source_template_id: str):
        with self._save_lock:
            target = self.get_template()
            library_snapshot = copy.deepcopy(target.hidden_preset)
            state_snapshot = dict(target.library_group_states)
            try:
                return self._import_hidden_preset_locked(source_template_id)
            except Exception:
                target.hidden_preset = library_snapshot
                target.library_group_states = state_snapshot
                raise

    def _import_hidden_preset_locked(self, source_template_id: str):
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
        occupied_image_ids = set(self.current_template.unassigned_images)
        for tier in self.current_template.tiers:
            occupied_image_ids.update(tier.image_ids)
        for group in self.current_template.hidden_preset.groups:
            occupied_image_ids.update(group.image_ids)
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
                    if img_id not in occupied_image_ids:
                        target_group.image_ids.append(img_id)
                        occupied_image_ids.add(img_id)
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
        if source not in self._source_folders():
            raise InvalidInputError(
                "缓存来源不正确",
                code="cache_source_invalid",
            )
        data_root = Path(self.data_dir).resolve()
        directory = (data_root / source).resolve()
        if directory.parent != data_root:
            raise InvalidInputError(
                "缓存目录不正确",
                code="cache_source_invalid",
            )
        directory.mkdir(parents=True, exist_ok=True)
        return str(directory)

    def _source_cache_path(self, source, file_id):
        """源缓存文件路径，检测扩展名"""
        base = os.path.join(self._source_cache_dir(source), safe_cache_key(file_id))
        for ext in (".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"):
            p = base + ext
            if os.path.exists(p):
                return p
        return base + ".jpg"

    def download_to_source_cache(
        self,
        url,
        source,
        file_id,
        game_name="",
        *,
        raise_errors=False,
    ):
        """下载到源缓存目录。缓存命中直接返回路径；404 返回 '__404__'；失败返回 ''。"""
        target = self._source_cache_path(source, safe_cache_key(file_id))
        display_name = (game_name or "").strip() or "未知游戏"
        if os.path.exists(target):
            try:
                validate_image_file(target)
                logger.info("源缓存命中: 游戏=%s, path=%s", display_name, target)
                return target
            except InvalidInputError:
                logger.warning("源缓存图片无效，重新下载: 游戏=%s, path=%s", display_name, target)
                try:
                    os.remove(target)
                except OSError as exc:
                    logger.error("无法删除无效源缓存: %s -> %s", target, exc)
                    if raise_errors:
                        raise ImageImportError(
                            "无法替换损坏的图片缓存",
                            code="image_cache_replace_failed",
                        ) from exc
                    return ""
        if isinstance(url, str) and url.startswith("//"):
            url = "https:" + url
        if isinstance(url, str) and "t_thumb" in url:
            url = url.replace("t_thumb", "t_1080p")
        try:
            downloaded_path = download_public_image(url, target)
            logger.info(
                "源缓存下载成功: 游戏=%s, url=%s -> %s",
                display_name,
                url,
                downloaded_path,
            )
            return downloaded_path
        except RemoteImageNotFoundError:
            logger.info("源缓存 404: 游戏=%s, url=%s", display_name, url)
            if raise_errors:
                raise
            return "__404__"
        except AppError as exc:
            logger.error(
                "源缓存下载失败: 游戏=%s, url=%s -> %s (%s)",
                display_name,
                url,
                exc.message,
                exc.code,
            )
            if raise_errors:
                raise
            return ""

    def _detect_source(self, url):
        """根据固定 CDN 主机判断图片来源，避免 URL 字符串误匹配。"""
        try:
            host = (urlsplit(str(url)).hostname or "").rstrip(".").lower()
        except ValueError:
            host = ""

        def host_matches(*suffixes):
            return any(host == suffix or host.endswith("." + suffix) for suffix in suffixes)

        if host_matches("steamstatic.com", "steampowered.com", "steamcdn-a.akamaihd.net"):
            return "steam"
        if host_matches("images.igdb.com"):
            return "igdb"
        if host_matches("bgm.tv", "bangumi.tv"):
            return "bangumi"
        if host_matches("vndb.org"):
            return "vndb"
        if host_matches("steamgriddb.com"):
            return "steamgriddb"
        if host_matches("store-images.s-microsoft.com", "store-images.microsoft.com", "assets.xboxservices.com"):
            return "xbox"
        if host_matches("znej.nintendo.com", "entry.nintendo.co.jp", "ec.nintendo.com"):
            return "nintendo"
        return "cache"

    def download_image_to_folder(
        self,
        url: str,
        game_name: str,
        game_id: str,
        *,
        source: str = "",
        asset_id: str = "",
    ) -> str:
        """下载图片到源缓存目录；新搜索请求显式传来源和图片资产。"""
        source = source.strip().lower() if isinstance(source, str) else ""
        if not source:
            source = self._detect_source(url)
        if source not in self._source_folders():
            raise InvalidInputError(
                "图片来源不正确",
                code="image_source_invalid",
            )
        # Keep the old game-id cache key for old callers. New providers must
        # include the asset ID so multiple SGDB grids cannot overwrite each
        # other. The cache helper hashes separators into a Windows-safe key.
        file_id = game_id
        if asset_id:
            file_id = f"{game_id}:{asset_id}"
        return self.download_to_source_cache(
            url,
            source,
            file_id,
            game_name=game_name,
            raise_errors=True,
        )

    def clear_all_source_folders(self):
        """清空所有源缓存目录"""
        count = 0
        for source in self._source_folders():
            count += self.clear_source_folder(source)
        return count

    def clear_source_folder(self, folder):
        """清空指定来源的缓存目录，返回删除数量"""
        import shutil
        if folder not in self._source_folders():
            raise InvalidInputError(
                "缓存来源不正确",
                code="cache_source_invalid",
            )
        count = 0
        data_root = Path(self.data_dir).resolve()
        directory = (data_root / folder).resolve()
        if directory.parent != data_root:
            raise InvalidInputError(
                "缓存目录不正确",
                code="cache_source_invalid",
            )
        if directory.exists():
            for item in directory.iterdir():
                try:
                    if item.is_file():
                        item.unlink()
                        count += 1
                    elif item.is_dir():
                        shutil.rmtree(item)
                        count += 1
                except OSError:
                    logger.warning("缓存项删除失败: %s", item, exc_info=True)
        return count

    @staticmethod
    def _source_folders():
        """所有图片来源文件夹名"""
        return SOURCE_CACHE_FOLDERS

    def reset_all_images(self):
        """清除所有图片数据：库图片、隐藏预设、源缓存、缩略图 —— 恢复初始状态"""
        import shutil
        with self._backfill_lock, self._save_lock:
            count = 0
            snapshot = copy.deepcopy(self.project_data)
            current_id = self.current_template.id if self.current_template else None
            retry_snapshot = dict(self._backfill_retry_after)

            for template in self.project_data.templates:
                for tier in template.tiers:
                    count += len(tier.image_ids)
                    tier.image_ids.clear()
                count += len(template.unassigned_images)
                template.unassigned_images.clear()
                for group in template.hidden_preset.groups:
                    count += len(group.image_ids)
                    group.image_ids.clear()

            for library in (
                self.project_data.shared_image_library,
                self.project_data.global_preset_library,
            ):
                for group in library.groups:
                    count += len(group.image_ids)
                    group.image_ids.clear()

            count += len(self.project_data.shared_images_meta)
            self.project_data.shared_images_meta.clear()
            self._backfill_retry_after.clear()

            try:
                self.save_project()
            except Exception:
                self._restore_project_snapshot(snapshot, current_id)
                self._backfill_retry_after = retry_snapshot
                raise

            count += self.clear_all_source_folders()
            for sub in ("images", "thumbnails"):
                directory = (Path(self.data_dir) / sub).resolve()
                if directory.parent != Path(self.data_dir).resolve() or not directory.exists():
                    continue
                for item in directory.iterdir():
                    try:
                        if item.is_file():
                            item.unlink()
                            count += 1
                        elif item.is_dir():
                            shutil.rmtree(item)
                            count += 1
                    except OSError:
                        logger.warning("重置图片时无法删除: %s", item, exc_info=True)
            return count

    def import_image_to_library(
        self,
        file_path: str,
        add_to_unassigned: bool = False,
        group_id: str | None = None,
        steam_id: str = "",
    ) -> TierImage:
        """将已验证的本地图片导入当前模板；失败时不留下半成品。"""
        target_group_id = group_id or SEARCH_RESULTS_GROUP_ID
        existing = self._lib().find_group_by_id(target_group_id)
        target_group_name = (
            existing.name
            if existing
            else (SEARCH_RESULTS_GROUP_NAME if not group_id else target_group_id)
        )
        return self._import_local_image_transaction(
            file_path,
            target_group_id=target_group_id,
            target_group_name=target_group_name,
            original_name=os.path.basename(file_path),
            steam_id=steam_id,
            source_group_id=group_id or "",
            add_to_unassigned=add_to_unassigned,
        )

    def _import_local_image_transaction(
        self,
        file_path: str,
        *,
        target_group_id: str,
        target_group_name: str,
        original_name: str,
        steam_id: str = "",
        source_group_id: str = "",
        add_to_unassigned: bool = False,
    ) -> TierImage:
        """复制文件、更新引用并原子保存；任一步失败都会回滚内存和新文件。"""
        with self._save_lock:
            template = self.get_template()
            validate_image_file(file_path)
            library_snapshot = copy.deepcopy(template.hidden_preset)
            group_states_snapshot = dict(template.library_group_states)
            unassigned_snapshot = list(template.unassigned_images)
            image_id = ""
            try:
                rel_path, image_id = self.image_svc.import_image(file_path)
                image = TierImage(
                    id=image_id,
                    path=rel_path,
                    original_name=original_name,
                    steam_id=steam_id,
                    source_group_id=source_group_id,
                )
                self.project_data.shared_images_meta[image_id] = image

                self._ensure_library_groups(template.hidden_preset)
                target_group = template.hidden_preset.find_group_by_id(target_group_id)
                if target_group is None:
                    target_group = ImageGroup(
                        id=target_group_id,
                        name=target_group_name,
                        image_ids=[],
                    )
                    template.hidden_preset.groups.append(target_group)
                    template.library_group_states[target_group_id] = True
                target_group.image_ids.append(image_id)

                if add_to_unassigned:
                    # 一个模板内只允许一个位置；调用方要求进入未排序区时，
                    # 不再同时保留图片组引用。
                    target_group.image_ids.remove(image_id)
                    template.unassigned_images.append(image_id)

                self.save_project()
                return image
            except Exception as exc:
                if image_id:
                    self.project_data.shared_images_meta.pop(image_id, None)
                template.hidden_preset = library_snapshot
                template.library_group_states = group_states_snapshot
                template.unassigned_images = unassigned_snapshot
                if image_id:
                    try:
                        self.image_svc.delete_image_files(image_id)
                    except OSError:
                        logger.warning("清理失败的图片导入文件失败: %s", image_id, exc_info=True)
                if isinstance(exc, (AppError, ProjectSaveError)):
                    raise
                logger.exception("图片导入失败: %s", file_path)
                raise ImageImportError(
                    "图片无法导入，请检查文件内容和数据目录权限",
                    code="image_import_failed",
                ) from exc

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
                if group.id.startswith("psn_import_") or group.id.startswith("xbox:"):
                    for image_id in group.image_ids:
                        meta = self.project_data.shared_images_meta.get(image_id)
                        if meta and not getattr(meta, "source_group_id", ""):
                            meta.source_group_id = group.id

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
        """创建模板，并让追加、切换与持久化处于同一个事务锁中。"""
        with self._save_lock:
            snapshot = copy.deepcopy(self.project_data)
            current_id = self.current_template.id if self.current_template else None
            try:
                return self._create_template_locked(name=name, persist=persist)
            except Exception:
                self._restore_project_snapshot(snapshot, current_id)
                raise

    def _create_template_locked(self, name: str = None, persist: bool = True) -> Template:
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

    def switch_template(self, template_id: str, *, persist: bool = False):
        with self._save_lock:
            previous = self.current_template
            previous_id = self.project_data.current_template_id
            for t in self.project_data.templates:
                if t.id == template_id:
                    self.current_template = t
                    self.project_data.current_template_id = t.id
                    try:
                        if persist:
                            self.save_project()
                    except Exception:
                        self.current_template = previous
                        self.project_data.current_template_id = previous_id
                        raise
                    return
            raise ValueError(f"Template {template_id} not found")

    def rename_current_template(self, new_name: str):
        if self.current_template:
            self.rename_template(self.current_template.id, new_name)

    def rename_template(self, template_id: str, new_name: str) -> Template:
        """按 ID 重命名模板，不依赖可变化的当前模板状态。"""
        with self._save_lock:
            template = self.get_template(template_id)
            normalized_name = str(new_name or "").strip()
            if not normalized_name:
                raise InvalidInputError(
                    "模板名称不能为空",
                    code="template_name_required",
                )
            previous_name = template.name
            template.name = normalized_name
            try:
                self.save_project()
            except Exception:
                template.name = previous_name
                raise
            return template

    def delete_current_template(self):
        """删除当前模板，并切换到其他模板"""
        if not self.current_template:
            return
        self.delete_template(self.current_template.id)

    def delete_template(self, template_id: str) -> Template:
        """按 ID 删除模板；仅在删除当前模板时选择新的当前模板。"""
        with self._save_lock:
            snapshot = copy.deepcopy(self.project_data)
            current_id = self.current_template.id if self.current_template else None
            template = self.get_template(template_id)
            deleting_current = self.current_template is template
            self.project_data.templates.remove(template)

            if not self.project_data.templates:
                replacement = self.create_template(persist=False)
            elif deleting_current:
                replacement = self.project_data.templates[0]
                self.current_template = replacement
                self.project_data.current_template_id = replacement.id
            else:
                replacement = self.current_template

            try:
                self.save_project()
            except Exception:
                self._restore_project_snapshot(snapshot, current_id)
                raise
            return replacement

    def move_library_group(self, from_index: int, to_index: int):
        """移动分组顺序"""
        with self._save_lock:
            groups = self._lib().groups
            self._validate_reorder_indices(
                groups,
                from_index,
                to_index,
                code="invalid_group_order",
            )
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
        with self._save_lock:
            if not self.current_template:
                raise InvalidInputError(
                    "当前没有可用模板",
                    code="template_not_found",
                )
            tiers = self.current_template.tiers
            self._validate_reorder_indices(
                tiers,
                from_index,
                to_index,
                code="invalid_tier_order",
            )
            item = tiers.pop(from_index)
            tiers.insert(to_index, item)
            self.save_project()

    # --- 图片操作 (针对当前模板) ---

    def upload_image(self, file_path: str, original_name: str | None = None):
        """上传图片到当前模板的'上传的图片'分组"""
        return self._import_local_image_transaction(
            file_path,
            target_group_id=LOCAL_UPLOAD_GROUP_ID,
            target_group_name=LOCAL_UPLOAD_GROUP_NAME,
            original_name=original_name or os.path.basename(file_path),
        )

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
        with self._save_lock:
            snapshot = copy.deepcopy(self.project_data)
            current_id = self.current_template.id if self.current_template else None
            self._delete_image_globally_no_save(image_id)
            try:
                self.save_project()
            except Exception:
                self._restore_project_snapshot(snapshot, current_id)
                raise
        self._delete_image_files_best_effort(image_id)

    def move_image(
        self,
        image_id: str,
        source_type: str,
        source_id: str | None,
        target_type: str,
        target_id: str | None,
        index: int = -1,
        template_id: str | None = None,
    ):
        """
        在图片组、未排序列表和等级行之间移动图片，当前模板中只保留一个位置。
        Types: 'library_group', 'tier', 'unassigned'
        """
        valid_types = ('library_group', 'tier', 'unassigned')
        with self.template_scope(template_id) as template:
            if image_id not in self.project_data.shared_images_meta:
                raise InvalidInputError(
                    "图片不存在或已被删除",
                    code="image_not_found",
                )
            if source_type not in valid_types or target_type not in valid_types:
                raise InvalidInputError(
                    "图片移动区域不正确",
                    code="invalid_image_zone",
                )
            if not isinstance(index, int) or index < -1:
                raise InvalidInputError(
                    "图片插入位置不正确",
                    code="invalid_image_index",
                )

            source_list = self._resolve_image_zone(
                template, source_type, source_id, required=True
            )
            target_list = self._resolve_image_zone(
                template, target_type, target_id, required=True
            )
            if image_id not in source_list:
                raise InvalidInputError(
                    "图片原位置已经发生变化，请刷新后重试",
                    code="image_source_changed",
                )

            actual_locations = sum(
                items.count(image_id)
                for items in (
                    template.unassigned_images,
                    *(tier.image_ids for tier in template.tiers),
                    *(group.image_ids for group in template.hidden_preset.groups),
                )
            )
            if actual_locations != 1:
                raise InvalidInputError(
                    "图片位置数据不一致，请刷新或恢复项目备份后重试",
                    code="image_reference_conflict",
                )

            # 同列表移动时，前端的 index 是基于拖拽前的顺序。先移除再修正
            # 上界；跨区域移动则允许 index == len(target_list) 表示追加。
            max_index = len(target_list) if target_list is not source_list else len(target_list) - 1
            if index != -1 and index > max_index:
                raise InvalidInputError(
                    "图片插入位置超出范围，请刷新后重试",
                    code="invalid_image_index",
                )

            # 验证全部完成后才修改。锁覆盖修改和保存，失败不会留下半成品。
            mutable_lists = [
                template.unassigned_images,
                *(tier.image_ids for tier in template.tiers),
                *(group.image_ids for group in template.hidden_preset.groups),
            ]
            snapshots = [(items, list(items)) for items in mutable_lists]
            try:
                self._remove_layout_refs(image_id)
                self._remove_library_refs(image_id)
                if index == -1 or index >= len(target_list):
                    target_list.append(image_id)
                else:
                    target_list.insert(index, image_id)
                self.save_project()
            except Exception:
                for items, original in snapshots:
                    items[:] = original
                raise

    def _resolve_image_zone(
        self,
        template: Template,
        zone_type: str,
        zone_id: str | None,
        *,
        required: bool,
    ) -> Optional[List[str]]:
        target_list = None
        if zone_type == 'tier':
            tier = next((item for item in template.tiers if item.id == zone_id), None)
            target_list = tier.image_ids if tier else None
        elif zone_type == 'unassigned':
            if zone_id not in (None, ""):
                raise InvalidInputError(
                    "未排序区域不接受目标 ID",
                    code="invalid_image_zone",
                )
            target_list = template.unassigned_images
        elif zone_type == 'library_group':
            group = template.hidden_preset.find_group_by_id(zone_id or "")
            target_list = group.image_ids if group else None

        if required and target_list is None:
            raise InvalidInputError(
                "图片移动的目标区域不存在或已被删除",
                code="image_zone_not_found",
            )
        return target_list

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
        """仅清空当前模板的指定分组，不影响其他模板中的同一共享图片。"""
        group = self._lib().find_group_by_id(group_id)
        if not group:
            return
        image_ids = list(group.image_ids)
        group.image_ids.clear()
        # 兼容旧数据中同模板重复引用的情况；其他模板的引用必须保留。
        if self.current_template:
            self.current_template.unassigned_images = [
                image_id
                for image_id in self.current_template.unassigned_images
                if image_id not in image_ids
            ]
            for tier in self.current_template.tiers:
                tier.image_ids = [
                    image_id
                    for image_id in tier.image_ids
                    if image_id not in image_ids
                ]
        self.save_project()

    def _delete_image_globally_no_save(self, image_id: str) -> None:
        """仅移除内存引用；物理文件必须在项目保存成功后再删除。"""
        self._backfill_retry_after.pop(image_id, None)
        self.project_data.shared_images_meta.pop(image_id, None)
        for group in self.project_data.shared_image_library.groups:
            while image_id in group.image_ids:
                group.image_ids.remove(image_id)
        for template in self.project_data.templates:
            for tier in template.tiers:
                tier.image_ids = [item for item in tier.image_ids if item != image_id]
            template.unassigned_images = [
                item for item in template.unassigned_images if item != image_id
            ]
            for group in template.hidden_preset.groups:
                group.image_ids = [item for item in group.image_ids if item != image_id]
        for group in self.project_data.global_preset_library.groups:
            group.image_ids = [item for item in group.image_ids if item != image_id]

    def _restore_project_snapshot(
        self,
        snapshot: ProjectData,
        current_template_id: str | None,
    ) -> None:
        self.project_data = snapshot
        self.current_template = next(
            (
                template
                for template in snapshot.templates
                if template.id == current_template_id
            ),
            snapshot.templates[0] if snapshot.templates else None,
        )

    def _delete_image_files_best_effort(self, image_id: str) -> None:
        try:
            self.image_svc.delete_image_files(image_id)
        except (OSError, InvalidInputError):
            # 项目引用已经安全移除；残留文件可由后续缓存清理处理。
            logger.warning("删除图片物理文件失败: %s", image_id, exc_info=True)

    def _account_image_ids(
        self,
        group_id: str,
        *,
        legacy_steam_id: str = "",
    ) -> set[str]:
        return {
            image_id
            for image_id, meta in self.project_data.shared_images_meta.items()
            if getattr(meta, "source_group_id", "") == group_id
            or (
                legacy_steam_id
                and not getattr(meta, "source_group_id", "")
                and getattr(meta, "steam_id", "") == legacy_steam_id
            )
        }

    def delete_images_by_source_group_id(
        self,
        group_id: str,
        *,
        legacy_steam_id: str = "",
    ) -> int:
        """按稳定来源身份全局删除图片，并兼容旧 Steam 元数据。"""
        return self.delete_account_images(
            group_id,
            legacy_steam_id=legacy_steam_id,
        )

    def remove_groups_by_id_globally(self, group_id: str) -> int:
        """从全部模板及兼容图片库中删除账号分组。"""
        with self._save_lock:
            removed = 0
            libraries = [
                self.project_data.shared_image_library,
                self.project_data.global_preset_library,
                *(template.hidden_preset for template in self.project_data.templates),
            ]
            for library in libraries:
                before = len(library.groups)
                library.groups = [g for g in library.groups if g.id != group_id]
                removed += before - len(library.groups)
            for template in self.project_data.templates:
                template.library_group_states.pop(group_id, None)
            if removed:
                self.save_project()
            return removed

    def delete_account_images(
        self,
        group_id: str,
        *,
        legacy_steam_id: str = "",
        remove_groups: bool = False,
    ) -> int:
        """原子删除账号图片，并可同时移除全部模板中的账号分组。"""
        with self._save_lock:
            snapshot = copy.deepcopy(self.project_data)
            current_id = self.current_template.id if self.current_template else None
            image_ids = self._account_image_ids(
                group_id,
                legacy_steam_id=legacy_steam_id,
            )
            for image_id in image_ids:
                self._delete_image_globally_no_save(image_id)

            removed_groups = 0
            if remove_groups:
                libraries = [
                    self.project_data.shared_image_library,
                    self.project_data.global_preset_library,
                    *(template.hidden_preset for template in self.project_data.templates),
                ]
                for library in libraries:
                    before = len(library.groups)
                    library.groups = [g for g in library.groups if g.id != group_id]
                    removed_groups += before - len(library.groups)
                for template in self.project_data.templates:
                    template.library_group_states.pop(group_id, None)

            try:
                if image_ids or removed_groups:
                    self.save_project()
            except Exception:
                self._restore_project_snapshot(snapshot, current_id)
                raise

        for image_id in image_ids:
            self._delete_image_files_best_effort(image_id)
        return len(image_ids)

    def delete_images_by_steam_id(self, steam_id: str) -> int:
        """兼容旧调用：按 Steam 来源组和旧 steam_id 元数据删除。"""
        return self.delete_images_by_source_group_id(
            "steam_import_" + str(steam_id),
            legacy_steam_id=str(steam_id),
        )

    def register_remote_images(
        self,
        games,
        steam_id,
        group_id,
        replace_group=False,
        template_id: str | None = None,
        group_name: str | None = None,
    ):
        """注册或复用平台图片，并把尚未排序的图片放入账号图片组。

        replace_group=True 时只重建未放入布局的分组引用；已经位于未排序列表
        或等级行中的图片保持原位，不会重新出现在图片组。返回识别到的封面数。
        """
        with self.template_scope(template_id) as target_template:
            snapshot = copy.deepcopy(self.project_data)
            current_id = self.current_template.id if self.current_template else None
            try:
                return self._register_remote_images_locked(
                    games,
                    steam_id,
                    group_id,
                    replace_group=replace_group,
                    target_template=target_template,
                    group_name=group_name,
                )
            except Exception:
                self._restore_project_snapshot(snapshot, current_id)
                raise

    def _register_remote_images_locked(
        self,
        games,
        steam_id,
        group_id,
        *,
        replace_group: bool,
        target_template: Template,
        group_name: str | None,
    ) -> int:
        import uuid as _uuid
        count = 0
        changed = False
        library = target_template.hidden_preset
        group = library.find_group_by_id(group_id)
        if not group:
            group = ImageGroup(id=group_id, name=group_name or group_id, image_ids=[])
            library.groups.append(group)
            target_template.library_group_states[group_id] = True
            changed = True
        elif group_name and group.name != group_name:
            group.name = group_name
            changed = True

        previous_group_ids = set(group.image_ids)
        for image_id in previous_group_ids:
            meta = self.project_data.shared_images_meta.get(image_id)
            if meta and not getattr(meta, 'source_group_id', ''):
                meta.source_group_id = group_id
                changed = True

        occupied_image_ids = set(target_template.unassigned_images)
        for tier in target_template.tiers:
            occupied_image_ids.update(tier.image_ids)
        for existing_group in target_template.hidden_preset.groups:
            if existing_group is not group:
                occupied_image_ids.update(existing_group.image_ids)

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
                elif (
                    not source_group_id
                    and not steam_id
                    and not meta_steam_id
                    and img_id in occupied_image_ids
                ):
                    # 兼容旧 PSN/Xbox 数据：图片移出账号组后只剩布局引用，
                    # 同步时用平台 title ID（original_name）恢复来源身份。
                    priority = 3

                if priority is not None:
                    candidates.append((priority, img_id, meta))

            existing = min(candidates, default=None, key=lambda item: item[0])
            if existing:
                _, image_id, meta = existing
                item_changed = False
                self._backfill_retry_after.pop(image_id, None)

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

                if image_id not in occupied_image_ids and image_id not in group.image_ids:
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

    def backfill_remote_images(self, steam_id="", limit=0, source=""):
        """后台下载远程图片到本地。先将原图存入 source cache，再复制到 images/。
        limit>0 时每次最多处理 limit 张。返回 (ok, fail)。"""
        with self._backfill_lock:
            return self._backfill_remote_images_serialized(
                steam_id=steam_id,
                limit=limit,
                source=source,
            )

    @staticmethod
    def _matches_backfill_source(meta: TierImage, source: str) -> bool:
        if not source:
            return True
        source_group_id = getattr(meta, "source_group_id", "")
        if source == "steam":
            return bool(meta.steam_id) or source_group_id.startswith("steam_import_")
        if source == "psn":
            return source_group_id.startswith("psn_import_")
        if source == "xbox":
            return source_group_id.startswith("xbox:")
        if source == "nintendo":
            return source_group_id.startswith("nintendo:")
        return False

    def get_backfill_status(self, source: str = "") -> tuple[int, int]:
        """返回（当前可处理数量，等待稍后重试数量）。"""
        now = time.time()
        with self._save_lock:
            actionable = retry_pending = 0
            for image_id, meta in self.project_data.shared_images_meta.items():
                if (
                    not meta.is_remote
                    or meta.remote_failed
                    or not self._matches_backfill_source(meta, source)
                ):
                    continue
                if self._backfill_retry_after.get(image_id, 0) > now:
                    retry_pending += 1
                else:
                    actionable += 1
            return actionable, retry_pending

    @staticmethod
    def _is_retryable_image_error(exc: AppError) -> bool:
        if isinstance(exc, (RemoteTimeoutError, ImageImportError)):
            return True
        terminal_response_codes = {
            "remote_image_content_type_invalid",
            "remote_image_response_invalid",
            "remote_image_too_large",
            "remote_image_empty",
            "remote_image_invalid",
            "remote_image_redirect_invalid",
            "remote_image_too_many_redirects",
        }
        return (
            isinstance(exc, RemoteServiceError)
            and exc.code not in terminal_response_codes
        )

    def _backfill_remote_images_serialized(self, steam_id="", limit=0, source=""):
        """串行执行回填；网络请求在总数据锁外，状态提交在锁内。"""
        ok = fail = deferred = 0
        pending_results: list[tuple[str, str, str]] = []
        now = time.time()
        with self._save_lock:
            remote_ids = [
                image_id
                for image_id, meta in self.project_data.shared_images_meta.items()
                if meta.is_remote
                and not meta.remote_failed
                and (not steam_id or meta.steam_id == steam_id)
                and self._matches_backfill_source(meta, source)
                and self._backfill_retry_after.get(image_id, 0) <= now
            ]
        batch_ids = remote_ids[:limit] if limit > 0 else remote_ids

        for image_id in batch_ids:
            with self._save_lock:
                current_meta = self.project_data.shared_images_meta.get(image_id)
                if (
                    current_meta is None
                    or not current_meta.is_remote
                    or current_meta.remote_failed
                ):
                    continue
                meta = copy.copy(current_meta)

            appid = meta.original_name.replace(".jpg", "").replace(".png", "")
            source_group_id = getattr(meta, "source_group_id", "")
            if source_group_id.startswith("nintendo:"):
                cache_source = "nintendo"
            else:
                cache_source = "steam" if meta.steam_id else self._detect_source(meta.path)
            source_retryable = False
            fallback_retryable = False
            try:
                cache_path = self.download_to_source_cache(
                    meta.path,
                    cache_source,
                    appid,
                    game_name=meta.game_name,
                    raise_errors=True,
                )
            except AppError as exc:
                if self._is_retryable_image_error(exc):
                    source_retryable = True
                    logger.warning(
                        "远程封面暂时无法下载，继续尝试兜底搜索: 游戏=%s (%s)",
                        (meta.game_name or "").strip() or "未知游戏",
                        exc.code,
                    )
                cache_path = ""

            local_path = ""
            if not cache_path or cache_path == "__404__":
                logger.info(
                    "原封面不可用，开始兜底搜索: 游戏=%s, url=%s",
                    (meta.game_name or "").strip() or "未知游戏",
                    meta.path,
                )
                try:
                    local_path = self._search_fallback_download(image_id, meta)
                except AppError as exc:
                    if self._is_retryable_image_error(exc):
                        fallback_retryable = True
                        logger.warning(
                            "封面兜底服务暂时不可用，保留后续重试: 游戏=%s (%s)",
                            (meta.game_name or "").strip() or "未知游戏",
                            exc.code,
                        )
                    local_path = ""
            else:
                try:
                    local_path = self.image_svc.copy_from_cache(image_id, cache_path)
                except AppError as exc:
                    logger.warning(
                        "源缓存复制到图片库失败: 游戏=%s, cache=%s -> %s (%s)",
                        (meta.game_name or "").strip() or "未知游戏",
                        cache_path,
                        exc.message,
                        exc.code,
                    )
                    if self._is_retryable_image_error(exc):
                        source_retryable = True
                    local_path = ""

            if not local_path and (source_retryable or fallback_retryable):
                self._backfill_retry_after[image_id] = time.time() + 60
                deferred += 1
                continue

            pending_results.append((image_id, meta.path, local_path))

        with self._save_lock:
            applied = []
            for image_id, expected_remote_path, local_path in pending_results:
                current_meta = self.project_data.shared_images_meta.get(image_id)
                if current_meta is None:
                    self._backfill_retry_after.pop(image_id, None)
                    if local_path:
                        self._delete_image_files_best_effort(image_id)
                    continue
                if not current_meta.is_remote or current_meta.path != expected_remote_path:
                    if local_path and current_meta.is_remote:
                        self._delete_image_files_best_effort(image_id)
                    continue

                retry_before = self._backfill_retry_after.get(image_id)
                applied.append(
                    (
                        image_id,
                        current_meta,
                        current_meta.path,
                        current_meta.is_remote,
                        current_meta.remote_failed,
                        retry_before,
                        local_path,
                    )
                )
                self._backfill_retry_after.pop(image_id, None)
                if local_path:
                    current_meta.path = local_path
                    current_meta.is_remote = False
                    current_meta.remote_failed = False
                    ok += 1
                else:
                    current_meta.remote_failed = True
                    fail += 1

            try:
                if applied:
                    self.save_project()
            except Exception:
                for (
                    image_id,
                    meta,
                    old_path,
                    old_is_remote,
                    old_remote_failed,
                    retry_before,
                    local_path,
                ) in applied:
                    meta.path = old_path
                    meta.is_remote = old_is_remote
                    meta.remote_failed = old_remote_failed
                    if retry_before is None:
                        self._backfill_retry_after.pop(image_id, None)
                    else:
                        self._backfill_retry_after[image_id] = retry_before
                    if local_path:
                        self._delete_image_files_best_effort(image_id)
                raise
            remaining = sum(
                1
                for meta in self.project_data.shared_images_meta.values()
                if meta.is_remote
                and not meta.remote_failed
                and self._matches_backfill_source(meta, source)
            )
        logger.info(
            "backfill: %d ok, %d fail, %d deferred, %d remaining",
            ok,
            fail,
            deferred,
            remaining,
        )
        return ok, fail, deferred

    def _search_fallback_download(self, image_id, meta) -> str:
        """搜索兜底并返回本地相对路径；元数据由调用方在锁内提交。"""
        _log = logger
        name = (meta.game_name or "").strip()
        if not name:
            _log.warning(
                "跳过封面兜底搜索: 缺少游戏名称, image_id=%s, url=%s",
                image_id,
                meta.path,
            )
            return ""

        _log.info("调用封面兜底搜索: 游戏=%s", name)
        try:
            results = self.search_only(name)
        except AppError as exc:
            _log.info("封面兜底搜索失败: %s (%s)", name, exc.code)
            if self._is_retryable_image_error(exc):
                raise
            return ""
        if not results or not isinstance(results, list):
            _log.info("封面兜底搜索无结果: 游戏=%s", name)
            return ""

        cover_url = (results[0].get("cover") or {}).get("url", "")
        if not cover_url:
            _log.info("封面兜底结果缺少图片地址: 游戏=%s", name)
            return ""

        # 获取 appid 作为缓存文件名
        appid = meta.original_name.replace(".jpg", "")
        if not appid:
            _log.warning("封面兜底下载跳过: 游戏=%s 缺少文件标识", name)
            return ""

        # 先存到源缓存
        source = self._detect_source(cover_url)
        try:
            cache_path = self.download_to_source_cache(
                cover_url,
                source,
                appid,
                game_name=name,
                raise_errors=True,
            )
        except AppError as exc:
            if self._is_retryable_image_error(exc):
                raise
            cache_path = ""
        if not cache_path or cache_path == "__404__":
            _log.warning(
                "封面兜底候选下载失败: 游戏=%s, url=%s",
                name,
                cover_url,
            )
            return ""

        local_path = self.image_svc.copy_from_cache(image_id, cache_path)
        if not local_path:
            _log.warning("封面兜底导入失败: 游戏=%s, cache=%s", name, cache_path)
            return ""

        _log.info("封面兜底成功: 游戏=%s, path=%s", name, local_path)
        return local_path
