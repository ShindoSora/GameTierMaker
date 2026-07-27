"""项目文件恢复状态与用户确认接口。"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from src.api.deps import get_manager


router = APIRouter()


class ResetProjectRequest(BaseModel):
    confirm: bool = False


@router.get("/status")
async def get_project_status():
    return get_manager().get_recovery_status()


@router.post("/reset")
async def reset_project_after_recovery(req: ResetProjectRequest):
    if not req.confirm:
        raise HTTPException(400, "必须明确确认后才能创建空白项目")
    manager = get_manager()
    if not manager.reset_after_recovery_failure():
        raise HTTPException(409, "项目当前不需要恢复重置")
    return manager.get_recovery_status()

