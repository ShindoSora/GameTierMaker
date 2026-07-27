import logging
from urllib.parse import urlsplit, urlunsplit

import requests

from src.core.config_handler import ConfigHandler
from src.core.errors import (
    AccountNotFoundError,
    AppError,
    CredentialExpiredError,
    CredentialMissingError,
    InvalidInputError,
    RemoteResponseError,
    RemoteServiceError,
    RemoteTimeoutError,
)
from src.core.json_store import update_json, validate_json_object

logger = logging.getLogger(__name__)


def normalize_psn_avatar_url(value):
    """Return an HTTPS URL for avatar links supplied by the PSN profile API."""
    if not isinstance(value, str):
        return ""
    value = value.strip()
    if value.startswith("//"):
        return "https:" + value
    try:
        parsed = urlsplit(value)
    except ValueError:
        return ""
    if parsed.scheme == "http" and parsed.netloc:
        return urlunsplit(("https", parsed.netloc, parsed.path, parsed.query, parsed.fragment))
    return value


class GetPSNUserProfile:
    @staticmethod
    def get_psn_user_profile(access_token, account_id):
        """获取并保存 PSN 用户的在线 ID 与头像。"""
        if not isinstance(access_token, str) or not access_token:
            raise CredentialMissingError(
                "PSN 登录信息缺失，请重新绑定账号",
                code="psn_access_token_missing",
            )
        if not isinstance(account_id, str) or not account_id:
            raise InvalidInputError(
                "PSN 账号 ID 无效",
                code="psn_account_id_invalid",
            )

        url = (
            "https://m.np.playstation.com/api/userProfile/v1/internal/users/"
            f"{account_id}/profiles"
        )
        headers = {"Authorization": f"Bearer {access_token}"}

        try:
            logger.info("请求 PSN 用户资料")
            response = requests.get(url, headers=headers, timeout=30)
            logger.info("用户资料响应状态: %s", response.status_code)
            response.raise_for_status()
        except requests.exceptions.HTTPError as exc:
            status = exc.response.status_code if exc.response is not None else None
            logger.warning("PSN 用户资料请求失败: HTTP %s", status or "unknown")
            if status == 401:
                raise CredentialExpiredError(
                    "PSN 登录信息已过期，请重新获取 NPSSO",
                    code="psn_token_expired",
                ) from exc
            if status == 404:
                raise AccountNotFoundError(
                    "未找到对应的 PSN 账号资料，请重新绑定账号",
                    code="psn_account_not_found",
                ) from exc
            raise RemoteServiceError("PSN 用户资料服务暂时不可用，请稍后重试") from exc
        except requests.exceptions.Timeout as exc:
            raise RemoteTimeoutError(
                "PSN 用户资料请求超时，请检查网络连接"
            ) from exc
        except requests.exceptions.RequestException as exc:
            logger.warning("PSN 用户资料请求失败", exc_info=True)
            raise RemoteServiceError(
                "无法连接 PSN 服务，请检查网络连接"
            ) from exc

        try:
            psn_user_profile = response.json()
        except (TypeError, ValueError) as exc:
            raise RemoteResponseError("PSN 用户资料响应格式不正确") from exc

        if not isinstance(psn_user_profile, dict) or not psn_user_profile:
            raise RemoteResponseError("PSN 用户资料响应格式不正确")

        online_id = psn_user_profile.get("onlineId", "")
        if not isinstance(online_id, str):
            raise RemoteResponseError("PSN 用户资料响应格式不正确")

        avatar_url = ""
        avatars = psn_user_profile.get("avatars", [])
        if not isinstance(avatars, list):
            raise RemoteResponseError("PSN 用户资料响应格式不正确")
        for avatar in avatars:
            if not isinstance(avatar, dict):
                raise RemoteResponseError("PSN 用户资料响应格式不正确")
            if avatar.get("size") == "m":
                avatar_url = avatar.get("url", "")
                break
        if not avatar_url and avatars:
            avatar_url = avatars[0].get("url", "")
        if not isinstance(avatar_url, str):
            raise RemoteResponseError("PSN 用户资料响应格式不正确")
        avatar_url = normalize_psn_avatar_url(avatar_url)

        def save_profile(config):
            config.setdefault("user", {})[account_id] = {
                "onlineId": online_id,
                "avatarfull": avatar_url,
            }

        try:
            update_json(
                ConfigHandler.get_psn_config_path(),
                save_profile,
                default={},
                validator=validate_json_object,
            )
        except AppError:
            raise
        except Exception as exc:
            logger.exception("保存 PSN 用户资料失败")
            raise AppError(
                "无法保存 PSN 账号资料，请检查程序数据目录",
                code="psn_profile_save_failed",
            ) from exc

        logger.info("PSN 用户资料已保存")
        return psn_user_profile
