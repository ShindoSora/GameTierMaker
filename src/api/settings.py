"""
设置与账号绑定 API
"""
import json
import os
import threading
import time
import uuid
from html import escape
from urllib.parse import urlencode
import logging
import re
import requests

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool
from src.core.config_handler import (
    ConfigHandler,
    DEFAULT_UI_LANGUAGE,
    SUPPORTED_UI_LANGUAGES,
)
from src.core.steam.steam_client import SteamInformation
from src.api.deps import get_manager
from src.core.models import ImageGroup
from src.core.errors import (
    AccountNotFoundError,
    AppError,
    EmptyLibraryError,
    InvalidInputError,
    RemoteServiceError,
    RemoteTimeoutError,
)
from src.core.export_service import (
    get_download_settings,
    get_runtime_mode,
    save_download_directory_setting,
)
from src.core.licenses import OPEN_SOURCE_LICENSES

logger = logging.getLogger(__name__)
router = APIRouter()

_STEAM_IMPORT_JOBS: dict[str, dict[str, object]] = {}
_STEAM_IMPORT_JOBS_LOCK = threading.RLock()
_STEAM_IMPORT_JOB_TTL_SECONDS = 30 * 60
_ACCOUNT_OPERATION_LOCKS: dict[str, threading.Lock] = {}
_ACCOUNT_OPERATION_LOCKS_GUARD = threading.Lock()


def _account_operation_lock(platform: str, account_id: str) -> threading.Lock:
    key = f"{platform}:{account_id}"
    with _ACCOUNT_OPERATION_LOCKS_GUARD:
        return _ACCOUNT_OPERATION_LOCKS.setdefault(key, threading.Lock())


def _prune_steam_import_jobs_locked(now: float) -> None:
    expired = [
        job_id
        for job_id, job in _STEAM_IMPORT_JOBS.items()
        if now - float(job.get("updated_at", now)) > _STEAM_IMPORT_JOB_TTL_SECONDS
    ]
    for job_id in expired:
        _STEAM_IMPORT_JOBS.pop(job_id, None)


def _set_steam_import_job(
    operation_id: str,
    *,
    create: bool = True,
    **changes,
) -> bool:
    """Store Steam callback progress so the embedded EXE can poll it."""
    if not operation_id:
        return False
    now = time.time()
    with _STEAM_IMPORT_JOBS_LOCK:
        _prune_steam_import_jobs_locked(now)

        job = _STEAM_IMPORT_JOBS.get(operation_id)
        if job is None:
            if not create:
                return False
            job = {
                "operation_id": operation_id,
                "status": "pending",
                "steamid": "",
                "total": 0,
                "message": "",
                "error": "",
            }
            _STEAM_IMPORT_JOBS[operation_id] = job
        job.update(changes)
        job["updated_at"] = now
        return True


def _get_steam_import_job(operation_id: str) -> dict[str, object] | None:
    with _STEAM_IMPORT_JOBS_LOCK:
        _prune_steam_import_jobs_locked(time.time())
        job = _STEAM_IMPORT_JOBS.get(operation_id)
        return dict(job) if job else None


def _claim_steam_import_job(operation_id: str) -> dict[str, object] | None:
    """Atomically consume a pending OpenID state and reject replay attempts."""
    if not operation_id:
        return None
    now = time.time()
    with _STEAM_IMPORT_JOBS_LOCK:
        _prune_steam_import_jobs_locked(now)
        job = _STEAM_IMPORT_JOBS.get(operation_id)
        if not job or job.get("status") != "pending":
            return None
        job["status"] = "processing"
        job["updated_at"] = now
        return dict(job)


_STEAM_CALLBACK_TEXTS = {
    "zh-CN": {
        "error_title": "Steam 绑定失败",
        "login_failed": "Steam 登录失败或已取消。",
        "identity_failed": "Steam 身份验证失败。",
        "identity_timeout": "Steam 身份验证请求超时，请检查网络连接。",
        "identity_service_error": "无法连接 Steam 身份验证服务，请稍后重试。",
        "steam_id_missing": "无法获取 SteamID。",
        "player_failed": "获取 Steam 玩家信息失败，请查看日志。",
        "library_failed": "获取 Steam 游戏库失败，请查看日志。",
        "library_empty": "Steam 游戏库为空或隐私未公开。",
        "api_key_missing": "请先在设置中填写 Steam API Key。",
        "account_not_found": "未找到该 Steam 用户。",
        "remote_timeout": "Steam 服务响应超时，请检查网络连接。",
        "remote_service_error": "Steam 服务暂时不可用，请稍后重试。",
        "remote_response_invalid": "Steam 服务返回了无效数据，请稍后重试。",
        "generic_error": "Steam 绑定失败，请查看日志。",
        "import_failed": "Steam 游戏封面导入失败，请查看日志。",
        "import_title": "Steam 导入",
        "import_complete": "导入完成",
        "covers_loaded": "已加载 {count} 款游戏封面",
        "background_download": "远程展示中，后台将自动下载到本地",
    },
    "en-US": {
        "error_title": "Steam Linking Failed",
        "login_failed": "Steam sign-in failed or was cancelled.",
        "identity_failed": "Steam identity verification failed.",
        "identity_timeout": "Steam identity verification timed out. Check your network connection.",
        "identity_service_error": "Could not connect to Steam's identity service. Try again later.",
        "steam_id_missing": "Could not retrieve the SteamID.",
        "player_failed": "Could not load the Steam player profile. See the logs for details.",
        "library_failed": "Could not load the Steam library. See the logs for details.",
        "library_empty": "The Steam library is empty or private.",
        "api_key_missing": "Enter a Steam Web API key in Settings first.",
        "account_not_found": "This Steam user could not be found.",
        "remote_timeout": "The Steam service timed out. Check your network connection.",
        "remote_service_error": "The Steam service is temporarily unavailable. Try again later.",
        "remote_response_invalid": "Steam returned invalid data. Try again later.",
        "generic_error": "Steam account linking failed. See the logs for details.",
        "import_failed": "Could not import Steam game covers. See the logs for details.",
        "import_title": "Steam Import",
        "import_complete": "Import Complete",
        "covers_loaded": "Game covers loaded: {count}",
        "background_download": "Covers are available remotely and will be downloaded in the background",
    },
}

