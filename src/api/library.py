"""
图片库管理 API
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from src.api.deps import get_manager

router = APIRouter()


def build_library_payload(mgr, template_id: str | None = None):
    """Build one template's library snapshot without relying on global UI state."""
    with mgr.template_scope(template_id) as template:
        groups = [
            {
                "id": group.id,
                "name": group.name,
                "image_ids": list(group.image_ids),
                "is_expanded": template.library_group_states.get(group.id, False),
            }
            for group in template.hidden_preset.groups
        ]

        top_crop_image_ids = set()
        for project_template in mgr.project_data.templates:
            for group_id in ("default_upload", "local_upload"):
                group = project_template.hidden_preset.find_group_by_id(group_id)
                if group:
                    top_crop_image_ids.update(group.image_ids)

        images_meta = {}
        for image_id, meta in mgr.project_data.shared_images_meta.items():
            source_group_id = getattr(meta, "source_group_id", "")
            keep_platform_ratio = (
                source_group_id.startswith("psn_import_")
                or source_group_id.startswith("xbox:")
            )
            use_top_crop = (
                bool(meta.steam_id)
                or image_id in top_crop_image_ids
                or (not meta.is_remote and not keep_platform_ratio)
            )
            images_meta[image_id] = {
                "is_remote": meta.is_remote,
                "remote_failed": meta.remote_failed,
                "path": meta.path,
                "source_group_id": source_group_id,
                "display_mode": "top_crop" if use_top_crop else "blur_contain",
            }
        return {"groups": groups, "images_meta": images_meta}


class ReorderRequest(BaseModel):
    from_index: int
    to_index: int


class GroupImageOrderRequest(BaseModel):
    group_id: str
    image_ids: list[str]


class CreateGroupRequest(BaseModel):
    name: str


@router.get("/groups")
def list_groups(template_id: str | None = None):
    mgr = get_manager()
    return build_library_payload(mgr, template_id)


@router.put("/groups/reorder")
def reorder_groups(req: ReorderRequest, template_id: str | None = None):
    mgr = get_manager()
    with mgr.template_scope(template_id):
        mgr.move_library_group(req.from_index, req.to_index)
    return {"ok": True}


@router.put("/groups/image-order")
def set_group_image_order(req: GroupImageOrderRequest, template_id: str | None = None):
    mgr = get_manager()
    with mgr.template_scope(template_id):
        mgr.set_library_group_image_order(req.group_id, req.image_ids)
    return {"ok": True}


@router.put("/groups/{group_id}/expand")
def set_group_expanded(
    group_id: str,
    expanded: bool = True,
    template_id: str | None = None,
):
    mgr = get_manager()
    with mgr.template_scope(template_id):
        mgr.set_library_group_expanded(group_id, expanded)
    return {"ok": True}


@router.delete("/groups/{group_id}")
def delete_group(group_id: str, template_id: str | None = None):
    mgr = get_manager()
    with mgr.template_scope(template_id):
        mgr.delete_library_group(group_id)
    return {"ok": True}


@router.get("/presets")
def list_presets():
    """列出所有模板的隐藏预设概况"""
    mgr = get_manager()
    return {"presets": mgr.get_hidden_presets_summary()}


@router.post("/presets/import/{template_id}")
def import_preset(template_id: str, target_template_id: str | None = None):
    """将指定模板的隐藏图片库导入当前模板的隐藏图片库。"""
    mgr = get_manager()
    try:
        with mgr.template_scope(target_template_id):
            count = mgr.import_hidden_preset(template_id)
        return {"ok": True, "imported": count}
    except ValueError as e:
        raise HTTPException(404, str(e))


@router.post("/groups")
def create_group(req: CreateGroupRequest, template_id: str | None = None):
    """创建新的图片库分组"""
    mgr = get_manager()
    with mgr.template_scope(template_id):
        mgr.create_library_group(req.name)
    return {"ok": True}


@router.delete("/groups/{group_id}/images")
def clear_group_images(group_id: str, template_id: str | None = None):
    """清空指定分组中的所有图片"""
    mgr = get_manager()
    with mgr.template_scope(template_id):
        mgr.clear_group_images(group_id)
    return {"ok": True}
