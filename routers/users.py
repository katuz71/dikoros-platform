"""Users API router."""

from __future__ import annotations

import csv
import logging
import json
from io import StringIO
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import StreamingResponse

from db import get_db_connection
from models.schemas import (
    AdminUserUpdate,
    BatchDeleteUsers,
    PushTokenRequest,
    UserInfoUpdate,
    UserResponse,
)
from services.auth import get_current_user_phone
from services.notifications import send_expo_push
from services.users import (
    calculate_cashback_percent,
    clean_warehouse_value,
    normalize_phone,
)


router = APIRouter()
logger = logging.getLogger(__name__)

ALLOWED_USER_SORT_FIELDS = {
    "phone",
    "name",
    "email",
    "city",
    "bonus_balance",
    "total_spent",
    "cashback_percent",
    "created_at",
}



@router.get("/user/{phone}", response_model=UserResponse)
def get_user_profile(phone: str):
    # Для соц. входу (google_*, fb_*, tg_*) не очищаем; для телефону — лише цифри
    raw = str(phone).strip()
    if raw.startswith("google_") or raw.startswith("fb_") or raw.startswith("tg_"):
        lookup_phone = raw
    else:
        lookup_phone = "".join(filter(str.isdigit, raw))
    conn = get_db_connection()
    user = conn.execute("SELECT * FROM users WHERE phone = ?", (lookup_phone,)).fetchone()
    conn.close()
    if user:
        user_dict = dict(user)
        stored_phone = user_dict.get('phone') or lookup_phone
        # Для соц. входу (google_*, fb_*, tg_*) не повертаємо технічний ідентифікатор як телефон — клієнт має запросити номер.
        display_phone = None if (stored_phone.startswith("google_") or stored_phone.startswith("fb_") or stored_phone.startswith("tg_")) else stored_phone
        # При віддачі профілю видаляємо префікси з відділень (для старих записів у БД)
        warehouse_display = user_dict.get('warehouse')
        if warehouse_display and isinstance(warehouse_display, str):
            warehouse_display = clean_warehouse_value(warehouse_display) or warehouse_display
        ukrposhta_display = user_dict.get('user_ukrposhta')
        if ukrposhta_display and isinstance(ukrposhta_display, str):
            ukrposhta_display = clean_warehouse_value(ukrposhta_display) or ukrposhta_display
        return UserResponse(
            phone=display_phone,
            bonus_balance=user_dict.get('bonus_balance', 0),
            total_spent=user_dict.get('total_spent', 0.0),
            cashback_percent=user_dict.get('cashback_percent', 0),
            name=user_dict.get('name'),
            city=user_dict.get('city'),
            warehouse=warehouse_display,
            ukrposhta=ukrposhta_display,
            email=user_dict.get('email'),
            contact_preference=user_dict.get('contact_preference'),
            referrer=user_dict.get('referrer'),
            created_at=user_dict.get('created_at')
        )
    raise HTTPException(status_code=404, detail="User not found")


@router.get("/api/user/me", response_model=UserResponse)
def get_api_user_me(phone: str = Depends(get_current_user_phone)):
    """Текущий пользователь по JWT (Bearer). Возвращает 401 если токен отсутствует или протух."""
    return get_user_profile(phone)


@router.delete("/api/user/me")
def delete_api_user_me(phone: str = Depends(get_current_user_phone)):
    """Delete current user account. Orders are anonymized, user profile and reviews are removed."""
    clean_phone = normalize_phone(phone)
    if not clean_phone:
        raise HTTPException(status_code=400, detail="Invalid user identifier")

    conn = get_db_connection()
    try:
        cur = conn.cursor()
        user = cur.execute("SELECT phone FROM users WHERE phone = ?", (clean_phone,)).fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        cur.execute(
            """
            UPDATE orders
            SET
                name = ?,
                phone = NULL,
                user_phone = NULL,
                email = '',
                contact_preference = 'call',
                city = NULL,
                city_ref = NULL,
                warehouse = NULL,
                warehouse_ref = NULL,
                user_ukrposhta = NULL,
                push_token = NULL
            WHERE user_phone = ? OR phone = ?
            """,
            ("Користувач видалений", clean_phone, clean_phone),
        )
        cur.execute("DELETE FROM reviews WHERE user_phone = ?", (clean_phone,))
        cur.execute("DELETE FROM app_users WHERE phone = ?", (clean_phone,))
        cur.execute("DELETE FROM users WHERE phone = ?", (clean_phone,))

        conn.commit()
        return {"status": "ok", "message": "Account deleted"}
    finally:
        conn.close()


