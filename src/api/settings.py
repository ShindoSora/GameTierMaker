"""
设置与账号绑定 API
"""
import os
import shutil
from html import escape
from urllib.parse import urlencode
import logging
import re
import requests

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
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

logger = logging.getLogger(__name__)
router = APIRouter()
image_cache = "./data/cache"


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
) -> HTMLResponse:
    """Return a safe error page for the browser-based Steam callback."""
    language = language or _steam_callback_language()
    title = escape(_steam_callback_text("error_title", language))
    message = escape(_steam_callback_text(message_key, language))
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


def _steam_callback_app_error(exc: AppError, language: str) -> HTMLResponse:
    if isinstance(exc, RemoteTimeoutError):
        status_code = 504
    elif isinstance(exc, RemoteServiceError):
        status_code = 502
    else:
        status_code = 400
    message_key = _STEAM_CALLBACK_ERROR_KEYS.get(exc.code, "generic_error")
    return _steam_callback_error(message_key, status_code, language)


class IgdbSettingsRequest(BaseModel):
    client_id: str
    client_secret: str


class BangumiSettingsRequest(BaseModel):
    bangumi_user_agent: str = ""
    bangumi_token: str = ""


class SteamSettingsRequest(BaseModel):
    steam_key: str = ""


class SteamJumpRequest(BaseModel):
    game_name: str


class LanguageSettingsRequest(BaseModel):
    language: str


class DownloadDirectorySettingsRequest(BaseModel):
    directory: str = ""


@router.get("/language")
async def get_ui_language():
    return {"language": ConfigHandler.get_ui_language()}


@router.put("/language")
async def update_ui_language(req: LanguageSettingsRequest):
    language = req.language.strip()
    if language not in SUPPORTED_UI_LANGUAGES:
        raise InvalidInputError(
            "不支持的界面语言",
            code="ui_language_invalid",
        )
    ConfigHandler.save_ui_language(language)
    return {"ok": True, "language": language}


@router.get("/download")
async def get_download_directory_settings():
    return get_download_settings()


@router.put("/download")
async def update_download_directory_settings(req: DownloadDirectorySettingsRequest):
    if get_runtime_mode() != "desktop":
        raise InvalidInputError(
            "浏览器模式的下载位置由浏览器管理",
            code="browser_download_managed",
        )
    return save_download_directory_setting(req.directory)


@router.get("")
async def get_settings():
    return ConfigHandler.read_config()


@router.put("/igdb")
async def update_igdb_settings(req: IgdbSettingsRequest):
    if not req.client_id.strip() or not req.client_secret.strip():
        raise InvalidInputError(
            "client_id 和 client_secret 不能为空",
            code="igdb_credentials_required",
        )
    ConfigHandler.update_config_fields({
        "client_id": req.client_id.strip(),
        "client_secret": req.client_secret.strip(),
        "access_token": "",
        "expiration_time": 0,
    })
    return {"ok": True}


@router.put("/bangumi")
async def update_bangumi_settings(req: BangumiSettingsRequest):
    ConfigHandler.update_config_fields({
        "bangumi_user_agent": req.bangumi_user_agent.strip(),
        "bangumi_token": req.bangumi_token.strip(),
    })
    return {"ok": True}


@router.put("/steam")
async def update_steam_settings(req: SteamSettingsRequest):
    ConfigHandler.update_config_fields({
        "steam_key": req.steam_key.strip(),
    })
    return {"ok": True}


@router.post("/steam/jump")
async def steam_jump(request: Request):
    base_url = str(request.base_url).rstrip("/")
    return_to = base_url + "/api/settings/steam/callback"
    params = {
        "openid.ns": "http://specs.openid.net/auth/2.0",
        "openid.mode": "checkid_setup",
        "openid.return_to": return_to,
        "openid.realm": base_url,
        "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
        "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
    }
    login_url = "https://steamcommunity.com/openid/login?" + urlencode(params)
    return {"url": login_url}


