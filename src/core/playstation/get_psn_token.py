import logging
import time
from urllib.parse import parse_qs, urlparse

import requests

from src.core.config_handler import ConfigHandler
from src.core.errors import (
    AppError,
    CredentialExpiredError,
    CredentialMissingError,
    RemoteResponseError,
    RemoteServiceError,
    RemoteTimeoutError,
)

logger = logging.getLogger(__name__)


class GetPsnToken:
    @staticmethod
    def _get_cached_token():
        config = ConfigHandler.read_config()
        token = ConfigHandler.deep_get(config, "psn_access_token") or ""
        expiration = int(ConfigHandler.deep_get(config, "psn_token_expiration") or 0)
        if token and expiration > int(time.time()):
            logger.info(
                "PSN token 缓存命中，剩余有效时间: %d 秒",
                expiration - int(time.time()),
            )
            return token
        return None

    @staticmethod
    def _save_token(token, expires_in):
        """将 PSN token 和过期时间写入 config.json。"""
        expiration = int(time.time()) + expires_in - 120  # 提前 2 分钟过期
        ConfigHandler.update_config_fields(
            {
                "psn_access_token": token,
                "psn_token_expiration": expiration,
            }
        )
        logger.info("PSN token 已保存到 config.json，过期时间: %d 秒后", expires_in)

    @staticmethod
    def _expired_error():
        return CredentialExpiredError(
            "PSN 登录信息已过期，请重新获取 NPSSO",
            code="psn_token_expired",
        )

    @staticmethod
    def get_psn_token(psn_npssoo, *, force_refresh=False):
        """获取 PSN access token；必要时可跳过本地缓存强制刷新。"""
        if not isinstance(psn_npssoo, str) or not psn_npssoo.strip():
            raise CredentialMissingError(
                "请先在设置中填写 PSN NPSSO",
                code="psn_npsso_missing",
            )

        if not force_refresh:
            try:
                cached = GetPsnToken._get_cached_token()
            except AppError:
                raise
            except Exception as exc:
                logger.exception("读取 PSN token 缓存失败")
                raise AppError(
                    "无法读取 PSN 登录缓存，请检查程序数据目录",
                    code="psn_token_cache_unavailable",
                ) from exc
            if cached:
                return cached

        # 第一步：请求授权码。
        url = "https://ca.account.sony.com/api/authz/v3/oauth/authorize"
        headers = {"Cookie": f"npsso={psn_npssoo.strip()}"}
        params = {
            "access_type": "offline",
            "client_id": "09515159-7237-4370-9b40-3806e67c0891",
            "response_type": "code",
            "scope": "psn:mobile.v2.core psn:clientapp",
            "redirect_uri": "com.scee.psxandroid.scecompcall://redirect",
        }

        try:
            logger.info("请求 PSN 授权码")
            response = requests.get(
                url,
                headers=headers,
                params=params,
                allow_redirects=False,
                timeout=30,
            )
            logger.info("授权响应状态: %s", response.status_code)
        except requests.exceptions.Timeout as exc:
            raise RemoteTimeoutError(
                "PSN 授权请求超时，请检查网络连接"
            ) from exc
        except requests.exceptions.RequestException as exc:
            logger.warning("PSN 授权请求失败", exc_info=True)
            raise RemoteServiceError(
                "无法连接 Sony 登录服务，请检查网络连接"
            ) from exc

        if response.status_code in {400, 401, 403}:
            raise GetPsnToken._expired_error()
        if response.status_code >= 400:
            raise RemoteServiceError("Sony 登录服务暂时不可用，请稍后重试")

        location = response.headers.get("Location")
        if not location:
            logger.warning("PSN 授权响应中未找到 Location 头")
            raise GetPsnToken._expired_error()

        try:
            parsed = urlparse(location)
            query_params = parse_qs(parsed.query)
            code_list = query_params.get("code", [None])
            code = code_list[0] if code_list else None
        except (TypeError, ValueError) as exc:
            raise RemoteResponseError("PSN 授权服务返回的数据无法识别") from exc

        if not code:
            logger.warning("PSN 授权重定向中未提取到授权码")
            raise GetPsnToken._expired_error()

        logger.info("成功提取 PSN 授权码（长度: %d）", len(code))

        # 第二步：用授权码换取 access token。
        token_url = "https://ca.account.sony.com/api/authz/v3/oauth/token"
        token_headers = {"Content-Type": "application/x-www-form-urlencoded"}
        body = {
            "code": code,
            "client_id": "09515159-7237-4370-9b40-3806e67c0891",
            "client_secret": "ucPjka5tntB2KqsP",
            "redirect_uri": "com.scee.psxandroid.scecompcall://redirect",
            "grant_type": "authorization_code",
        }

        try:
            logger.info("请求 PSN access_token")
            response = requests.post(
                token_url,
                headers=token_headers,
                data=body,
                allow_redirects=False,
                timeout=30,
            )
            logger.info("Token 响应状态: %s", response.status_code)
            response.raise_for_status()
        except requests.exceptions.HTTPError as exc:
            status = exc.response.status_code if exc.response is not None else None
            logger.warning("PSN token 请求被拒绝: HTTP %s", status or "unknown")
            if status in {400, 401, 403}:
                raise GetPsnToken._expired_error() from exc
            raise RemoteServiceError("Sony 登录服务暂时不可用，请稍后重试") from exc
        except requests.exceptions.Timeout as exc:
            raise RemoteTimeoutError(
                "PSN token 请求超时，请检查网络连接"
            ) from exc
        except requests.exceptions.RequestException as exc:
            logger.warning("PSN token 请求失败", exc_info=True)
            raise RemoteServiceError(
                "无法连接 Sony 登录服务，请检查网络连接"
            ) from exc

        try:
            result = response.json()
        except (TypeError, ValueError) as exc:
            raise RemoteResponseError("PSN token 响应格式不正确") from exc

        if not isinstance(result, dict):
            raise RemoteResponseError("PSN token 响应格式不正确")

        access_token = result.get("access_token")
        if not isinstance(access_token, str) or not access_token:
            raise RemoteResponseError("PSN token 响应中缺少登录凭证")

        try:
            expires_in = int(result.get("expires_in", 3600))
        except (TypeError, ValueError) as exc:
            raise RemoteResponseError("PSN token 响应中的有效期格式不正确") from exc
        if expires_in <= 0:
            raise RemoteResponseError("PSN token 响应中的有效期格式不正确")

        try:
            GetPsnToken._save_token(access_token, expires_in)
        except AppError:
            raise
        except Exception as exc:
            logger.exception("保存 PSN token 失败")
            raise AppError(
                "无法保存 PSN 登录信息，请检查程序数据目录",
                code="psn_token_save_failed",
            ) from exc

        logger.info("PSN Authentication Token 获取成功（有效期: %d 秒）", expires_in)
        return access_token
