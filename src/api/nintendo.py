"""Nintendo Account authorization and play-history import endpoints."""

from __future__ import annotations

import threading
import time
import uuid
import re
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from src.api.deps import get_manager
from src.core.errors import (
    AccountNotFoundError,
    AppError,
    CredentialExpiredError,
    InvalidInputError,
    RemoteResponseError,
)
from src.core.nintendo.models import NintendoTitle
from src.core.nintendo.nintendo_client import NintendoClient
from src.core.nintendo.store import NintendoStore


router = APIRouter()

_LOCK = threading.RLock()
_ACCOUNT_LOCKS: dict[str, threading.Lock] = {}
_AUTH_SESSIONS: dict[str, dict[str, Any]] = {}
_PREVIEWS: dict[str, dict[str, Any]] = {}
_AUTH_TTL = 10 * 60
_PREVIEW_TTL = 10 * 60


def _account_lock(account_id: str) -> threading.Lock:
    with _LOCK:
        return _ACCOUNT_LOCKS.setdefault(account_id, threading.Lock())


def _prune_locked(now: float | None = None) -> None:
    now = now or time.time()
    for key, item in list(_AUTH_SESSIONS.items()):
        if now - float(item.get("created_at", now)) > _AUTH_TTL:
            _AUTH_SESSIONS.pop(key, None)
    for key, item in list(_PREVIEWS.items()):
        if now - float(item.get("created_at", now)) > _PREVIEW_TTL:
            _PREVIEWS.pop(key, None)


