"""Small Windows user-scoped credential store used by platform integrations.

Nintendo's session token is a long-lived credential.  Keep it out of normal
JSON configuration by protecting it with Windows DPAPI.  The application is
Windows-first; on another platform callers receive a clear error instead of
silently persisting the token as plaintext.
"""

from __future__ import annotations

import base64
import ctypes
import os
from ctypes import wintypes


class CredentialStoreError(RuntimeError):
    """The platform credential service could not protect or restore a value."""


class _DataBlob(ctypes.Structure):
    _fields_ = [
        ("cbData", wintypes.DWORD),
        ("pbData", ctypes.POINTER(ctypes.c_ubyte)),
    ]


def _crypt32():
    if os.name != "nt":
        raise CredentialStoreError("当前系统不支持 Windows 凭证保护")
    try:
        crypt32 = ctypes.WinDLL("crypt32", use_last_error=True)
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        crypt32.CryptProtectData.argtypes = [
            ctypes.POINTER(_DataBlob),
            wintypes.LPCWSTR,
            ctypes.POINTER(_DataBlob),
            wintypes.LPVOID,
            wintypes.LPVOID,
            wintypes.DWORD,
            ctypes.POINTER(_DataBlob),
        ]
        crypt32.CryptProtectData.restype = wintypes.BOOL
        crypt32.CryptUnprotectData.argtypes = [
            ctypes.POINTER(_DataBlob),
            ctypes.POINTER(wintypes.LPWSTR),
            ctypes.POINTER(_DataBlob),
            wintypes.LPVOID,
            wintypes.LPVOID,
            wintypes.DWORD,
            ctypes.POINTER(_DataBlob),
        ]
        crypt32.CryptUnprotectData.restype = wintypes.BOOL
        kernel32.LocalFree.argtypes = [wintypes.HLOCAL]
        kernel32.LocalFree.restype = wintypes.HLOCAL
        return crypt32, kernel32
    except Exception as exc:  # pragma: no cover - only reachable on unusual Windows hosts
        raise CredentialStoreError("无法加载 Windows 凭证保护服务") from exc


def _blob(payload: bytes) -> tuple[_DataBlob, ctypes.Array]:
    if not payload:
        raise CredentialStoreError("凭证内容不能为空")
    buffer = (ctypes.c_ubyte * len(payload)).from_buffer_copy(payload)
    return _DataBlob(len(payload), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte))), buffer


def protect_secret(secret: str) -> str:
    """Protect a secret with the current Windows user's DPAPI key."""
    if not isinstance(secret, str) or not secret:
        raise CredentialStoreError("凭证内容不能为空")
    crypt32, kernel32 = _crypt32()
    source, source_buffer = _blob(secret.encode("utf-8"))
    destination = _DataBlob()
    try:
        ok = crypt32.CryptProtectData(
            ctypes.byref(source),
            "Game Tier Maker Nintendo credential",
            None,
            None,
            None,
            0,
            ctypes.byref(destination),
        )
        if not ok or not destination.pbData or not destination.cbData:
            error = ctypes.get_last_error()
            raise CredentialStoreError(f"Windows 凭证保护失败（错误码 {error}）")
        protected = ctypes.string_at(destination.pbData, destination.cbData)
        return "dpapi:" + base64.b64encode(protected).decode("ascii")
    finally:
        if destination.pbData:
            kernel32.LocalFree(destination.pbData)
        # Keep the source buffer alive until CryptProtectData returns.
        _ = source_buffer


def unprotect_secret(value: str) -> str:
    """Restore a value produced by :func:`protect_secret`."""
    if not isinstance(value, str) or not value.startswith("dpapi:"):
        raise CredentialStoreError("凭证格式不受支持")
    try:
        encrypted = base64.b64decode(value[6:], validate=True)
    except (ValueError, TypeError) as exc:
        raise CredentialStoreError("凭证编码无效") from exc

    crypt32, kernel32 = _crypt32()
    source, source_buffer = _blob(encrypted)
    destination = _DataBlob()
    description = wintypes.LPWSTR()
    try:
        ok = crypt32.CryptUnprotectData(
            ctypes.byref(source),
            ctypes.byref(description),
            None,
            None,
            None,
            0,
            ctypes.byref(destination),
        )
        if not ok or not destination.pbData:
            error = ctypes.get_last_error()
            raise CredentialStoreError(f"Windows 凭证恢复失败（错误码 {error}）")
        try:
            return ctypes.string_at(destination.pbData, destination.cbData).decode("utf-8")
        except UnicodeDecodeError as exc:
            raise CredentialStoreError("凭证内容不是有效的 UTF-8") from exc
    finally:
        if description:
            kernel32.LocalFree(description)
        if destination.pbData:
            kernel32.LocalFree(destination.pbData)
        _ = source_buffer
