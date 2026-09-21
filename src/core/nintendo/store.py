"""Persistent Nintendo account, credential and play-history storage."""

from __future__ import annotations

import hashlib
import os
import threading
import time
from pathlib import Path
from typing import Any

from src.core.credential_store import CredentialStoreError, protect_secret, unprotect_secret
from src.core.config_handler import ConfigHandler
from src.core.errors import CredentialExpiredError, RemoteServiceError
from src.core.json_store import (
    JsonStoreError,
    atomic_write_json,
    read_json_with_backup,
    validate_json_object,
)


SCHEMA_VERSION = 1


def _now() -> int:
    return int(time.time())


def _ref(account_id: str) -> str:
    return hashlib.sha256(str(account_id).encode("utf-8")).hexdigest()[:40]


class NintendoStore:
    """Keep Nintendo data separate from project.json and normal settings."""

    _lock = threading.RLock()

    @staticmethod
    def _accounts_path() -> str:
        return ConfigHandler.get_nintendo_accounts_path()

    @staticmethod
    def _credentials_path() -> str:
        return ConfigHandler.get_nintendo_credentials_path()

    @staticmethod
    def _records_path(account_id: str) -> Path:
        return Path(ConfigHandler.get_nintendo_records_dir()) / f"{_ref(account_id)}.json"

    @classmethod
    def _read_accounts(cls) -> dict[str, Any]:
        path = cls._accounts_path()
        if not os.path.exists(path):
            return {"schema_version": SCHEMA_VERSION, "accounts": {}}
        try:
            data = read_json_with_backup(path, validator=validate_json_object)
        except JsonStoreError as exc:
            raise RemoteServiceError(
                "Nintendo 账号存储无法读取，请检查数据目录",
                code="nintendo_store_unavailable",
            ) from exc
        accounts = data.get("accounts")
        if not isinstance(accounts, dict):
            raise RemoteServiceError(
                "Nintendo 账号存储格式异常",
                code="nintendo_store_unavailable",
            )
        return {"schema_version": SCHEMA_VERSION, "accounts": accounts}

    @classmethod
    def list_accounts(cls) -> dict[str, dict[str, Any]]:
        with cls._lock:
            accounts = cls._read_accounts().get("accounts", {})
            result = {}
            for account_id, info in accounts.items():
                if not isinstance(info, dict):
                    continue
                safe = dict(info)
                safe.pop("credential_ref", None)
                safe.pop("credential_version", None)
                result[str(account_id)] = safe
            return result

    @classmethod
    def get_account(cls, account_id: str) -> dict[str, Any] | None:
        with cls._lock:
            info = cls._read_accounts().get("accounts", {}).get(str(account_id))
            return dict(info) if isinstance(info, dict) else None

    @classmethod
    def save_account(cls, profile: dict[str, Any], session_token: str) -> dict[str, Any]:
        account_id = str(profile.get("id") or "").strip()
        if not account_id or not session_token:
            raise RemoteServiceError(
                "Nintendo 账号信息不完整，无法保存",
                code="nintendo_response_invalid",
            )
        credential_ref = _ref(account_id)
        try:
            ciphertext = protect_secret(session_token)
        except CredentialStoreError as exc:
            raise RemoteServiceError(
                "无法安全保存 Nintendo 登录信息",
                code="nintendo_credential_store_unavailable",
            ) from exc

        with cls._lock:
            current = cls._read_accounts()
            old = current["accounts"].get(account_id)
            if not isinstance(old, dict):
                old = {}
            version = int(old.get("credential_version", 0) or 0) + 1
            now = _now()
            credential_payload = {"schema_version": SCHEMA_VERSION, "credentials": {}}
            credential_path = cls._credentials_path()
            if os.path.exists(credential_path):
                try:
                    existing = read_json_with_backup(
                        credential_path,
                        validator=validate_json_object,
                    )
                    if isinstance(existing.get("credentials"), dict):
                        credential_payload["credentials"].update(existing["credentials"])
                except JsonStoreError:
                    pass
            previous_credential = credential_payload["credentials"].get(credential_ref)
            credential_payload["credentials"][credential_ref] = {
                "ciphertext": ciphertext,
                "updated_at": now,
            }
            atomic_write_json(
                credential_path,
                credential_payload,
                validator=validate_json_object,
            )

            record = {
                **old,
                "display_name": str(profile.get("nickname") or "Nintendo Account"),
                "country": str(profile.get("country") or ""),
                "language": str(profile.get("language") or "en-US"),
                "credential_ref": credential_ref,
                "credential_version": version,
                "needs_reauth": False,
                "updated_at": now,
            }
            current["accounts"][account_id] = record
            try:
                atomic_write_json(
                    cls._accounts_path(),
                    current,
                    validator=validate_json_object,
                )
            except Exception:
                # Restore the previous credential if this was a reauthorization;
                # otherwise remove the newly written, currently unreferenced value.
                if previous_credential is not None:
                    credential_payload["credentials"][credential_ref] = previous_credential
                    atomic_write_json(
                        credential_path,
                        credential_payload,
                        validator=validate_json_object,
                    )
                else:
                    cls._remove_credential_locked(credential_ref)
                raise
            safe = dict(record)
            safe.pop("credential_ref", None)
            safe.pop("credential_version", None)
            return {"account_id": account_id, **safe}

    @classmethod
    def mark_needs_reauth(cls, account_id: str, message: str = "") -> None:
        with cls._lock:
            current = cls._read_accounts()
            info = current["accounts"].get(str(account_id))
            if not isinstance(info, dict):
                return
            info["needs_reauth"] = True
            if message:
                info["last_error"] = message[:240]
            info["updated_at"] = _now()
            atomic_write_json(cls._accounts_path(), current, validator=validate_json_object)

    @classmethod
    def get_session_token(cls, account_id: str) -> str:
        with cls._lock:
            account = cls.get_account(account_id)
            if not account:
                raise CredentialExpiredError(
                    "未找到 Nintendo 账号，请重新绑定",
                    code="nintendo_account_not_found",
                )
            ref = account.get("credential_ref")
            if not isinstance(ref, str) or not ref:
                raise CredentialExpiredError(
                    "Nintendo 登录信息不存在，请重新授权",
                    code="nintendo_auth_expired",
                )
            try:
                data = read_json_with_backup(
                    cls._credentials_path(),
                    validator=validate_json_object,
                )
                entry = data.get("credentials", {}).get(ref, {})
                return unprotect_secret(entry.get("ciphertext", ""))
            except (JsonStoreError, CredentialStoreError, AttributeError) as exc:
                raise CredentialExpiredError(
                    "Nintendo 登录信息无法恢复，请重新授权",
                    code="nintendo_auth_expired",
                ) from exc

    @classmethod
    def _remove_credential_locked(cls, credential_ref: str) -> None:
        path = cls._credentials_path()
        if not os.path.exists(path):
            return
        try:
            data = read_json_with_backup(path, validator=validate_json_object)
        except JsonStoreError:
            return
        credentials = data.get("credentials")
        if not isinstance(credentials, dict):
            return
        credentials.pop(credential_ref, None)
        atomic_write_json(path, data, validator=validate_json_object)

    @classmethod
    def remove_account(cls, account_id: str) -> bool:
        with cls._lock:
            current = cls._read_accounts()
            account = current["accounts"].pop(str(account_id), None)
            if not isinstance(account, dict):
                return False
            ref = account.get("credential_ref")
            atomic_write_json(cls._accounts_path(), current, validator=validate_json_object)
            if isinstance(ref, str):
                cls._remove_credential_locked(ref)
            return True

    @classmethod
    def load_records(cls, account_id: str) -> dict[str, Any] | None:
        path = cls._records_path(account_id)
        if not path.exists():
            return None
        with cls._lock:
            try:
                return read_json_with_backup(path, validator=validate_json_object)
            except JsonStoreError as exc:
                raise RemoteServiceError(
                    "Nintendo 游玩记录存储无法读取，请检查数据目录",
                    code="nintendo_store_unavailable",
                ) from exc

    @classmethod
    def save_records(cls, account_id: str, payload: dict[str, Any]) -> None:
        path = cls._records_path(account_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        with cls._lock:
            atomic_write_json(path, payload, validator=validate_json_object)

    @classmethod
    def touch_sync(cls, account_id: str, *, error: str = "") -> None:
        with cls._lock:
            current = cls._read_accounts()
            info = current["accounts"].get(str(account_id))
            if not isinstance(info, dict):
                return
            info["last_sync_at"] = _now()
            info["last_error"] = error[:240] if error else ""
            info["needs_reauth"] = False if not error else bool(info.get("needs_reauth", False))
            info["updated_at"] = _now()
            atomic_write_json(cls._accounts_path(), current, validator=validate_json_object)