def _account_id(value: str) -> str:
    value = str(value or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", value):
        raise InvalidInputError("Nintendo 账号标识无效", code="nintendo_account_id_invalid")
    return value


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _title_dict(title: NintendoTitle | dict[str, Any]) -> dict[str, Any]:
    value = title.to_dict() if isinstance(title, NintendoTitle) else dict(title)
    if not value.get("record_key") or not value.get("title_name"):
        raise RemoteResponseError(
            "Nintendo 游玩记录标准化失败",
            code="nintendo_response_invalid",
        )
    return value


def _group_id(account_id: str) -> str:
    return "nintendo:" + account_id


def _group_name(account: dict[str, Any], account_id: str) -> str:
    display = str(account.get("display_name") or "").strip()
    return display or ("Nintendo " + account_id[:8])


def _manager_games(titles: list[dict[str, Any]]) -> list[dict[str, Any]]:
    games = []
    for title in titles:
        cover_url = str(title.get("cover_url") or "").strip()
        title_key = str(title.get("record_key") or "").strip()
        if not cover_url or not title_key or not cover_url.startswith(("http://", "https://", "//")):
            continue
        games.append(
            {
                "appid": "nintendo_" + title_key,
                "name": str(title.get("title_name") or ""),
                "cover": {"url": cover_url},
            }
        )
    return games


def _has_cover(title: dict[str, Any]) -> bool:
    value = str(title.get("cover_url") or "").strip()
    return value.startswith(("http://", "https://", "//"))


def _existing_source_names(manager, group_id: str) -> set[str]:
    with manager._save_lock:
        return {
            str(meta.original_name)
            for meta in manager.project_data.shared_images_meta.values()
            if getattr(meta, "source_group_id", "") == group_id
        }


class NintendoAuthStartRequest(BaseModel):
    template_id: str | None = None


class NintendoAuthCompleteRequest(BaseModel):
    operation_id: str = Field(min_length=1, max_length=128)
    callback_url: str = Field(min_length=1, max_length=8192)


class NintendoImportRequest(BaseModel):
    preview_id: str = Field(min_length=1, max_length=128)
    record_keys: list[str] = Field(min_length=1, max_length=1000)
    request_id: str = Field(min_length=1, max_length=128)


@router.post("/nintendo/auth/start")
def start_nintendo_auth(req: NintendoAuthStartRequest):
    manager = get_manager()
    template_id = manager.get_template(req.template_id).id
    operation_id = uuid.uuid4().hex
    login = NintendoClient.build_login_request(operation_id)
    with _LOCK:
        _prune_locked()
        _AUTH_SESSIONS[operation_id] = {
            "operation_id": operation_id,
            "state": login.state,
            "code_verifier": login.code_verifier,
            "template_id": template_id,
            "status": "pending",
            "created_at": time.time(),
        }
    return {
        "ok": True,
        "operation_id": operation_id,
        "authorize_url": login.authorize_url,
        "expires_at": int(time.time() + _AUTH_TTL),
    }


@router.post("/nintendo/auth/complete")
def complete_nintendo_auth(req: NintendoAuthCompleteRequest):
    with _LOCK:
        _prune_locked()
        session = _AUTH_SESSIONS.get(req.operation_id)
        if not session or session.get("status") != "pending":
            raise InvalidInputError(
                "Nintendo 授权会话已失效，请重新发起绑定",
                code="nintendo_auth_session_expired",
            )
        session["status"] = "exchanging"

    try:
        client = NintendoClient()
        session_token = client.exchange_callback(
            req.callback_url,
            str(session["state"]),
            str(session["code_verifier"]),
        )
        client = NintendoClient(session_token)
        profile = client.get_profile()
        saved = NintendoStore.save_account(profile, session_token)
    except AppError:
        with _LOCK:
            if req.operation_id in _AUTH_SESSIONS:
                _AUTH_SESSIONS[req.operation_id]["status"] = "failed"
        raise
    except Exception as exc:
        with _LOCK:
            if req.operation_id in _AUTH_SESSIONS:
                _AUTH_SESSIONS[req.operation_id]["status"] = "failed"
        raise RemoteResponseError(
            "Nintendo 授权过程中发生错误，请重新尝试",
            code="nintendo_auth_failed",
        ) from exc

    with _LOCK:
        session = _AUTH_SESSIONS.get(req.operation_id)
        if session:
            session.update({"status": "completed", "account_id": saved["account_id"]})
    return {"ok": True, **saved}


@router.get("/nintendo/accounts")
def list_nintendo_accounts():
    return {"accounts": NintendoStore.list_accounts()}


@router.delete("/nintendo/accounts/{account_id}")
def unbind_nintendo_account(account_id: str):
    account_id = _account_id(account_id)
    with _account_lock(account_id):
        removed = NintendoStore.remove_account(account_id)
        if not removed:
            raise AccountNotFoundError("未找到 Nintendo 账号", code="nintendo_account_not_found")
        with _LOCK:
            for key, preview in list(_PREVIEWS.items()):
                if preview.get("account_id") == account_id:
                    _PREVIEWS.pop(key, None)
    # Deliberately preserve records, project images and their layout.
    return {"ok": True, "account_id": account_id}


@router.delete("/nintendo/accounts/{account_id}/images")
def delete_nintendo_account_images(account_id: str):
    account_id = _account_id(account_id)
    if not NintendoStore.get_account(account_id) and NintendoStore.load_records(account_id) is None:
        raise AccountNotFoundError("未找到 Nintendo 账号", code="nintendo_account_not_found")
    with _account_lock(account_id):
        deleted = get_manager().delete_account_images(
            _group_id(account_id),
            remove_groups=True,
        )
    return {"ok": True, "account_id": account_id, "deleted_images": deleted}


@router.post("/nintendo/accounts/{account_id}/sync")
def sync_nintendo_account(account_id: str, template_id: str | None = None):
    account_id = _account_id(account_id)
    account = NintendoStore.get_account(account_id)
    if not account:
        raise AccountNotFoundError("未找到 Nintendo 账号", code="nintendo_account_not_found")
    manager = get_manager()
    target_template_id = manager.get_template(template_id).id
    with _account_lock(account_id):
        account = NintendoStore.get_account(account_id)
        if not account:
            raise AccountNotFoundError("未找到 Nintendo 账号", code="nintendo_account_not_found")
        try:
            token = NintendoStore.get_session_token(account_id)
            client = NintendoClient(token, locale=account.get("language") or "en-US")
            titles = client.get_play_history(account_id)
        except CredentialExpiredError as exc:
            NintendoStore.mark_needs_reauth(account_id, exc.message)
            raise
        title_dicts = [_title_dict(title) for title in titles]
        snapshot_id = uuid.uuid4().hex
        preview_id = uuid.uuid4().hex
        existing = NintendoStore.load_records(account_id) or {}
        preview = {
            "preview_id": preview_id,
            "account_id": account_id,
            "account_version": int(account.get("credential_version", 0) or 0),
            "template_id": target_template_id,
            "snapshot_id": snapshot_id,
            "titles": title_dicts,
            "created_at": time.time(),
        }
        with _LOCK:
            _prune_locked()
            _PREVIEWS[preview_id] = preview
        NintendoStore.save_records(
            account_id,
            {
                "schema_version": 1,
                "account_id": account_id,
                "snapshot_id": snapshot_id,
                "status": "preview",
                "fetched_at": _utc_now(),
                "titles": title_dicts,
                "imported_record_keys": existing.get("imported_record_keys", []),
                "imported_titles": existing.get("imported_titles", {}),
            },
        )
        NintendoStore.touch_sync(account_id)
        return {
            "ok": True,
            "preview_id": preview_id,
            "expires_at": int(time.time() + _PREVIEW_TTL),
            "account_id": account_id,
            "template_id": target_template_id,
            "received": len(title_dicts),
            "titles": title_dicts,
        }


@router.get("/nintendo/accounts/{account_id}/records")
def get_nintendo_records(account_id: str):
    account_id = _account_id(account_id)
    records = NintendoStore.load_records(account_id)
    if records is None:
        raise AccountNotFoundError("未找到 Nintendo 游玩记录", code="nintendo_records_not_found")
    return {
        "ok": True,
        "account_id": account_id,
        "bound": NintendoStore.get_account(account_id) is not None,
        "records": records,
    }


@router.post("/nintendo/accounts/{account_id}/import")
def import_nintendo_records(account_id: str, req: NintendoImportRequest):
    account_id = _account_id(account_id)
    account = NintendoStore.get_account(account_id)
    if not account:
        raise AccountNotFoundError("未找到 Nintendo 账号", code="nintendo_account_not_found")
    with _account_lock(account_id):
        account = NintendoStore.get_account(account_id)
        if not account:
            raise AccountNotFoundError("未找到 Nintendo 账号", code="nintendo_account_not_found")
        previous = NintendoStore.load_records(account_id) or {}
        if previous.get("last_import_request_id") == req.request_id:
            prior = previous.get("last_import_result")
            if isinstance(prior, dict):
                return prior
        with _LOCK:
            _prune_locked()
            preview = _PREVIEWS.get(req.preview_id)
        if not preview or preview.get("account_id") != account_id:
            raise InvalidInputError("Nintendo 预览已失效，请重新同步", code="nintendo_preview_expired")
        if int(preview.get("account_version", -1)) != int(account.get("credential_version", 0) or 0):
            raise InvalidInputError("Nintendo 账号已重新授权，请重新同步", code="nintendo_preview_stale")
        manager = get_manager()
        target_template = manager.get_template(preview.get("template_id"))
        if target_template is None:
            raise InvalidInputError("目标模板不存在或已被删除", code="template_not_found")

        all_titles = {
            str(title.get("record_key")): title
            for title in preview.get("titles", [])
            if isinstance(title, dict) and title.get("record_key")
        }
        selected_keys = list(dict.fromkeys(str(key) for key in req.record_keys))
        if any(key not in all_titles for key in selected_keys):
            raise InvalidInputError("Nintendo 导入项不属于当前预览", code="nintendo_preview_invalid")

        imported_before = {
            str(key) for key in previous.get("imported_record_keys", []) if key
        }
        imported_titles = {
            str(key): dict(value)
            for key, value in (previous.get("imported_titles") or {}).items()
            if isinstance(value, dict)
        }
        for key in selected_keys:
            imported_titles[key] = all_titles[key]
        imported_keys = imported_before | set(selected_keys)
        union_titles = [imported_titles[key] for key in imported_keys if key in imported_titles]
        games = _manager_games(union_titles)
        group_id = _group_id(account_id)
        before_names = _existing_source_names(manager, group_id)
        manager.register_remote_images(
            games,
            steam_id="",
            group_id=group_id,
            replace_group=True,
            template_id=str(preview["template_id"]),
            group_name=_group_name(account, account_id),
        )
        after_names = _existing_source_names(manager, group_id)
        selected_with_cover = sum(1 for key in selected_keys if _has_cover(all_titles[key]))
        selected_names = {
            "nintendo_" + key + ".jpg"
            for key in selected_keys
            if _has_cover(all_titles[key])
        }
        created = len((after_names - before_names) & selected_names)
        registered = selected_with_cover
        reused = max(0, registered - created)
        result = {
            "ok": True,
            "status": "completed",
            "account_id": account_id,
            "template_id": preview["template_id"],
            "received": len(all_titles),
            "selected": len(selected_keys),
            "registered": registered,
            "created": created,
            "reused": reused,
            "cover_pending": len(selected_keys) - selected_with_cover,
            "skipped_invalid": 0,
        }
        confirmed = {
            "schema_version": 1,
            "account_id": account_id,
            "snapshot_id": preview["snapshot_id"],
            "status": "confirmed",
            "fetched_at": previous.get("fetched_at") or _utc_now(),
            "confirmed_at": _utc_now(),
            "titles": list(all_titles.values()),
            "selected_record_keys": selected_keys,
            "imported_record_keys": sorted(imported_keys),
            "imported_titles": imported_titles,
            "last_import_request_id": req.request_id,
            "last_import_result": result,
        }
        NintendoStore.save_records(account_id, confirmed)
        with _LOCK:
            _PREVIEWS.pop(req.preview_id, None)
        return result
