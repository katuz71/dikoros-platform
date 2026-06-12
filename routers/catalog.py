"""Dynamic catalog API for mobile app home/catalog screens."""

from __future__ import annotations

import asyncio
import logging
import os
import re
from html import unescape
from urllib.parse import urljoin
import urllib.request

import httpx
from fastapi import APIRouter

from db import get_db_connection
from services.catalog_sync import HOROSHOP_PAGE_HEADERS, HomepageProductRef, _fetch_homepage_sections
from services.products import normalize_product_row


router = APIRouter(prefix="/api/catalog", tags=["catalog"])
logger = logging.getLogger(__name__)


PRODUCT_COLUMNS = """
    id, name, price, discount, image, images, category, pack_sizes,
    old_price, unit, description, usage, composition, delivery_info,
    return_info, variants, option_names, external_id, is_bestseller,
    is_promotion, is_new, is_hit, sku, status, remains, parent_sku,
    variant_name, sort_order, home_hit_order, home_new_order,
    home_promotion_order
"""

CARD_FIELDS = {
    "id",
    "name",
    "price",
    "discount",
    "image",
    "images",
    "category",
    "old_price",
    "unit",
    "external_id",
    "is_bestseller",
    "is_promotion",
    "is_new",
    "is_hit",
    "sku",
    "status",
    "remains",
    "parent_sku",
    "variant_name",
    "sort_order",
    "home_hit_order",
    "home_new_order",
    "home_promotion_order",
    "variants",
    "option_names",
}


def _compact_product(product: dict) -> dict:
    """Return the lightweight shape needed by carousel cards.

    Home endpoints must stay small and fast. Product details are loaded by id on
    the product screen, so large HTML descriptions must not be shipped here.
    """
    return {key: product.get(key) for key in CARD_FIELDS if key in product}


def _compact_products(products: list[dict]) -> list[dict]:
    return [_compact_product(product) for product in products]


def _product_group_key(product: dict) -> str:
    """Stable dedupe key for carousel cards.

    Horoshop exports variants as separate SKUs. On the app home screen those
    variants must be shown as one product card, not as repeated cards.
    """
    parent_sku = str(product.get("parent_sku") or "").strip()
    if parent_sku:
        return f"parent:{parent_sku}"

    sku = str(product.get("sku") or "").strip()
    if sku:
        return f"sku:{sku}"

    product_id = str(product.get("id") or "").strip()
    if product_id:
        return f"id:{product_id}"

    name = str(product.get("name") or "").strip().casefold()
    category = str(product.get("category") or "").strip().casefold()
    return f"name:{category}:{name}"


def _dedupe_products(products: list[dict], limit: int | None = None) -> list[dict]:
    seen: set[str] = set()
    result: list[dict] = []

    for product in products:
        key = _product_group_key(product)
        if key in seen:
            continue

        seen.add(key)
        result.append(product)

        if limit is not None and len(result) >= limit:
            break

    return result


def _rows_to_products(rows):
    return [normalize_product_row(dict(row)) for row in rows]


def _fetch_products(where_sql: str = "", params: tuple = (), order_sql: str = "", limit: int = 50, dedupe_by=None, strict: bool = True):
    conn = get_db_connection()
    try:
        base_cond = "WHERE name IS NOT NULL AND TRIM(name) != '' AND LOWER(TRIM(name)) != 'без назви'"
        
        if strict:
            base_cond += " AND COALESCE(status, '') != 'out_of_stock' AND price IS NOT NULL AND price > 0"
            
        sql = f"""
            SELECT {PRODUCT_COLUMNS}
            FROM products
            {base_cond}
            {where_sql}
            {order_sql}
            LIMIT ?
        """
        fetch_limit = min(max(limit * 10, limit), 500)

        rows = conn.execute(sql, tuple(params) + (fetch_limit,)).fetchall()
        products = _compact_products(_rows_to_products(rows))

        if dedupe_by:
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

        return _dedupe_products(products, limit=limit)
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


def _extract_product_page_sku(html: str) -> str | None:
    match = re.search(r"Артикул:\s*([^<]+)", html)
    if not match:
        return None

    sku = unescape(match.group(1)).strip()
    return sku or None


async def _resolve_ref_sku_from_href(
    client: httpx.AsyncClient,
    domain: str,
    ref: HomepageProductRef,
) -> str | None:
    if not ref.href:
        return None

    try:
        url = urljoin(f"https://{domain}/", ref.href)
        request = urllib.request.Request(url, headers=HOROSHOP_PAGE_HEADERS)
        html = await asyncio.to_thread(
            lambda: urllib.request.urlopen(request, timeout=20.0).read().decode("utf-8", "replace")
        )
        return _extract_product_page_sku(html)
    except OSError:
        return None


async def _fetch_products_by_home_refs(
    refs: list[HomepageProductRef],
    client: httpx.AsyncClient,
    domain: str,
    limit: int | None = None,
):
    products, unresolved = await _map_products_by_home_refs(refs, client, domain, limit=limit)
    if unresolved:
        logger.warning("Unresolved Horoshop homepage refs: %s", unresolved)
    return products