@router.get("/steam/callback")
def steam_callback(request: Request):
    """Steam OpenID 回调：验证 -> 获取游戏库 -> 去重 -> 远程注册 -> 通知前端"""
    language = _steam_callback_language()
    params = dict(request.query_params)

    if params.get("openid.mode") != "id_res":
        return _steam_callback_error("login_failed", 400, language)

    verify_params = params.copy()
    verify_params["openid.mode"] = "check_authentication"

    try:
        resp = requests.post(
            "https://steamcommunity.com/openid/login",
            data=verify_params, timeout=10
        )
        if "is_valid:true" not in resp.text:
            return _steam_callback_error("identity_failed", 400, language)
    except requests.exceptions.Timeout:
        return _steam_callback_error("identity_timeout", 504, language)
    except requests.exceptions.RequestException:
        logger.exception("Steam OpenID 验证请求失败")
        return _steam_callback_error("identity_service_error", 502, language)

    claimed_id = params.get("openid.claimed_id", "")
    match = re.search(r"https://steamcommunity.com/openid/id/(\d+)", claimed_id)
    if not match:
        return _steam_callback_error("steam_id_missing", 400, language)

    steamid = match.group(1)

    try:
        SteamInformation.get_steam_player_summaries(steamid)
    except AppError as exc:
        return _steam_callback_app_error(exc, language)
    except Exception:
        logger.exception("Steam 玩家信息获取发生未知错误")
        return _steam_callback_error("player_failed", 500, language)

    try:
        games = SteamInformation.get_owned_games(steamid)
    except AppError as exc:
        return _steam_callback_app_error(exc, language)
    except Exception:
        logger.exception("Steam 游戏库获取发生未知错误")
        return _steam_callback_error("library_failed", 500, language)

    logger.info("Steam 回调: steamid=%s, 获取到 %d 款游戏", steamid, len(games))

    if not games:
        return _steam_callback_error("library_empty", 422, language)

    # 去重 + 远程注册
    try:
        mgr, sid = _ensure_steam_group(steamid)
        games = _dedup_games(games, steamid, mgr)
        registered = mgr.register_remote_images(games, steam_id=steamid, group_id=sid)
    except AppError as exc:
        return _steam_callback_app_error(exc, language)
    except Exception:
        logger.exception("Steam 回调注册远程图片失败")
        return _steam_callback_error("import_failed", 500, language)
    logger.info("远程注册完成: %d 款，可直接展示", registered)

    title = escape(_steam_callback_text("import_title", language))
    complete = escape(_steam_callback_text("import_complete", language))
    covers_loaded = escape(_steam_callback_text("covers_loaded", language, count=registered))
    background_download = escape(_steam_callback_text("background_download", language))
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
        '        window.opener.postMessage({ type: "steam-import-done" }, "*");\n'
        '    }\n'
        '    setTimeout(function() { window.close(); }, 3000);\n'
        '})();\n'
        '</script>\n'
        '</body></html>'
    )

    return HTMLResponse(html)


# === Steam 账号管理 ===

@router.get("/steam/accounts")
async def list_steam_accounts():
    accounts = SteamInformation.get_accounts()
    return {"accounts": accounts}


@router.delete("/steam/accounts/{steamid}")
async def unbind_steam_account(steamid: str):
    mgr = get_manager()
    deleted_images = mgr.delete_images_by_steam_id(steamid)
    SteamInformation.remove_account(steamid)
    # 删除对应的分组
    sid = "steam_import_" + steamid
    groups = mgr._lib().groups
    for g in list(groups):
        if g.id == sid:
            groups.remove(g)
            break
    mgr.save_project()
    logger.info("取消绑定 Steam 账号: %s, 删除了 %d 张图片及分组", steamid, deleted_images)
    return {"ok": True, "deleted_images": deleted_images}


@router.delete("/steam/accounts/{steamid}/images")
async def delete_steam_account_images(steamid: str):
    mgr = get_manager()
    deleted = mgr.delete_images_by_steam_id(steamid)
    logger.info("删除 Steam 账号图片: %s, 共 %d 张", steamid, deleted)
    return {"ok": True, "deleted_images": deleted}


