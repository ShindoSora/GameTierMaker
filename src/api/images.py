"""
图片管理 API：上传、搜索、下载、移动、删除
"""

import os
from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from pydantic import BaseModel
from src.api.deps import get_manager, get_image_svc
from src.core.errors import InvalidInputError

router = APIRouter()


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
async def upload_image(file: UploadFile = File(...)):
    """上传单张图片"""
    mgr = get_manager()
    # 保存临时文件
    tmp_path = os.path.join(mgr.data_dir, "tmp_" + file.filename)
    try:
        content = await file.read()
        with open(tmp_path, "wb") as f:
            f.write(content)
        img = mgr.upload_image(tmp_path)
        if img:
            return {"image_id": img.id, "path": img.path}
        raise HTTPException(400, "上传失败")
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


@router.post("/search")
async def search_images(req: SearchRequest):
    """搜索 IGDB / Bangumi 游戏封面"""
    if not req.query.strip():
        raise InvalidInputError(
            "请输入游戏名称",
            code="search_query_required",
        )
    mgr = get_manager()
    results = mgr.search_only(req.query)
    return {"results": results}


@router.post("/download")
async def download_image(req: DownloadRequest):
    """下载搜索结果中的游戏封面，可指定导入到哪个分组"""
    import logging
    logger = logging.getLogger(__name__)
    mgr = get_manager()
    logger.info("下载请求: game=%s, url=%s, group=%s", req.game_name, req.url, req.group_id)
    file_path = mgr.download_image_to_folder(req.url, req.game_name, req.game_id)
    if file_path:
        mgr.import_image_to_library(file_path, group_id=req.group_id, steam_id=req.steam_id)
        return {"file_path": file_path}
    logger.error("下载失败: file_path为空, game=%s, url=%s", req.game_name, req.url)
    raise HTTPException(400, f"下载失败: 无法从URL获取图片")


@router.put("/move")
async def move_image(req: MoveRequest):
    """移动图片到指定区域"""
    mgr = get_manager()
    source_info = _find_source(mgr, req.image_id)
    if not source_info:
        raise HTTPException(404, "图片不存在")
    src_type, src_id = source_info
    mgr.move_image(req.image_id, src_type, src_id, req.target_type, req.target_id, req.index)
    return {"ok": True}


@router.delete("/{image_id}")
async def delete_image(image_id: str, is_global: bool = False):
    """删除图片"""
    mgr = get_manager()
    if is_global:
        mgr.delete_image_globally(image_id)
    else:
        mgr.delete_image_from_template(image_id)
    return {"ok": True}


@router.get("/{image_id}/thumbnail")
async def get_thumbnail(image_id: str):
    """获取缩略图"""
    svc = get_image_svc()
    path = svc.get_thumbnail_path(image_id)
    mgr = get_manager()
    meta = mgr.project_data.shared_images_meta.get(image_id)
    if meta and not meta.is_remote and meta.path:
        source_path = svc.get_full_image_path(meta.path)
        if os.path.exists(source_path):
            path = svc.ensure_thumbnail(source_path, image_id)
    if os.path.exists(path):
        return FileResponse(path)
    raise HTTPException(404, "缩略图不存在")


@router.get("/{image_id}/info")
async def get_image_info(image_id: str):
    """获取图片元数据"""
    mgr = get_manager()
    meta = mgr.project_data.shared_images_meta.get(image_id)
    if meta:
        return {"id": meta.id, "path": meta.path, "original_name": meta.original_name}
    raise HTTPException(404, "图片不存在")


def _find_source(mgr, image_id: str):
    """查找图片当前位置"""
    t = mgr.current_template
    if not t:
        return None
    for tier in t.tiers:
        if image_id in tier.image_ids:
            return ('tier', tier.id)
    if image_id in t.unassigned_images:
        return ('unassigned', None)
    for group in mgr._lib().groups:
        if image_id in group.image_ids:
            return ('library_group', group.id)
    return None
