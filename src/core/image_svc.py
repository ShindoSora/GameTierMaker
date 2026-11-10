import os
import shutil
import uuid
from pathlib import Path
from typing import Tuple

from .errors import ImageImportError, InvalidInputError
from .image_security import validate_image_id

# Shared by cache download/cleanup and cache-to-library validation.
SOURCE_CACHE_FOLDERS = (
    "steam",
    "igdb",
    "bangumi",
    "vndb",
    "steamgriddb",
    "xbox",
    "nintendo",
    "cache",
)

class ImageService:
    """
    负责图片的物理操作：导入、存储
    完全不涉及业务逻辑（如模板、分组），只管文件
    """

    def __init__(self, data_dir: str):
        self.data_dir = data_dir
        self.images_dir = os.path.join(data_dir, "images")
        # 界面直接显示原图，不再生成缩略图；该目录只用于清理旧版本留下的文件。
        self.thumbnails_dir = os.path.join(data_dir, "thumbnails")
        self._ensure_dirs()

    def _ensure_dirs(self):
        self._safe_storage_dir(self.images_dir).mkdir(parents=True, exist_ok=True)

    def _safe_storage_dir(self, directory: str) -> Path:
        data_root = Path(self.data_dir).resolve()
        resolved = Path(directory).resolve()
        if resolved.parent != data_root:
            raise InvalidInputError(
                "图片存储目录无效",
                code="image_storage_path_invalid",
            )
        return resolved

    def import_image(self, source_path: str) -> Tuple[str, str]:
        """
        导入图片：复制原图
        返回: (local_relative_path, image_id)
        """
        if not os.path.exists(source_path):
            raise FileNotFoundError(f"Source image not found: {source_path}")

        image_id = str(uuid.uuid4())
        ext = os.path.splitext(source_path)[1].lower()
        if not ext:
            ext = ".png"
            
        new_filename = f"{image_id}{ext}"
        dest_path = str(self._safe_storage_dir(self.images_dir) / new_filename)
        
        shutil.copy2(source_path, dest_path)

        # 返回相对于 data_dir 的路径，方便移植
        relative_path = os.path.join("images", new_filename)
        return relative_path, image_id

    def get_full_image_path(self, relative_path: str) -> str:
        candidate = (Path(self.data_dir) / str(relative_path or "")).resolve()
        images_root = self._safe_storage_dir(self.images_dir)
        if (
            candidate.parent != images_root
            or candidate.suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"}
        ):
            raise InvalidInputError(
                "本地图片路径无效",
                code="image_path_invalid",
            )
        validate_image_id(candidate.stem)
        return str(candidate)

    def delete_image_files(self, image_id: str):
        """删除本地图片文件，以及旧版本可能留下的缩略图"""
        image_id = validate_image_id(image_id)
        thumb = str(self._safe_storage_dir(self.thumbnails_dir) / f"{image_id}.png")
        if os.path.exists(thumb):
            os.remove(thumb)
        for ext in (".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"):
            fpath = str(self._safe_storage_dir(self.images_dir) / (image_id + ext))
            if os.path.exists(fpath):
                os.remove(fpath)
                return

    def copy_from_cache(self, image_id: str, source_path: str) -> str:
        """从源缓存文件复制到 images/。返回相对路径。"""
        image_id = validate_image_id(image_id)
        source = Path(source_path).resolve()
        data_root = Path(self.data_dir).resolve()
        cache_roots = [
            (data_root / folder).resolve()
            for folder in SOURCE_CACHE_FOLDERS
        ]
        allowed_cache_roots = {
            root for root in cache_roots if root.parent == data_root
        }
        if source.parent not in allowed_cache_roots or not source.is_file():
            raise ImageImportError(
                "图片缓存路径无效",
                code="image_cache_path_invalid",
            )
        ext = source.suffix.lower()
        if not ext:
            ext = ".jpg"
        dest = str(self._safe_storage_dir(self.images_dir) / f"{image_id}{ext}")
        try:
            shutil.copy2(source, dest)
        except OSError as exc:
            raise ImageImportError(
                "无法保存回填图片，请检查磁盘空间和数据目录权限",
                code="image_cache_write_failed",
            ) from exc
        return os.path.join("images", f"{image_id}{ext}")