_STEAM_CALLBACK_ERROR_KEYS = {
    "steam_api_key_missing": "api_key_missing",
    "steam_account_not_found": "account_not_found",
    "steam_library_private": "library_empty",
    "steam_library_empty": "library_empty",
    "remote_timeout": "remote_timeout",
    "remote_service_error": "remote_service_error",
    "remote_response_invalid": "remote_response_invalid",
}


def _steam_callback_text(key: str, language: str, **values) -> str:
    texts = _STEAM_CALLBACK_TEXTS.get(language, _STEAM_CALLBACK_TEXTS["zh-CN"])
    return texts[key].format(**values)


def _steam_callback_language() -> str:
    try:
        return ConfigHandler.get_ui_language()
    except Exception:
        logger.exception("Steam 回调读取界面语言失败，将使用简体中文")
        return DEFAULT_UI_LANGUAGE


def _steam_callback_error(
    message_key: str,
    status_code: int = 400,
    language: str | None = None,
    operation_id: str = "",
    error_code: str = "",
) -> HTMLResponse:
    """Return a safe error page for the browser-based Steam callback."""
    language = language or _steam_callback_language()
    raw_message = _steam_callback_text(message_key, language)
    if operation_id:
        _set_steam_import_job(
            operation_id,
            create=False,
            status="error",
            message=raw_message,
            error=error_code or message_key,
        )
    title = escape(_steam_callback_text("error_title", language))
    message = escape(raw_message)
    html = (
        "<!DOCTYPE html>\n"
        f'<html lang="{language}">\n'
        f'<head><meta charset="UTF-8"><title>{title}</title></head>\n'
        '<body style="font-family:sans-serif;text-align:center;padding:40px;'
        'background:#1a1a1a;color:#e8e8e8">\n'
        f'<h3 style="color:#ef5350">{message}</h3>\n'
        "</body></html>"
    )
    return HTMLResponse(html, status_code=status_code)


def _steam_callback_app_error(
    exc: AppError,
    language: str,
    operation_id: str = "",
) -> HTMLResponse:
    if isinstance(exc, RemoteTimeoutError):
        status_code = 504
    elif isinstance(exc, RemoteServiceError):
        status_code = 502
    else:
        status_code = 400
    message_key = _STEAM_CALLBACK_ERROR_KEYS.get(exc.code, "generic_error")
    return _steam_callback_error(
        message_key,
        status_code,
        language,
        operation_id=operation_id,
        error_code=exc.code,
    )


class IgdbSettingsRequest(BaseModel):
    client_id: str
    client_secret: str | None = None


class BangumiSettingsRequest(BaseModel):
    bangumi_user_agent: str = ""
    bangumi_token: str | None = None


class SteamSettingsRequest(BaseModel):
    steam_key: str | None = None


class SteamGridDBSettingsRequest(BaseModel):
    steamgriddb_api_key: str | None = None


class SteamJumpRequest(BaseModel):
    game_name: str


class LanguageSettingsRequest(BaseModel):
    language: str


class DownloadDirectorySettingsRequest(BaseModel):
    directory: str = ""


class UiPreferencesRequest(BaseModel):
    library_open: bool = True
    library_width: int = 280
    settings_open: bool = False
    settings_width: int = 500
    settings_active_section: str = "search_settings"


@router.get("/language")
def get_ui_language():
    return {"language": ConfigHandler.get_ui_language()}


@router.put("/language")
def update_ui_language(req: LanguageSettingsRequest):
    language = req.language.strip()
    if language not in SUPPORTED_UI_LANGUAGES:
        raise InvalidInputError(
            "不支持的界面语言",
            code="ui_language_invalid",
        )
    ConfigHandler.save_ui_language(language)
    return {"ok": True, "language": language}


