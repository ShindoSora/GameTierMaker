"""Local API for the current-run live log panel."""

from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Query, Request
from fastapi.responses import StreamingResponse

from src.core.live_logs import clear_persistent_log_file, session_log_handler


router = APIRouter()


@router.get("")
async def get_session_logs(after: int = Query(default=0, ge=0)):
    return session_log_handler.snapshot(after)


@router.post("/clear")
async def clear_session_logs():
    return session_log_handler.clear_session()


@router.post("/clear-file")
async def clear_log_file():
    result = clear_persistent_log_file()
    session = session_log_handler.clear_session()
    return {**result, **session}


def _sse_event(event: str, data: dict[str, object], event_id: int | None = None) -> str:
    lines = []
    if event_id is not None:
        lines.append(f"id: {event_id}")
    lines.append(f"event: {event}")
    lines.append(f"data: {json.dumps(data, ensure_ascii=False)}")
    return "\n".join(lines) + "\n\n"


@router.get("/stream")
async def stream_session_logs(
    request: Request,
    after: int = Query(default=0, ge=0),
):
    last_event_id = request.headers.get("last-event-id", "")
    try:
        cursor = max(after, int(last_event_id or 0))
    except ValueError:
        cursor = after

    async def event_stream():
        nonlocal cursor
        clear_version = session_log_handler.snapshot(cursor)["clear_version"]
        heartbeat_ticks = 0
        yield "retry: 1500\n\n"

        while not await request.is_disconnected():
            snapshot = session_log_handler.snapshot(cursor)
            current_clear_version = snapshot["clear_version"]
            if current_clear_version != clear_version:
                clear_version = current_clear_version
                yield _sse_event(
                    "clear",
                    {
                        "session_id": snapshot["session_id"],
                        "clear_version": clear_version,
                    },
                )

            entries = snapshot["entries"]
            for entry in entries:
                cursor = int(entry["id"])
                yield _sse_event("log", entry, cursor)

            heartbeat_ticks += 1
            if heartbeat_ticks >= 60:
                heartbeat_ticks = 0
                yield ": keep-alive\n\n"
            await asyncio.sleep(0.25)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-store",
            "X-Accel-Buffering": "no",
        },
    )
