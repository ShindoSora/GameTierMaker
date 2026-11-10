"""
图片库管理 API
"""

from fastapi import APIRouter
from pydantic import BaseModel
from src.api.deps import get_manager
from src.core.library_groups import format_account_group_name

router = APIRouter()


def build_library_payload(mgr, template_id: str | None = None):
    """Build one template's library snapshot without relying on global UI state."""
    with mgr.template_scope(template_id) as template:
        groups = [
            {
                "id": group.id,
                "name": format_account_group_name(group.id, group.name),
                "image_ids": list(group.image_ids),
                "is_expanded": template.library_group_states.get(group.id, False),
            }
            for group in template.hidden_preset.groups
        ]

        images_meta = {}
        for image_id, meta in mgr.project_data.shared_images_meta.items():
            source_group_id = getattr(meta, "source_group_id", "")
            images_meta[image_id] = {
                "is_remote": meta.is_remote,
                "remote_failed": meta.remote_failed,
                "path": meta.path,
                "source_group_id": source_group_id,
                "game_name": meta.game_name,
                "original_name": meta.original_name,
                "display_mode": "cover_top",
            }
        return {"groups": groups, "images_meta": images_meta}


class CreateGroupRequest(BaseModel):
    name: str


@router.delete("/groups/{group_id}")
def delete_group(group_id: str, template_id: str | None = None):
    mgr = get_manager()
    with mgr.template_scope(template_id):
        mgr.delete_library_group(group_id)
    return {"ok": True}


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