@router.get("/ui-preferences")
def get_ui_preferences():
    return ConfigHandler.get_ui_preferences()


@router.put("/ui-preferences")
def update_ui_preferences(req: UiPreferencesRequest):
    return ConfigHandler.save_ui_preferences({
        "library_open": req.library_open,
        "library_width": req.library_width,
        "settings_open": req.settings_open,
        "settings_width": req.settings_width,
        "settings_active_section": req.settings_active_section,
    })


@router.get("/download")
def get_download_directory_settings():
    return get_download_settings()


@router.put("/download")
def update_download_directory_settings(req: DownloadDirectorySettingsRequest):
    if get_runtime_mode() != "desktop":
        raise InvalidInputError(
            "浏览器模式的下载位置由浏览器管理",
            code="browser_download_managed",
        )
    return save_download_directory_setting(req.directory)


@router.get("")
def get_settings():
    config = ConfigHandler.read_config()
    public_fields = (
        "client_id",
        "bangumi_user_agent",
        "psn_online_id",
        "ui_language",
        "download_directory",
    )
    result = {
        field: ConfigHandler.deep_get(config, field)
        for field in public_fields
        if ConfigHandler.deep_get(config, field) is not None
    }
    result["configured_secrets"] = {
        field: bool(ConfigHandler.deep_get(config, field))
        for field in (
            "client_secret",
            "bangumi_token",
            "steam_key",
            "steamgriddb_api_key",
            "psn_npsso",
        )
    }
    return result


@router.get("/licenses")
def get_open_source_licenses():
    """Return the licenses displayed by the local settings panel."""
    return {"licenses": [dict(license_info) for license_info in OPEN_SOURCE_LICENSES]}


@router.get("/secret/{field_name}")
def reveal_setting_secret(field_name: str):
    """Return one credential only after an explicit action in the local UI."""
    allowed = {
        "client_secret",
        "bangumi_token",
        "steam_key",
        "steamgriddb_api_key",
        "psn_npsso",
    }
    if field_name not in allowed:
        raise InvalidInputError(
            "不支持读取该设置项",
            code="setting_secret_invalid",
        )
    value = ConfigHandler.deep_get(ConfigHandler.read_config(), field_name)
    return {"field": field_name, "value": value if isinstance(value, str) else ""}


@router.put("/igdb")
def update_igdb_settings(req: IgdbSettingsRequest):
    current_secret = ConfigHandler.deep_get(
        ConfigHandler.read_config(), "client_secret"
    )
    supplied_secret = req.client_secret.strip() if req.client_secret is not None else None
    effective_secret = supplied_secret if supplied_secret is not None else current_secret
    if not req.client_id.strip() or not effective_secret:
        raise InvalidInputError(
            "client_id 和 client_secret 不能为空",
            code="igdb_credentials_required",
        )
    fields = {
        "client_id": req.client_id.strip(),
        "access_token": "",
        "expiration_time": 0,
    }
    if supplied_secret is not None:
        fields["client_secret"] = supplied_secret
    ConfigHandler.update_config_fields(fields)
    return {"ok": True}


@router.put("/bangumi")
def update_bangumi_settings(req: BangumiSettingsRequest):
    fields = {"bangumi_user_agent": req.bangumi_user_agent.strip()}
    if req.bangumi_token is not None:
        fields["bangumi_token"] = req.bangumi_token.strip()
    ConfigHandler.update_config_fields(fields)
    return {"ok": True}


@router.put("/steam")
def update_steam_settings(req: SteamSettingsRequest):
    if req.steam_key is not None:
        ConfigHandler.update_config_fields({"steam_key": req.steam_key.strip()})
    return {"ok": True}


@router.put("/steamgriddb")
def update_steamgriddb_settings(req: SteamGridDBSettingsRequest):
    if req.steamgriddb_api_key is not None:
        ConfigHandler.update_config_fields(
            {"steamgriddb_api_key": req.steamgriddb_api_key.strip()}
        )
    return {"ok": True}


@router.post("/steam/jump")
def steam_jump(request: Request, template_id: str | None = None):
    base_url = str(request.base_url).rstrip("/")
    mgr = get_manager()
    target_template_id = mgr.get_template(template_id).id
    operation_id = uuid.uuid4().hex
    return_to = (
        base_url
        + "/api/settings/steam/callback?"
        + urlencode({"operation_id": operation_id})
    )
    _set_steam_import_job(
        operation_id,
        status="pending",
        target_template_id=target_template_id,
        expected_return_to=return_to,
    )
    params = {
        "openid.ns": "http://specs.openid.net/auth/2.0",
        "openid.mode": "checkid_setup",
        "openid.return_to": return_to,
        "openid.realm": base_url,
        "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
        "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
    }
    login_url = "https://steamcommunity.com/openid/login?" + urlencode(params)
    return {"url": login_url, "operation_id": operation_id}


@router.get("/steam/import-status/{operation_id}")
def steam_import_status(operation_id: str):
    job = _get_steam_import_job(operation_id)
    if not job:
        return {"operation_id": operation_id, "status": "unknown"}
    return job


