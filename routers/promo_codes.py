"""Promo code routes."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, HTTPException

from db import get_db_connection
from models.schemas import PromoCodeCreate, PromoCodeValidate


router = APIRouter()


@router.get("/api/promo-codes")
def get_promo_codes():
    """Return all promo codes for admin panel."""
    conn = get_db_connection()
    rows = conn.execute("SELECT * FROM promo_codes ORDER BY id DESC").fetchall()
    conn.close()
    return [dict(row) for row in rows]


@router.post("/api/promo-codes")
def create_promo_code(promo: PromoCodeCreate):
    """Create a promo code."""
    conn = get_db_connection()
    try:
        conn.execute(
            """
            INSERT INTO promo_codes (code, discount_percent, discount_amount, max_uses, expires_at, created_at, current_uses, active)
            VALUES (?, ?, ?, ?, ?, ?, 0, 1)
            """,
            (
                promo.code.upper(),
                promo.discount_percent,
                promo.discount_amount,
                promo.max_uses,
                promo.expires_at,
                datetime.now().isoformat(),
            ),
        )
        conn.commit()
        conn.close()
        return {"status": "ok", "message": "Promo code created"}
    except Exception as exc:
        conn.close()
        raise HTTPException(status_code=400, detail=f"Error creating promo code: {exc}")


@router.post("/api/promo-codes/validate")
def validate_promo_code(promo: PromoCodeValidate):
    """Validate promo code and return discount details."""
    conn = get_db_connection()
    code = promo.code.upper()

    row = conn.execute("SELECT * FROM promo_codes WHERE code=?", (code,)).fetchone()
    conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Промокод не знайдено")

    promo_dict = dict(row)

    if not promo_dict.get("active"):
        raise HTTPException(status_code=400, detail="Промокод неактивний")

    if promo_dict.get("expires_at"):
        expires = datetime.fromisoformat(promo_dict["expires_at"])
        if datetime.now() > expires:
            raise HTTPException(status_code=400, detail="Термін дії промокоду закінчився")

    max_uses = promo_dict.get("max_uses", 0)
    current_uses = promo_dict.get("current_uses", 0)
    if max_uses > 0 and current_uses >= max_uses:
        raise HTTPException(status_code=400, detail="Промокод вичерпано")

    return {
        "valid": True,
        "code": code,
        "discount_percent": promo_dict.get("discount_percent", 0),
        "discount_amount": promo_dict.get("discount_amount", 0),
    }


@router.delete("/api/promo-codes/{id}")
def delete_promo_code(id: int):
    """Delete a promo code."""
    conn = get_db_connection()
    conn.execute("DELETE FROM promo_codes WHERE id=?", (id,))
    conn.commit()
    conn.close()
    return {"status": "ok"}


@router.put("/api/promo-codes/{id}/toggle")
def toggle_promo_code(id: int):
    """Toggle promo code activity."""
    conn = get_db_connection()
    row = conn.execute("SELECT active FROM promo_codes WHERE id=?", (id,)).fetchone()
    if row:
        new_active = 0 if row.get("active") else 1
        conn.execute("UPDATE promo_codes SET active=? WHERE id=?", (new_active, id))
        conn.commit()
    conn.close()
    return {"status": "ok"}
