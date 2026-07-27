import os
import shutil
import threading
import uuid
from PIL import Image
from typing import Tuple

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
        os.makedirs(self.images_dir, exist_ok=True)
        os.makedirs(self.thumbnails_dir, exist_ok=True)

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
        dest_path = os.path.join(self.images_dir, new_filename)
        
        # 1. 复制原图
        shutil.copy2(source_path, dest_path)
        
        # 2. 生成缩略图 (用于列表显示，Center Crop)
        self._generate_thumbnail(dest_path, image_id)

        # 返回相对于 data_dir 的路径，方便移植
        relative_path = os.path.join("images", new_filename)
        return relative_path, image_id

    def _generate_thumbnail(self, source_path: str, image_id: str):
        """生成紧贴图片内容的等比例缩略图，避免透明画布破坏圆角效果。"""
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
                thumb_path = os.path.join(self.thumbnails_dir, f"{image_id}.png")
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
        return os.path.join(self.thumbnails_dir, f"{image_id}.png")

    def get_full_image_path(self, relative_path: str) -> str:
        return os.path.join(self.data_dir, relative_path)

    def delete_image_files(self, image_id: str):
        """删除本地图片文件及缩略图"""
        thumb = self.get_thumbnail_path(image_id)
        if os.path.exists(thumb):
            os.remove(thumb)
        for ext in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
            fpath = os.path.join(self.images_dir, image_id + ext)
            if os.path.exists(fpath):
                os.remove(fpath)
                return

    def copy_from_cache(self, image_id: str, source_path: str) -> str:
        """从源缓存文件复制到 images/ 并生成缩略图。返回相对路径，失败返回 ''。"""
        ext = os.path.splitext(source_path)[1].lower()
        if not ext:
            ext = ".jpg"
        dest = os.path.join(self.images_dir, f"{image_id}{ext}")
        try:
            shutil.copy2(source_path, dest)
        except Exception:
            return ""
        self._generate_thumbnail(dest, image_id)
        return os.path.join("images", f"{image_id}{ext}")

    def download_remote_to_local(self, image_id: str, url: str) -> str:
        """下载远程图片到本地 images/ 并生成缩略图，保持原 image_id。
        返回本地相对路径；404 返回 '__404__'；其他失败返回 ''。"""
        import requests
        import logging
        logger = logging.getLogger(__name__)
        try:
            resp = requests.get(url, timeout=30)
            resp.raise_for_status()
        except requests.exceptions.HTTPError as e:
            if e.response is not None and e.response.status_code == 404:
                logger.info("backfill 404 (skip): %s", url)
                return "__404__"
            logger.warning("backfill download failed: %s -> %s", url, e)
            return ""
        except Exception as e:
            logger.warning("backfill download failed: %s -> %s", url, e)
            return ""

        ext = os.path.splitext(url.split("?")[0])[1].lower()
        if not ext or ext not in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
            ext = ".jpg"

        filename = f"{image_id}{ext}"
        dest_path = os.path.join(self.images_dir, filename)
        with open(dest_path, "wb") as f:
            f.write(resp.content)

        self._generate_thumbnail(dest_path, image_id)
        return os.path.join("images", filename)
