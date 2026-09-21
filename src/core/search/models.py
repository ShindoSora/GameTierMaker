"""Stable internal models for multi-source cover search."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


SOURCE_NAMES = ("igdb", "bangumi", "vndb", "steamgriddb")
SOURCE_STATUSES = ("ok", "partial", "empty", "unconfigured", "error")


@dataclass(slots=True)
class SearchItem:
    """One downloadable image result with an explicit provider identity."""

    id: str
    result_id: str
    source: str
    source_game_id: str
    asset_id: str
    name: str
    cover_url: str
    thumbnail_url: str = ""

    def to_dict(self) -> dict[str, Any]:
        cover: dict[str, str] = {"url": self.cover_url}
        if self.thumbnail_url:
            cover["thumbnail_url"] = self.thumbnail_url
        return {
            "id": self.id,
            "result_id": self.result_id,
            "source": self.source,
            "source_game_id": self.source_game_id,
            "asset_id": self.asset_id,
            "name": self.name,
            "cover": cover,
        }


@dataclass(slots=True)
class SourceOutcome:
    """Provider result and a safe, stable status for the frontend."""

    source: str
    status: str
    results: list[SearchItem] = field(default_factory=list)
    error_code: str | None = None

    def __post_init__(self) -> None:
        if self.source not in SOURCE_NAMES:
            raise ValueError(f"unknown search source: {self.source}")
        if self.status not in SOURCE_STATUSES:
            raise ValueError(f"unknown search status: {self.status}")
        if self.status in {"ok", "partial"} and not self.results:
            self.status = "empty"
        if self.status in {"empty", "unconfigured", "error"}:
            self.results = []

    @property
    def count(self) -> int:
        return len(self.results)

    def to_dict(self) -> dict[str, Any]:
        return {
            "source": self.source,
            "status": self.status,
            "count": self.count,
            "error_code": self.error_code,
        }