@router.post("/steam/accounts/{steamid}/sync")
async def sync_steam_account(steamid: str):
    """同步账号游戏库：获取列表 -> 去重 -> 远程注册（不下载）"""
    games = SteamInformation.get_owned_games(steamid)

    if not games:
        raise EmptyLibraryError(
            "Steam 游戏库为空或隐私未公开",
            code="steam_library_empty",
        )

    mgr, sid = _ensure_steam_group(steamid)
    games = _dedup_games(games, steamid, mgr)
    registered = mgr.register_remote_images(games, steam_id=steamid, group_id=sid)
    logger.info("同步账号 %s: 远程注册 %d 款", steamid, registered)
    return {"ok": True, "total": registered}


@router.post("/steam/backfill")
async def backfill_steam_images():
    """后台下载远程图片到本地，每次最多处理 20 张，返回剩余数量"""
    mgr = get_manager()
    ok, fail = mgr.backfill_remote_images(limit=20)
    remaining = 0
    for m in mgr.project_data.shared_images_meta.values():
        if m.is_remote and not m.remote_failed:
            remaining += 1
    return {"ok": ok, "fail": fail, "remaining": remaining}


# === 内部辅助 ===

def _ensure_steam_group(steamid):
    """为指定 steam 账号创建/查找独立分组，分组名使用 Steam 昵称"""
    mgr = get_manager()
    sid = "steam_import_" + str(steamid)

    # 查昵称
    accounts = SteamInformation.get_accounts()
    info = accounts.get(str(steamid), {})
    gname = (info.get("personaname") or "").strip() or ("Steam " + str(steamid)[:8])

    found = False
    for g in mgr._lib().groups:
        if g.id == sid:
            g.name = gname  # 名称可能已更新
            found = True
            break
    if not found:
        sg = ImageGroup(id=sid, name=gname, image_ids=[])
        mgr._lib().groups.append(sg)
        if mgr.current_template:
            mgr.current_template.library_group_states[sid] = True
        mgr.save_project()
    return mgr, sid


def _dedup_games(games, steam_id, mgr):
    def _is_dup(game):
        return mgr.is_steam_duplicate(str(game.get("appid", "")), steam_id)
    return [g for g in games if not _is_dup(g)]


def _ensure_psn_group(account_id, online_id):
    """为指定 PSN 账号创建/查找独立分组，分组名使用 PSN 在线 ID"""
    mgr = get_manager()
    sid = "psn_import_" + str(account_id)
    gname = (online_id or "").strip() or ("PSN " + str(account_id)[:8])

    found = False
    for g in mgr._lib().groups:
        if g.id == sid:
            g.name = gname
            found = True
            break
    if not found:
        sg = ImageGroup(id=sid, name=gname, image_ids=[])
        mgr._lib().groups.append(sg)
        if mgr.current_template:
            mgr.current_template.library_group_states[sid] = True
        mgr.save_project()
    return sid


def _dedup_psn_titles(titles, account_id, mgr):
    """去重：检查 PSN 游戏是否已导入"""
    def _is_dup(title):
        appid = str(title.get("appid", ""))
        target_name = appid + ".jpg"
        for meta in mgr.project_data.shared_images_meta.values():
            if meta.original_name == target_name:
                if not meta.remote_failed:
                    return True
        return False
    return [t for t in titles if not _is_dup(t)]


def _clear_psn_group_images(group_id: str, mgr):
    """清空指定分组的图片数据（meta + image_ids），为重新同步做准备"""
    group = mgr._lib().find_group_by_id(group_id)
    if not group:
        return
    count = len(group.image_ids)
    for img_id in list(group.image_ids):
        mgr.delete_image_globally(img_id)
    group.image_ids.clear()
    mgr.save_project()
    logger.info("PSN 分组 %s 已清空 %d 张旧图片，准备重新同步", group_id, count)

# === PSN 设置与账号管理 ===

class PSNSettingsRequest(BaseModel):
    psn_npsso: str = ""


class PSNBindRequest(BaseModel):
    psn_online_id: str = ""


class PSNFilterRequest(BaseModel):
    categories: list = []
    min_play_duration_hours: float = 0.0


@router.put("/psn")
async def update_psn_settings(req: PSNSettingsRequest):
    """保存 PSN NPSSO"""
    ConfigHandler.update_config_fields({
        "psn_npsso": req.psn_npsso.strip(),
    })
    return {"ok": True}