@router.get("/steam/callback")
def steam_callback(request: Request):
    """Steam OpenID 回调：验证 -> 获取游戏库 -> 去重 -> 远程注册 -> 通知前端"""
    language = _steam_callback_language()
    params = dict(request.query_params)
    operation_id = str(params.get("operation_id", "")).strip()
    job = _claim_steam_import_job(operation_id)
    if not job:
        return _steam_callback_error(
            "login_failed", 400, language, error_code="invalid_operation"
        )
    target_template_id = str(job.get("target_template_id", "")).strip() or None
    expected_return_to = str(job.get("expected_return_to", "")).strip()

    if params.get("openid.mode") != "id_res":
        return _steam_callback_error(
            "login_failed", 400, language, operation_id=operation_id
        )
    if not expected_return_to or params.get("openid.return_to") != expected_return_to:
        return _steam_callback_error(
            "identity_failed", 400, language, operation_id=operation_id
        )

    verify_params = {
        key: value for key, value in params.items() if key.startswith("openid.")
    }
    verify_params["openid.mode"] = "check_authentication"

    try:
        resp = requests.post(
            "https://steamcommunity.com/openid/login",
            data=verify_params, timeout=10
        )
        if not any(
            line.strip() == "is_valid:true"
            for line in resp.text.splitlines()
        ):
            return _steam_callback_error(
                "identity_failed", 400, language, operation_id=operation_id
            )
    except requests.exceptions.Timeout:
        return _steam_callback_error(
            "identity_timeout", 504, language, operation_id=operation_id
        )
    except requests.exceptions.RequestException:
        logger.exception("Steam OpenID 验证请求失败")
        return _steam_callback_error(
            "identity_service_error", 502, language, operation_id=operation_id
        )

    claimed_id = params.get("openid.claimed_id", "")
    match = re.search(r"https://steamcommunity.com/openid/id/(\d+)", claimed_id)
    if not match:
        return _steam_callback_error(
            "steam_id_missing", 400, language, operation_id=operation_id
        )

    steamid = match.group(1)

    try:
        SteamInformation.get_steam_player_summaries(steamid)
    except AppError as exc:
        return _steam_callback_app_error(exc, language, operation_id)
    except Exception:
        logger.exception("Steam 玩家信息获取发生未知错误")
        return _steam_callback_error(
            "player_failed", 500, language, operation_id=operation_id
        )

    try:
        games = SteamInformation.get_owned_games(steamid)
    except AppError as exc:
        return _steam_callback_app_error(exc, language, operation_id)
    except Exception:
        logger.exception("Steam 游戏库获取发生未知错误")
        return _steam_callback_error(
            "library_failed", 500, language, operation_id=operation_id
        )

    logger.info("Steam 回调: steamid=%s, 获取到 %d 款游戏", steamid, len(games))

    if not games:
        return _steam_callback_error(
            "library_empty", 422, language, operation_id=operation_id
        )

    # 注册或复用已有图片，并关联到当前模板的 Steam 分组
    try:
        with _account_operation_lock("steam", steamid):
            if str(steamid) not in SteamInformation.get_accounts():
                raise AccountNotFoundError(
                    "Steam 账号绑定已被取消，请重新绑定",
                    code="steam_account_not_found",
                )
            mgr = get_manager()
            target_template = mgr.get_template(target_template_id)
            sid = "steam_import_" + str(steamid)
            group_name = _steam_group_name(steamid)
            registered = mgr.register_remote_images(
                games,
                steam_id=steamid,
                group_id=sid,
                replace_group=True,
                template_id=target_template.id,
                group_name=group_name,
            )
    except AppError as exc:
        return _steam_callback_app_error(exc, language, operation_id)
    except Exception:
        logger.exception("Steam 回调注册远程图片失败")
        return _steam_callback_error(
            "import_failed", 500, language, operation_id=operation_id
        )
    logger.info("Steam 图片同步完成: 识别 %d 款游戏封面", registered)

    _set_steam_import_job(
        operation_id,
        create=False,
        status="complete",
        steamid=steamid,
        total=registered,
        message=_steam_callback_text("covers_loaded", language, count=registered),
        error="",
    )

    title = escape(_steam_callback_text("import_title", language))
    complete = escape(_steam_callback_text("import_complete", language))
    covers_loaded = escape(_steam_callback_text("covers_loaded", language, count=registered))
    background_download = escape(_steam_callback_text("background_download", language))
    completion_payload = json.dumps(
        {
            "type": "steam-import-done",
            "operation_id": operation_id,
            "steamid": steamid,
            "total": registered,
        },
        ensure_ascii=False,
    )
    html = (
        '<!DOCTYPE html>\n'
        f'<html lang="{language}">\n'
        f'<head><meta charset="UTF-8"><title>{title}</title></head>\n'
        '<body style="font-family:sans-serif;text-align:center;padding:40px;background:#1a1a1a;color:#e8e8e8">\n'
        f'<h3 style="color:#4caf50">{complete}</h3>\n'
        f'<p>{covers_loaded}</p>\n'
        f'<p style="color:#888;font-size:12px">{background_download}</p>\n'
        '<script>\n'
        '(function() {\n'
        '    if (window.opener && !window.opener.closed) {\n'
        f'        window.opener.postMessage({completion_payload}, window.location.origin);\n'
        '    }\n'
        '    setTimeout(function() { window.close(); }, 3000);\n'
        '})();\n'
        '</script>\n'
        '</body></html>'
    )

    return HTMLResponse(html)


