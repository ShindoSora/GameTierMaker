"""VNDB Kana API provider."""

from __future__ import annotations

from collections.abc import Mapping

import httpx

from .common import make_item, object_or_empty
from src.core.errors import RemoteResponseError, RemoteServiceError, RemoteTimeoutError
from src.core.search.models import SearchItem


class VNDBProvider:
    source = "vndb"
    endpoint = "https://api.vndb.org/kana/vn"

    @staticmethod
    def _display_title(raw: Mapping) -> str:
        titles = raw.get("titles")
        if isinstance(titles, list):
            by_language = {
                str(item.get("lang")): str(item.get("title") or "").strip()
                for item in titles
                if isinstance(item, Mapping) and item.get("title")
            }
            for language in ("zh-Hans", "zh-Hant", "en", "ja"):
                if by_language.get(language):
                    return by_language[language]
        return str(raw.get("title") or raw.get("alttitle") or "").strip()

    async def search(self, query: str, client: httpx.AsyncClient) -> list[SearchItem]:
        payload = {
            "filters": ["search", "=", query],
            "fields": "title,alttitle,titles.lang,titles.title,image.url,image.thumbnail",
            "sort": "searchrank",
            "results": 30,
            "page": 1,
        }
        try:
            response = await client.post(self.endpoint, json=payload)
        except httpx.TimeoutException as exc:
            raise RemoteTimeoutError("VNDB 搜索超时", code="vndb_remote_timeout") from exc
        except httpx.RequestError as exc:
            raise RemoteServiceError("无法连接 VNDB 服务", code="vndb_service_unavailable") from exc
        if response.status_code == 429:
            raise RemoteServiceError("VNDB 请求过于频繁", code="vndb_rate_limited")
        if response.status_code != 200:
            raise RemoteServiceError("VNDB 服务暂时不可用", code="vndb_service_error")
        try:
            body = response.json()
        except (TypeError, ValueError) as exc:
            raise RemoteResponseError("VNDB 返回的数据格式异常", code="vndb_response_invalid") from exc
        if not isinstance(body, Mapping) or not isinstance(body.get("results"), list):
            raise RemoteResponseError("VNDB 返回的数据格式异常", code="vndb_response_invalid")
        results: list[SearchItem] = []
        seen: set[str] = set()
        for raw in body["results"]:
            if not isinstance(raw, Mapping):
                continue
            image = object_or_empty(raw.get("image"))
            game_id = str(raw.get("id") or "").strip()
            item = make_item(
                source=self.source,
                game_id=game_id,
                asset_id="cover",
                name=self._display_title(raw),
                cover_url=image.get("url"),
                thumbnail_url=image.get("thumbnail"),
            )
            if item and item.result_id not in seen:
                seen.add(item.result_id)
                results.append(item)
        return results
