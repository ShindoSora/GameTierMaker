"""
全局依赖：提供 ProjectManager 单例
"""

from src.core.manager import ProjectManager
from src.core.image_svc import ImageService


# 应用根目录由 main.py 的 ROOT_DIR 决定
# 这里使用环境变量或默认值
import os

ROOT_DIR = os.environ.get("GAMELIST_ROOT", os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

# 单例
_manager: ProjectManager | None = None
_image_svc: ImageService | None = None


def get_manager() -> ProjectManager:
    global _manager
    if _manager is None:
        _manager = ProjectManager(ROOT_DIR)
    return _manager


def get_image_svc() -> ImageService:
    manager = get_manager()
    return manager.image_svc
