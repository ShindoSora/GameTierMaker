"""
图片管理 API：上传、搜索、下载、移动、删除
"""

import os
import uuid
import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool
from src.api.deps import get_manager, get_image_svc
from src.core.errors import ImageImportError, InvalidInputError
from src.core.image_security import (
    MAX_UPLOAD_BYTES,
    STREAM_CHUNK_SIZE,
    safe_original_filename,
    validate_image_file,
    validate_image_id,
)

router = APIRouter()
logger = logging.getLogger(__name__)


def _copy_upload_to_temporary_file(file: UploadFile, destination: Path) -> int:
    """Copy the already-parsed multipart file without blocking the event loop."""
    total = 0
    file.file.seek(0)
    with destination.open("xb") as output:
        while chunk := file.file.read(STREAM_CHUNK_SIZE):
            total += len(chunk)
            if total > MAX_UPLOAD_BYTES:
                raise InvalidInputError(
                    "上传图片不能超过 25 MB",
                    code="upload_too_large",
                )
            output.write(chunk)
    return total


class SearchRequest(BaseModel):
    query: str


class DownloadRequest(BaseModel):
    url: str
    game_name: str
    game_id: str
    group_id: str | None = None
    steam_id: str = ""          # 关联 Steam 账号，用于去重和账号管理


class MoveRequest(BaseModel):
    image_id: str
    target_type: str   # "tier" | "unassigned" | "library_group"
    target_id: str | None = None
    index: int = -1    # 插入位置，-1 表示末尾


@router.post("/upload")
async def upload_image(
    file: UploadFile = File(...),
    template_id: str | None = None,
):
    """上传单张图片"""
    mgr = get_manager()
    temporary_dir = Path(mgr.data_dir) / "temp" / "uploads"
    try:
        temporary_dir.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise ImageImportError(
            "无法创建图片上传临时目录，请检查数据目录权限",
            code="upload_temp_directory_failed",
        ) from exc
    temporary_path = temporary_dir / f"{uuid.uuid4().hex}.upload"
    validated_path: Path | None = None
    try:
        total = await run_in_threadpool(
            _copy_upload_to_temporary_file,
            file,
            temporary_path,
        )

        if total == 0:
            raise InvalidInputError(
                "上传的图片内容为空",
                code="upload_empty",
            )

        extension = await run_in_threadpool(validate_image_file, temporary_path)
        validated_path = temporary_path.with_suffix(extension)
        os.replace(temporary_path, validated_path)
        original_name = safe_original_filename(file.filename, extension)

        def import_upload():
            with mgr.template_scope(template_id):
                return mgr.upload_image(
                    str(validated_path),
                    original_name=original_name,
                )

        img = await run_in_threadpool(import_upload)
        return {"image_id": img.id, "path": img.path}
    except OSError as exc:
        raise ImageImportError(
            "无法暂存上传图片，请检查磁盘空间和数据目录权限",
            code="upload_temp_write_failed",
        ) from exc
    finally:
        try:
            await file.close()
        except OSError:
            logger.warning("关闭上传临时文件失败", exc_info=True)
        for candidate in (temporary_path, validated_path):
            if candidate is not None:
                try:
                    candidate.unlink(missing_ok=True)
                except OSError:
                    logger.warning("清理上传临时文件失败: %s", candidate, exc_info=True)


@router.post("/search")
async def search_images(req: SearchRequest):
    """搜索 IGDB / Bangumi 游戏封面"""
    if not req.query.strip():
        raise InvalidInputError(
            "请输入游戏名称",
            code="search_query_required",
        )
    mgr = get_manager()
    results = await run_in_threadpool(mgr.search_only, req.query)
    return {"results": results}


@router.post("/download")
async def download_image(req: DownloadRequest, template_id: str | None = None):
    """下载搜索结果中的游戏封面，可指定导入到哪个分组"""
    mgr = get_manager()
    logger.info("下载请求: game=%s, url=%s, group=%s", req.game_name, req.url, req.group_id)
    def download_and_import():
        file_path = mgr.download_image_to_folder(
            req.url,
            req.game_name,
            req.game_id,
        )
        if file_path:
            with mgr.template_scope(template_id):
                mgr.import_image_to_library(
                    file_path,
                    group_id=req.group_id,
                    steam_id=req.steam_id,
                )
        return file_path

    file_path = await run_in_threadpool(download_and_import)
    if file_path:
        return {"file_path": file_path}
    logger.error("下载失败: file_path为空, game=%s, url=%s", req.game_name, req.url)
    raise InvalidInputError(
        "下载失败：无法从图片地址获取有效图片",
        code="remote_image_download_failed",
    )


@router.put("/move")
def move_image(req: MoveRequest, template_id: str | None = None):
    """移动图片到指定区域"""
    mgr = get_manager()
    source_info = _find_source(mgr, req.image_id, template_id)
    if not source_info:
        raise HTTPException(404, "图片不存在")
    src_type, src_id = source_info
    mgr.move_image(
        req.image_id,
        src_type,
        src_id,
        req.target_type,
        req.target_id,
        req.index,
        template_id=template_id,
    )
    return {"ok": True}


@router.delete("/{image_id}")
def delete_image(
    image_id: str,
    is_global: bool = False,
    template_id: str | None = None,
):
    """删除图片"""
    image_id = validate_image_id(image_id)
    mgr = get_manager()
    with mgr._save_lock:
        if image_id not in mgr.project_data.shared_images_meta:
            raise HTTPException(404, "图片不存在")
    if is_global:
        mgr.delete_image_globally(image_id)
    else:
        with mgr.template_scope(template_id):
            mgr.delete_image_from_template(image_id)
    return {"ok": True}


@router.get("/{image_id}/thumbnail")
async def get_thumbnail(image_id: str):
    """获取缩略图"""
    image_id = validate_image_id(image_id)
    def resolve_thumbnail():
        svc = get_image_svc()
        mgr = get_manager()
        with mgr._save_lock:
            meta = mgr.project_data.shared_images_meta.get(image_id)
            if meta is None:
                return ""
            meta_path = meta.path
            is_remote = meta.is_remote
        path = svc.get_thumbnail_path(image_id)
        if not is_remote and meta_path:
            source_path = svc.get_full_image_path(meta_path)
            if os.path.exists(source_path):
                path = svc.ensure_thumbnail(source_path, image_id)
        return path

    path = await run_in_threadpool(resolve_thumbnail)
    if os.path.exists(path):
        return FileResponse(path)
    raise HTTPException(404, "缩略图不存在")


@router.get("/{image_id}/info")
def get_image_info(image_id: str):
    """获取图片元数据"""
    image_id = validate_image_id(image_id)
    mgr = get_manager()
    with mgr._save_lock:
        meta = mgr.project_data.shared_images_meta.get(image_id)
        if meta:
            return {"id": meta.id, "path": meta.path, "original_name": meta.original_name}
    raise HTTPException(404, "图片不存在")


def _find_source(mgr, image_id: str, template_id: str | None = None):
    """查找图片当前位置"""
    image_id = validate_image_id(image_id)
    with mgr.template_scope(template_id) as template:
        for tier in template.tiers:
            if image_id in tier.image_ids:
                return ('tier', tier.id)
        if image_id in template.unassigned_images:
            return ('unassigned', None)
        for group in template.hidden_preset.groups:
            if image_id in group.image_ids:
                return ('library_group', group.id)
    return None
