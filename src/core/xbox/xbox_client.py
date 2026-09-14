import asyncio
import os
import logging

import httpx

from xbox.webapi.api.client import XboxLiveClient
from xbox.webapi.authentication.manager import AuthenticationManager
from xbox.webapi.authentication.models import OAuth2TokenResponse
from xbox.webapi.common.exceptions import AuthenticationException
from xbox.webapi.common.signed_session import SignedSession
from xbox.webapi.scripts import CLIENT_ID, CLIENT_SECRET

from src.core.config_handler import ConfigHandler
from src.core.errors import (
    AccountNotFoundError,
    CredentialExpiredError,
    RemoteResponseError,
    RemoteServiceError,
    RemoteTimeoutError,
)
from src.core.json_store import (
    JsonStoreError,
    read_json_with_backup,
    update_json,
    validate_json_object,
)
from src.core.xbox.get_xbox_token import XboxLiveToken

logger = logging.getLogger(__name__)


class XboxClient:
    def __init__(self):
        self.config = ConfigHandler.read_config()
        self.xbox_token = XboxLiveToken()

    async def _get_client(self):
        try:
            # Token discovery may launch the xbox authentication helper and
            # wait for a child process. Keep that blocking work off Uvicorn's
            # event-loop thread.
            json_str = await asyncio.to_thread(
                self.xbox_token.get_xbox_live_token
            )
        except Exception as exc:
            raise CredentialExpiredError(
                "Xbox 登录信息无效，请重新完成账号验证",
                code="xbox_auth_failed",
            ) from exc

        if not isinstance(json_str, str) or not json_str.strip():
            raise CredentialExpiredError(
                "Xbox 登录信息无效，请重新完成账号验证",
                code="xbox_auth_failed",
            )

        session = None
        try:
            session = SignedSession()
            auth_mgr = AuthenticationManager(
                session, CLIENT_ID, CLIENT_SECRET, ""
            )
        except Exception as exc:
            if session is not None:
                await self._close_session(session)
            raise RemoteServiceError(
                "Xbox 登录服务初始化失败，请稍后重试"
            ) from exc
        try:
            auth_mgr.oauth = OAuth2TokenResponse.model_validate_json(json_str)
        except (TypeError, ValueError) as exc:
            await self._close_session(session)
            raise CredentialExpiredError(
                "Xbox 登录信息已失效，请重新完成账号验证",
                code="xbox_auth_expired",
            ) from exc

        try:
            await auth_mgr.refresh_tokens()
        except AuthenticationException as exc:
            await self._close_session(session)
            raise CredentialExpiredError(
                "Xbox 登录信息已失效，请重新完成账号验证",
                code="xbox_auth_expired",
            ) from exc
        except httpx.TimeoutException as exc:
            await self._close_session(session)
            raise RemoteTimeoutError(
                "Xbox 登录服务响应超时，请检查网络连接",
                code="xbox_auth_timeout",
            ) from exc
        except httpx.HTTPStatusError as exc:
            await self._close_session(session)
            if exc.response.status_code in {400, 401, 403}:
                raise CredentialExpiredError(
                    "Xbox 登录信息已失效，请重新完成账号验证",
                    code="xbox_auth_expired",
                ) from exc
            raise RemoteServiceError(
                "Xbox 登录服务暂时不可用，请稍后重试"
            ) from exc
        except Exception as exc:
            await self._close_session(session)
            raise RemoteServiceError(
                "Xbox 登录服务暂时不可用，请稍后重试"
            ) from exc

        try:
            return XboxLiveClient(auth_mgr)
        except Exception as exc:
            await self._close_session(session)
            raise RemoteServiceError(
                "Xbox 服务客户端初始化失败，请稍后重试"
            ) from exc

    @staticmethod
    async def _close_session(session):
        try:
            await session.aclose()
        except Exception:
            logger.warning("关闭 Xbox 登录会话失败", exc_info=True)

    @staticmethod
    def _raise_request_error(exc, message, *, not_found_message=None):
        if isinstance(exc, AuthenticationException):
            raise CredentialExpiredError(
                "Xbox 登录信息已失效，请重新完成账号验证",
                code="xbox_auth_expired",
            ) from exc
        if isinstance(exc, httpx.TimeoutException):
            raise RemoteTimeoutError(
                "Xbox 服务响应超时，请检查网络连接",
                code="xbox_request_timeout",
            ) from exc
        if isinstance(exc, httpx.HTTPStatusError):
            status_code = exc.response.status_code
            if status_code in {401, 403}:
                raise CredentialExpiredError(
                    "Xbox 登录信息已失效，请重新完成账号验证",
                    code="xbox_auth_expired",
                ) from exc
            if status_code == 404 and not_found_message:
                raise AccountNotFoundError(
                    not_found_message,
                    code="xbox_account_not_found",
                ) from exc
        raise RemoteServiceError(message) from exc

    @staticmethod
    def get_accounts():
        """读取 xbox_config.json 中所有已绑定的账号"""
        path = ConfigHandler.get_xbox_config_path()
        if not os.path.exists(path):
            return {}
        try:
            config = read_json_with_backup(path, validator=validate_json_object)
        except JsonStoreError as exc:
            logger.warning("xbox_config.json 内容无效: %s", exc)
            return {}
        return config.get("user", {})

    @staticmethod
    def remove_account(xuid):
        """从 xbox_config.json 中移除指定账号"""
        path = ConfigHandler.get_xbox_config_path()

        def remove_profile(config):
            if "user" in config:
                config["user"].pop(xuid, None)

        update_json(
            path,
            remove_profile,
            default={},
            validator=validate_json_object,
        )
        logger.info("Xbox 账号已移除: %s", xuid)

    async def get_xbox_games(self, gamertag):
        xbl_client = await self._get_client()

        # 获取 xuid
        logger.info("查询 Xbox 玩家: %s", gamertag)
        account_not_found_message = f"未找到 Xbox 玩家“{gamertag}”"
        try:
            profile = await xbl_client.profile.get_profile_by_gamertag(gamertag)
        except Exception as exc:
            self._raise_request_error(
                exc,
                "暂时无法查询 Xbox 玩家，请稍后重试",
                not_found_message=account_not_found_message,
            )
        try:
            profile_users = profile.profile_users
        except AttributeError as exc:
            raise RemoteResponseError("Xbox 玩家资料格式异常") from exc
        if not isinstance(profile_users, list):
            raise RemoteResponseError("Xbox 玩家资料格式异常")
        if not profile_users:
            raise AccountNotFoundError(
                account_not_found_message,
                code="xbox_account_not_found",
            )
        try:
            xuid = profile_users[0].id
        except (AttributeError, IndexError, TypeError) as exc:
            raise RemoteResponseError("Xbox 玩家资料格式异常") from exc
        if not xuid:
            raise RemoteResponseError("Xbox 玩家资料格式异常")
        logger.info("Xbox xuid: %s", xuid)

        # 获取个人资料
        try:
            profile_detail = await xbl_client.profile.get_profile_by_xuid(xuid)
        except Exception as exc:
            self._raise_request_error(
                exc,
                "暂时无法获取 Xbox 玩家资料，请稍后重试",
            )
        try:
            profile_data = profile_detail.model_dump()
        except (AttributeError, TypeError, ValueError) as exc:
            raise RemoteResponseError("Xbox 玩家资料格式异常") from exc
        if not isinstance(profile_data, dict):
            raise RemoteResponseError("Xbox 玩家资料格式异常")

        # 提取头像和玩家代号
        gamertag_display = ""
        avatar_url = ""
        detail_users = profile_data.get("profile_users", [])
        if not isinstance(detail_users, list):
            raise RemoteResponseError("Xbox 玩家资料格式异常")
        for u in detail_users:
            if not isinstance(u, dict):
                raise RemoteResponseError("Xbox 玩家资料格式异常")
            settings = u.get("settings", [])
            if not isinstance(settings, list):
                raise RemoteResponseError("Xbox 玩家资料格式异常")
            for s in settings:
                if not isinstance(s, dict):
                    raise RemoteResponseError("Xbox 玩家资料格式异常")
                if s.get("id") == "Gamertag":
                    gamertag_display = s.get("value", "")
                elif s.get("id") == "GameDisplayPicRaw":
                    avatar_url = s.get("value", "")

        # 写入 xbox_config.json
        self._save_profile(xuid, gamertag_display or gamertag, avatar_url)

        # 获取游戏列表
        try:
            title_history = await xbl_client.titlehub.get_title_history(
                xuid, max_items=1000
            )
        except Exception as exc:
            self._raise_request_error(
                exc,
                "暂时无法获取 Xbox 游戏库，请稍后重试",
            )
        try:
            games_data = title_history.model_dump()
        except (AttributeError, TypeError, ValueError) as exc:
            raise RemoteResponseError("Xbox 游戏库数据格式异常") from exc
        if not isinstance(games_data, dict):
            raise RemoteResponseError("Xbox 游戏库数据格式异常")
        raw_titles = games_data.get("titles", [])
        if not isinstance(raw_titles, list):
            raise RemoteResponseError("Xbox 游戏库数据格式异常")
        logger.info("title_history 顶层 keys: %s", list(games_data.keys()))
        logger.info("titles 总数: %d", len(raw_titles))

        if raw_titles:
            logger.info("第一条原始 keys: %s", list(raw_titles[0].keys()) if isinstance(raw_titles[0], dict) else type(raw_titles[0]))

        # 格式化游戏数据
        titles = []
        for t in raw_titles:
            if not isinstance(t, dict):
                raise RemoteResponseError("Xbox 游戏库数据格式异常")
            title_name = t.get("name", "")
            title_id = str(t.get("title_id", ""))
            if not title_name or not title_id:
                continue
            img = t.get("display_image", "")
            if not img:
                images = t.get("images", [])
                if not isinstance(images, list):
                    raise RemoteResponseError("Xbox 游戏库数据格式异常")
                if images:
                    img = images[0].get("url", "") if isinstance(images[0], dict) else ""
            if not img:
                img = f"https://store-images.s-microsoft.com/image/apps.{title_id}.jpg"
            titles.append({
                "titleId": title_id,
                "titleName": title_name,
                "imageUrl": img,
            })

        logger.info("Xbox 获取完成: xuid=%s, gamertag=%s, 共 %d 款游戏",
                    xuid, gamertag_display or gamertag, len(titles))

        return {
            "xuid": xuid,
            "gamertag": gamertag_display or gamertag,
            "avatar_url": avatar_url,
            "titles": titles,
        }

    @staticmethod
    def _save_profile(xuid, gamertag, avatar_url):
        """保存 Xbox 个人资料到 xbox_config.json"""
        path = ConfigHandler.get_xbox_config_path()

        def save_profile(config):
            config.setdefault("user", {})[xuid] = {
                "gamertag": gamertag,
                "avatarfull": avatar_url,
            }

        update_json(
            path,
            save_profile,
            default={},
            validator=validate_json_object,
        )

        logger.info("Xbox 用户资料已保存: xuid=%s, gamertag=%s", xuid, gamertag)