@router.get("/psn/accounts")
async def list_psn_accounts():
    """列出已绑定的 PSN 账号"""
    from src.core.playstation.psn_client import PSNClient
    accounts = PSNClient.get_accounts()
    return {"accounts": accounts}


@router.delete("/psn/accounts/{account_id}")
async def unbind_psn_account(account_id: str):
    """取消绑定 PSN 账号，删除对应图片和分组"""
    from src.core.playstation.psn_client import PSNClient
    mgr = get_manager()

    # 根据 account_id 找分组
    sid = "psn_import_" + str(account_id)
    # 收集该分组下的图片并删除
    group = mgr._lib().find_group_by_id(sid)
    if group:
        for img_id in list(group.image_ids):
            mgr.delete_image_globally(img_id)
        mgr._lib().groups.remove(group)

    PSNClient.remove_account(account_id)
    mgr.save_project()
    logger.info("取消绑定 PSN 账号: %s，已删除对应图片及分组", account_id)
    return {"ok": True}


@router.delete("/psn/accounts/{account_id}/images")
async def delete_psn_account_images(account_id: str):
    """删除 PSN 账号下的所有图片（保留账号绑定）"""
    mgr = get_manager()
    sid = "psn_import_" + str(account_id)
    group = mgr._lib().find_group_by_id(sid)
    count = 0
    if group:
        count = len(group.image_ids)
        for img_id in list(group.image_ids):
            mgr.delete_image_globally(img_id)
        group.image_ids.clear()
    mgr.save_project()
    logger.info("删除 PSN 账号图片: account_id=%s, 共 %d 张", account_id, count)
    return {"ok": True, "deleted_images": count}


@router.post("/psn/accounts/{account_id}/sync")
async def sync_psn_account(account_id: str):
    """同步 PSN 账号游戏库：获取列表 → 去重 → 远程注册（不下载）"""
    from src.core.playstation.psn_client import PSNClient

    mgr = get_manager()
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

    sid = _ensure_psn_group(aid, online_id)
    _clear_psn_group_images(sid, mgr)
    registered = mgr.register_remote_images(normalized_titles, steam_id="", group_id=sid)
    logger.info("PSN 同步账号 %s (%s): 远程注册 %d 款", account_id, online_id, registered)
    return {"ok": True, "total": registered, "account_id": aid}


@router.post("/psn/bind")
async def bind_psn_account(req: PSNBindRequest):
    """绑定 PSN 账号：获取游戏列表 → 去重 → 远程注册（不下载）"""
    from src.core.playstation.psn_client import PSNClient

    mgr = get_manager()
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

    sid = _ensure_psn_group(aid, online_id)
    _clear_psn_group_images(sid, mgr)
    registered = mgr.register_remote_images(normalized_titles, steam_id="", group_id=sid)
    logger.info("PSN 绑定完成: account_id=%s (%s), 远程注册 %d 款", aid, online_id, registered)
    return {"ok": True, "total": registered, "account_id": aid}


@router.post("/psn/backfill")
async def backfill_psn_images():
    """后台下载 PSN 远程图片到本地，每次最多处理 20 张，返回剩余数量"""
    mgr = get_manager()
    ok, fail = mgr.backfill_remote_images(limit=20)
    remaining = 0
    for m in mgr.project_data.shared_images_meta.values():
        if m.is_remote and not m.remote_failed:
            remaining += 1
    return {"ok": ok, "fail": fail, "remaining": remaining}


@router.get("/psn/filters")
async def get_psn_filters():
    """获取 PSN 筛选配置"""
    return ConfigHandler.read_psn_filter_config()


@router.put("/psn/filters")
async def update_psn_filters(req: PSNFilterRequest):
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
async def list_xbox_accounts():
    """列出已绑定的 Xbox 账号"""
    from src.core.xbox.xbox_client import XboxClient
    accounts = XboxClient.get_accounts()
    return {"accounts": accounts}


