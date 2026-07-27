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
async def list_templates():
    mgr = get_manager()
    return [
        {"id": t.id, "name": t.name, "created_at": t.created_at}
        for t in mgr.project_data.templates
    ]


@router.post("")
async def create_template(req: CreateTemplateRequest):
    mgr = get_manager()
    t = mgr.create_template(req.name)
    return {"id": t.id, "name": t.name}


@router.put("/{template_id}/switch")
async def switch_template(template_id: str):
    mgr = get_manager()
    try:
        mgr.switch_template(template_id)
        return {"current_template_id": template_id}
    except ValueError:
        raise HTTPException(404, "模板不存在")


@router.put("/{template_id}/rename")
async def rename_template(template_id: str, req: RenameRequest):
    mgr = get_manager()
    if mgr.current_template and mgr.current_template.id == template_id:
        mgr.rename_current_template(req.name)
        return {"ok": True}
    return None


@router.delete("/{template_id}")
async def delete_template(template_id: str):
    mgr = get_manager()
    if mgr.current_template and mgr.current_template.id == template_id:
        mgr.delete_current_template()
        return {"ok": True}
    raise HTTPException(400, "不能删除非当前模板")


# === 当前模板的等级行操作 ===

@router.get("/current/tiers")
async def get_current_tiers():
    mgr = get_manager()
    t = mgr.current_template
    if not t:
        raise HTTPException(404, "无当前模板")
    return [
        {
            "id": tier.id, "label": tier.label,
            "color": tier.color, "image_ids": tier.image_ids
        }
        for tier in t.tiers
    ]


@router.post("/current/tiers")
async def add_tier_row(req: TierRowRequest):
    mgr = get_manager()
    mgr.add_tier_row(req.label, req.color)
    return {"ok": True}


@router.put("/current/tiers/{tier_id}/rename")
async def rename_tier(tier_id: str, req: RenameTierRequest):
    mgr = get_manager()
    mgr.rename_tier_row(tier_id, req.new_name)
    return {"ok": True}


@router.put("/current/tiers/{tier_id}/color")
async def change_tier_color(tier_id: str, req: ColorChangeRequest):
    mgr = get_manager()
    mgr.set_tier_color(tier_id, req.color)
    return {"ok": True}


@router.delete("/current/tiers/{tier_id}")
async def delete_tier(tier_id: str):
    mgr = get_manager()
    mgr.delete_tier_row(tier_id)
    return {"ok": True}


@router.put("/current/tiers/reorder")
async def reorder_tiers(req: ReorderRequest):
    mgr = get_manager()
    mgr.move_tier_row(req.from_index, req.to_index)
    return {"ok": True}


# === 未排序图片 ===

@router.get("/current/unassigned")
async def get_unassigned():
    mgr = get_manager()
    t = mgr.current_template
    if not t:
        raise HTTPException(404, "无当前模板")
    return {"image_ids": t.unassigned_images}
