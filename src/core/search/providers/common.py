"""Small provider helpers shared by the external search adapters."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any
from urllib.parse import urlsplit

from src.core.search.models import SearchItem


def as_text(value: Any) -> str:
    return str(value).strip() if value is not None else ""


def valid_image_url(value: Any) -> str:
    """Normalize a remote URL without trusting arbitrary schemes."""
    url = as_text(value)
    if url.startswith("//"):
        url = "https:" + url
    parts = urlsplit(url)
    if parts.scheme not in {"http", "https"} or not parts.netloc:
        return ""
    return url


def make_item(
    *,
    source: str,
    game_id: Any,
    asset_id: Any,
    name: Any,
    cover_url: Any,
    thumbnail_url: Any = "",
) -> SearchItem | None:
    source_game_id = as_text(game_id)
    asset = as_text(asset_id)
    title = as_text(name)
    image_url = valid_image_url(cover_url)
    if not source_game_id or not asset or not title or not image_url:
        return None
    thumb = valid_image_url(thumbnail_url)
    result_id = f"{source}:{source_game_id}:{asset}"
    return SearchItem(
        id=source_game_id,
        result_id=result_id,
        source=source,
        source_game_id=source_game_id,
        asset_id=asset,
        name=title,
        cover_url=image_url,
        thumbnail_url=thumb,
    )


def object_or_empty(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}
