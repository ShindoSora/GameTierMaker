"""Bangumi subject search provider."""

from __future__ import annotations

from collections.abc import Mapping

import httpx

from .common import make_item, object_or_empty
from src.core.errors import (
    CredentialMissingError,
    RemoteResponseError,
    RemoteServiceError,
    RemoteTimeoutError,
)
from src.core.search.models import SearchItem


class BangumiProvider:
    source = "bangumi"
    endpoint = "https://api.bgm.tv/v0/search/subjects"

    def __init__(self, user_agent: str, token: str = ""):
        self.user_agent = user_agent
        self.token = token

    async def search(self, query: str, client: httpx.AsyncClient) -> list[SearchItem]:
        if not self.user_agent:
            raise CredentialMissingError(
                "请先在设置中填写 Bangumi User-Agent",
                code="bangumi_user_agent_missing",
            )
        headers = {"User-Agent": self.user_agent}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        body = {"keyword": query, "filter": {"type": [1, 2, 3, 4, 6]}}
        try:
            response = await client.post(
                self.endpoint,
                params={"limit": 30, "offset": 0},
                headers=headers,
                json=body,
            )
        except httpx.TimeoutException as exc:
            raise RemoteTimeoutError("Bangumi 搜索超时", code="bangumi_remote_timeout") from exc
        except httpx.RequestError as exc:
            raise RemoteServiceError("无法连接 Bangumi 服务", code="bangumi_service_unavailable") from exc
        if response.status_code == 401:
            raise CredentialMissingError("Bangumi Token 无效", code="bangumi_token_invalid")
        if response.status_code == 429:
            raise RemoteServiceError("Bangumi 请求过于频繁", code="bangumi_rate_limited")
        if response.status_code != 200:
            raise RemoteServiceError("Bangumi 服务暂时不可用", code="bangumi_service_error")
        try:
            payload = response.json()
        except (TypeError, ValueError) as exc:
            raise RemoteResponseError("Bangumi 返回的数据格式异常", code="bangumi_response_invalid") from exc
        if not isinstance(payload, Mapping) or not isinstance(payload.get("data"), list):
            raise RemoteResponseError("Bangumi 返回的数据格式异常", code="bangumi_response_invalid")
        results: list[SearchItem] = []
        seen: set[str] = set()
        for raw in payload["data"]:
            if not isinstance(raw, Mapping):
                continue
            images = object_or_empty(raw.get("images"))
            item = make_item(
                source=self.source,
                game_id=raw.get("id"),
                asset_id="cover",
                name=raw.get("name") or raw.get("name_cn"),
                cover_url=images.get("large") or images.get("medium") or images.get("common"),
            )
            if item and item.result_id not in seen:
                seen.add(item.result_id)
                results.append(item)
        return results
