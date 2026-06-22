"""Administrative application settings API."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from models.schemas import CashbackSettingsUpdate
from services.cashback import get_global_cashback_percent, set_global_cashback_percent
from services.security import require_admin


router = APIRouter(prefix="/api/admin/settings", tags=["admin-settings"])


@router.get("/cashback")
def get_cashback_settings(_admin: bool = Depends(require_admin)):
    return {"percent": get_global_cashback_percent()}


@router.put("/cashback")
def update_cashback_settings(
    body: CashbackSettingsUpdate,
    _admin: bool = Depends(require_admin),
):
    return {"percent": set_global_cashback_percent(body.percent)}
