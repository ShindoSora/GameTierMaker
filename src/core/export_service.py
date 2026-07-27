"""Tier-list image export paths and reliable desktop file saving."""

from __future__ import annotations

import io
import logging
import os
import re
import sys
import threading
import uuid
from pathlib import Path

from PIL import Image, UnidentifiedImageError

from .config_handler import ConfigHandler
from .errors import ExportWriteError, InvalidInputError
from .runtime_guard import RuntimeDirectoryError, ensure_writable_directory


logger = logging.getLogger(__name__)

MAX_EXPORT_BYTES = 64 * 1024 * 1024
MAX_EXPORT_PIXELS = 160_000_000
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
_INVALID_FILENAME_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_WINDOWS_RESERVED_STEMS = re.compile(
    r"^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$",
    re.IGNORECASE,
)
_save_lock = threading.Lock()


def get_runtime_mode() -> str:
    """Return how the UI is displayed, independent from build tooling."""
    configured = os.environ.get("GAMELIST_RUNTIME_MODE", "").strip().lower()
    if configured in {"desktop", "browser"}:
        return configured
    return "desktop" if getattr(sys, "frozen", False) else "browser"


def get_system_download_directory() -> Path:
    """Resolve the current user's operating-system Downloads directory."""
    if sys.platform == "win32":
        try:
            import winreg

            key_path = r"Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders"
            value_name = "{374DE290-123F-4565-9164-39C4925E467B}"
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key_path) as key:
                raw_value, _ = winreg.QueryValueEx(key, value_name)
            if isinstance(raw_value, str) and raw_value.strip():
                return Path(os.path.expandvars(raw_value)).expanduser().resolve()
        except (OSError, ValueError):
            logger.warning("无法读取 Windows 系统下载目录，将使用用户目录下的 Downloads")

    return (Path.home() / "Downloads").resolve()


def _validate_custom_directory(value: str, *, probe_writable: bool = True) -> Path:
    raw_value = str(value or "").strip()
    if not raw_value:
        raise InvalidInputError(
            "下载目录不能为空",
            code="download_directory_invalid",
        )

    try:
        expanded = os.path.expandvars(raw_value)
        candidate = Path(expanded).expanduser()
        if not candidate.is_absolute():
            raise ValueError("download directory must be absolute")
        directory = candidate.resolve(strict=True)
    except (OSError, RuntimeError, ValueError) as exc:
        raise InvalidInputError(
            "下载目录不存在或路径无效",
            code="download_directory_invalid",
        ) from exc

    if not directory.is_dir():
        raise InvalidInputError(
            "下载路径必须是文件夹",
            code="download_directory_invalid",
        )

    if probe_writable:
        try:
            ensure_writable_directory(directory)
        except (RuntimeDirectoryError, OSError) as exc:
            raise InvalidInputError(
                "下载目录不可写，请选择其他文件夹",
                code="download_directory_not_writable",
            ) from exc
    elif not os.access(directory, os.W_OK):
        raise InvalidInputError(
            "下载目录不可写，请选择其他文件夹",
            code="download_directory_not_writable",
        )
    return directory


def _ensure_default_directory() -> Path:
    directory = get_system_download_directory()
    try:
        return ensure_writable_directory(directory).resolve()
    except (RuntimeDirectoryError, OSError) as exc:
        raise ExportWriteError(
            "系统下载目录不可写，请在设置中选择其他文件夹",
            code="download_directory_not_writable",
        ) from exc


def resolve_download_directory() -> tuple[Path, bool]:
    """Return the effective desktop download directory and fallback status."""
    configured = ConfigHandler.get_download_directory()
    if configured:
        try:
            return _validate_custom_directory(configured), False
        except InvalidInputError:
            logger.warning("自定义下载目录已失效，将回退到系统下载目录: %s", configured)
            return _ensure_default_directory(), True
    return _ensure_default_directory(), False