@router.post("/api/recalculate-cashback")
def recalculate_cashback():
    """Recalculate cashback_percent for all users based on total_spent."""
    conn = get_db_connection()
    try:
        cur = conn.cursor()
        users = cur.execute("SELECT phone, total_spent FROM users").fetchall()
        updated_count = 0

        for user in users:
            phone = user["phone"]
            total_spent = float(user["total_spent"] or 0)
            cashback_percent = calculate_cashback_percent(total_spent)
            cur.execute("UPDATE users SET cashback_percent=? WHERE phone=?", (cashback_percent, phone))
            updated_count += 1
            logger.info("Updated cashback percent: phone=%s total_spent=%s cashback_percent=%s", phone, total_spent, cashback_percent)

        conn.commit()
        return {
            "status": "ok",
            "message": f"Updated cashback_percent for {updated_count} users"
        }
    finally:
        conn.close()


@router.get("/api/users")
def get_users(
    search: Optional[str] = None,
    has_bonuses: Optional[bool] = None,
    sort_by: Optional[str] = None,
    source: Optional[str] = None,
):
    """Список пользователей. Параметры: search, has_bonuses, sort_by, source (google|facebook). SELECT * возвращает google_id, facebook_id."""
    conn = get_db_connection()
    cur = conn.cursor()
    conditions = []
    params = []
    # Поиск по фразе "google" или "facebook" — фильтр по источнику
    search_trimmed = (search or "").strip()
    source_from_search = None
    search_for_like = search_trimmed
    if search_trimmed.lower() in ("google", "facebook"):
        source_from_search = search_trimmed.lower()
        search_for_like = None
    effective_source = (source or "").strip().lower() or source_from_search
    if effective_source == "google":
        conditions.append("(google_id IS NOT NULL AND google_id != '')")
    elif effective_source == "facebook":
        conditions.append("(facebook_id IS NOT NULL AND facebook_id != '')")
    if search_for_like:
        q = "%" + search_for_like + "%"
        conditions.append("(name ILIKE ? OR phone ILIKE ? OR email ILIKE ?)")
        params.extend([q, q, q])
    if has_bonuses is True:
        conditions.append("(bonus_balance IS NOT NULL AND bonus_balance > 0)")
    where_sql = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    order_field = "phone"
    if sort_by and sort_by.strip() in ALLOWED_USER_SORT_FIELDS:
        order_field = sort_by.strip()
    order_sql = f"ORDER BY {order_field} NULLS LAST"
    sql = f"SELECT * FROM users {where_sql} {order_sql}"
    rows = cur.execute(sql, tuple(params) if params else ()).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@router.get("/api/admin/users")
def get_admin_users(
    search: Optional[str] = None,
    has_bonuses: Optional[bool] = None,
    sort_by: Optional[str] = None,
    source: Optional[str] = None,
):
    """Тот же список, что и GET /api/users. Возвращает всех пользователей с полями google_id, facebook_id и остальными."""
    return get_users(search=search, has_bonuses=has_bonuses, sort_by=sort_by, source=source)


@router.get("/api/users/export")
def export_users(
    search: Optional[str] = None,
    has_bonuses: Optional[bool] = None,
    sort_by: Optional[str] = None,
    source: Optional[str] = None,
):
    """Экспорт списка клиентов в CSV с учётом фильтров search, has_bonuses, sort_by, source."""
    conn = get_db_connection()
    cur = conn.cursor()
    conditions = []
    params = []
    search_trimmed = (search or "").strip()
    source_from_search = None
    search_for_like = search_trimmed
    if search_trimmed.lower() in ("google", "facebook"):
        source_from_search = search_trimmed.lower()
        search_for_like = None
    effective_source = (source or "").strip().lower() or source_from_search
    if effective_source == "google":
        conditions.append("(google_id IS NOT NULL AND google_id != '')")
    elif effective_source == "facebook":
        conditions.append("(facebook_id IS NOT NULL AND facebook_id != '')")
    if search_for_like:
        q = "%" + search_for_like + "%"
        conditions.append("(name ILIKE ? OR phone ILIKE ? OR email ILIKE ?)")
        params.extend([q, q, q])
    if has_bonuses is True:
        conditions.append("(bonus_balance IS NOT NULL AND bonus_balance > 0)")
    where_sql = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    order_field = "phone"
    if sort_by and sort_by.strip() in ALLOWED_USER_SORT_FIELDS:
        order_field = sort_by.strip()
    order_sql = f"ORDER BY {order_field} NULLS LAST"
    sql = f"SELECT * FROM users {where_sql} {order_sql}"
    rows = cur.execute(sql, tuple(params) if params else ()).fetchall()
    conn.close()

    output = StringIO()
    output.write("\ufeff")  # BOM для UTF-8 в Excel
    writer = csv.writer(output)
    writer.writerow([
        "Телефон", "Имя", "Город", "Отделение НП", "Укрпошта", "Email", "Способ связи",
        "Баланс бонусов (₴)", "Всего потрачено (₴)", "Кешбэк %", "Дата регистрации"
    ])
    for r in rows:
        row = dict(r)
        total = row.get("total_spent") or 0
        level = calculate_cashback_percent(float(total or 0))
        writer.writerow([
            row.get("phone") or "",
            row.get("name") or "",
            row.get("city") or "",
            row.get("warehouse") or "",
            row.get("user_ukrposhta") or "",
            row.get("email") or "",
            row.get("contact_preference") or "call",
            row.get("bonus_balance") or 0,
            total,
            level,
            row.get("created_at") or "",
        ])
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=clients.csv"},
    )


