"""Orders API router."""

from __future__ import annotations

import csv
import logging
import json
import os
from datetime import datetime
from io import StringIO

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse

from db import DATABASE_URL, get_db_connection
from models.schemas import BatchDelete, OrderRequest, OrderStatusUpdate
from services.notifications import send_expo_push
from services.onebox_api import OneBoxDbSession, Product, create_onebox_order
from services.cashback import calculate_order_cashback
from services.users import calculate_cumulative_discount_percent, clean_warehouse_value, normalize_phone
from services.analytics import track_analytics_event
from services.auth import get_current_user_phone


router = APIRouter()
logger = logging.getLogger(__name__)


def _apply_completed_order_rewards(conn, cur, order_dict: dict, order_id: int) -> int:
    """Apply paid spend and cashback exactly once for a completed order."""
    if bool(order_dict.get("cashback_applied")):
        return int(order_dict.get("cashback_earned") or 0)

    # Only authenticated checkout writes user_phone. Guest buyer phone must not
    # grant account rewards merely because it matches an existing account.
    user_phone = normalize_phone(order_dict.get("user_phone") or "")
    try:
        paid_total = max(0.0, round(float(order_dict.get("total_price") or 0), 2))
    except (TypeError, ValueError):
        paid_total = 0.0

    cashback_amount = 0
    if user_phone:
        user = cur.execute(
            "SELECT bonus_balance, total_spent FROM users WHERE phone = ? FOR UPDATE",
            (user_phone,),
        ).fetchone()
        if user:
            current_total_spent = float(user.get("total_spent") or 0)
            new_total_spent = round(current_total_spent + paid_total, 2)
            cumulative_discount = calculate_cumulative_discount_percent(new_total_spent)
            order_items = order_dict.get("items") or []
            if isinstance(order_items, str):
                try:
                    order_items = json.loads(order_items)
                except (json.JSONDecodeError, TypeError):
                    order_items = []
            cashback_amount = calculate_order_cashback(conn, order_items)
            cur.execute(
                """
                UPDATE users
                SET bonus_balance = COALESCE(bonus_balance, 0) + ?,
                    total_spent = ?,
                    cashback_percent = ?
                WHERE phone = ?
                """,
                (cashback_amount, new_total_spent, cumulative_discount, user_phone),
            )

    cur.execute(
        "UPDATE orders SET cashback_earned = ?, cashback_applied = TRUE WHERE id = ?",
        (cashback_amount, order_id),
    )
    logger.info(
        "Order rewards applied: order_id=%s user_phone=%s paid_total=%s cashback_earned=%s",
        order_id,
        user_phone or None,
        paid_total,
        cashback_amount,
    )
    return cashback_amount


# 2. ЗАКАЗЫ
@router.get("/api/orders")
def get_orders_api():
    conn = get_db_connection()
    rows = conn.execute("SELECT * FROM orders ORDER BY id DESC").fetchall()
    res = []
    for r in rows:
        d = dict(r)
        total = d.get("total_price") or d.get("total") or d.get("totalprice") or d.get("totalPrice") or 0
        d["total_price"] = total
        d["totalPrice"] = total
        d["totalprice"] = total
        try:
            d["items"] = json.loads(d["items"])
        except (json.JSONDecodeError, TypeError, KeyError):
            d["items"] = []
        res.append(d)
    conn.close()
    return res

@router.get("/api/orders/{order_id}")
def get_order_by_id(order_id: int):
    """Возвращает один заказ по id для админки (детали, доставка)."""
    conn = get_db_connection()
    row = conn.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Order not found")
    d = dict(row)
    d["total_price"] = d.get("total_price") or d.get("total") or d.get("totalprice") or d.get("totalPrice") or 0
    try:
        d["items"] = json.loads(d["items"]) if d.get("items") else []
    except Exception:
        d["items"] = []
    return d

