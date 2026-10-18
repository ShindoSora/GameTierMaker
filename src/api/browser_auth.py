"""Platform login orchestration; authorization credentials stay in the backend."""
import asyncio
import hmac
import secrets
import contextlib
import json
import time
from typing import Literal
from urllib.parse import parse_qs, urlsplit

from fastapi import APIRouter, Request, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

from src.core.browser_auth import PSN_LOGIN_URL, BrowserSpec, browser_auth, is_callback
from src.core.config_handler import ConfigHandler
from src.core.errors import AppError, CredentialMissingError, InvalidInputError, RemoteServiceError
from src.core.platform_credentials import save_credentials
from src.core.local_security import SESSION_COOKIE_NAME, is_allowed_local_origin, is_valid_local_session

router = APIRouter()


class BrowserAuthRequest(BaseModel):
    platform: Literal["steam", "psn", "xbox", "nintendo"]
    account: str = Field(default="", max_length=128)
    template_id: str | None = Field(default=None, max_length=128)


def prepare_login(req, request):
    from src.api import settings, nintendo
    from src.api.deps import get_manager
    target_id = get_manager().get_template(req.template_id).id
    account = req.account.strip()
    if req.platform in {"psn", "xbox"} and not account:
        raise InvalidInputError("请先填写账号的在线 ID 或玩家代号", code="platform_account_required")
    if req.platform == "steam":
        if not ConfigHandler().get_steam_key().strip():
            raise CredentialMissingError("请先填写并保存 Steam API Key", code="steam_key_missing")
        login = settings.steam_jump(request, target_id)
        job = settings._get_steam_import_job(login["operation_id"])
        spec = BrowserSpec("steam", login["url"], str(job["expected_return_to"]))
        def complete(result):
            if not is_callback(result.get("callback"), spec.callback):
                raise InvalidInputError("Steam 登录回调无效", code="steam_callback_invalid")
            current = settings._get_steam_import_job(login["operation_id"])
            if not current or current.get("status") != "complete":
                raise AppError((current or {}).get("message") or "Steam 账号绑定失败",
                               code=(current or {}).get("error") or "steam_bind_failed")
            return current
        return spec, complete
    if req.platform == "psn":
        spec = BrowserSpec("psn", PSN_LOGIN_URL)
        def complete(result):
            from src.core.browser_auth import NPSSO_PATTERN
            from src.core.playstation.get_psn_token import GetPsnToken
            value = result.get("npsso", "")
            if not isinstance(value, str) or not NPSSO_PATTERN.fullmatch(value):
                raise InvalidInputError("未取得有效的 PSN 登录凭据，请重新登录", code="psn_login_invalid")
            GetPsnToken.get_psn_token(value, force_refresh=True)
            save_credentials("psn", npsso=value)
            return settings.bind_psn_account(settings.PSNBindRequest(psn_online_id=account), target_id)
        return spec, complete
    if req.platform == "nintendo":
        from src.core.nintendo.nintendo_client import REDIRECT_URI
        login = nintendo.start_nintendo_auth(nintendo.NintendoAuthStartRequest(template_id=target_id))
        spec = BrowserSpec("nintendo", login["authorize_url"], REDIRECT_URI)
        def complete(result):
            return nintendo.complete_nintendo_auth(nintendo.NintendoAuthCompleteRequest(
                operation_id=login["operation_id"], callback_url=result.get("callback", "")))
        return spec, complete
    from xbox.webapi.authentication.manager import AuthenticationManager
    from xbox.webapi.common.signed_session import SignedSession
    from xbox.webapi.scripts import CLIENT_ID, CLIENT_SECRET, REDIRECT_URI
    state = secrets.token_urlsafe(32)
    async def authorize_url():
        async with SignedSession() as session:
            return AuthenticationManager(session, CLIENT_ID, CLIENT_SECRET, REDIRECT_URI).generate_authorization_url(state)
    spec = BrowserSpec("xbox", asyncio.run(authorize_url()), REDIRECT_URI)
    def complete(result):
        callback = result.get("callback", "")
        if not is_callback(callback, spec.callback):
            raise InvalidInputError("Xbox 登录回调无效", code="xbox_callback_invalid")
        query = parse_qs(urlsplit(callback).query)
        if len(query.get("state", [])) != 1 or not hmac.compare_digest(query["state"][0], state):
            raise InvalidInputError("Xbox 登录会话不匹配，请重新绑定", code="xbox_state_mismatch")
        if len(query.get("code", [])) != 1:
            raise InvalidInputError("Xbox 授权未完成，请重新登录", code="xbox_auth_denied")
        async def exchange_and_bind():
            async with SignedSession() as session:
                auth = AuthenticationManager(session, CLIENT_ID, CLIENT_SECRET, REDIRECT_URI)
                try:
                    await auth.request_tokens(query["code"][0])
                except Exception:
                    raise RemoteServiceError("Xbox 授权交换失败，请重新登录", code="xbox_auth_exchange_failed") from None
                save_credentials("xbox", oauth=auth.oauth.model_dump_json())
            return await settings.bind_xbox_account(settings.XboxBindRequest(gamertag=account), target_id)
        return asyncio.run(exchange_and_bind())
    return spec, complete