@router.put("/api/users/{phone}")
def update_user(phone: str, u: AdminUserUpdate):
    """Обновление клиента админом: phone, name, city, warehouse, email, contact_preference, bonus_balance, total_spent."""
    clean_phone = normalize_phone(phone)
    if not clean_phone:
        raise HTTPException(status_code=400, detail="Invalid phone")

    conn = get_db_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM users WHERE phone = ?", (clean_phone,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="User not found")

        new_phone = None
        if u.phone is not None and str(u.phone).strip():
            new_phone = "".join(filter(str.isdigit, str(u.phone).strip()))
            if not new_phone:
                raise HTTPException(status_code=400, detail="Invalid new phone number")
            if new_phone == clean_phone:
                new_phone = None
            elif cur.execute("SELECT 1 FROM users WHERE phone = ?", (new_phone,)).fetchone():
                raise HTTPException(status_code=409, detail="Phone already exists")

        update_fields = []
        update_values = []

        if u.name is not None:
            update_fields.append("name = ?")
            update_values.append(u.name)
        if u.city is not None:
            update_fields.append("city = ?")
            update_values.append(u.city)
        if u.warehouse is not None:
            update_fields.append("warehouse = ?")
            update_values.append(clean_warehouse_value(u.warehouse) or u.warehouse.strip())
        if getattr(u, "user_ukrposhta", None) is not None:
            update_fields.append("user_ukrposhta = ?")
            update_values.append(clean_warehouse_value(u.user_ukrposhta) or u.user_ukrposhta.strip())
        if u.email is not None:
            update_fields.append("email = ?")
            update_values.append(u.email)
        if u.contact_preference is not None:
            update_fields.append("contact_preference = ?")
            update_values.append(u.contact_preference)
        if u.bonus_balance is not None:
            update_fields.append("bonus_balance = ?")
            update_values.append(u.bonus_balance)
        if u.total_spent is not None:
            update_fields.append("total_spent = ?")
            update_values.append(u.total_spent)

        if update_fields:
            update_values.append(clean_phone)
            cur.execute(
                f"UPDATE users SET {', '.join(update_fields)} WHERE phone = ?",
                tuple(update_values),
            )
            conn.commit()

        if new_phone:
            cur.execute("UPDATE users SET phone = ? WHERE phone = ?", (new_phone, clean_phone))
            conn.commit()

        return {"status": "ok"}
    finally:
        conn.close()


@router.delete("/api/admin/user/{phone}")
def delete_admin_user(phone: str):
    """Удаление клиента из базы (админ)."""
    clean_phone = normalize_phone(phone)
    if not clean_phone:
        raise HTTPException(status_code=400, detail="Invalid phone")

    conn = get_db_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM users WHERE phone = ?", (clean_phone,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="User not found")

        cur.execute("DELETE FROM users WHERE phone = ?", (clean_phone,))
        conn.commit()
        return {"status": "ok"}
    finally:
        conn.close()