# === Steam 账号管理 ===

@router.get("/steam/accounts")
def list_steam_accounts():
    accounts = SteamInformation.get_accounts()
    return {"accounts": accounts}


@router.delete("/steam/accounts/{steamid}")
def unbind_steam_account(steamid: str):
    with _account_operation_lock("steam", steamid):
        mgr = get_manager()
        sid = "steam_import_" + str(steamid)
        deleted_images = mgr.delete_account_images(
            sid,
            legacy_steam_id=str(steamid),
            remove_groups=True,
        )
        SteamInformation.remove_account(steamid)
    logger.info("取消绑定 Steam 账号: %s, 删除了 %d 张图片及分组", steamid, deleted_images)
    return {"ok": True, "deleted_images": deleted_images}


@router.delete("/steam/accounts/{steamid}/images")
def delete_steam_account_images(steamid: str):
    with _account_operation_lock("steam", steamid):
        mgr = get_manager()
        deleted = mgr.delete_account_images(
            "steam_import_" + str(steamid),
            legacy_steam_id=str(steamid),
        )
    logger.info("删除 Steam 账号图片: %s, 共 %d 张", steamid, deleted)
    return {"ok": True, "deleted_images": deleted}


@router.post("/steam/accounts/{steamid}/sync")
def sync_steam_account(steamid: str, template_id: str | None = None):
    """同步账号游戏库：获取列表 -> 注册或复用图片 -> 关联当前模板分组。"""
    with _account_operation_lock("steam", steamid):
        return _sync_steam_account_locked(steamid, template_id)


def _sync_steam_account_locked(steamid: str, template_id: str | None = None):
    mgr = get_manager()
    target_template_id = mgr.get_template(template_id).id
    if str(steamid) not in SteamInformation.get_accounts():
        raise AccountNotFoundError(
            "未找到该 Steam 账号，请重新绑定",
            code="steam_account_not_found",
        )
    games = SteamInformation.get_owned_games(steamid)

    if not games:
        raise EmptyLibraryError(
            "Steam 游戏库为空或隐私未公开",
            code="steam_library_empty",
        )

    sid = "steam_import_" + str(steamid)
    registered = mgr.register_remote_images(
        games,
        steam_id=steamid,
        group_id=sid,
        replace_group=True,
        template_id=target_template_id,
        group_name=_steam_group_name(steamid),
    )
    logger.info("同步账号 %s: 识别 %d 款游戏封面", steamid, registered)
    return {"ok": True, "total": registered}


@router.post("/steam/backfill")
def backfill_steam_images():
    """后台下载远程图片到本地，每次最多处理 20 张，返回剩余数量"""
    return _backfill_images_for_source("steam")


@router.post("/images/backfill")
def backfill_platform_images(source: str = ""):
    """按平台回填远程封面；空 source 兼容为全部平台。"""
    if source not in {"", "steam", "psn", "xbox", "nintendo"}:
        raise InvalidInputError(
            "图片回填来源不正确",
            code="backfill_source_invalid",
        )
    return _backfill_images_for_source(source)


def _backfill_images_for_source(source: str):
    mgr = get_manager()
    ok, fail, deferred = mgr.backfill_remote_images(limit=20, source=source)
    remaining, retry_pending = mgr.get_backfill_status(source)
    return {
        "ok": ok,
        "fail": fail,
        "deferred": deferred,
        "remaining": remaining,
        "retry_pending": retry_pending,
    }


# === 内部辅助 ===

def _steam_group_name(steamid: str) -> str:
    """返回 Steam 账号图片组名称。"""
    accounts = SteamInformation.get_accounts()
    info = accounts.get(str(steamid), {})
    return (info.get("personaname") or "").strip() or ("Steam " + str(steamid)[:8])


def _ensure_steam_group(steamid, template_id: str | None = None):
    """为指定 steam 账号创建/查找独立分组，分组名使用 Steam 昵称"""
    mgr = get_manager()
    sid = "steam_import_" + str(steamid)

    gname = _steam_group_name(steamid)
    target = mgr.get_template(template_id)
    library = target.hidden_preset

    found = False
    for g in library.groups:
        if g.id == sid:
            g.name = gname  # 名称可能已更新
            found = True
            break
    if not found:
        sg = ImageGroup(id=sid, name=gname, image_ids=[])
        library.groups.append(sg)
        target.library_group_states[sid] = True
        mgr.save_project()
    return mgr, sid


