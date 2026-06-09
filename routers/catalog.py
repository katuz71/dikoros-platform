"""Dynamic catalog API for mobile app home/catalog screens."""

from __future__ import annotations

from fastapi import APIRouter

from db import get_db_connection
from services.products import normalize_product_row


router = APIRouter(prefix="/api/catalog", tags=["catalog"])


PRODUCT_COLUMNS = """
    id, name, price, discount, image, images, category, pack_sizes,
    old_price, unit, description, usage, composition, delivery_info,
    return_info, variants, option_names, external_id, is_bestseller,
    is_promotion, is_new, is_hit, sku, status, remains, parent_sku,
    variant_name, sort_order, home_hit_order, home_new_order,
    home_promotion_order
"""


def _rows_to_products(rows):
    return [normalize_product_row(dict(row)) for row in rows]


def _fetch_products(where_sql: str = "", params: tuple = (), order_sql: str = "", limit: int = 16, dedupe_by=None):
    conn = get_db_connection()
    try:
        sql = f"""
            SELECT {PRODUCT_COLUMNS}
            FROM products
            WHERE COALESCE(status, '') != 'out_of_stock'
              AND name IS NOT NULL
              AND TRIM(name) != ''
              AND LOWER(TRIM(name)) != 'без назви'
              AND price IS NOT NULL
              AND price > 0
            {where_sql}
            {order_sql}
            LIMIT ?
        """
        fetch_limit = limit
        if dedupe_by:
            fetch_limit = min(max(limit * 10, limit), 500)

        rows = conn.execute(sql, tuple(params) + (fetch_limit,)).fetchall()
        products = _rows_to_products(rows)

        if not dedupe_by:
            return products

        seen = set()
        deduped = []

        for product in products:
            key = product.get(dedupe_by)
            if key is None or key in seen:
                continue

            seen.add(key)
            deduped.append(product)

            if len(deduped) >= limit:
                break

        return deduped
    finally:
        conn.close()


def _fetch_categories():
    conn = get_db_connection()
    try:
        rows = conn.execute("""
            SELECT DISTINCT category
            FROM products
            WHERE category IS NOT NULL
              AND TRIM(category) != ''
              AND COALESCE(status, '') != 'out_of_stock'
            ORDER BY category ASC
        """).fetchall()

        return [
            {"name": row["category"]}
            for row in rows
            if row.get("category")
        ]
    finally:
        conn.close()


def _fetch_banners():
    conn = get_db_connection()
    try:
        rows = conn.execute("""
            SELECT id, image_url
            FROM banners
            ORDER BY id ASC
        """).fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()


def _fetch_home_promotions():
    promotions = _fetch_home_promotions()

    if promotions:
        return promotions

    return _fetch_products(
        where_sql="""
            AND (
                COALESCE(is_promotion, FALSE) = TRUE
                OR (
                    old_price IS NOT NULL
                    AND price IS NOT NULL
                    AND old_price > price
                )
            )
        """,
        order_sql="ORDER BY COALESCE(sort_order, 2147483647), id ASC",
        dedupe_by="sort_order",
        limit=16,
    )


@router.get("/home")
def get_catalog_home():
    hits = _fetch_products(
        where_sql="AND home_hit_order IS NOT NULL",
        order_sql="ORDER BY home_hit_order ASC, COALESCE(sort_order, 2147483647), id ASC",
        dedupe_by="home_hit_order",
        limit=16,
    )

    promotions = _fetch_products(
        where_sql="AND home_promotion_order IS NOT NULL",
        order_sql="ORDER BY home_promotion_order ASC, COALESCE(sort_order, 2147483647), id ASC",
        dedupe_by="home_promotion_order",
        limit=16,
    )

    new_products = _fetch_products(
        where_sql="AND home_new_order IS NOT NULL",
        order_sql="ORDER BY home_new_order ASC, COALESCE(sort_order, 2147483647), id ASC",
        dedupe_by="home_new_order",
        limit=16,
    )

    return {
        "banners": _fetch_banners(),
        "categories": _fetch_categories(),
        "hits": hits,
        "promotions": promotions,
        "new_products": new_products,
    }


@router.get("/hits")
def get_catalog_hits(limit: int = 32):
    return {
        "products": _fetch_products(
            where_sql="AND COALESCE(is_hit, FALSE) = TRUE",
            order_sql="ORDER BY COALESCE(home_hit_order, sort_order, 2147483647), id DESC",
            limit=limit,
        )
    }


@router.get("/promotions")
def get_catalog_promotions(limit: int = 32):
    return {
        "products": _fetch_products(
            where_sql="""
                AND (
                    COALESCE(is_promotion, FALSE) = TRUE
                    OR (
                        old_price IS NOT NULL
                        AND price IS NOT NULL
                        AND old_price > price
                    )
                )
            """,
            order_sql="ORDER BY COALESCE(home_promotion_order, sort_order, 2147483647), id DESC",
            limit=limit,
        )
    }


@router.get("/new")
def get_catalog_new(limit: int = 32):
    return {
        "products": _fetch_products(
            where_sql="AND COALESCE(is_new, FALSE) = TRUE",
            order_sql="ORDER BY COALESCE(home_new_order, sort_order, 2147483647), id DESC",
            limit=limit,
        )
    }


@router.get("/categories")
def get_catalog_categories():
    return {"categories": _fetch_categories()}