@router.post("/api/admin/users/delete-batch")
def delete_users_batch(batch: BatchDeleteUsers):
    """Массовое удаление клиентов по списку телефонов."""
    if not batch.phones:
        return {"status": "ok", "deleted": 0}

    conn = get_db_connection()
    try:
        cur = conn.cursor()
        cleaned = [normalize_phone(p) for p in batch.phones if normalize_phone(p)]
        if not cleaned:
            return {"status": "ok", "deleted": 0}

        placeholders = ",".join("?" for _ in cleaned)
        cur.execute(f"DELETE FROM users WHERE phone IN ({placeholders})", cleaned)
        conn.commit()

        deleted_count = getattr(cur, "rowcount", len(cleaned))
        return {"status": "ok", "deleted": deleted_count}
    finally:
        conn.close()



@router.put("/api/user/info/me")
def update_current_user_info(info: UserInfoUpdate, phone: str = Depends(get_current_user_phone)):
    clean_phone = normalize_phone(phone)
    if not clean_phone:
        raise HTTPException(status_code=400, detail="Invalid user identifier")

    return update_user_info(clean_phone, info)


@router.put("/api/user/info/{phone}")
def update_user_info(phone: str, info: UserInfoUpdate):
    """Оновлення профілю. phone у path може бути google_*/fb_* для соц. юзерів."""
    clean_phone = normalize_phone(phone)
    if not clean_phone:
        raise HTTPException(status_code=400, detail="Invalid user identifier")

    conn = get_db_connection()
    try:
        cur = conn.cursor()

        cur.execute("SELECT 1 FROM users WHERE phone = ?", (clean_phone,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="User not found")

        if info.phone is not None and info.phone.strip():
            new_phone = "".join(filter(str.isdigit, info.phone.strip()))
            if not new_phone:
                raise HTTPException(status_code=400, detail="Invalid phone number")

            if new_phone != clean_phone and cur.execute("SELECT 1 FROM users WHERE phone = ?", (new_phone,)).fetchone():
                raise HTTPException(status_code=409, detail="Phone already exists")

            cur.execute("UPDATE users SET phone = ? WHERE phone = ?", (new_phone, clean_phone))
            conn.commit()
            clean_phone = new_phone

        update_fields = []
        update_values = []

        if info.name is not None:
            update_fields.append("name = ?")
            update_values.append(info.name)

        if info.city is not None:
            update_fields.append("city = ?")
            update_values.append(info.city)

        if info.warehouse is not None:
            update_fields.append("warehouse = ?")
            update_values.append(clean_warehouse_value(info.warehouse) or info.warehouse.strip())

        if getattr(info, "user_ukrposhta", None) is not None:
            update_fields.append("user_ukrposhta = ?")
            update_values.append(clean_warehouse_value(info.user_ukrposhta) or info.user_ukrposhta.strip())

        if info.email is not None:
            update_fields.append("email = ?")
            update_values.append(info.email)

        if info.contact_preference is not None:
            update_fields.append("contact_preference = ?")
            update_values.append(info.contact_preference)

        if update_fields:
            update_values.append(clean_phone)
            cur.execute(f"""
                UPDATE users
                SET {', '.join(update_fields)}
                WHERE phone = ?
            """, tuple(update_values))
            conn.commit()
            logger.info("Updated user info: phone=%s email=%s contact=%s", clean_phone, info.email, info.contact_preference)

        return {"status": "ok"}
    finally:
        conn.close()


@router.post("/api/user/push-token")
def save_push_token(body: PushTokenRequest, background_tasks: BackgroundTasks):
    """Зберігає push-токен для користувача за auth_id. Привітальний пуш тільки якщо клієнт передав send_welcome=True (після sign_up) і ще не надсилався."""
    auth_id = (body.auth_id or "").strip()
    token = (body.token or "").strip()

    if not auth_id or not token:
        raise HTTPException(status_code=400, detail="auth_id and token are required")

    conn = get_db_connection()
    try:
        cur = conn.cursor()
        row = cur.execute("SELECT push_token, welcome_push_sent FROM users WHERE phone = ?", (auth_id,)).fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="User not found")

        cur.execute("UPDATE users SET push_token = ? WHERE phone = ?", (token, auth_id))

        row_dict = dict(row)
        should_send_welcome = bool(getattr(body, "send_welcome", False)) and not row_dict.get("welcome_push_sent")

        if should_send_welcome and token.startswith("ExponentPushToken"):
            cur.execute("UPDATE users SET welcome_push_sent = 1 WHERE phone = ?", (auth_id,))
            background_tasks.add_task(
                send_expo_push,
                token,
                "Вітаємо у DikorosUA 🍄",
                "Дякуємо за реєстрацію! Ваш бонус уже чекає у профілі.",
            )

        conn.commit()
        return {"status": "success"}
    finally:
        conn.close()