def _ensure_psn_group(account_id, online_id, template_id: str | None = None):
    """为指定 PSN 账号创建/查找独立分组，分组名使用 PSN 在线 ID"""
    mgr = get_manager()
    sid = "psn_import_" + str(account_id)
    gname = (online_id or "").strip() or ("PSN " + str(account_id)[:8])

    target = mgr.get_template(template_id)
    library = target.hidden_preset
    found = False
    for g in library.groups:
        if g.id == sid:
            g.name = gname
            found = True
            break
    if not found:
        sg = ImageGroup(id=sid, name=gname, image_ids=[])
        library.groups.append(sg)
        target.library_group_states[sid] = True
        mgr.save_project()
    return sid


# === PSN 设置与账号管理 ===

class PSNSettingsRequest(BaseModel):
    psn_npsso: str | None = None


class PSNBindRequest(BaseModel):
    psn_online_id: str = ""


class PSNFilterRequest(BaseModel):
    categories: list = []
    min_play_duration_hours: float = 0.0


@router.put("/psn")
def update_psn_settings(req: PSNSettingsRequest):
    """保存 PSN NPSSO"""
    if req.psn_npsso is not None:
        ConfigHandler.update_config_fields({"psn_npsso": req.psn_npsso.strip()})
    return {"ok": True}


@router.get("/psn/accounts")
def list_psn_accounts():
    """列出已绑定的 PSN 账号"""
    from src.core.playstation.psn_client import PSNClient
    accounts = PSNClient.get_accounts()
    return {"accounts": accounts}


@router.delete("/psn/accounts/{account_id}")
def unbind_psn_account(account_id: str):
    """取消绑定 PSN 账号，删除对应图片和分组"""
    from src.core.playstation.psn_client import PSNClient
    with _account_operation_lock("psn", account_id):
        mgr = get_manager()
        sid = "psn_import_" + str(account_id)
        deleted = mgr.delete_account_images(sid, remove_groups=True)
        PSNClient.remove_account(account_id)
    logger.info("取消绑定 PSN 账号: %s，删除了 %d 张图片及全部模板分组", account_id, deleted)
    return {"ok": True, "deleted_images": deleted}


@router.delete("/psn/accounts/{account_id}/images")
def delete_psn_account_images(account_id: str):
    """删除 PSN 账号下的所有图片（保留账号绑定）"""
    with _account_operation_lock("psn", account_id):
        mgr = get_manager()
        sid = "psn_import_" + str(account_id)
        count = mgr.delete_account_images(sid)
    logger.info("删除 PSN 账号图片: account_id=%s, 共 %d 张", account_id, count)
    return {"ok": True, "deleted_images": count}


@router.post("/psn/accounts/{account_id}/sync")
def sync_psn_account(account_id: str, template_id: str | None = None):
    """同步 PSN 账号游戏库：获取列表 → 去重 → 远程注册（不下载）"""
    with _account_operation_lock("psn", account_id):
        return _sync_psn_account_locked(account_id, template_id)


def _sync_psn_account_locked(account_id: str, template_id: str | None = None):
    from src.core.playstation.psn_client import PSNClient

    mgr = get_manager()
    target_template_id = mgr.get_template(template_id).id
    client = PSNClient()

    # 从 psn_config.json 读取该账号的 onlineId
    accounts = PSNClient.get_accounts()
    account_info = accounts.get(account_id, {})
    psn_online_id = account_info.get("onlineId", "")
    if not psn_online_id:
        raise AccountNotFoundError(
            "未找到该 PSN 账号信息，请重新绑定",
            code="psn_account_not_found",
        )

    # 读取筛选配置
    filter_config = ConfigHandler.read_psn_filter_config()
    categories = filter_config.get("categories", [])
    min_hours = filter_config.get("min_play_duration_hours", 0.0)

    result = client.psn_client(
        psn_online_id,
        categories=categories,
        min_play_duration_hours=min_hours,
    )

    titles = result.get("titles", [])
    if not titles:
        raise EmptyLibraryError(
            "PSN 游戏库为空或隐私未公开",
            code="psn_library_empty",
        )

    online_id = result.get("online_id", "")
    aid = result.get("account_id", account_id)

    # 标准化 PSN 游戏数据格式，适配 register_remote_images
    normalized_titles = []
    for t in titles:
        image_url = t.get("imageUrl", "")
        title_id = str(t.get("titleId", ""))
        title_name = t.get("name", "")
        if not image_url or not title_id:
            continue
        normalized_titles.append({
            "appid": title_id,
            "name": title_name,
            "cover": {"url": image_url},
        })

    sid = "psn_import_" + str(aid)
    group_name = (online_id or "").strip() or ("PSN " + str(aid)[:8])
    registered = mgr.register_remote_images(
        normalized_titles,
        steam_id="",
        group_id=sid,
        replace_group=True,
        template_id=target_template_id,
        group_name=group_name,
    )
    logger.info("PSN 同步账号 %s (%s): 识别 %d 款游戏封面", account_id, online_id, registered)
    return {"ok": True, "total": registered, "account_id": aid}


