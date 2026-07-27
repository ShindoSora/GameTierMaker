"""便携版运行目录检查和 Windows 单实例保护。"""

from __future__ import annotations

import ctypes
import hashlib
import os
import sys
import uuid
from pathlib import Path


class RuntimeDirectoryError(RuntimeError):
    pass


def ensure_writable_directory(path: str | os.PathLike) -> Path:
    """创建目录并实际写入探测文件，确认便携数据可以持久化。"""
    directory = Path(path)
    try:
        directory.mkdir(parents=True, exist_ok=True)
        probe = directory / f".write-test-{os.getpid()}-{uuid.uuid4().hex}"
        with probe.open("x", encoding="utf-8") as file:
            file.write("ok")
            file.flush()
            os.fsync(file.fileno())
        probe.unlink()
    except OSError as exc:
        try:
            if "probe" in locals():
                probe.unlink(missing_ok=True)
        except OSError:
            pass
        raise RuntimeDirectoryError(f"目录不可写: {directory}") from exc
    return directory


def show_error_message(title: str, message: str) -> None:
    """打包版使用原生消息框；不可用时回退到标准错误输出。"""
    if sys.platform == "win32":
        try:
            ctypes.windll.user32.MessageBoxW(None, message, title, 0x10)
            return
        except Exception:
            pass
    print(f"{title}: {message}", file=sys.stderr)


class SingleInstanceGuard:
    """基于 EXE 路径命名的 Windows Mutex；不同便携目录可独立运行。"""

    ERROR_ALREADY_EXISTS = 183

    def __init__(self, executable_path: str | os.PathLike, enabled: bool = True):
        normalized = str(Path(executable_path).resolve()).casefold()
        digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:24]
        self.name = f"Local\\GameTierMaker-{digest}"
        self.enabled = enabled and sys.platform == "win32"
        self._handle = None

    def acquire(self) -> bool:
        if not self.enabled:
            return True
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.CreateMutexW.argtypes = [ctypes.c_void_p, ctypes.c_bool, ctypes.c_wchar_p]
        kernel32.CreateMutexW.restype = ctypes.c_void_p
        kernel32.CloseHandle.argtypes = [ctypes.c_void_p]
        kernel32.CloseHandle.restype = ctypes.c_bool
        handle = kernel32.CreateMutexW(None, False, self.name)
        if not handle:
            raise OSError(ctypes.get_last_error(), "无法创建单实例锁")
        if ctypes.get_last_error() == self.ERROR_ALREADY_EXISTS:
            kernel32.CloseHandle(handle)
            return False
        self._handle = handle
        return True

    def release(self) -> None:
        if not self._handle:
            return
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.CloseHandle.argtypes = [ctypes.c_void_p]
        kernel32.CloseHandle.restype = ctypes.c_bool
        kernel32.CloseHandle(self._handle)
        self._handle = None
