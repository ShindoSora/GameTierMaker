"""HTTP client for the Nintendo Account and My Nintendo play-history APIs."""

from __future__ import annotations

import base64
import hashlib
import secrets
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import parse_qs, urlencode, urlsplit

import requests

from src.core.errors import (
    CredentialExpiredError,
    InvalidInputError,
    RemoteResponseError,
    RemoteServiceError,
    RemoteTimeoutError,
)

from .models import normalize_history

CLIENT_ID = "5c38e31cd085304b"
REDIRECT_URI = f"npf{CLIENT_ID}://auth"
AUTH_BASE_URL = "https://accounts.nintendo.com"
PROFILE_URL = "https://api.accounts.nintendo.com/2.0.0/users/me"
PLAY_HISTORY_URL = "https://app-api.znej.nintendo.com/api/v2.0/users/me/play_histories"
USER_AGENT = "com.nintendo.znej/1.13.0 (Android/7.1.2)"
REQUEST_TIMEOUT = (10, 30)
MAX_RESPONSE_BYTES = 8 * 1024 * 1024


@dataclass(frozen=True)
class NintendoLoginRequest:
    operation_id: str
    state: str
    code_verifier: str
    authorize_url: str


class NintendoClient:
    """One-shot client; durable session tokens are supplied by the store."""

    def __init__(self, session_token: str = "", *, locale: str = "en-US"):
        self.session_token = session_token
        self.locale = locale or "en-US"
        self._access_token = ""
        self._access_expires_at = 0.0

    @staticmethod
    def build_login_request(operation_id: str) -> NintendoLoginRequest:
        state = secrets.token_urlsafe(36)
        verifier = secrets.token_urlsafe(32)
        challenge = base64.urlsafe_b64encode(
            hashlib.sha256(verifier.encode("ascii")).digest()
        ).rstrip(b"=").decode("ascii")
        query = urlencode(
            {
                "client_id": CLIENT_ID,
                "redirect_uri": REDIRECT_URI,
                "response_type": "session_token_code",
                "scope": "openid user user.mii user.email user.links[].id",
                "session_token_code_challenge": challenge,
                "session_token_code_challenge_method": "S256",
                "state": state,
                "theme": "login_form",
            }
        )
        return NintendoLoginRequest(
            operation_id=operation_id,
            state=state,
            code_verifier=verifier,
            authorize_url=f"{AUTH_BASE_URL}/connect/1.0.0/authorize?{query}",
        )

    @staticmethod
    def parse_callback(callback_url: str, expected_state: str) -> str:
        if not isinstance(callback_url, str) or len(callback_url) > 8192:
            raise InvalidInputError(
                "Nintendo 回调链接无效",
                code="nintendo_callback_invalid",
            )
        try:
            parsed = urlsplit(callback_url.strip())
        except ValueError as exc:
            raise InvalidInputError(
                "Nintendo 回调链接无法解析",
                code="nintendo_callback_invalid",
            ) from exc
        try:
            has_port = parsed.port is not None
        except ValueError as exc:
            raise InvalidInputError(
                "Nintendo 回调链接端口无效",
                code="nintendo_callback_invalid",
            ) from exc
        if (
            parsed.scheme != f"npf{CLIENT_ID}"
            or parsed.netloc != "auth"
            or parsed.path
            or parsed.query
            or parsed.username
            or parsed.password
            or has_port
        ):
            raise InvalidInputError(
                "请粘贴任天堂登录后生成的 npf 回调链接",
                code="nintendo_callback_invalid",
            )
        try:
            values = parse_qs(parsed.fragment, keep_blank_values=True, strict_parsing=True)
        except ValueError as exc:
            raise InvalidInputError(
                "Nintendo 回调参数格式无效",
                code="nintendo_callback_invalid",
            ) from exc
        code_values = values.get("session_token_code", [])
        state_values = values.get("state", [])
        if len(code_values) != 1 or not code_values[0] or len(state_values) != 1:
            raise InvalidInputError(
                "Nintendo 回调缺少授权参数",
                code="nintendo_callback_invalid",
            )
        if state_values[0] != expected_state:
            raise InvalidInputError(
                "Nintendo 回调状态已失效，请重新发起绑定",
                code="nintendo_state_mismatch",
            )
        return code_values[0]

    @staticmethod
    def _raise_response_error(response: requests.Response, *, auth_endpoint: bool = False) -> None:
        if response.status_code in {401, 403} or (
            auth_endpoint and response.status_code == 400
        ):
            raise CredentialExpiredError(
                "Nintendo 登录状态已失效，请重新授权",
                code="nintendo_auth_expired",
            )
        if response.status_code == 429:
            raise RemoteServiceError(
                "Nintendo 请求过于频繁，请稍后再试",
                code="nintendo_rate_limited",
            )
        raise RemoteServiceError(
            "Nintendo 服务暂时不可用，请稍后重试",
            code="nintendo_service_error",
        )

    @staticmethod
    def _json(response: requests.Response, *, auth_endpoint: bool = False) -> Any:
        if response.status_code < 200 or response.status_code >= 300:
            NintendoClient._raise_response_error(response, auth_endpoint=auth_endpoint)
        content = response.content
        if len(content) > MAX_RESPONSE_BYTES:
            raise RemoteResponseError(
                "Nintendo 返回内容过大",
                code="nintendo_response_invalid",
            )
        try:
            return response.json()
        except (TypeError, ValueError) as exc:
            raise RemoteResponseError(
                "Nintendo 返回的数据格式异常",
                code="nintendo_response_invalid",
            ) from exc

    @staticmethod
    def _request(method: str, url: str, **kwargs) -> requests.Response:
        try:
            return requests.request(method, url, timeout=REQUEST_TIMEOUT, **kwargs)
        except requests.Timeout as exc:
            raise RemoteTimeoutError(
                "Nintendo 服务响应超时，请检查网络连接",
                code="nintendo_request_timeout",
            ) from exc
        except requests.RequestException as exc:
            raise RemoteServiceError(
                "无法连接 Nintendo 服务，请稍后重试",
                code="nintendo_service_error",
            ) from exc

    def exchange_callback(self, callback_url: str, expected_state: str, code_verifier: str) -> str:
        code = self.parse_callback(callback_url, expected_state)
        response = self._request(
            "POST",
            f"{AUTH_BASE_URL}/connect/1.0.0/api/session_token",
            data={
                "client_id": CLIENT_ID,
                "session_token_code": code,
                "session_token_code_verifier": code_verifier,
            },
            headers={
                "Accept": "application/json",
                "Content-Type": "application/x-www-form-urlencoded",
                "X-Platform": "Android",
                "X-ProductVersion": "2.5.0",
                "User-Agent": USER_AGENT,
            },
        )
        payload = self._json(response, auth_endpoint=True)
        session_token = payload.get("session_token") if isinstance(payload, dict) else ""
        if not isinstance(session_token, str) or not session_token:
            raise RemoteResponseError(
                "Nintendo 授权响应缺少 session_token",
                code="nintendo_response_invalid",
            )
        return session_token

    def access_token(self) -> str:
        if not self.session_token:
            raise CredentialExpiredError(
                "Nintendo 登录状态已失效，请重新授权",
                code="nintendo_auth_expired",
            )
        if self._access_token and time.time() < self._access_expires_at - 60:
            return self._access_token
        response = self._request(
            "POST",
            f"{AUTH_BASE_URL}/connect/1.0.0/api/token",
            json={
                "client_id": CLIENT_ID,
                "session_token": self.session_token,
                "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer-session-token",
            },
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json; charset=utf-8",
                "User-Agent": USER_AGENT,
            },
        )
        payload = self._json(response, auth_endpoint=True)
        if not isinstance(payload, dict) or not payload.get("access_token"):
            raise RemoteResponseError(
                "Nintendo token 响应缺少 access_token",
                code="nintendo_response_invalid",
            )
        self._access_token = str(payload["access_token"])
        try:
            expires_in = max(60, int(payload.get("expires_in", 900)))
        except (TypeError, ValueError):
            expires_in = 900
        self._access_expires_at = time.time() + expires_in
        return self._access_token

    def get_profile(self) -> dict[str, Any]:
        token = self.access_token()
        response = self._request(
            "GET",
            PROFILE_URL,
            headers={
                "Accept": "application/json",
                "Accept-Language": self.locale,
                "Authorization": f"Bearer {token}",
                "User-Agent": USER_AGENT,
            },
        )
        payload = self._json(response)
        if not isinstance(payload, dict) or not isinstance(payload.get("id"), (str, int)):
            raise RemoteResponseError(
                "Nintendo 账号资料缺少稳定 ID",
                code="nintendo_response_invalid",
            )
        return {
            "id": str(payload["id"]),
            "nickname": str(payload.get("nickname") or "Nintendo Account"),
            "language": str(payload.get("language") or self.locale),
            "country": str(payload.get("country") or ""),
        }

    def get_play_history(self, account_id: str) -> list:
        token = self.access_token()
        response = self._request(
            "GET",
            PLAY_HISTORY_URL,
            headers={
                "Accept": "application/json",
                "Authorization": f"Bearer {token}",
                "Gentry-Locale": self.locale,
                "User-Agent": USER_AGENT,
            },
        )
        return normalize_history(self._json(response), account_id)