@router.post("/psn/bind")
def bind_psn_account(req: PSNBindRequest, template_id: str | None = None):
    """绑定 PSN 账号：获取游戏列表 → 去重 → 远程注册（不下载）"""
    from src.core.playstation.psn_client import PSNClient

    mgr = get_manager()
    target_template_id = mgr.get_template(template_id).id
    client = PSNClient()

    # 读取筛选配置
    filter_config = ConfigHandler.read_psn_filter_config()
    categories = filter_config.get("categories", [])
    min_hours = filter_config.get("min_play_duration_hours", 0.0)

    result = client.psn_client(
        req.psn_online_id,
        categories=categories,
        min_play_duration_hours=min_hours,
    )

    titles_raw = result.get("titles", [])
    if not titles_raw:
        raise EmptyLibraryError(
            "PSN 游戏库为空或隐私未公开",
            code="psn_library_empty",
        )

    online_id = result.get("online_id", "")
    aid = result.get("account_id", "")

    # 标准化 PSN 游戏数据格式
    normalized_titles = []
    for t in titles_raw:
        image_url = t.get("imageUrl", "")
        title_id = str(t.get("titleId", ""))
        title_name = t.get("name", "")
        if not image_url or not title_id:
            continue
        normalized_titles.append({
            "appid": title_id,
            "name": title_name,
            "cover": {"url": image_url},
        })

    sid = "psn_import_" + str(aid)
    group_name = (online_id or "").strip() or ("PSN " + str(aid)[:8])
    with _account_operation_lock("psn", str(aid)):
        if str(aid) not in {
            str(account_key) for account_key in PSNClient.get_accounts()
        }:
            raise AccountNotFoundError(
                "PSN 账号绑定已被取消，请重新绑定",
                code="psn_account_not_found",
            )
        registered = mgr.register_remote_images(
            normalized_titles,
            steam_id="",
            group_id=sid,
            replace_group=True,
            template_id=target_template_id,
            group_name=group_name,
        )
    logger.info("PSN 绑定完成: account_id=%s (%s), 识别 %d 款游戏封面", aid, online_id, registered)
    return {"ok": True, "total": registered, "account_id": aid}


@router.post("/psn/backfill")
def backfill_psn_images():
    """后台下载 PSN 远程图片到本地，每次最多处理 20 张，返回剩余数量"""
    return _backfill_images_for_source("psn")


@router.get("/psn/filters")
def get_psn_filters():
    """获取 PSN 筛选配置"""
    return ConfigHandler.read_psn_filter_config()


@router.put("/psn/filters")
def update_psn_filters(req: PSNFilterRequest):
    """保存 PSN 筛选配置"""
    ConfigHandler.save_psn_filter_config(
        categories=req.categories,
        min_play_duration_hours=req.min_play_duration_hours
    )
    return {"ok": True}


# === Xbox 设置与账号管理 ===

class XboxBindRequest(BaseModel):
    gamertag: str = ""


@router.get("/xbox/accounts")
def list_xbox_accounts():
    """列出已绑定的 Xbox 账号"""
    from src.core.xbox.xbox_client import XboxClient
    accounts = XboxClient.get_accounts()
    return {"accounts": accounts}


@router.delete("/xbox/accounts/{xuid}")
def unbind_xbox_account(xuid: str):
    """取消绑定 Xbox 账号，删除对应图片和分组"""
    from src.core.xbox.xbox_client import XboxClient
    with _account_operation_lock("xbox", xuid):
        mgr = get_manager()
        sid = "xbox:" + str(xuid)
        deleted = mgr.delete_account_images(sid, remove_groups=True)
        XboxClient.remove_account(xuid)
    logger.info("取消绑定 Xbox 账号: %s，删除了 %d 张图片及全部模板分组", xuid, deleted)
    return {"ok": True, "deleted_images": deleted}


@router.delete("/xbox/accounts/{xuid}/images")
def delete_xbox_account_images(xuid: str):
    """删除 Xbox 账号下的所有图片（保留账号绑定）"""
    with _account_operation_lock("xbox", xuid):
        mgr = get_manager()
        sid = "xbox:" + str(xuid)
        count = mgr.delete_account_images(sid)
    logger.info("删除 Xbox 账号图片: xuid=%s, 共 %d 张", xuid, count)
    return {"ok": True, "deleted_images": count}


@router.post("/xbox/accounts/{xuid}/sync")
async def sync_xbox_account(xuid: str, template_id: str | None = None):
    """同步 Xbox 账号游戏库"""
    operation_lock = _account_operation_lock("xbox", xuid)
    await run_in_threadpool(operation_lock.acquire)
    try:
        return await _sync_xbox_account_locked(xuid, template_id)
    finally:
        operation_lock.release()