@router.delete("/xbox/accounts/{xuid}")
async def unbind_xbox_account(xuid: str):
    """取消绑定 Xbox 账号，删除对应图片和分组"""
    from src.core.xbox.xbox_client import XboxClient
    mgr = get_manager()

    sid = "xbox:" + str(xuid)
    group = mgr._lib().find_group_by_id(sid)
    if group:
        for img_id in list(group.image_ids):
            mgr.delete_image_globally(img_id)
        mgr._lib().groups.remove(group)

    XboxClient.remove_account(xuid)
    mgr.save_project()
    logger.info("取消绑定 Xbox 账号: %s", xuid)
    return {"ok": True}


@router.delete("/xbox/accounts/{xuid}/images")
async def delete_xbox_account_images(xuid: str):
    """删除 Xbox 账号下的所有图片（保留账号绑定）"""
    mgr = get_manager()
    sid = "xbox:" + str(xuid)
    group = mgr._lib().find_group_by_id(sid)
    count = 0
    if group:
        count = len(group.image_ids)
        for img_id in list(group.image_ids):
            mgr.delete_image_globally(img_id)
        group.image_ids.clear()
    mgr.save_project()
    logger.info("删除 Xbox 账号图片: xuid=%s, 共 %d 张", xuid, count)
    return {"ok": True, "deleted_images": count}


@router.post("/xbox/accounts/{xuid}/sync")
async def sync_xbox_account(xuid: str):
    """同步 Xbox 账号游戏库"""
    from src.core.xbox.xbox_client import XboxClient

    mgr = get_manager()
    accounts = XboxClient.get_accounts()
    info = accounts.get(xuid, {})
    gamertag = info.get("gamertag", "")
    if not gamertag:
        raise AccountNotFoundError(
            "未找到该 Xbox 账号信息，请重新绑定",
            code="xbox_account_not_found",
        )

    client = XboxClient()
    result = await client.get_xbox_games(gamertag)

    return _register_xbox_titles(result, mgr)


@router.post("/xbox/bind")
async def bind_xbox_account(req: XboxBindRequest):
    """绑定 Xbox 账号"""
    from src.core.xbox.xbox_client import XboxClient

    if not req.gamertag.strip():
        raise InvalidInputError(
            "请输入 Xbox 玩家代号",
            code="xbox_gamertag_required",
        )

    mgr = get_manager()
    client = XboxClient()
    result = await client.get_xbox_games(req.gamertag.strip())

    return _register_xbox_titles(result, mgr)


def _register_xbox_titles(result, mgr):
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

    sid = _ensure_xbox_group(xuid, gamertag)
    _clear_psn_group_images(sid, mgr)  # 复用 PSN 的清理逻辑
    registered = mgr.register_remote_images(normalized, steam_id="", group_id=sid)
    logger.info("Xbox 注册完成: xuid=%s (%s), 远程注册 %d 款", xuid, gamertag, registered)
    return {"ok": True, "total": registered, "xuid": xuid, "gamertag": gamertag}


def _ensure_xbox_group(xuid, gamertag):
    """为指定 Xbox 账号创建/查找独立分组"""
    mgr = get_manager()
    sid = "xbox:" + str(xuid)
    gname = gamertag.strip() or ("Xbox " + str(xuid)[:8])

    found = False
    for g in mgr._lib().groups:
        if g.id == sid:
            g.name = gname
            found = True
            break
    if not found:
        sg = ImageGroup(id=sid, name=gname, image_ids=[])
        mgr._lib().groups.append(sg)
        if mgr.current_template:
            mgr.current_template.library_group_states[sid] = True
        mgr.save_project()
    return sid


class ClearSourceRequest(BaseModel):
    source: str = ""  # steam / igdb / bangumi / xbox / cache，空字符串 = 全部


@router.post("/clear_cache")
async def clear_cache(req: ClearSourceRequest):
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
async def reset_all_images():
    """清除所有图片：库图片、隐藏预设、源缓存、缩略图 —— 恢复到初始分发状态"""
    mgr = get_manager()
    count = mgr.reset_all_images()
    logger.info("重置所有图片: 删除了 %d 项", count)
    return {"ok": True, "deleted": count}


@router.get("/cache_sources")
async def list_cache_sources():
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

