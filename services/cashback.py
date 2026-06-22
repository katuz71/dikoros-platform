"""Global cashback settings stored independently from cumulative discounts."""

from __future__ import annotations

from db import get_db_connection


GLOBAL_CASHBACK_KEY = "global_cashback_percent"
DEFAULT_GLOBAL_CASHBACK_PERCENT = 5


def _clamp_percent(percent) -> int:
    try:
        normalized = int(float(percent))
    except (TypeError, ValueError):
        normalized = DEFAULT_GLOBAL_CASHBACK_PERCENT
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
