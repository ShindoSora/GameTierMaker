import os
import shutil
import threading
import uuid
from pathlib import Path
from PIL import Image
from typing import Tuple

from .errors import ImageImportError, InvalidInputError
from .image_security import validate_image_id

class ImageService:
    """
    负责图片的物理操作：导入、存储、缩略图生成
    完全不涉及业务逻辑（如模板、分组），只管文件
    """
    
    def __init__(self, data_dir: str):
        self.data_dir = data_dir
        self.images_dir = os.path.join(data_dir, "images")
        self.thumbnails_dir = os.path.join(data_dir, "thumbnails")
        self._thumbnail_lock = threading.Lock()
        self._ensure_dirs()

    def _ensure_dirs(self):
        self._safe_storage_dir(self.images_dir).mkdir(parents=True, exist_ok=True)
        self._safe_storage_dir(self.thumbnails_dir).mkdir(parents=True, exist_ok=True)

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
        导入图片：复制原图，生成缩略图
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
        
        # 1. 复制原图
        shutil.copy2(source_path, dest_path)
        
        # 2. 生成缩略图 (用于列表显示，Center Crop)
        self._generate_thumbnail(dest_path, image_id)

        # 返回相对于 data_dir 的路径，方便移植
        relative_path = os.path.join("images", new_filename)
        return relative_path, image_id

    def _generate_thumbnail(self, source_path: str, image_id: str):
        """生成紧贴图片内容的等比例缩略图，避免透明画布破坏圆角效果。"""
        image_id = validate_image_id(image_id)
        try:
            with Image.open(source_path) as img:
                original_width, original_height = img.size
                new_width, new_height = self._thumbnail_dimensions(
                    original_width,
                    original_height,
                )
                resized_img = img.resize((new_width, new_height), Image.Resampling.LANCZOS)
                if resized_img.mode != 'RGBA':
                    resized_img = resized_img.convert('RGBA')
                thumb_path = str(
                    self._safe_storage_dir(self.thumbnails_dir) / f"{image_id}.png"
                )
                resized_img.save(thumb_path, "PNG")
        except Exception as e:
            print(f"Error generating thumbnail for {source_path}: {e}")

    @staticmethod
    def _thumbnail_dimensions(width: int, height: int) -> tuple[int, int]:
        if width <= 0 or height <= 0:
            raise ValueError("invalid image dimensions")
        scale_ratio = min(128 / width, 128 / height)
        return (
            max(1, int(width * scale_ratio)),
            max(1, int(height * scale_ratio)),
        )

    def ensure_thumbnail(self, source_path: str, image_id: str) -> str:
        """按当前缩略图规格创建或刷新旧版透明画布缩略图。"""
        thumb_path = self.get_thumbnail_path(image_id)
        with self._thumbnail_lock:
            needs_refresh = not os.path.exists(thumb_path)
            if not needs_refresh:
                try:
                    with Image.open(source_path) as source:
                        expected_size = self._thumbnail_dimensions(*source.size)
                    with Image.open(thumb_path) as thumbnail:
                        needs_refresh = thumbnail.size != expected_size
                    if os.path.getmtime(thumb_path) < os.path.getmtime(source_path):
                        needs_refresh = True
                except (OSError, ValueError):
                    needs_refresh = True
            if needs_refresh:
                self._generate_thumbnail(source_path, image_id)
        return thumb_path

    def get_thumbnail_path(self, image_id: str) -> str:
        image_id = validate_image_id(image_id)
        return str(self._safe_storage_dir(self.thumbnails_dir) / f"{image_id}.png")

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
        """删除本地图片文件及缩略图"""
        image_id = validate_image_id(image_id)
        thumb = self.get_thumbnail_path(image_id)
        if os.path.exists(thumb):
            os.remove(thumb)
        for ext in (".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"):
            fpath = str(self._safe_storage_dir(self.images_dir) / (image_id + ext))
            if os.path.exists(fpath):
                os.remove(fpath)
                return

    def copy_from_cache(self, image_id: str, source_path: str) -> str:
        """从源缓存文件复制到 images/ 并生成缩略图。返回相对路径，失败返回 ''。"""
        image_id = validate_image_id(image_id)
        source = Path(source_path).resolve()
        data_root = Path(self.data_dir).resolve()
        cache_roots = [
            (data_root / folder).resolve()
            for folder in ("steam", "igdb", "bangumi", "xbox", "cache")
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
        self._generate_thumbnail(dest, image_id)
        return os.path.join("images", f"{image_id}{ext}")

    def download_remote_to_local(self, image_id: str, url: str) -> str:
        """下载远程图片到本地 images/ 并生成缩略图，保持原 image_id。
        返回本地相对路径；404 返回 '__404__'；其他失败返回 ''。"""
        image_id = validate_image_id(image_id)
        import logging
        from src.core.errors import AppError
        from src.core.image_security import (
            RemoteImageNotFoundError,
            download_public_image,
        )
        logger = logging.getLogger(__name__)
        destination = str(self._safe_storage_dir(self.images_dir) / f"{image_id}.jpg")
        try:
            dest_path = download_public_image(url, destination)
        except RemoteImageNotFoundError:
            logger.info("backfill 404 (skip): %s", url)
            return "__404__"
        except AppError as exc:
            logger.warning(
                "backfill download failed: %s -> %s (%s)",
                url,
                exc.message,
                exc.code,
            )
            return ""

        self._generate_thumbnail(dest_path, image_id)
        return os.path.join("images", os.path.basename(dest_path))