@router.post("/legacy/create_order_disabled")
async def create_order(order: OrderRequest, background_tasks: BackgroundTasks):
    raise HTTPException(status_code=410, detail="Legacy checkout is disabled. Use secure SMS checkout.")
    conn = None
    """
    Создание нового заказа:
    1. Сохранение в БД
    2. Создание/обновление пользователя
    3. Отправка в Apix-Drive для синхронизации с OneBox
    """
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        # Очищаем номер телефона
        clean_phone = normalize_phone(order.phone)
        user_phone = normalize_phone(order.user_phone) if order.user_phone else clean_phone
        
        # Проверяем/создаем пользователя
        user = cur.execute("SELECT * FROM users WHERE phone=?", (user_phone,)).fetchone()
        
        if not user:
            # Создаем нового пользователя
            cur.execute("""
                INSERT INTO users (phone, name, bonus_balance, total_spent, cashback_percent)
                VALUES (?, ?, 0, 0, 0)
            """, (user_phone, order.name))
            logger.info("Created new user: %s", user_phone)
            available_bonus_balance = 0
        else:
            user_dict = dict(user)
            available_bonus_balance = int(user_dict.get("bonus_balance") or 0)

        if order.use_bonuses and order.bonus_used > available_bonus_balance:
            raise HTTPException(status_code=400, detail="Not enough bonus balance")
        
        # Бонусы списываем только при наложенном платеже — здесь. При оплате картой — в payment_callback_monobank после успешной оплаты.
        
        # Обновляем профиль пользователя (name, city, warehouse, email, contact_preference)
        update_fields = []
        update_values = []
        
        if order.name:
            update_fields.append("name = ?")
            update_values.append(order.name)
        
        if order.city:
            update_fields.append("city = ?")
            update_values.append(order.city)
        
        # Зберігаємо тільки назву/номер відділення без префіксів "Нова почта" / "Укрпошта"
        is_ukrposhta = (order.delivery_method or "").strip().lower() == "ukrposhta"
        if is_ukrposhta and order.warehouse:
            cleaned_ukr = clean_warehouse_value(order.warehouse) or order.warehouse.strip()
            update_fields.append("user_ukrposhta = ?")
            update_values.append(cleaned_ukr)
        elif order.warehouse:
            cleaned_wh = clean_warehouse_value(order.warehouse) or order.warehouse.strip()
            update_fields.append("warehouse = ?")
            update_values.append(cleaned_wh)
        
        if order.email:
            update_fields.append("email = ?")
            update_values.append(order.email)
        
        if order.contact_preference:
            update_fields.append("contact_preference = ?")
            update_values.append(order.contact_preference)
        
        if update_fields:
            update_values.append(user_phone)
            cur.execute(f"""
                UPDATE users 
                SET {', '.join(update_fields)}
                WHERE phone = ?
            """, tuple(update_values))
            logger.info("Updated user profile: phone=%s", user_phone)
        
        # Сериализуем items в JSON
        items_json = json.dumps([{
            "id": item.id,
            "product_id": (item.product_id or item.id),
            "name": item.name,
            "price": item.price,
            "quantity": item.quantity,
            "packSize": item.packSize,
            "unit": item.unit,
            "variant_info": item.variant_info
        } for item in order.items])
        
        # У заказ зберігаємо тільки значення (без префіксу "Нова Пошта:" / "Укрпошта:")
        warehouse_for_order = (clean_warehouse_value(order.warehouse) or order.warehouse or "").strip()
        delivery_method = (order.delivery_method or "nova_poshta").strip().lower()
        is_ukrposhta_order = delivery_method == "ukrposhta"
        order_warehouse = warehouse_for_order if not is_ukrposhta_order else ""
        order_user_ukrposhta = warehouse_for_order if is_ukrposhta_order else ""

        # Создаем заказ
        push_token = getattr(order, 'push_token', None) or None
        row = cur.execute("""
            INSERT INTO orders (
                name, phone, user_phone, email, contact_preference, city, city_ref, warehouse, warehouse_ref,
                delivery_method, user_ukrposhta, push_token,
                items, total_price, payment_method, bonus_used, status, date
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            RETURNING id
        """, (
            order.name,
            clean_phone,
            user_phone,
            order.email or '',
            order.contact_preference or 'call',
            order.city,
            getattr(order, 'cityRef', ''),
            order_warehouse,
            getattr(order, 'warehouseRef', ''),
            delivery_method,
            order_user_ukrposhta or None,
            push_token,
            items_json,
            order.totalPrice,
            order.payment_method,
            order.bonus_used,
            "Pending",
            datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        )).fetchone()
        order_id = (row or {}).get("id")
        conn.commit()
        
        # Списание бонусов только при «Оплата при отриманні» (наложенный платёж). При оплате картой — в payment_callback после успешной оплаты.
        is_fully_paid_by_bonuses = order.use_bonuses and order.bonus_used > 0 and float(order.totalPrice or 0) <= 0

        if (order.payment_method == "cash" or is_fully_paid_by_bonuses) and order.use_bonuses and order.bonus_used > 0:
            cur.execute("""
                UPDATE users 
                SET bonus_balance = GREATEST(bonus_balance - ?, 0) 
                WHERE phone = ?
            """, (order.bonus_used, user_phone))
            if is_fully_paid_by_bonuses:
                paid_status = "\u041e\u043f\u043b\u0430\u0447\u0435\u043d\u043e"
                cur.execute("UPDATE orders SET status=? WHERE id=?", (paid_status, order_id))

            conn.commit()

            try:
                order_items = json.loads(order_dict.get("items") or "[]")
                purchase_items = [
                    {
                        "item_id": str(item.get("id") or item.get("product_id") or ""),
                        "item_name": item.get("name") or "",
                        "price": float(item.get("price") or 0),
                        "quantity": int(item.get("quantity") or 1),
                        "item_variant": item.get("variant_info") or item.get("packSize") or item.get("unit") or "шт",
                    }
                    for item in order_items
                ]

                await track_analytics_event(
                    "purchase",
                    {
                        "event_id": f"purchase_{order_id}",
                        "transaction_id": str(order_id),
                        "value": float(order_dict.get("total_price") or 0),
                        "currency": "UAH",
                        "content_type": "product",
                        "content_ids": [item.get("id") or item.get("product_id") for item in order_items],
                        "num_items": sum(int(item.get("quantity") or 1) for item in order_items),
                        "items": purchase_items,
                        "payment_method": order_dict.get("payment_method") or "card",
                    },
                    {
                        "phone": order_dict.get("user_phone") or order_dict.get("phone"),
                        "email": order_dict.get("email"),
                        "user_agent": "Monobank Callback",
                    },
                )
            except Exception as analytics_err:
                logger.warning("Card purchase analytics failed: %s", analytics_err)
            logger.info("Bonuses deducted immediately: phone=%s amount=%s order_id=%s", user_phone, order.bonus_used, order_id)
        
        conn.close()
        
        logger.info("Order created successfully: order_id=%s", order_id)
        
        # Пуш про успішне оформлення замовлення (фоном, щоб не гальмувати відповідь)
        _push_token = (push_token or "").strip()
        if not _push_token and user_phone:
            conn_reopen = get_db_connection()
            user_row = conn_reopen.execute("SELECT push_token FROM users WHERE phone = ?", (user_phone,)).fetchone()
            conn_reopen.close()
            if user_row:
                _push_token = (user_row.get("push_token") or "").strip()
        if _push_token and _push_token.startswith("ExponentPushToken"):
            background_tasks.add_task(_send_order_created_push_task, _push_token, order_id)
        
        # Подготавливаем данные для Apix-Drive (для Укрпочты: warehouse = полная строка "индекс, город, адрес", user_ukrposhta дублирует для ясности)
        order_data = {
            "id": order_id,
            "name": order.name,
            "phone": clean_phone,
            "user_phone": user_phone,
            "city": order.city,
            "warehouse": order_warehouse or order.warehouse or "",
            "user_ukrposhta": order_user_ukrposhta or None,
            "delivery_method": delivery_method,
            "comment": order.comment or order.comments or order.note or "",
            "comments": order.comment or order.comments or order.note or "",
            # Strict OneBox mapping: pass db session + Product marker + items with product_id
            "db": OneBoxDbSession(DATABASE_URL),
            "Product": Product,
            "items": [{
                "product_id": (item.product_id or item.id),
                "name": item.name,
                "price": item.price,
                "quantity": item.quantity,
                "packSize": item.packSize,
                "unit": item.unit,
            } for item in order.items],
            "totalPrice": order.totalPrice,
            "payment_method": order.payment_method,
            "bonus_used": order.bonus_used,
            "status": "Pending",
            "date": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        }
        
        # Отправляем в OneBox CRM напрямую
        background_tasks.add_task(create_onebox_order, order_data)
        
        response_data = {
            "status": "ok",
            "order_id": order_id,
            "message": "Заказ успешно создан"
        }
        
        # Интеграция Монобанка: при оплате картой создаём инвойс и возвращаем ссылку на оплату
        if order.payment_method == "card" and float(order.totalPrice or 0) > 0:
            token = os.getenv("MONOBANK_API_TOKEN")
            if token:
                amount_kopiyky = int(float(order.totalPrice) * 100)
                payload = {
                    "amount": amount_kopiyky,
                    "ccy": 980,
                    "merchantPaymInfo": {
                        "reference": str(order_id),
                        "destination": f"Оплата замовлення №{order_id}"
                    },
                    "webHookUrl": "https://app.dikoros.ua/api/payment/callback",
                    "redirectUrl": order.return_url or "https://dikoros.ua",
                }
                try:
                    async with httpx.AsyncClient() as client:
                        mono_resp = await client.post(
                            "https://api.monobank.ua/api/merchant/invoice/create",
                            headers={"X-Token": token},
                            json=payload,
                            timeout=15.0
                        )
                        mono_resp.raise_for_status()
                        mono_data = mono_resp.json()
                        page_url = mono_data.get("pageUrl")
                        if page_url:
                            response_data["pageUrl"] = page_url
                            logger.info("Monobank invoice created: order_id=%s", order_id)
                        else:
                            logger.warning("Monobank response without pageUrl: %s", mono_data)
                except Exception as mono_err:
                    logger.warning("Monobank request failed: %s", mono_err)
            else:
                logger.warning("MONOBANK_API_TOKEN is not set, payment URL was not created")
        
        return response_data
        
    except Exception as e:
        logger.exception("Failed to create order")
        if conn is not None:
            try:
                conn.rollback()
            except Exception:
                pass
            try:
                conn.close()
            except Exception:
                pass
        raise HTTPException(status_code=500, detail=f"Ошибка создания заказа: {str(e)}")


