"""Order cancellation reward rollback helpers."""

from __future__ import annotations

import logging

from db import get_db_connection
from services.users import calculate_cumulative_discount_percent, normalize_phone

logger = logging.getLogger(__name__)

CANCELLED_ORDER_STATUSES = {"отменен", "отменён", "скасовано", "cancelled", "canceled"}


def is_cancelled_order_status(status: str) -> bool:
    """Return True when a status means that an order is canceled."""
    return str(status or "").strip().casefold() in CANCELLED_ORDER_STATUSES


def cancel_order_and_revert_rewards(order_id: int, new_status: str) -> dict:
    """Cancel order and revert previously applied cashback/spend exactly once."""
    conn = get_db_connection()
    try:
        cur = conn.cursor()
        order = cur.execute(
            """
            SELECT id, user_phone, total_price, cashback_earned, cashback_applied
            FROM orders WHERE id = ? FOR UPDATE
            """,
            (order_id,),
        ).fetchone()
        if not order:
            return {"status": "error", "status_code": 404, "detail": "Order not found"}

        order_dict = dict(order)
        cashback_was_applied = bool(order_dict.get("cashback_applied"))
        cashback_earned = int(order_dict.get("cashback_earned") or 0)
        user_phone = normalize_phone(order_dict.get("user_phone") or "")
        try:
            total_price = max(0.0, round(float(order_dict.get("total_price") or 0), 2))
        except (TypeError, ValueError):
            total_price = 0.0

        rewards_reverted = False
        if cashback_was_applied and user_phone:
            user = cur.execute(
                "SELECT total_spent FROM users WHERE phone = ? FOR UPDATE",
                (user_phone,),
            ).fetchone()
            if user:
                current_total_spent = float(user.get("total_spent") or 0)
                new_total_spent = max(0.0, round(current_total_spent - total_price, 2))
                cumulative_discount = calculate_cumulative_discount_percent(new_total_spent)
                cur.execute(
                    """
                    UPDATE users
                    SET bonus_balance = GREATEST(COALESCE(bonus_balance, 0) - ?, 0),
                        total_spent = ?,
                        cashback_percent = ?
                    WHERE phone = ?
                    """,
                    (cashback_earned, new_total_spent, cumulative_discount, user_phone),
                )
                rewards_reverted = True

        cur.execute(
            """
            UPDATE orders
            SET status = ?, cashback_earned = 0, cashback_applied = FALSE
            WHERE id = ?
            """,
            (new_status, order_id),
        )
        conn.commit()
        logger.info(
            "Order canceled: order_id=%s user_phone=%s cashback_reverted=%s cashback_earned=%s total_price=%s",
            order_id,
            user_phone or None,
            rewards_reverted,
            cashback_earned,
            total_price,
        )
        return {
            "status": "ok",
            "message": "Order status updated",
            "cashback_reverted": rewards_reverted,
        }
    except Exception as exc:
        conn.rollback()
        logger.exception("Failed to cancel order and revert rewards: order_id=%s", order_id)
        return {
            "status": "error",
            "status_code": 500,
            "detail": f"Failed to update order status: {exc}",
        }
    finally:
        conn.close()
