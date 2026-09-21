"""Concurrent, failure-isolated aggregation for interactive cover search."""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from typing import Any

import httpx
from starlette.concurrency import run_in_threadpool

from src.core.config_handler import ConfigHandler
from src.core.errors import AppError, CredentialMissingError, RemoteTimeoutError
from .models import SOURCE_NAMES, SearchItem, SourceOutcome
from .providers.bangumi import BangumiProvider
from .providers.igdb import IGDBProvider
from .providers.steamgriddb import SteamGridDBProvider
from .providers.vndb import VNDBProvider

logger = logging.getLogger(__name__)


class SearchService:
    """Search all providers once and return a source-aware response."""

    SOURCE_TIMEOUT_SECONDS = 12.0
    TOTAL_TIMEOUT_SECONDS = 15.0
    CONNECT_TIMEOUT_SECONDS = 3.0
    READ_TIMEOUT_SECONDS = 8.0
    _concurrency = asyncio.Semaphore(8)

    def __init__(self, config_reader: Callable[[], dict[str, Any]] | None = None):
        self._config_reader = config_reader or ConfigHandler.read_config

    async def _read_config(self) -> dict[str, Any]:
        try:
            config = await run_in_threadpool(self._config_reader)
        except Exception:
            logger.exception("多源搜索读取配置失败")
            return {}
        return config if isinstance(config, dict) else {}

    @staticmethod
    def _get(config: dict[str, Any], name: str) -> str:
        value = ConfigHandler.deep_get(config, name)
        return value.strip() if isinstance(value, str) else ""

    async def _igdb_credentials(self, config: dict[str, Any]) -> tuple[str, str]:
        client_id = self._get(config, "client_id")
        client_secret = self._get(config, "client_secret")
        token = self._get(config, "access_token")
        try:
            expires_at = int(ConfigHandler.deep_get(config, "expiration_time") or 0)
        except (TypeError, ValueError):
            expires_at = 0
        if not client_id or not client_secret:
            return "", ""
        if token and expires_at > int(time.time()) + 10:
            return client_id, token
        # get_token() owns the existing atomic token persistence path. Keep it
        # off the event loop because it may perform the Twitch token request.
        try:
            success, resolved_id, resolved_token = await run_in_threadpool(ConfigHandler().get_token)
        except Exception:
            logger.warning("IGDB token 刷新失败")
            return client_id, ""
        return str(resolved_id or client_id), str(resolved_token or "") if success else ""

    async def _provider_outcome(
        self,
        source: str,
        query: str,
        provider_factory: Callable[[dict[str, Any]], Awaitable[Any] | Any],
        client: httpx.AsyncClient,
        config: dict[str, Any],
    ) -> SourceOutcome:
        try:
            async with self._concurrency:
                provider = await provider_factory(config)
                if provider is None:
                    return SourceOutcome(source, "unconfigured", error_code="credential_missing")
                result = await asyncio.wait_for(
                    provider.search(query, client),
                    timeout=self.SOURCE_TIMEOUT_SECONDS,
                )
            partial = False
            if isinstance(result, tuple):
                results, partial = result
            else:
                results = result
            if partial and not results:
                return SourceOutcome(source, "error", error_code=f"{source}_subrequest_failed")
            return SourceOutcome(source, "partial" if partial else "ok", list(results or []))
        except asyncio.TimeoutError:
            return SourceOutcome(source, "error", error_code=f"{source}_remote_timeout")
        except CredentialMissingError as exc:
            return SourceOutcome(source, "unconfigured", error_code=exc.code)
        except AppError as exc:
            return SourceOutcome(source, "error", error_code=exc.code)
        except Exception:
            logger.exception("多源搜索来源失败: %s", source)
            return SourceOutcome(source, "error", error_code=f"{source}_service_error")

    async def _make_igdb(self, config: dict[str, Any]) -> IGDBProvider | None:
        client_id, token = await self._igdb_credentials(config)
        return IGDBProvider(client_id, token) if client_id and token else None

    async def _make_bangumi(self, config: dict[str, Any]) -> BangumiProvider | None:
        user_agent = self._get(config, "bangumi_user_agent")
        if not user_agent:
            return None
        return BangumiProvider(user_agent, self._get(config, "bangumi_token"))

    async def _make_vndb(self, config: dict[str, Any]) -> VNDBProvider:
        return VNDBProvider()

    async def _make_steamgriddb(self, config: dict[str, Any]) -> SteamGridDBProvider | None:
        api_key = self._get(config, "steamgriddb_api_key")
        return SteamGridDBProvider(api_key) if api_key else None

    async def search_all(self, query: str) -> dict[str, Any]:
        value = query.strip() if isinstance(query, str) else ""
        if not value:
            raise ValueError("search query must not be empty")
        if len(value) > 200:
            raise ValueError("search query is too long")
        started = time.perf_counter()
        config = await self._read_config()
        timeout = httpx.Timeout(
            timeout=self.READ_TIMEOUT_SECONDS,
            connect=self.CONNECT_TIMEOUT_SECONDS,
        )
        providers = {
            "igdb": self._make_igdb,
            "bangumi": self._make_bangumi,
            "vndb": self._make_vndb,
            "steamgriddb": self._make_steamgriddb,
        }
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
            tasks = [
                asyncio.create_task(
                    self._provider_outcome(source, value, providers[source], client, config)
                )
                for source in SOURCE_NAMES
            ]
            done, pending = await asyncio.wait(
                tasks,
                timeout=self.TOTAL_TIMEOUT_SECONDS,
            )
            outcomes = []
            for source, task in zip(SOURCE_NAMES, tasks):
                if task in done and not task.cancelled():
                    try:
                        outcomes.append(task.result())
                    except Exception:
                        outcomes.append(SourceOutcome(source, "error", error_code=f"{source}_service_error"))
                else:
                    task.cancel()
                    outcomes.append(SourceOutcome(source, "error", error_code=f"{source}_total_timeout"))
            if pending:
                await asyncio.gather(*pending, return_exceptions=True)
        by_source = {outcome.source: outcome for outcome in outcomes}
        normalized = [
            by_source.get(source, SourceOutcome(source, "error", error_code=f"{source}_service_error"))
            for source in SOURCE_NAMES
        ]
        # Interleave source lists in the documented fixed source order.
        results: list[SearchItem] = []
        index = 0
        while True:
            added = False
            for outcome in normalized:
                if index < len(outcome.results):
                    results.append(outcome.results[index])
                    added = True
            if not added:
                break
            index += 1
        partial = any(outcome.status in {"partial", "error", "unconfigured"} for outcome in normalized)
        return {
            "query": value,
            "results": [item.to_dict() for item in results],
            "sources": [outcome.to_dict() for outcome in normalized],
            "partial": partial,
            "elapsed_ms": int((time.perf_counter() - started) * 1000),
        }