@router.post("/api/payment/callback")
async def payment_callback_monobank(request: Request):
    """
    Вебхук від Монобанка: при успішній оплаті оновлюємо статус замовлення на «Оплачено»
    та списуємо бонуси з балансу користувача (якщо замовлення було з use_bonuses).
    """
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")
    status = body.get("status")
    if status != "success":
        return {"status": "ignored", "reason": f"status is {status}"}
    reference = body.get("reference") or (body.get("merchantPaymInfo") or {}).get("reference")
    if not reference:
        return {"status": "error", "reason": "missing reference"}
    try:
        order_id = int(reference)
    except (TypeError, ValueError):
        return {"status": "error", "reason": "invalid reference"}
    conn = get_db_connection()
    try:
        cur = conn.cursor()
        order = cur.execute(
            """
            SELECT id, user_phone, phone, email, bonus_used, status, total_price, items,
                   payment_method, cashback_applied, cashback_earned
            FROM orders WHERE id=? FOR UPDATE
            """,
            (order_id,),
        ).fetchone()
        if not order:
            return {"status": "error", "reason": "order not found"}

        order_dict = dict(order)
        old_status = order_dict.get("status")
        user_phone = order_dict.get("user_phone")
        bonus_used = order_dict.get("bonus_used") or 0

        if old_status == "Оплачено" and order_dict.get("cashback_applied"):
            return {"status": "ok", "reason": "already processed"}

        if old_status != "Оплачено" and user_phone and bonus_used > 0:
            cur.execute("""
                UPDATE users
                SET bonus_balance = GREATEST(bonus_balance - ?, 0)
                WHERE phone = ?
            """, (bonus_used, user_phone))
            logger.info("Bonuses deducted after card payment: phone=%s amount=%s", user_phone, bonus_used)

        cur.execute("UPDATE orders SET status=? WHERE id=?", ("Оплачено", order_id))
        _apply_completed_order_rewards(conn, cur, order_dict, order_id)
        conn.commit()

        try:
            order_items = json.loads(order_dict.get("items") or "[]")
            purchase_items = [
                {
                    "item_id": str(item.get("id") or item.get("product_id") or ""),
                    "item_name": item.get("name") or "",
                    "price": float(item.get("price") or 0),
                    "quantity": int(item.get("quantity") or 1),
                    "item_variant": item.get("variant_info") or item.get("packSize") or item.get("unit") or "\u0448\u0442",
                }
                for item in order_items
            ]

            await track_analytics_event(
                "purchase",
                {
                    "event_id": f"purchase_{order_id}",
                    "transaction_id": str(order_id),
                    "value": float(order_dict.get("total_price") or 0),
                    "currency": "UAH",
                    "content_type": "product",
                    "content_ids": [item.get("id") or item.get("product_id") for item in order_items],
                    "num_items": sum(int(item.get("quantity") or 1) for item in order_items),
                    "items": purchase_items,
                    "payment_method": order_dict.get("payment_method") or "card",
                },
                {
                    "phone": order_dict.get("user_phone") or order_dict.get("phone"),
                    "email": order_dict.get("email"),
                    "user_agent": "Monobank Callback",
                },
            )
        except Exception as analytics_err:
            logger.warning("Card purchase analytics failed: %s", analytics_err)
    finally:
        conn.close()
    logger.info("Monobank payment confirmed: order_id=%s", order_id)
    return {"status": "ok"}


