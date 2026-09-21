"""SteamGridDB game and static grid search provider."""

from __future__ import annotations

import asyncio
from collections.abc import Mapping
from typing import Any
from urllib.parse import quote

import httpx

from .common import make_item, object_or_empty
from src.core.errors import (
    CredentialMissingError,
    RemoteResponseError,
    RemoteServiceError,
    RemoteTimeoutError,
)
from src.core.search.models import SearchItem


class SteamGridDBProvider:
    source = "steamgriddb"
    base_url = "https://www.steamgriddb.com/api/v2"
    candidate_limit = 8
    grids_per_game = 3

    def __init__(self, api_key: str):
        self.api_key = api_key
        self._grid_semaphore = asyncio.Semaphore(3)

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.api_key}"}

    async def _get_grids(
        self,
        game: Mapping[str, Any],
        client: httpx.AsyncClient,
    ) -> tuple[list[SearchItem], bool]:
        game_id = str(game.get("id") or "").strip()
        game_name = str(game.get("name") or "").strip()
        if not game_id or not game_name:
            return [], False
        path_id = quote(game_id, safe="")
        async with self._grid_semaphore:
            try:
                response = await client.get(
                    f"{self.base_url}/grids/game/{path_id}",
                    headers=self._headers(),
                )
            except (httpx.TimeoutException, asyncio.TimeoutError):
                return [], True
            except httpx.RequestError:
                return [], True
        if response.status_code in {401, 403}:
            raise CredentialMissingError("SteamGridDB API Key 无效", code="steamgriddb_credentials_invalid")
        if response.status_code == 429:
            return [], True
        if response.status_code == 404:
            return [], False
        if response.status_code != 200:
            return [], True
        try:
            body = response.json()
        except (TypeError, ValueError):
            return [], True
        if not isinstance(body, Mapping) or not isinstance(body.get("data"), list):
            return [], True
        results: list[SearchItem] = []
        selected = [
            raw for raw in body["data"]
            if isinstance(raw, Mapping)
            and str(raw.get("type") or "static").lower() not in {"animated", "video"}
        ][: self.grids_per_game]
        for raw in selected:
            if not isinstance(raw, Mapping):
                continue
            item = make_item(
                source=self.source,
                game_id=game_id,
                asset_id=raw.get("id"),
                name=game_name,
                cover_url=raw.get("url"),
                thumbnail_url=raw.get("thumb") or raw.get("thumbnail"),
            )
            if item:
                results.append(item)
        return results, False

    async def search(self, query: str, client: httpx.AsyncClient) -> tuple[list[SearchItem], bool]:
        if not self.api_key:
            raise CredentialMissingError(
                "请先在设置中填写 SteamGridDB API Key",
                code="steamgriddb_api_key_missing",
            )
        try:
            response = await client.get(
                f"{self.base_url}/search/autocomplete/{quote(query, safe='')}",
                headers=self._headers(),
            )
        except httpx.TimeoutException as exc:
            raise RemoteTimeoutError("SteamGridDB 搜索超时", code="steamgriddb_remote_timeout") from exc
        except httpx.RequestError as exc:
            raise RemoteServiceError("无法连接 SteamGridDB 服务", code="steamgriddb_service_unavailable") from exc
        if response.status_code in {401, 403}:
            raise CredentialMissingError("SteamGridDB API Key 无效", code="steamgriddb_credentials_invalid")
        if response.status_code == 429:
            raise RemoteServiceError("SteamGridDB 请求过于频繁", code="steamgriddb_rate_limited")
        if response.status_code != 200:
            raise RemoteServiceError("SteamGridDB 服务暂时不可用", code="steamgriddb_service_error")
        try:
            body = response.json()
        except (TypeError, ValueError) as exc:
            raise RemoteResponseError("SteamGridDB 返回的数据格式异常", code="steamgriddb_response_invalid") from exc
        if not isinstance(body, Mapping) or not isinstance(body.get("data"), list):
            raise RemoteResponseError("SteamGridDB 返回的数据格式异常", code="steamgriddb_response_invalid")
        candidates = [item for item in body["data"][: self.candidate_limit] if isinstance(item, Mapping)]
        tasks = [self._get_grids(game, client) for game in candidates]
        if not tasks:
            return [], False
        gathered = await asyncio.gather(*tasks, return_exceptions=True)
        results: list[SearchItem] = []
        had_failure = False
        seen: set[str] = set()
        for outcome in gathered:
            if isinstance(outcome, CredentialMissingError):
                raise outcome
            if isinstance(outcome, BaseException):
                had_failure = True
                continue
            items, failed = outcome
            had_failure = had_failure or failed
            for item in items:
                if item.result_id not in seen:
                    seen.add(item.result_id)
                    results.append(item)
        return results, had_failure
