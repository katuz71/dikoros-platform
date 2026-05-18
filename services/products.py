"""Product service helpers shared by routers."""

from __future__ import annotations

from typing import List

from db import get_db_connection


def get_products_by_ids(ids: List[int]) -> List[dict]:
    """Return product rows by ids preserving input order."""
    if not ids:
        return []

    unique_ids = list(dict.fromkeys(ids))
    conn = get_db_connection()
    placeholders = ",".join(["?" for _ in unique_ids])
    rows = conn.execute(
        f"""
        SELECT id, name, price, old_price, image, images, description
        FROM products WHERE id IN ({placeholders})
        """,
        tuple(unique_ids),
    ).fetchall()
    conn.close()

    by_id = {int(row["id"]): dict(row) for row in rows}
    return [by_id[item_id] for item_id in unique_ids if item_id in by_id]
