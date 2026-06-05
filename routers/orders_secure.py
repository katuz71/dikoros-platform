"""Secure checkout route used before the legacy orders router.

This route intentionally does not create a user account during checkout.
Registration/login must happen through SMS verification first.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime

import httpx
from fastapi import APIRouter, BackgroundTasks, HTTPException

from db import DATABASE_URL, get_db_connection
from models.schemas import OrderRequest
from services.notifications import send_expo_push
from services.onebox_api import OneBoxDbSession, Product, create_onebox_order
from services.users import clean_warehouse_value, normalize_phone
from services.analytics import track_analytics_event


router = APIRouter()
logger = logging.getLogger(__name__)


def _send_order_created_push_task(push_token: str, order_id: int) -> None:
    send_expo_push(
        push_token,
        title="Замовлення оформлено! 🍄",
        body="Дякуємо за замовлення, ми зв'яжемося з вами найближчим часом!",
    )


@router.post("/create_order")
async def create_order_secure(order: OrderRequest, background_tasks: BackgroundTasks):
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()

        clean_phone = normalize_phone(order.phone)
        user_phone = normalize_phone(order.user_phone) if order.user_phone else clean_phone

        user = cur.execute("SELECT * FROM users WHERE phone=?", (user_phone,)).fetchone()
        user_dict = dict(user) if user else None
        available_bonus_balance = int((user_dict or {}).get("bonus_balance") or 0)
        is_verified_user = bool(user_dict and user_dict.get("phone_verified"))

        if not user_dict:
            logger.info("Guest checkout without user creation: phone=%s", user_phone)

        if order.use_bonuses and order.bonus_used > available_bonus_balance:
            raise HTTPException(status_code=400, detail="Not enough bonus balance")

        if order.use_bonuses and order.bonus_used > 0 and not is_verified_user:
            raise HTTPException(status_code=401, detail="SMS login is required to use bonuses")

        if user_dict:
            update_fields = []
            update_values = []

            if order.name:
                update_fields.append("name = ?")
                update_values.append(order.name)

            if order.city:
                update_fields.append("city = ?")
                update_values.append(order.city)

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
                cur.execute(
                    f"UPDATE users SET {', '.join(update_fields)} WHERE phone = ?",
                    tuple(update_values),
                )

        items_json = json.dumps([
            {
                "id": item.id,
                "product_id": item.product_id or item.id,
                "name": item.name,
                "price": item.price,
                "quantity": item.quantity,
                "packSize": item.packSize,
                "unit": item.unit,
                "variant_info": item.variant_info,
            }
            for item in order.items
        ])

        warehouse_for_order = (clean_warehouse_value(order.warehouse) or order.warehouse or "").strip()
        delivery_method = (order.delivery_method or "nova_poshta").strip().lower()
        is_ukrposhta_order = delivery_method == "ukrposhta"
        order_warehouse = warehouse_for_order if not is_ukrposhta_order else ""
        order_user_ukrposhta = warehouse_for_order if is_ukrposhta_order else ""

        push_token = getattr(order, "push_token", None) or None
        row = cur.execute(
            """
            INSERT INTO orders (
                name, phone, user_phone, email, contact_preference, city, city_ref, warehouse, warehouse_ref,
                delivery_method, user_ukrposhta, push_token,
                items, total_price, payment_method, bonus_used, status, date
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            RETURNING id
            """,
            (
                order.name,
                clean_phone,
                user_phone,
                order.email or "",
                order.contact_preference or "call",
                order.city,
                getattr(order, "cityRef", ""),
                order_warehouse,
                getattr(order, "warehouseRef", ""),
                delivery_method,
                order_user_ukrposhta or None,
                push_token,
                items_json,
                order.totalPrice,
                order.payment_method,
                order.bonus_used,
                "Pending",
                datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            ),
        ).fetchone()
        order_id = (row or {}).get("id")
        conn.commit()

        if user_dict and order.use_bonuses and order.bonus_used > 0 and order.payment_method == "cash":
            cur.execute(
                "UPDATE users SET bonus_balance = GREATEST(bonus_balance - ?, 0) WHERE phone = ?",
                (order.bonus_used, user_phone),
            )
            conn.commit()

        conn.close()
        conn = None

        _push_token = (push_token or "").strip()
        if not _push_token and user_dict and user_phone:
            conn_reopen = get_db_connection()
            user_row = conn_reopen.execute("SELECT push_token FROM users WHERE phone = ?", (user_phone,)).fetchone()
            conn_reopen.close()
            if user_row:
                _push_token = (user_row.get("push_token") or "").strip()
        if _push_token and _push_token.startswith("ExponentPushToken"):
            background_tasks.add_task(_send_order_created_push_task, _push_token, order_id)

        order_data = {
            "id": order_id,
            "order_id": order_id,
            "name": order.name,
            "phone": clean_phone,
            "user_phone": user_phone if user_dict else "",
            "email": order.email or "",
            "contact_preference": order.contact_preference or "call",
            "city": order.city,
            "cityRef": getattr(order, "cityRef", ""),
            "city_ref": getattr(order, "cityRef", ""),
            "warehouse": order_warehouse or order.warehouse or "",
            "warehouseRef": getattr(order, "warehouseRef", ""),
            "warehouse_ref": getattr(order, "warehouseRef", ""),
            "user_ukrposhta": order_user_ukrposhta or None,
            "delivery_method": delivery_method,
            "bonus_used": order.bonus_used,
            "bonus_balance": available_bonus_balance,
            "return_url": order.return_url or "",
            "db": OneBoxDbSession(DATABASE_URL),
            "Product": Product,
            "items": [
                {
                    "product_id": item.product_id or item.id,
                    "id": item.id,
                    "name": item.name,
                    "price": item.price,
                    "quantity": item.quantity,
                    "packSize": item.packSize,
                    "unit": item.unit,
                    "variant_info": item.variant_info,
                }
                for item in order.items
            ],
            "totalPrice": order.totalPrice,
            "payment_method": order.payment_method,
            "status": "Pending",
            "date": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        }
        background_tasks.add_task(create_onebox_order, order_data)

        response_data = {
            "status": "ok",
            "order_id": order_id,
            "message": "Заказ успешно создан",
            "account_created": False,
            "guest_checkout": not bool(user_dict),
        }

        if order.payment_method == "card" and float(order.totalPrice or 0) > 0:
            token = os.getenv("MONOBANK_API_TOKEN")
            if token:
                payload = {
                    "amount": int(float(order.totalPrice) * 100),
                    "ccy": 980,
                    "merchantPaymInfo": {
                        "reference": str(order_id),
                        "destination": f"Оплата замовлення №{order_id}",
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
                            timeout=15.0,
                        )
                        mono_resp.raise_for_status()
                        page_url = mono_resp.json().get("pageUrl")
                        if page_url:
                            response_data["pageUrl"] = page_url
                except Exception as mono_err:
                    logger.warning("Monobank request failed: %s", mono_err)
            else:
                logger.warning("MONOBANK_API_TOKEN is not set, payment URL was not created")

        if order.payment_method == "cash":
            try:
                order_items = json.loads(items_json or "[]")
                await track_analytics_event(
                    "purchase",
                    {
                        "event_id": f"purchase_{order_id}",
                        "transaction_id": str(order_id),
                        "value": float(order.totalPrice or 0),
                        "currency": "UAH",
                        "content_type": "product",
                        "content_ids": [item.get("id") or item.get("product_id") for item in order_items],
                        "num_items": sum(int(item.get("quantity") or 1) for item in order_items),
                        "items": order_items,
                        "payment_method": order.payment_method,
                    },
                    {
                        "phone": user_phone or clean_phone,
                        "email": order.email,
                        "user_agent": "Mobile App",
                    },
                )
            except Exception as analytics_err:
                logger.warning("Cash purchase analytics failed: %s", analytics_err)

        return response_data

    except HTTPException:
        if conn is not None:
            try:
                conn.rollback()
            except Exception:
                pass
            try:
                conn.close()
            except Exception:
                pass
        raise
    except Exception as exc:
        logger.exception("Failed to create secure order")
        if conn is not None:
            try:
                conn.rollback()
            except Exception:
                pass
            try:
                conn.close()
            except Exception:
                pass
        raise HTTPException(status_code=500, detail=f"Ошибка создания заказа: {str(exc)}")