# Статусы заказа, при смене на которые отправляем пуш клиенту
ORDER_STATUSES_FOR_PUSH = {"Отправлен", "В обработке", "Доставлен", "Виконано", "Выполнен", "Completed", "Delivered"}


def _send_order_created_push_task(push_token: str, order_id: int) -> None:
    """Фонова задача: пуш про успішне оформлення замовлення."""
    send_expo_push(
        push_token,
        title="Замовлення оформлено! 🍄",
        body="Дякуємо за замовлення, ми зв'яжемося з вами найближчим часом!",
    )


def _send_order_status_push_task(push_token: str, new_status: str) -> None:
    """Фонова задача: пуш про зміну статусу замовлення."""
    send_expo_push(
        push_token,
        title="Оновлення замовлення 📦",
        body=f"Ваше замовлення переведено в статус: {new_status}",
    )


@router.put("/orders/{id}/status")
async def update_order_status(id: int, status: OrderStatusUpdate, background_tasks: BackgroundTasks):
    conn = get_db_connection()
    try:
        cur = conn.cursor()

        order = cur.execute("SELECT * FROM orders WHERE id=? FOR UPDATE", (id,)).fetchone()
        if not order:
            raise HTTPException(status_code=404, detail="Order not found")

        order_dict = dict(order)
        old_status = order_dict.get("status")
        new_status = status.new_status

        cur.execute("UPDATE orders SET status=? WHERE id=?", (new_status, id))

        if new_status in ORDER_STATUSES_FOR_PUSH:
            push_token = (order_dict.get("push_token") or "").strip()
            if not push_token:
                user_phone = order_dict.get("user_phone") or order_dict.get("phone")
                if user_phone:
                    user_row = cur.execute("SELECT push_token FROM users WHERE phone=?", (user_phone,)).fetchone()
                    if user_row:
                        push_token = (user_row.get("push_token") or "").strip()
            if push_token and push_token.startswith("ExponentPushToken"):
                background_tasks.add_task(_send_order_status_push_task, push_token, new_status)

        final_statuses = {
            "Completed",
            "Delivered",
            "\u0414\u043e\u0441\u0442\u0430\u0432\u043b\u0435\u043d",
            "\u0412\u0438\u043a\u043e\u043d\u0430\u043d\u043e",
            "\u0412\u044b\u043f\u043e\u043b\u043d\u0435\u043d",
        }

        if new_status in final_statuses:
            _apply_completed_order_rewards(conn, cur, order_dict, id)

        conn.commit()
        return {"status": "ok", "message": "Order status updated"}
    finally:
        conn.close()


