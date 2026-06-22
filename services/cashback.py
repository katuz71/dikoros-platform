"""Global cashback settings stored independently from cumulative discounts."""

from __future__ import annotations

from decimal import Decimal, InvalidOperation

from db import get_db_connection


GLOBAL_CASHBACK_KEY = "global_cashback_percent"
DEFAULT_GLOBAL_CASHBACK_PERCENT = 5


def _clamp_percent(percent) -> int:
    try:
        normalized = int(float(percent))
    except (TypeError, ValueError):
        normalized = DEFAULT_GLOBAL_CASHBACK_PERCENT
    return max(0, min(100, normalized))


def normalize_cashback_percent(percent, default=DEFAULT_GLOBAL_CASHBACK_PERCENT) -> int:
    """Return a product/global cashback rate constrained to 0..100."""
    if percent is None:
        percent = default
    try:
        normalized = int(float(percent))
    except (TypeError, ValueError):
        normalized = _clamp_percent(default)
    return max(0, min(100, normalized))


def get_global_cashback_percent(conn=None) -> int:
    """Return the global cashback rate, using 5% if the setting is unavailable."""
    owns_connection = conn is None
    connection = conn or get_db_connection()
    try:
        row = connection.execute(
            "SELECT value FROM app_settings WHERE key = ?",
            (GLOBAL_CASHBACK_KEY,),
        ).fetchone()
        return _clamp_percent((row or {}).get("value") if row else None)
    finally:
        if owns_connection:
            connection.close()


def set_global_cashback_percent(percent) -> int:
    """Persist and return a clamped global cashback rate."""
    normalized = _clamp_percent(percent)
    conn = get_db_connection()
    try:
        conn.execute(
            """
            INSERT INTO app_settings (key, value)
            VALUES (?, ?)
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
            """,
            (GLOBAL_CASHBACK_KEY, str(normalized)),
        )
        conn.commit()
        return normalized
    finally:
        conn.close()


def calculate_order_cashback(conn, items) -> int:
    """Calculate cashback from product rates captured on the order items."""
    global_percent = get_global_cashback_percent(conn)
    total_cashback = Decimal("0")

    for item in items or []:
        if not isinstance(item, dict):
            continue

        percent_value = item.get("cashback_percent")
        if percent_value is None:
            product_id = item.get("product_id") or item.get("id")
            try:
                normalized_product_id = int(product_id or 0)
            except (TypeError, ValueError):
                normalized_product_id = 0

            if normalized_product_id > 0:
                product = conn.execute(
                    "SELECT cashback_percent FROM products WHERE id = ?",
                    (normalized_product_id,),
                ).fetchone()
                if product and product.get("cashback_percent") is not None:
                    percent_value = product.get("cashback_percent")

        percent = normalize_cashback_percent(percent_value, global_percent)
        try:
            price = max(Decimal("0"), Decimal(str(item.get("price") or 0)))
            quantity = max(Decimal("0"), Decimal(str(item.get("quantity") or 0)))
        except (InvalidOperation, TypeError, ValueError):
            continue

        total_cashback += price * quantity * Decimal(percent) / Decimal("100")

    return int(total_cashback)
