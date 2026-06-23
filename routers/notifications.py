"""Authenticated user notification center API."""

from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from db import get_db_connection
from services.auth import get_current_user_phone
from services.users import normalize_phone

router = APIRouter()

ALLOWED_TYPES = {"all", "order_status", "order_notification", "cashback", "promo", "system"}
ALLOWED_DATE_FILTERS = {"all", "today", "yesterday", "week", "month"}


def _clean_phone_or_400(phone: str) -> str:
    clean_phone = normalize_phone(phone)
    if not clean_phone:
        raise HTTPException(status_code=400, detail="Invalid user identifier")
    return clean_phone


def _row_to_notification(row) -> dict:
    data = row.get("data") or "{}"
    if isinstance(data, str):
        try:
            data = json.loads(data)
        except (json.JSONDecodeError, TypeError):
            data = {}
    created_at = row.get("created_at")
    return {
        "id": row.get("id"),
        "type": row.get("type") or "system",
        "title": row.get("title") or "",
        "body": row.get("body") or "",
        "data": data or {},
        "is_read": bool(row.get("is_read")),
        "created_at": created_at.isoformat() if hasattr(created_at, "isoformat") else created_at,
    }


@router.get("/api/notifications/me")
def get_my_notifications(
    type: str = Query("all"),
    date_filter: str = Query("all"),
    unread_only: bool = Query(False),
    limit: int = Query(100, ge=1, le=200),
    phone: str = Depends(get_current_user_phone),
):
    clean_phone = _clean_phone_or_400(phone)
    notification_type = str(type or "all").strip().lower()
    if notification_type not in ALLOWED_TYPES:
        notification_type = "all"

    normalized_date_filter = str(date_filter or "all").strip().lower()
    if normalized_date_filter not in ALLOWED_DATE_FILTERS:
        normalized_date_filter = "all"

    conditions = ["user_phone = ?"]
    params: list = [clean_phone]

    if notification_type != "all":
        if notification_type == "order_notification":
            conditions.append("type IN (?, ?)")
            params.extend(["order_notification", "order_status"])
        else:
            conditions.append("type = ?")
            params.append(notification_type)

    if unread_only:
        conditions.append("is_read = FALSE")

    if normalized_date_filter == "today":
        conditions.append("created_at >= CURRENT_DATE")
    elif normalized_date_filter == "yesterday":
        conditions.append("created_at >= CURRENT_DATE - INTERVAL '1 day' AND created_at < CURRENT_DATE")
    elif normalized_date_filter == "week":
        conditions.append("created_at >= CURRENT_DATE - INTERVAL '7 days'")
    elif normalized_date_filter == "month":
        conditions.append("created_at >= CURRENT_DATE - INTERVAL '30 days'")

    where_sql = " AND ".join(conditions)
    conn = get_db_connection()
    try:
        rows = conn.execute(
            f"""
            SELECT id, type, title, body, data, is_read, created_at
            FROM user_notifications
            WHERE {where_sql}
            ORDER BY created_at DESC, id DESC
            LIMIT ?
            """,
            tuple(params + [limit]),
        ).fetchall()
        unread_row = conn.execute(
            "SELECT COUNT(*) AS count FROM user_notifications WHERE user_phone = ? AND is_read = FALSE",
            (clean_phone,),
        ).fetchone()
        return {
            "items": [_row_to_notification(row) for row in rows],
            "unread_count": int((unread_row or {}).get("count") or 0),
        }
    finally:
        conn.close()


@router.post("/api/notifications/read-all")
def mark_all_notifications_read(phone: str = Depends(get_current_user_phone)):
    clean_phone = _clean_phone_or_400(phone)
    conn = get_db_connection()
    try:
        cur = conn.execute(
            "UPDATE user_notifications SET is_read = TRUE WHERE user_phone = ? AND is_read = FALSE",
            (clean_phone,),
        )
        conn.commit()
        return {"status": "ok", "updated": getattr(cur, "rowcount", 0)}
    finally:
        conn.close()


@router.post("/api/notifications/{notification_id}/read")
def mark_notification_read(notification_id: int, phone: str = Depends(get_current_user_phone)):
    clean_phone = _clean_phone_or_400(phone)
    conn = get_db_connection()
    try:
        cur = conn.execute(
            """
            UPDATE user_notifications
            SET is_read = TRUE
            WHERE id = ? AND user_phone = ?
            """,
            (notification_id, clean_phone),
        )
        conn.commit()
        if getattr(cur, "rowcount", 0) == 0:
            raise HTTPException(status_code=404, detail="Notification not found")
        return {"status": "ok"}
    finally:
        conn.close()
