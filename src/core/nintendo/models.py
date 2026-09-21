"""Internal Nintendo play-history data contracts and normalization."""

from __future__ import annotations

import hashlib
from dataclasses import asdict, dataclass
from datetime import datetime
from typing import Any

from src.core.errors import RemoteResponseError


@dataclass(frozen=True)
class NintendoTitle:
    record_key: str
    title_id: str
    platform: str
    platform_raw: str
    title_name: str
    cover_url: str
    total_played_minutes: int | None
    first_played_at: str | None
    last_played_at: str | None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _string(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _integer(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return number if number >= 0 else None


def _time(value: Any) -> str | None:
    text = _string(value)
    if not text:
        return None
    # Preserve the upstream value, but reject arbitrary HTML/error strings.
    try:
        datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    return text


def _cover(item: dict[str, Any]) -> str:
    direct = item.get("imageUrl", item.get("image_url", ""))
    if isinstance(direct, str) and direct.strip():
        return direct.strip()
    cover = item.get("cover")
    if isinstance(cover, dict):
        return _string(cover.get("url"))
    return ""


def _platform(item: dict[str, Any]) -> tuple[str, str]:
    raw = _string(item.get("platform")) or _string(item.get("deviceType"))
    normalized = raw.casefold().replace("_", "-").replace(" ", "-")
    aliases = {
        "nintendo-switch": "switch",
        "switch": "switch",
        "nintendo-switch-2": "switch-2",
        "switch-2": "switch-2",
        "nintendo-3ds": "3ds",
        "3ds": "3ds",
        "wii-u": "wii-u",
        "wiiu": "wii-u",
    }
    return aliases.get(normalized, normalized or "unknown"), raw


def normalize_title(item: Any, account_id: str) -> NintendoTitle | None:
    if not isinstance(item, dict):
        return None
    title_id = _string(item.get("titleId", item.get("title_id")))
    title_name = _string(
        item.get("titleName", item.get("title_name", item.get("name")))
    )
    if not title_id or not title_name:
        return None
    platform, platform_raw = _platform(item)
    record_key = hashlib.sha256(
        f"{account_id}\x1f{platform}\x1f{title_id}".encode("utf-8")
    ).hexdigest()[:32]
    return NintendoTitle(
        record_key=record_key,
        title_id=title_id,
        platform=platform,
        platform_raw=platform_raw,
        title_name=title_name,
        cover_url=_cover(item),
        total_played_minutes=_integer(
            item.get("totalPlayedMinutes", item.get("total_played_minutes"))
        ),
        first_played_at=_time(item.get("firstPlayedAt", item.get("first_played_at"))),
        last_played_at=_time(item.get("lastPlayedAt", item.get("last_played_at"))),
    )


def normalize_history(payload: Any, account_id: str) -> list[NintendoTitle]:
    if not isinstance(payload, dict) or "playHistories" not in payload:
        raise RemoteResponseError(
            "Nintendo 游玩记录响应缺少 playHistories",
            code="nintendo_response_invalid",
        )
    raw_titles = payload.get("playHistories")
    if not isinstance(raw_titles, list):
        raise RemoteResponseError(
            "Nintendo 游玩记录格式异常",
            code="nintendo_response_invalid",
        )
    titles: list[NintendoTitle] = []
    seen: set[str] = set()
    for item in raw_titles:
        title = normalize_title(item, account_id)
        if title is None or title.record_key in seen:
            continue
        seen.add(title.record_key)
        titles.append(title)
    return titles