@router.post("/browser-auth")
def start_browser_auth(req: BrowserAuthRequest, request: Request):
    return browser_auth.start(lambda: prepare_login(req, request), platform=req.platform)


@router.get("/browser-auth/{operation_id}")
def browser_auth_status(operation_id: str):
    return browser_auth.status(operation_id)


@router.delete("/browser-auth/{operation_id}")
def cancel_browser_auth(operation_id: str):
    return browser_auth.cancel(operation_id)


@router.websocket("/browser-auth/{operation_id}/stream")
async def browser_stream(websocket: WebSocket, operation_id: str):
    token = getattr(websocket.app.state, "local_session_token", "")
    if (not token or not is_allowed_local_origin(websocket.headers.get("origin", ""), websocket.url.port or 80)
            or not is_valid_local_session(websocket.cookies.get(SESSION_COOKIE_NAME), token)):
        await websocket.close(code=1008)
        return
    try:
        browser = browser_auth.stream_browser(operation_id)
    except AppError:
        await websocket.close(code=1008)
        return
    if not hasattr(browser, "condition"):
        await websocket.close(code=1008)
        return
    with browser.condition:
        busy = getattr(browser, "viewer_connected", False)
        if not busy:
            browser.viewer_connected = True
    if busy:
        await websocket.close(code=1008)
        return
    try:
        await websocket.accept()
    except Exception:
        with browser.condition:
            browser.viewer_connected = False
        return

    async def send_frames():
        sequence = -1
        while not browser.finished.is_set():
            update = await asyncio.to_thread(browser.wait_update, sequence, .75)
            if update is None:
                continue
            sequence, frame, metadata = update
            await websocket.send_json(metadata)
            if frame is not None and browser.visible:
                await websocket.send_json(frame)
            await asyncio.sleep(.08)  # Latest-frame delivery bounds latency and bandwidth.

    async def receive_input():
        window_start, count = time.monotonic(), 0
        while True:
            raw = await websocket.receive_text()
            if len(raw) > 32768:
                await websocket.close(code=1009)
                return
            now = time.monotonic()
            if now - window_start >= 1:
                window_start, count = now, 0
            count += 1
            if count > 240:
                await websocket.close(code=1008)
                return
            try:
                message = json.loads(raw)
            except ValueError:
                await websocket.close(code=1008)
                return
            browser.command(message)

    tasks = [asyncio.create_task(send_frames()), asyncio.create_task(receive_input())]
    try:
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    except WebSocketDisconnect:
        pass
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        with browser.condition:
            browser.viewer_connected = False
        browser.command({"type": "visibility", "visible": False})
        with contextlib.suppress(Exception):
            await websocket.close()
