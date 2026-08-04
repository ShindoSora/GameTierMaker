"""
图片库管理 API
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from src.api.deps import get_manager

router = APIRouter()


class ReorderRequest(BaseModel):
    from_index: int
    to_index: int


class GroupImageOrderRequest(BaseModel):
    group_id: str
    image_ids: list[str]


class CreateGroupRequest(BaseModel):
    name: str


@router.get("/groups")
async def list_groups():
    mgr = get_manager()
    groups = []
    for g in mgr._lib().groups:
        groups.append({
            "id": g.id, "name": g.name,
            "image_ids": g.image_ids,
            "is_expanded": mgr.current_template.library_group_states.get(g.id, False)
            if mgr.current_template else False
        })

    top_crop_image_ids = set()
    shared_search_group = mgr._lib().find_group_by_id("default_upload")
    if shared_search_group:
        top_crop_image_ids.update(shared_search_group.image_ids)
    shared_local_group = mgr._lib().find_group_by_id("local_upload")
    if shared_local_group:
        top_crop_image_ids.update(shared_local_group.image_ids)
    for template in mgr.project_data.templates:
        search_group = template.hidden_preset.find_group_by_id("default_upload")
        if search_group:
            top_crop_image_ids.update(search_group.image_ids)
        local_group = template.hidden_preset.find_group_by_id("local_upload")
        if local_group:
            top_crop_image_ids.update(local_group.image_ids)

    images_meta = {}
    for img_id, meta in mgr.project_data.shared_images_meta.items():
        # 搜索和上传图片导入后都是本地图片；图片移入等级行或未排序列表
        # 后会从隐藏图片库分组移除，因此不能只依赖分组 ID 判断显示模式。
        use_top_crop = (
            bool(meta.steam_id)
            or not meta.is_remote
            or img_id in top_crop_image_ids
        )
        images_meta[img_id] = {
            "is_remote": meta.is_remote,
            "remote_failed": meta.remote_failed,
            "path": meta.path,
            "display_mode": "top_crop" if use_top_crop else "blur_contain",
        }
    return {"groups": groups, "images_meta": images_meta}


@router.put("/groups/reorder")
async def reorder_groups(req: ReorderRequest):
    mgr = get_manager()
    mgr.move_library_group(req.from_index, req.to_index)
    return {"ok": True}


@router.put("/groups/image-order")
async def set_group_image_order(req: GroupImageOrderRequest):
    mgr = get_manager()
    mgr.set_library_group_image_order(req.group_id, req.image_ids)
    return {"ok": True}


@router.put("/groups/{group_id}/expand")
async def set_group_expanded(group_id: str, expanded: bool = True):
    mgr = get_manager()
    mgr.set_library_group_expanded(group_id, expanded)
    return {"ok": True}


@router.delete("/groups/{group_id}")
async def delete_group(group_id: str):
    mgr = get_manager()
    mgr.delete_library_group(group_id)
    return {"ok": True}


@router.get("/presets")
async def list_presets():
    """列出所有模板的隐藏预设概况"""
    mgr = get_manager()
    return {"presets": mgr.get_hidden_presets_summary()}


@router.post("/presets/import/{template_id}")
async def import_preset(template_id: str):
    """将指定模板的隐藏图片库导入当前模板的隐藏图片库。"""
    mgr = get_manager()
    try:
        count = mgr.import_hidden_preset(template_id)
        return {"ok": True, "imported": count}
    except ValueError as e:
        raise HTTPException(404, str(e))


@router.post("/groups")
async def create_group(req: CreateGroupRequest):
    """创建新的图片库分组"""
    mgr = get_manager()
    mgr.create_library_group(req.name)
    return {"ok": True}


@router.delete("/groups/{group_id}/images")
async def clear_group_images(group_id: str):
    """清空指定分组中的所有图片"""
    mgr = get_manager()
    mgr.clear_group_images(group_id)
    return {"ok": True}