def get_download_settings() -> dict:
    runtime_mode = get_runtime_mode()
    if runtime_mode == "browser":
        return {
            "runtime_mode": "browser",
            "managed_by": "browser",
            "configured_directory": "",
            "effective_directory": "",
            "uses_default": True,
            "is_valid": True,
        }

    configured = ConfigHandler.get_download_directory()
    fallback_used = False
    is_valid = True
    if configured:
        try:
            effective = _validate_custom_directory(configured, probe_writable=False)
        except InvalidInputError:
            effective = get_system_download_directory()
            fallback_used = True
            is_valid = False
    else:
        effective = get_system_download_directory()

    return {
        "runtime_mode": "desktop",
        "managed_by": "application",
        "configured_directory": configured,
        "effective_directory": str(effective),
        "uses_default": not bool(configured) or fallback_used,
        "is_valid": is_valid,
    }


def save_download_directory_setting(directory: str) -> dict:
    value = str(directory or "").strip()
    if value:
        normalized = _validate_custom_directory(value)
        ConfigHandler.save_download_directory(str(normalized))
    else:
        ConfigHandler.save_download_directory("")
    return get_download_settings()


def sanitize_export_filename(filename: str) -> str:
    value = str(filename or "").strip()
    if value.lower().endswith(".png"):
        value = value[:-4]
    value = _INVALID_FILENAME_CHARS.sub("_", value).strip(" .")
    value = re.sub(r"\s+", " ", value)
    if not value:
        value = "tierlist"
    if _WINDOWS_RESERVED_STEMS.fullmatch(value):
        value = f"_{value}"
    return f"{value[:120].rstrip(' .') or 'tierlist'}.png"


def _validate_png(payload: bytes) -> None:
    if not payload:
        raise InvalidInputError("导出图片内容为空", code="export_invalid_png")
    if len(payload) > MAX_EXPORT_BYTES:
        raise InvalidInputError("导出图片文件过大", code="export_too_large")
    if not payload.startswith(PNG_SIGNATURE):
        raise InvalidInputError("导出内容不是有效的 PNG 图片", code="export_invalid_png")

    try:
        with Image.open(io.BytesIO(payload)) as image:
            if image.format != "PNG":
                raise ValueError("not a PNG")
            width, height = image.size
            if width <= 0 or height <= 0 or width * height > MAX_EXPORT_PIXELS:
                raise ValueError("invalid image dimensions")
            image.verify()
    except (
        Image.DecompressionBombError,
        OSError,
        SyntaxError,
        UnidentifiedImageError,
        ValueError,
    ) as exc:
        raise InvalidInputError(
            "导出内容不是有效的 PNG 图片",
            code="export_invalid_png",
        ) from exc


def _available_target(directory: Path, filename: str) -> Path:
    target = directory / filename
    if not target.exists():
        return target
    stem = target.stem
    for index in range(2, 10_000):
        candidate = directory / f"{stem} ({index}).png"
        if not candidate.exists():
            return candidate
    raise ExportWriteError("导出目录中的同名文件过多", code="export_write_failed")


def save_tier_list_png(payload: bytes, filename: str) -> dict:
    _validate_png(payload)
    directory, fallback_used = resolve_download_directory()
    safe_filename = sanitize_export_filename(filename)

    with _save_lock:
        target = _available_target(directory, safe_filename)
        temporary = directory / f".{target.name}.{uuid.uuid4().hex}.tmp"
        try:
            with temporary.open("xb") as file:
                file.write(payload)
                file.flush()
                os.fsync(file.fileno())
            os.replace(temporary, target)
        except OSError as exc:
            temporary.unlink(missing_ok=True)
            logger.error("导出图片保存失败: %s", target, exc_info=True)
            raise ExportWriteError(
                "导出图片无法保存，请检查下载目录和磁盘空间",
                code="export_write_failed",
            ) from exc
        finally:
            temporary.unlink(missing_ok=True)

    logger.info("Tier List 已导出: %s", target)
    return {
        "ok": True,
        "filename": target.name,
        "saved_path": str(target),
        "directory": str(directory),
        "fallback_used": fallback_used,
    }
