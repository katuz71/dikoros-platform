"""Saved checkout profile API.

Stores delivery/payment/recipient preferences separately from order creation.
This must not affect OneBox payload generation.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from db import get_db_connection
from services.auth import get_current_user_phone
from services.users import clean_warehouse_value, normalize_phone


router = APIRouter()


class CheckoutProfileUpdate(BaseModel):
    name: Optional[str] = None
    last_name: Optional[str] = None
    middle_name: Optional[str] = None
    email: Optional[str] = None
    contact_preference: Optional[str] = None
    city: Optional[str] = None
    city_ref: Optional[str] = None
    warehouse: Optional[str] = None
    warehouse_ref: Optional[str] = None
    user_ukrposhta: Optional[str] = None
    recipient_name: Optional[str] = None
    recipient_phone: Optional[str] = None
    is_different_recipient: Optional[bool] = None
    do_not_call: Optional[bool] = None
    delivery_method: Optional[str] = None
    payment_method: Optional[str] = None
    checkout_comment: Optional[str] = None


CHECKOUT_PROFILE_FIELDS = [
    "name",
    "last_name",
    "middle_name",
    "email",
    "contact_preference",
    "city",
    "city_ref",
    "warehouse",
    "warehouse_ref",
    "user_ukrposhta",
    "recipient_name",
    "recipient_phone",
    "is_different_recipient",
    "do_not_call",
    "delivery_method",
    "payment_method",
    "checkout_comment",
]


def _clean_text(value: Optional[str]) -> str:
    return str(value or "").strip()


def _get_clean_phone(phone: str) -> str:
    clean_phone = normalize_phone(phone)
    if not clean_phone:
        raise HTTPException(status_code=400, detail="Invalid user identifier")
    return clean_phone


@router.get("/api/user/checkout-profile/me")
def get_checkout_profile(phone: str = Depends(get_current_user_phone)):
    clean_phone = _get_clean_phone(phone)
    conn = get_db_connection()
    try:
        row = conn.execute("SELECT * FROM users WHERE phone = ?", (clean_phone,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="User not found")

        data = dict(row)
        warehouse_display = data.get("warehouse")
        if warehouse_display and isinstance(warehouse_display, str):
            warehouse_display = clean_warehouse_value(warehouse_display) or warehouse_display
        ukrposhta_display = data.get("user_ukrposhta")
        if ukrposhta_display and isinstance(ukrposhta_display, str):
            ukrposhta_display = clean_warehouse_value(ukrposhta_display) or ukrposhta_display

        return {
            "phone": clean_phone,
            "name": data.get("name") or "",
            "last_name": data.get("last_name") or "",
            "middle_name": data.get("middle_name") or "",
            "email": data.get("email") or "",
            "contact_preference": data.get("contact_preference") or "call",
            "city": data.get("city") or "",
            "city_ref": data.get("city_ref") or "",
            "warehouse": warehouse_display or "",
            "warehouse_ref": data.get("warehouse_ref") or "",
            "user_ukrposhta": ukrposhta_display or "",
            "recipient_name": data.get("recipient_name") or "",
            "recipient_phone": data.get("recipient_phone") or "",
            "is_different_recipient": bool(data.get("is_different_recipient")),
            "do_not_call": bool(data.get("do_not_call")),
            "delivery_method": data.get("delivery_method") or "",
            "payment_method": data.get("payment_method") or "",
            "checkout_comment": data.get("checkout_comment") or "",
        }
    finally:
        conn.close()


@router.put("/api/user/checkout-profile/me")
def update_checkout_profile(info: CheckoutProfileUpdate, phone: str = Depends(get_current_user_phone)):
    clean_phone = _get_clean_phone(phone)
    conn = get_db_connection()
    try:
        cur = conn.cursor()
        row = cur.execute("SELECT 1 FROM users WHERE phone = ?", (clean_phone,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="User not found")

        payload = info.model_dump(exclude_unset=True)
        update_fields = []
        update_values = []

        for field in CHECKOUT_PROFILE_FIELDS:
            if field not in payload:
                continue

            value = payload[field]
            if field in {"warehouse", "user_ukrposhta"} and value is not None:
                value = clean_warehouse_value(value) or _clean_text(value)
            elif isinstance(value, str):
                value = _clean_text(value)

            update_fields.append(f"{field} = ?")
            update_values.append(value)

        if not update_fields:
            return {"status": "ok", "updated": 0}

        update_values.append(clean_phone)
        cur.execute(
            f"UPDATE users SET {', '.join(update_fields)} WHERE phone = ?",
            tuple(update_values),
        )
        conn.commit()
        return {"status": "ok", "updated": len(update_fields)}
    finally:
        conn.close()
