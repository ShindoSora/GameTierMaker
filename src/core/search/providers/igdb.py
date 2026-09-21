"""IGDB provider without the legacy Bangumi fallback."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import httpx

from .common import make_item, object_or_empty
from src.core.errors import (
    CredentialMissingError,
    RemoteResponseError,
    RemoteServiceError,
    RemoteTimeoutError,
)
from src.core.search.models import SearchItem


class IGDBProvider:
    source = "igdb"
    endpoint = "https://api.igdb.com/v4/games"

    def __init__(self, client_id: str, access_token: str):
        self.client_id = client_id
        self.access_token = access_token

    async def search(self, query: str, client: httpx.AsyncClient) -> list[SearchItem]:
        if not self.client_id or not self.access_token:
            raise CredentialMissingError("IGDB 尚未配置有效凭证", code="igdb_credentials_missing")
        # IGDB accepts a text body. Escape both backslashes and quotes so a
        # search term cannot alter the query expression.
        escaped = query.replace("\\", "\\\\").replace('"', '\\"')
        body = f'search "{escaped}"; fields name,cover.url; limit 30;'
        try:
            response = await client.post(
                self.endpoint,
                headers={
                    "Client-ID": self.client_id,
                    "Authorization": f"Bearer {self.access_token}",
                    "Content-Type": "text/plain",
                },
                content=body,
            )
        except httpx.TimeoutException as exc:
            raise RemoteTimeoutError("IGDB 搜索超时", code="igdb_remote_timeout") from exc
        except httpx.RequestError as exc:
            raise RemoteServiceError("无法连接 IGDB 服务", code="igdb_service_unavailable") from exc
        if response.status_code in {401, 403}:
            raise CredentialMissingError("IGDB 凭证无效", code="igdb_credentials_invalid")
        if response.status_code == 429:
            raise RemoteServiceError("IGDB 请求过于频繁", code="igdb_rate_limited")
        if response.status_code != 200:
            raise RemoteServiceError("IGDB 服务暂时不可用", code="igdb_service_error")
        try:
            payload = response.json()
        except (TypeError, ValueError) as exc:
            raise RemoteResponseError("IGDB 返回的数据格式异常", code="igdb_response_invalid") from exc
        if not isinstance(payload, list):
            raise RemoteResponseError("IGDB 返回的数据格式异常", code="igdb_response_invalid")
        results: list[SearchItem] = []
        seen: set[str] = set()
        for raw in payload:
            if not isinstance(raw, Mapping):
                continue
            cover = object_or_empty(raw.get("cover"))
            item = make_item(
                source=self.source,
                game_id=raw.get("id"),
                asset_id="cover",
                name=raw.get("name"),
                cover_url=cover.get("url"),
            )
            if item and item.result_id not in seen:
                seen.add(item.result_id)
                results.append(item)
        return results
