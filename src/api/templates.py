"""
模板管理 API
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from src.api.deps import get_manager

router = APIRouter()


class CreateTemplateRequest(BaseModel):
    name: str | None = None


class RenameRequest(BaseModel):
    name: str


class TierRowRequest(BaseModel):
    label: str = "NEW"
    color: str = "#808080"


class RenameTierRequest(BaseModel):
    new_name: str


class ColorChangeRequest(BaseModel):
    color: str


class ReorderRequest(BaseModel):
    from_index: int
    to_index: int


@router.get("")
def list_templates():
    mgr = get_manager()
    with mgr._save_lock:
        return [
            {
                "id": t.id,
                "name": t.name,
                "created_at": t.created_at,
                "is_current": t.id == mgr.project_data.current_template_id,
            }
            for t in mgr.project_data.templates
        ]


@router.post("")
def create_template(req: CreateTemplateRequest):
    mgr = get_manager()
    t = mgr.create_template(req.name)
    return {"id": t.id, "name": t.name}


@router.put("/{template_id}/switch")
def switch_template(template_id: str):
    mgr = get_manager()
    try:
        mgr.switch_template(template_id, persist=True)
        return {"current_template_id": template_id}
    except ValueError:
        raise HTTPException(404, "模板不存在")


@router.get("/{template_id}/snapshot")
def get_template_snapshot(template_id: str):
    """Return all render state for one template in one consistent response."""
    mgr = get_manager()
    if mgr.get_template(template_id, required=False) is None:
        raise HTTPException(404, "模板不存在")
    with mgr.template_scope(template_id) as template:
        # Import lazily to avoid coupling router import order.
        from src.api.library import build_library_payload

        library = build_library_payload(mgr, template.id)
        return {
            "template": {
                "id": template.id,
                "name": template.name,
                "created_at": template.created_at,
            },
            "tiers": [
                {
                    "id": tier.id,
                    "label": tier.label,
                    "color": tier.color,
                    "image_ids": list(tier.image_ids),
                }
                for tier in template.tiers
            ],
            "unassigned": {"image_ids": list(template.unassigned_images)},
            **library,
        }


@router.put("/{template_id}/rename")
def rename_template(template_id: str, req: RenameRequest):
    mgr = get_manager()
    if mgr.get_template(template_id, required=False) is None:
        raise HTTPException(404, "模板不存在")
    mgr.rename_template(template_id, req.name)
    return {"ok": True}


@router.delete("/{template_id}")
def delete_template(template_id: str):
    mgr = get_manager()
    if mgr.get_template(template_id, required=False) is None:
        raise HTTPException(404, "模板不存在")
    replacement = mgr.delete_template(template_id)
    return {"ok": True, "current_template_id": replacement.id}


# === 当前模板的等级行操作 ===

@router.get("/current/tiers")
def get_current_tiers(template_id: str | None = None):
    mgr = get_manager()
    if mgr.get_template(template_id, required=False) is None:
        raise HTTPException(404, "模板不存在")
    with mgr.template_scope(template_id) as template:
        return [
            {
                "id": tier.id,
                "label": tier.label,
                "color": tier.color,
                "image_ids": list(tier.image_ids),
            }
            for tier in template.tiers
        ]


@router.post("/current/tiers")
def add_tier_row(req: TierRowRequest, template_id: str | None = None):
    mgr = get_manager()
    with mgr.template_scope(template_id):
        mgr.add_tier_row(req.label, req.color)
    return {"ok": True}


@router.put("/current/tiers/{tier_id}/rename")
def rename_tier(
    tier_id: str,
    req: RenameTierRequest,
    template_id: str | None = None,
):
    mgr = get_manager()
    with mgr.template_scope(template_id):
        mgr.rename_tier_row(tier_id, req.new_name)
    return {"ok": True}


@router.put("/current/tiers/{tier_id}/color")
def change_tier_color(
    tier_id: str,
    req: ColorChangeRequest,
    template_id: str | None = None,
):
    mgr = get_manager()
    with mgr.template_scope(template_id):
        mgr.set_tier_color(tier_id, req.color)
    return {"ok": True}


@router.delete("/current/tiers/{tier_id}")
def delete_tier(tier_id: str, template_id: str | None = None):
    mgr = get_manager()
    with mgr.template_scope(template_id):
        mgr.delete_tier_row(tier_id)
    return {"ok": True}


@router.put("/current/tiers/reorder")
def reorder_tiers(req: ReorderRequest, template_id: str | None = None):
    mgr = get_manager()
    with mgr.template_scope(template_id):
        mgr.move_tier_row(req.from_index, req.to_index)
    return {"ok": True}


# === 未排序图片 ===

@router.get("/current/unassigned")
def get_unassigned(template_id: str | None = None):
    mgr = get_manager()
    if mgr.get_template(template_id, required=False) is None:
        raise HTTPException(404, "模板不存在")
    with mgr.template_scope(template_id) as template:
        return {"image_ids": list(template.unassigned_images)}