async def _map_products_by_home_refs(
    refs: list[HomepageProductRef],
    client: httpx.AsyncClient,
    domain: str,
    limit: int | None = None,
) -> tuple[list[dict], list[dict]]:
    conn = get_db_connection()
    try:
        products = []
        unresolved = []
        visible_sql = """
            AND name IS NOT NULL
            AND TRIM(name) != ''
            AND LOWER(TRIM(name)) != 'без назви'
            AND COALESCE(status, '') != 'out_of_stock'
            AND price IS NOT NULL
            AND price > 0
        """

        for ref in refs:
            row = None
            resolved_sku = None
            if ref.external_id:
                row = conn.execute(
                    f"SELECT {PRODUCT_COLUMNS} FROM products WHERE external_id = ? {visible_sql} LIMIT 1",
                    (ref.external_id,),
                ).fetchone()
            if not row and ref.sku:
                row = conn.execute(
                    f"SELECT {PRODUCT_COLUMNS} FROM products WHERE sku = ? {visible_sql} LIMIT 1",
                    (ref.sku,),
                ).fetchone()
            if not row and ref.href:
                resolved_sku = await _resolve_ref_sku_from_href(client, domain, ref)
                if resolved_sku:
                    row = conn.execute(
                        f"SELECT {PRODUCT_COLUMNS} FROM products WHERE sku = ? {visible_sql} LIMIT 1",
                        (resolved_sku,),
                    ).fetchone()
            if not row:
                unresolved.append({
                    "section": ref.section,
                    "external_id": ref.external_id,
                    "sku": ref.sku,
                    "href": ref.href,
                    "resolved_sku": resolved_sku,
                })
                continue

            products.append(_compact_product(normalize_product_row(dict(row))))

        return _dedupe_products(products, limit=limit), unresolved
    finally:
        conn.close()


async def _fetch_live_home_hits(limit: int = 50):
    domain = os.getenv("HOROSHOP_DOMAIN") or "dikoros-ua.com"
    async with httpx.AsyncClient(timeout=60.0) as client:
        sections = await _fetch_homepage_sections(client, domain)
        return await _fetch_products_by_home_refs(sections.get("hit", []), client, domain, limit=limit)


def _fetch_home_hit_products(limit: int = 50):
    return _fetch_products(
        where_sql="AND home_hit_order IS NOT NULL",
        order_sql="ORDER BY home_hit_order ASC, id DESC",
        limit=limit,
    )


def _fetch_hit_fallback(limit: int = 50):
    return _fetch_products(
        where_sql="AND COALESCE(is_hit, FALSE) = TRUE",
        order_sql="ORDER BY COALESCE(sort_order, 2147483647), id DESC",
        limit=limit,
    )


def _fetch_promotion_fallback(limit: int = 50):
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
        order_sql="ORDER BY COALESCE(home_promotion_order, sort_order, 2147483647), id DESC",
        limit=limit,
    )


def _fetch_new_fallback(limit: int = 50):
    return _fetch_products(
        where_sql="AND COALESCE(is_new, FALSE) = TRUE",
        order_sql="ORDER BY COALESCE(home_new_order, sort_order, 2147483647), id DESC",
        limit=limit,
    )


@router.get("/home")
async def get_catalog_home():
    domain = os.getenv("HOROSHOP_DOMAIN") or "dikoros-ua.com"
    async with httpx.AsyncClient(timeout=60.0) as client:
        sections = await _fetch_homepage_sections(client, domain)

        hits = await _fetch_products_by_home_refs(sections.get("hit", []), client, domain)
        promotions = await _fetch_products_by_home_refs(sections.get("promotion", []), client, domain)
        new_products = await _fetch_products_by_home_refs(sections.get("new", []), client, domain)

    return {
        # Banners are loaded by the app through /banners. Keeping them out of
        # /api/catalog/home prevents large base64 payloads from blocking the
        # home product sections.
        "banners": [],
        "categories": _fetch_categories(),
        "hits": hits,
        "promotions": promotions,
        "new_products": new_products,
    }


@router.get("/home/debug")
async def get_catalog_home_debug():
    domain = os.getenv("HOROSHOP_DOMAIN") or "dikoros-ua.com"
    async with httpx.AsyncClient(timeout=60.0) as client:
        sections = await _fetch_homepage_sections(client, domain)
        mapped_hits, unresolved_hits = await _map_products_by_home_refs(sections.get("hit", []), client, domain)
        mapped_promotions, unresolved_promotions = await _map_products_by_home_refs(sections.get("promotion", []), client, domain)
        mapped_new, unresolved_new = await _map_products_by_home_refs(sections.get("new", []), client, domain)

    return {
        "raw_sections": {
            "hit": len(sections.get("hit", [])),
            "promotion": len(sections.get("promotion", [])),
            "new": len(sections.get("new", [])),
        },
        "mapped_sections": {
            "hit": len(mapped_hits),
            "promotion": len(mapped_promotions),
            "new": len(mapped_new),
        },
        "unresolved": unresolved_hits + unresolved_promotions + unresolved_new,
    }


@router.get("/hits")
async def get_catalog_hits(limit: int = 32):
    products = await _fetch_live_home_hits(limit=limit)
    if not products:
        products = _fetch_home_hit_products(limit=limit) or _fetch_hit_fallback(limit=limit)
    return {"products": products}


@router.get("/promotions")
def get_catalog_promotions(limit: int = 32):
    return {"products": _fetch_promotion_fallback(limit=limit)}


@router.get("/new")
def get_catalog_new(limit: int = 32):
    return {"products": _fetch_new_fallback(limit=limit)}


@router.get("/categories")
def get_catalog_categories():
    return {"categories": _fetch_categories()}