# --- API aliases (some deployments allow only /api/*) ---
@router.put("/api/orders/{id}/status")
async def update_order_status_api(id: int, status: OrderStatusUpdate, background_tasks: BackgroundTasks):
    return await update_order_status(id, status, background_tasks)

@router.delete("/orders/{id}")
async def delete_order(id: int):
    conn = get_db_connection()
    try:
        cur = conn.execute("DELETE FROM orders WHERE id=?", (id,))
        conn.commit()
        deleted_count = getattr(cur, "rowcount", 0)

        if deleted_count == 0:
            raise HTTPException(status_code=404, detail="Order not found")

        return {"status": "ok"}
    finally:
        conn.close()


@router.delete("/api/orders/{id}")
async def delete_order_api(id: int):
    return await delete_order(id)

@router.post("/orders/delete-batch")
async def delete_orders_batch(batch: BatchDelete):
    if not batch.ids:
        return {"status": "ok", "deleted": 0}

    conn = get_db_connection()
    try:
        placeholders = ",".join("?" for _ in batch.ids)
        cur = conn.execute(f"DELETE FROM orders WHERE id IN ({placeholders})", batch.ids)
        conn.commit()
        deleted_count = getattr(cur, "rowcount", 0)
        return {"status": "ok", "deleted": deleted_count}
    finally:
        conn.close()


