"""Checkout route used before the legacy orders router.

Authenticated users can use profile data and bonuses. Guests can also complete
checkout without creating an account; guest checkout never creates a user and
never allows bonus usage.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime
from typing import Optional

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from db import DATABASE_URL, get_db_connection
from models.schemas import OrderRequest
from services.auth import get_optional_current_user_phone
from services.cashback import get_global_cashback_percent, normalize_cashback_percent
from services.notifications import send_expo_push
from services.onebox_api import OneBoxDbSession, Product, create_onebox_order
from services.users import calculate_cumulative_discount_percent, clean_warehouse_value, normalize_phone
from services.analytics import track_analytics_event


MIN_ORDER_AMOUNT = 200

router = APIRouter()
logger = logging.getLogger(__name__)


def _send_order_created_push_task(push_token: str, order_id: int) -> None:
    send_expo_push(
        push_token,
        title="Замовлення оформлено! 🍄",
        body="Дякуємо за замовлення, ми зв'яжемося з вами найближчим часом!",
    )


def _round_money(value: float) -> float:
    return round(max(0.0, float(value or 0)), 2)


def _is_unavailable_status(value) -> bool:
    status = str(value or "").strip().lower()
    return any(
        marker in status
        for marker in (
            "out_of_stock",
            "not_available",
            "unavailable",
            "disabled",
            "відсутній",
            "немає в наявності",
            "нет в наличии",
        )
    )


def _resolve_order_items(conn, cur, order: OrderRequest) -> tuple[list[dict], float]:
    """Resolve every order item against current catalog rows and prices."""
    resolved_items: list[dict] = []
    subtotal = 0.0
    global_cashback_percent = get_global_cashback_percent(conn)

    for requested in order.items or []:
        product_id = int(requested.product_id or requested.id or 0)
        quantity = int(requested.quantity or 0)
        if product_id <= 0 or quantity <= 0:
            raise HTTPException(status_code=400, detail="Invalid order item")

        product = cur.execute(
            "SELECT id, name, price, unit, status, cashback_percent FROM products WHERE id = ?",
            (product_id,),
        ).fetchone()
        if not product or float(product.get("price") or 0) <= 0:
            raise HTTPException(status_code=400, detail=f"Product {product_id} is unavailable")
        if _is_unavailable_status(product.get("status")):
            raise HTTPException(status_code=400, detail=f"Product {product_id} is out of stock")

        unit_price = _round_money(product.get("price") or 0)
        subtotal += unit_price * quantity
        resolved_items.append(
            {
                "id": int(product.get("id") or product_id),
                "product_id": int(product.get("id") or product_id),
                "name": product.get("name") or requested.name,
                "price": unit_price,
                "quantity": quantity,
                "cashback_percent": normalize_cashback_percent(
                    product.get("cashback_percent"),
                    global_cashback_percent,
                ),
                "packSize": requested.packSize,
                "unit": product.get("unit") or requested.unit,
                "variant_info": requested.variant_info,
            }
        )

    return resolved_items, _round_money(subtotal)


def _calculate_promo_discount(cur, promo_code: str | None, subtotal: float) -> float:
    code = str(promo_code or "").strip().upper()
    if not code:
        return 0.0

    row = cur.execute("SELECT * FROM promo_codes WHERE code = ?", (code,)).fetchone()
    if not row or not bool(row.get("active")):
        raise HTTPException(status_code=400, detail="Промокод неактивний або не знайдений")

    expires_at = row.get("expires_at")
    if expires_at:
        try:
            expires = datetime.fromisoformat(str(expires_at).replace("Z", "+00:00"))
            now = datetime.now(expires.tzinfo) if expires.tzinfo else datetime.now()
            if now > expires:
                raise HTTPException(status_code=400, detail="Термін дії промокоду закінчився")
        except HTTPException:
            raise
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="Промокод має некоректний термін дії")

    max_uses = int(row.get("max_uses") or 0)
    current_uses = int(row.get("current_uses") or 0)
    if max_uses > 0 and current_uses >= max_uses:
        raise HTTPException(status_code=400, detail="Промокод вичерпано")

    percent = max(0, min(100, int(row.get("discount_percent") or 0)))
    fixed_amount = _round_money(row.get("discount_amount") or 0)
    discount = subtotal * percent / 100 if percent > 0 else fixed_amount
    return min(subtotal, _round_money(discount))


@router.post("/create_order")
async def create_order_secure(
    order: OrderRequest,
    background_tasks: BackgroundTasks,
    current_user_phone: Optional[str] = Depends(get_optional_current_user_phone),
):
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        resolved_items, subtotal_price = _resolve_order_items(conn, cur, order)
        if subtotal_price < MIN_ORDER_AMOUNT:
            raise HTTPException(
                status_code=400,
                detail=f"Мінімальна сума замовлення — {MIN_ORDER_AMOUNT} грн. Додайте товарів у кошик.",
            )

        clean_phone = normalize_phone(order.phone)
        requested_user_phone = normalize_phone(order.user_phone) if order.user_phone else clean_phone
        token_phone = normalize_phone(current_user_phone) if current_user_phone else None
        is_authenticated_checkout = bool(token_phone)
        user_phone = token_phone if is_authenticated_checkout else None

        if token_phone and token_phone != requested_user_phone:
            raise HTTPException(status_code=403, detail="Order user does not match authenticated user")

        user = None
        user_dict = None
        available_bonus_balance = 0
        cumulative_discount_percent = 0

        if is_authenticated_checkout:
            user = cur.execute("SELECT * FROM users WHERE phone=?", (user_phone,)).fetchone()
            user_dict = dict(user) if user else None
            available_bonus_balance = int((user_dict or {}).get("bonus_balance") or 0)
            cumulative_discount_percent = calculate_cumulative_discount_percent(
                float((user_dict or {}).get("total_spent") or 0)
            )
            is_verified_user = bool(user_dict and user_dict.get("phone_verified"))

            if not is_verified_user:
                raise HTTPException(status_code=401, detail="SMS login is required before checkout")

            if order.use_bonuses and order.bonus_used > available_bonus_balance:
                raise HTTPException(status_code=400, detail="Not enough bonus balance")
        else:
            if order.use_bonuses or order.bonus_used:
                raise HTTPException(status_code=401, detail="Login is required to use bonuses")
            order.use_bonuses = False
            order.bonus_used = 0

        promo_discount_amount = _calculate_promo_discount(cur, order.promo_code, subtotal_price)
        price_after_promo = _round_money(subtotal_price - promo_discount_amount)
        cumulative_discount_amount = _round_money(
            price_after_promo * cumulative_discount_percent / 100
        )
        price_after_cumulative_discount = _round_money(
            price_after_promo - cumulative_discount_amount
        )
        bonus_used = 0
        if is_authenticated_checkout and order.use_bonuses:
            requested_bonus = max(0, int(order.bonus_used or 0))
            bonus_used = min(requested_bonus, available_bonus_balance, int(price_after_cumulative_discount))
        final_total = _round_money(price_after_cumulative_discount - bonus_used)

        update_fields = []
        update_values = []

        if is_authenticated_checkout:
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

        items_json = json.dumps(resolved_items, ensure_ascii=False)

        warehouse_for_order = (clean_warehouse_value(order.warehouse) or order.warehouse or "").strip()
        delivery_method = (order.delivery_method or "nova_poshta").strip().lower()
        is_ukrposhta_order = delivery_method == "ukrposhta_branch"
        order_warehouse = warehouse_for_order if not is_ukrposhta_order else ""
        order_user_ukrposhta = warehouse_for_order if is_ukrposhta_order else ""

        push_token = getattr(order, "push_token", None) or None
        row = cur.execute(
            """
            INSERT INTO orders (
                name, phone, user_phone, email, contact_preference, city, city_ref, warehouse, warehouse_ref,
                delivery_method, user_ukrposhta, push_token,
                items, subtotal_price, cumulative_discount_percent, cumulative_discount_amount,
                total_price, payment_method, bonus_used, status, date
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                subtotal_price,
                cumulative_discount_percent,
                cumulative_discount_amount,
                final_total,
                order.payment_method,
                bonus_used,
                "Pending",
                datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            ),
        ).fetchone()
        order_id = (row or {}).get("id")
        conn.commit()

        if is_authenticated_checkout and bonus_used > 0 and order.payment_method != "card":
            cur.execute(
                "UPDATE users SET bonus_balance = GREATEST(bonus_balance - ?, 0) WHERE phone = ?",
                (bonus_used, user_phone),
            )
            conn.commit()
            logger.info("Bonuses deducted on checkout: phone=%s amount=%s order_id=%s", user_phone, bonus_used, order_id)

        conn.close()
        conn = None

        _push_token = (push_token or "").strip()
        if not _push_token and is_authenticated_checkout and user_phone:
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
            "last_name": order.last_name or "",
            "middle_name": order.middle_name or "",
            "client_full_name": order.client_full_name or "",
            "recipient_name": order.recipient_name or "",
            "recipient_phone": order.recipient_phone or "",
            "do_not_call": bool(order.do_not_call),
            "phone": clean_phone,
            "user_phone": user_phone,
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
            "bonus_used": bonus_used,
            "bonus_balance": available_bonus_balance,
            "subtotal_price": subtotal_price,
            "promo_discount_amount": promo_discount_amount,
            "cumulative_discount_percent": cumulative_discount_percent,
            "cumulative_discount_amount": cumulative_discount_amount,
            "guest_checkout": not is_authenticated_checkout,
            "return_url": order.return_url or "",
            "comment": order.comment or order.comments or order.note or "",
            "comments": order.comment or order.comments or order.note or "",
            "db": OneBoxDbSession(DATABASE_URL),
            "Product": Product,
            "items": resolved_items,
            "totalPrice": final_total,
            "payment_method": order.payment_method,
            "status": "Pending",
            "date": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        }
        safe_order_data = {
            "id": order_data.get("id"),
            "order_id": order_data.get("order_id"),
            "name_present": bool(order_data.get("name")),
            "phone_present": bool(order_data.get("phone")),
            "user_phone_present": bool(order_data.get("user_phone")),
            "email_present": bool(order_data.get("email")),
            "contact_preference": order_data.get("contact_preference"),
            "city": order_data.get("city"),
            "city_ref_present": bool(order_data.get("city_ref") or order_data.get("cityRef")),
            "warehouse": order_data.get("warehouse"),
            "warehouse_ref_present": bool(order_data.get("warehouse_ref") or order_data.get("warehouseRef")),
            "delivery_method": order_data.get("delivery_method"),
            "payment_method": order_data.get("payment_method"),
            "comment_present": bool(order_data.get("comment") or order_data.get("comments")),
            "bonus_used": order_data.get("bonus_used"),
            "bonus_balance_present": order_data.get("bonus_balance") is not None,
            "guest_checkout": order_data.get("guest_checkout"),
            "items_count": len(order_data.get("items") or []),
            "totalPrice": order_data.get("totalPrice"),
        }
        logger.info("[Order] OneBox sanitized order_data: %s", json.dumps(safe_order_data, ensure_ascii=False))

        background_tasks.add_task(create_onebox_order, order_data)

        response_data = {
            "status": "ok",
            "order_id": order_id,
            "message": "Замовлення успішно створено",
            "account_created": False,
            "guest_checkout": not is_authenticated_checkout,
            "subtotal_price": subtotal_price,
            "promo_discount_amount": promo_discount_amount,
            "cumulative_discount_percent": cumulative_discount_percent,
            "cumulative_discount_amount": cumulative_discount_amount,
            "bonus_used": bonus_used,
            "total_price": final_total,
        }

        if order.payment_method == "card" and final_total > 0:
            token = os.getenv("MONOBANK_API_TOKEN")
            if not token:
                logger.error("MONOBANK_API_TOKEN is not set, card order cannot be paid")
                raise HTTPException(status_code=503, detail="Card payment is temporarily unavailable")

            payload = {
                "amount": int(final_total * 100),
                "ccy": 980,
                "merchantPaymInfo": {
                    "reference": str(order_id),
                    "destination": f"Оплата замовлення №{order_id}",
                },
                "webHookUrl": "https://app.dikoros.ua/api/payment/callback",
                "redirectUrl": order.return_url or "https://dikoros.ua",
            }

            page_url = None
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
            except Exception as mono_err:
                logger.warning("Monobank request failed: %s", mono_err)
                raise HTTPException(status_code=502, detail="Failed to create card payment invoice")

            if not page_url:
                logger.warning("Monobank response did not include pageUrl for order_id=%s", order_id)
                raise HTTPException(status_code=502, detail="Card payment invoice was not created")

            response_data["pageUrl"] = page_url

        if order.payment_method != "card":
            try:
                order_items = json.loads(items_json or "[]")
                await track_analytics_event(
                    "purchase",
                    {
                        "event_id": f"purchase_{order_id}",
                        "transaction_id": str(order_id),
                        "value": final_total,
                        "currency": "UAH",
                        "content_type": "product",
                        "content_ids": [item.get("id") or item.get("product_id") for item in order_items],
                        "num_items": sum(int(item.get("quantity") or 1) for item in order_items),
                        "items": order_items,
                        "payment_method": order.payment_method,
                        "guest_checkout": not is_authenticated_checkout,
                    },
                    {
                        "phone": user_phone or clean_phone,
                        "email": order.email,
                        "user_agent": "Mobile App",
                    },
                )
            except Exception as analytics_err:
                logger.warning("Purchase analytics failed: %s", analytics_err)

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