async def _sync_xbox_account_locked(xuid: str, template_id: str | None = None):
    from src.core.xbox.xbox_client import XboxClient

    mgr = get_manager()
    target_template_id = mgr.get_template(template_id).id
    accounts = await run_in_threadpool(XboxClient.get_accounts)
    info = accounts.get(xuid, {})
    gamertag = info.get("gamertag", "")
    if not gamertag:
        raise AccountNotFoundError(
            "未找到该 Xbox 账号信息，请重新绑定",
            code="xbox_account_not_found",
        )

    client = XboxClient()
    result = await client.get_xbox_games(gamertag)

    return await run_in_threadpool(
        _register_xbox_titles, result, mgr, target_template_id
    )


@router.post("/xbox/bind")
async def bind_xbox_account(req: XboxBindRequest, template_id: str | None = None):
    """绑定 Xbox 账号"""
    from src.core.xbox.xbox_client import XboxClient

    if not req.gamertag.strip():
        raise InvalidInputError(
            "请输入 Xbox 玩家代号",
            code="xbox_gamertag_required",
        )

    mgr = get_manager()
    target_template_id = mgr.get_template(template_id).id
    client = XboxClient()
    result = await client.get_xbox_games(req.gamertag.strip())
    xuid = str(result.get("xuid", ""))
    operation_lock = _account_operation_lock("xbox", xuid)
    await run_in_threadpool(operation_lock.acquire)
    try:
        accounts = await run_in_threadpool(XboxClient.get_accounts)
        if xuid not in {str(account_key) for account_key in accounts}:
            raise AccountNotFoundError(
                "Xbox 账号绑定已被取消，请重新绑定",
                code="xbox_account_not_found",
            )
        return await run_in_threadpool(
            _register_xbox_titles, result, mgr, target_template_id
        )
    finally:
        operation_lock.release()


def _register_xbox_titles(result, mgr, template_id: str | None = None):
    """注册 Xbox 游戏到图片库（共享逻辑）"""
    titles = result.get("titles", [])
    if not titles:
        raise EmptyLibraryError(
            "Xbox 游戏库为空或隐私未公开",
            code="xbox_library_empty",
        )

    xuid = result.get("xuid", "")
    gamertag = result.get("gamertag", "")

    # 标准化格式
    normalized = []
    for t in titles:
        normalized.append({
            "appid": str(t.get("titleId", "")),
            "name": t.get("titleName", ""),
            "cover": {"url": t.get("imageUrl", "")},
        })

    sid = "xbox:" + str(xuid)
    group_name = gamertag.strip() or ("Xbox " + str(xuid)[:8])
    registered = mgr.register_remote_images(
        normalized,
        steam_id="",
        group_id=sid,
        replace_group=True,
        template_id=template_id,
        group_name=group_name,
    )
    logger.info("Xbox 注册完成: xuid=%s (%s), 识别 %d 款游戏封面", xuid, gamertag, registered)
    return {"ok": True, "total": registered, "xuid": xuid, "gamertag": gamertag}


def _ensure_xbox_group(xuid, gamertag, template_id: str | None = None):
    """为指定 Xbox 账号创建/查找独立分组"""
    mgr = get_manager()
    sid = "xbox:" + str(xuid)
    gname = gamertag.strip() or ("Xbox " + str(xuid)[:8])

    target = mgr.get_template(template_id)
    library = target.hidden_preset
    found = False
    for g in library.groups:
        if g.id == sid:
            g.name = gname
            found = True
            break
    if not found:
        sg = ImageGroup(id=sid, name=gname, image_ids=[])
        library.groups.append(sg)
        target.library_group_states[sid] = True
        mgr.save_project()
    return sid


class ClearSourceRequest(BaseModel):
    source: str = ""  # steam / igdb / bangumi / vndb / steamgriddb / xbox / nintendo / cache，空字符串 = 全部


@router.post("/clear_cache")
def clear_cache(req: ClearSourceRequest):
    """按来源清空缓存：传 source 清单个，不传则清全部"""
    mgr = get_manager()
    if req.source:
        count = mgr.clear_source_folder(req.source)
        logger.info("清空缓存 [%s]: 删除了 %d 项", req.source, count)
    else:
        count = mgr.clear_all_source_folders()
        logger.info("清空缓存 [全部]: 删除了 %d 项", count)
    return {"ok": True, "deleted": count, "source": req.source or "all"}


@router.post("/reset_all_images")
def reset_all_images():
    """清除所有图片：库图片、隐藏预设、源缓存、缩略图 —— 恢复到初始分发状态"""
    mgr = get_manager()
    count = mgr.reset_all_images()
    logger.info("重置所有图片: 删除了 %d 项", count)
    return {"ok": True, "deleted": count}


@router.get("/cache_sources")
def list_cache_sources():
    """列出所有缓存来源及其文件数"""
    import os as _os
    mgr = get_manager()
    sources = {}
    data_dir = os.path.join(mgr.root_dir, "data")
    for folder in mgr._source_folders():
        d = os.path.join(data_dir, folder)
        count = len(_os.listdir(d)) if _os.path.exists(d) else 0
        sources[folder] = count
    return {"sources": sources, "total": sum(sources.values())}