@router.post("/api/orders/delete-batch")
async def delete_orders_batch_api(batch: BatchDelete):
    return await delete_orders_batch(batch)

@router.get("/orders/export")
def export_orders():
    conn = get_db_connection()
    rows = conn.execute("SELECT * FROM orders ORDER BY id DESC").fetchall()
    conn.close()
    
    output = StringIO()
    writer = csv.writer(output)
    writer.writerow(['ID', 'Date', 'Name', 'Phone', 'Total', 'Status', 'Items'])
    
    for r in rows:
        writer.writerow([
            r.get('id'),
            r.get('date'),
            r.get('name'),
            r.get('phone'),
            r.get('total_price') or r.get('totalPrice') or r.get('totalprice') or r.get('total'),
            r.get('status'),
            r.get('items'),
        ])
    
    output.seek(0)
    return StreamingResponse(iter([output.getvalue()]), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=orders.csv"})


@router.get("/api/client/orders/me")
def get_current_client_orders(phone: str = Depends(get_current_user_phone)):
    clean_phone = normalize_phone(phone)
    return _get_client_orders_by_phone(clean_phone)


@router.get("/api/client/orders/{phone}")
def get_client_orders_legacy(phone: str):
    raise HTTPException(
        status_code=410,
        detail="Legacy client orders endpoint is disabled. Use /api/client/orders/me with authorization."
    )


def _get_client_orders_by_phone(phone: str):
    clean_phone = normalize_phone(phone)
    logger.info("Searching client orders: phone=%s", clean_phone)
    conn = get_db_connection()
    # Search by user_phone OR phone column
    rows = conn.execute("SELECT * FROM orders WHERE user_phone=? OR phone=? ORDER BY id DESC", (clean_phone, clean_phone)).fetchall()
    conn.close()
    logger.info("Found client orders: phone=%s count=%s", clean_phone, len(rows))
    res = []
    for r in rows:
        d = dict(r)
        total = d.get("total_price") or d.get("total") or d.get("totalprice") or 0
        d["total_price"] = total
        d["totalPrice"] = total  # для мобильного приложения (camelCase)
        try:
            d["items"] = json.loads(d["items"])
        except (json.JSONDecodeError, TypeError, KeyError):
            d["items"] = []
        res.append(d)
    return res


@router.delete("/api/client/orders/{order_id}")
def delete_client_order(order_id: int):
    raise HTTPException(
        status_code=410,
        detail="Client order deletion is disabled. Orders are preserved for accounting."
    )


@router.delete("/api/client/orders/clear/{phone}")
def clear_client_orders(phone: str):
    raise HTTPException(
        status_code=410,
        detail="Client order history clearing is disabled. Orders are preserved for accounting."
    )
