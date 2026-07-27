import uuid
import json
import time
from typing import List, Dict, Optional
from dataclasses import dataclass, field, asdict

from .version import PROJECT_SCHEMA_VERSION

# --- 基础数据结构 ---

@dataclass
class TierImage:
    """图片实体，在模板中的引用"""
    id: str  # 唯一ID
    path: str  # 本地相对路径或远程 URL
    original_name: str # 原始文件名
    steam_id: str = ""  # 关联的 Steam ID
    is_remote: bool = False  # True 时 path 为远程 URL，展示时直连
    remote_failed: bool = False  # 远程图片下载永久失败，不再重试
    game_name: str = ""  # 游戏名，搜索兜底时用

@dataclass
class TierRow:
    """等级行"""
    id: str
    label: str
    color: str
    image_ids: List[str] = field(default_factory=list)  # 存储图片ID的有序列表

@dataclass
class ImageGroup:
    """图片库中的分组"""
    id: str
    name: str
    image_ids: List[str] = field(default_factory=list)
    is_expanded: bool = False

@dataclass
class ImageLibrary:
    """图片库状态"""
    groups: List[ImageGroup] = field(default_factory=list)

    def find_group_by_id(self, group_id: str) -> Optional[ImageGroup]:
        for g in self.groups:
            if g.id == group_id:
                return g
        return None

    def add_image_to_group(self, group_id: str, image_id: str):
        group = self.find_group_by_id(group_id)
        if group:
            if image_id not in group.image_ids:
                group.image_ids.append(image_id)

    def remove_image(self, image_id: str):
        """从所有分组中移除该图片"""
        for group in self.groups:
            if image_id in group.image_ids:
                group.image_ids.remove(image_id)

@dataclass
class Template:
    """单个模板"""
    id: str
    name: str
    created_at: float
    tiers: List[TierRow] = field(default_factory=list)
    unassigned_images: List[str] = field(default_factory=list) # 未排序区的图片ID
    library_group_states: Dict[str, bool] = field(default_factory=dict)  # 分组展开状态
    hidden_preset: ImageLibrary = field(default_factory=ImageLibrary)  # 隐藏预设库，跨模板导入用

    # 注意：image_library 和 images_meta 已移到 ProjectData 中全局共享
    # 为了向后兼容，反序列化时可能会保留这些字段，但新代码不应使用它们

@dataclass
class ProjectData:
    """整个项目的数据根节点"""
    version: str = PROJECT_SCHEMA_VERSION
    current_template_id: Optional[str] = None
    global_preset_library: ImageLibrary = field(default_factory=ImageLibrary)
    shared_image_library: ImageLibrary = field(default_factory=ImageLibrary)  # 所有模板共享的图片库
    shared_images_meta: Dict[str, TierImage] = field(default_factory=dict)  # 全局共享的图片元数据
    templates: List[Template] = field(default_factory=list)

# --- JSON 序列化辅助 ---
class ProjectEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, TierImage):
            return asdict(o)
        if hasattr(o, "__dict__"):
            return asdict(o)
        return super().default(o)
