"""Horoshop catalog synchronization helpers."""

from __future__ import annotations

import logging
import os
import traceback

import httpx
from fastapi import HTTPException

from db import get_db_connection


logger = logging.getLogger(__name__)

EXPORT_PAGE_SIZE = 500
MAX_EXPORT_PAGES = 100


def _localized_value(value: object, default: str = "") -> str:
    if isinstance(value, dict):
        return str(value.get("ua") or value.get("ru") or value.get("en") or default)
    return str(value or default)


async def _export_catalog_products(
    client: httpx.AsyncClient,
    domain: str,
    token: str,
) -> list[dict]:
    products: list[dict] = []
    offset = 0

    for _ in range(MAX_EXPORT_PAGES):
        export_response = await client.post(
            f"https://{domain}/api/catalog/export/",
            json={"token": token, "limit": EXPORT_PAGE_SIZE, "offset": offset},
        )
        export_data = export_response.json()

        if export_data.get("status") != "OK":
            raise HTTPException(status_code=400, detail=f"Horoshop export error: {export_data}")

        page_products = export_data.get("response", {}).get("products", [])
        products.extend(page_products)

        if len(page_products) < EXPORT_PAGE_SIZE:
            return products
        offset += EXPORT_PAGE_SIZE

    raise HTTPException(status_code=400, detail="Horoshop export pagination did not finish")


async def sync_catalog_from_horoshop() -> dict:
    domain = os.getenv("HOROSHOP_DOMAIN")
    login = os.getenv("HOROSHOP_LOGIN")
    password = os.getenv("HOROSHOP_PASSWORD")

    if not domain or not login or not password:
        raise HTTPException(status_code=500, detail="Horoshop sync credentials are not configured")

    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()

        async with httpx.AsyncClient(timeout=120.0) as client:
            auth_response = await client.post(
                f"https://{domain}/api/auth/",
                json={"login": login, "password": password},
            )
            auth_data = auth_response.json()
            token = auth_data.get("response", {}).get("token") or auth_data.get("token")
            if not token:
                raise HTTPException(status_code=400, detail=f"Horoshop auth error: {auth_data}")

            products_list = await _export_catalog_products(client, domain, token)
            if not products_list:
                raise HTTPException(status_code=400, detail="Horoshop returned an empty product list")

            count = 0
            group_order: dict[str, int] = {}

            cur.execute("UPDATE products SET sort_order = NULL, is_hit = FALSE, is_new = FALSE, is_promotion = FALSE")

            for item in products_list:
                sku = str(item.get("article") or item.get("parent_article") or "").strip()
                if not sku:
                    continue

                parent_sku = str(item.get("parent_article") or "").strip()
                group_key = parent_sku or sku
                if group_key not in group_order:
                    group_order[group_key] = len(group_order) + 1
                sort_order = group_order[group_key]

                variant_name = _localized_value(item.get("mod_title") or {})
                title = _localized_value(item.get("title") or {}, "Без назви")
                description = _localized_value(item.get("description") or {})

                parent_obj = item.get("parent") or {}
                category = parent_obj.get("value") or "Загальне"

                try:
                    price = float(item.get("price") or 0)
                except (TypeError, ValueError):
                    price = 0.0

                try:
                    old_price = float(item.get("old_price") or 0)
                except (TypeError, ValueError):
                    old_price = 0.0

                status = "available"
                presence_obj = item.get("presence") or {}
                if presence_obj.get("id") == 2:
                    status = "out_of_stock"

                img_list = item.get("images") or []
                img = img_list[0] if img_list else ""
                images_str = ",".join(img_list) if img_list else ""

                icon_texts = []
                for icon in item.get("icons", []) or []:
                    val_obj = icon.get("value", {})
                    if isinstance(val_obj, dict):
                        icon_texts.extend([str(v).lower() for v in val_obj.values()])

                is_hit = bool(
                    item.get("hit") == 1
                    or any("хит" in t or "хіт" in t for t in icon_texts)
                )
                is_new = bool(
                    item.get("new") == 1
                    or any("новинка" in t or "new" in t for t in icon_texts)
                )
                is_promotion = bool(
                    item.get("action") == 1
                    or (old_price > 0 and old_price > price)
                    or any("акц" in t or "розпродаж" in t or "распродаж" in t or "скидка" in t or "sale" in t for t in icon_texts)
                )

                cur.execute("SELECT id FROM products WHERE sku = ?", (sku,))
                exists = cur.fetchone()
                if exists:
                    product_id = exists["id"] if isinstance(exists, dict) else exists[0]
                    cur.execute(
                        """
                        UPDATE products SET
                            name = ?, price = ?, category = ?, status = ?,
                            description = ?, image = ?, images = ?,
                            parent_sku = ?, variant_name = ?,
                            is_hit = ?, is_promotion = ?, is_new = ?,
                            old_price = ?, sort_order = ?
                        WHERE id = ?
                        """,
                        (
                            title,
                            price,
                            category,
                            status,
                            description,
                            img,
                            images_str,
                            parent_sku,
                            variant_name,
                            is_hit,
                            is_promotion,
                            is_new,
                            old_price,
                            sort_order,
                            product_id,
                        ),
                    )
                else:
                    cur.execute(
                        """
                        INSERT INTO products (
                            sku, name, price, category, status, description,
                            image, images, parent_sku, variant_name,
                            is_hit, is_promotion, is_new, old_price, sort_order
                        )
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            sku,
                            title,
                            price,
                            category,
                            status,
                            description,
                            img,
                            images_str,
                            parent_sku,
                            variant_name,
                            is_hit,
                            is_promotion,
                            is_new,
                            old_price,
                            sort_order,
                        ),
                    )
                count += 1

        conn.commit()
        return {"success": True, "count": count, "message": f"Synced products: {count}"}
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as exc:
        if conn:
            conn.rollback()
        logger.error("Horoshop sync error: %s", traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Horoshop sync error: {exc}")
    finally:
        if conn:
            conn.close()
