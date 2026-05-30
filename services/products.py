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
        SELECT id, name, price, old_price, image, images, description, link_url
        FROM products WHERE id IN ({placeholders})
        """,
        tuple(unique_ids),
    ).fetchall()
    conn.close()

    by_id = {int(row["id"]): dict(row) for row in rows}
    return [by_id[item_id] for item_id in unique_ids if item_id in by_id]
def normalize_product_row(d: dict) -> dict:
    """Normalize product DB row for API responses."""
    d["discount"] = d.get("discount", 0) if d.get("discount") is not None else 0

    variants_value = d.get("variants")
    if isinstance(variants_value, str):
        try:
            import json
            d["variants"] = json.loads(variants_value)
        except (json.JSONDecodeError, TypeError):
            d["variants"] = []
    elif isinstance(variants_value, list):
        d["variants"] = variants_value
    else:
        d["variants"] = []

    images_value = d.get("images")
    if isinstance(images_value, str):
        d["images"] = images_value
    elif isinstance(images_value, list):
        d["images"] = ",".join(str(x) for x in images_value)
    elif images_value is None:
        d["images"] = ""
    return d
