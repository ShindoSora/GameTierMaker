"""Desktop image export API."""

from fastapi import APIRouter, File, Form, UploadFile
from starlette.concurrency import run_in_threadpool

from src.core.errors import InvalidInputError
from src.core.export_service import (
    MAX_EXPORT_BYTES,
    get_runtime_mode,
    save_tier_list_png,
)


router = APIRouter()


@router.post("/tier-list")
async def export_tier_list(
    file: UploadFile = File(...),
    filename: str = Form("tierlist.png"),
):
    if get_runtime_mode() != "desktop":
        raise InvalidInputError(
            "浏览器模式应使用浏览器下载",
            code="browser_download_managed",
        )

    try:
        payload = await file.read(MAX_EXPORT_BYTES + 1)
    finally:
        await file.close()
    return await run_in_threadpool(save_tier_list_png, payload, filename)
