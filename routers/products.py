"""Products API router."""

from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter, HTTPException, Request

from db import get_db_connection
from models.schemas import ProductCreate, ProductUpdate
from services.images import save_uploaded_image
from services.products import normalize_product_row


router = APIRouter()

PRODUCT_SELECT_FIELDS = """
    id, sku, name, price, discount, image, images, category, pack_sizes,
    old_price, unit, description, usage, composition, delivery_info, return_info,
    variants, option_names, variant_options, external_id, is_bestseller, is_promotion, is_new,
    is_hit, status, remains, parent_sku, variant_name, sort_order,
    home_hit_order, home_new_order, home_promotion_order
"""

PRODUCT_GROUP_EXPR = "COALESCE(NULLIF(parent_sku, ''), NULLIF(sku, ''), CAST(id AS TEXT))"

VISIBLE_PRODUCT_CONDITIONS = [
    "name IS NOT NULL",
    "TRIM(name) != ''",
    "LOWER(TRIM(name)) != 'без назви'",
    "price IS NOT NULL",
    "price > 0",
]

VISIBLE_PRODUCT_WHERE_SQL = " AND ".join(VISIBLE_PRODUCT_CONDITIONS)


def _as_float(value: object, default: float = 0.0) -> float:
    try:
        return float(value or default)
    except (TypeError, ValueError):
        return default


def _product_group_key(product: dict) -> str:
    return str(product.get("parent_sku") or product.get("sku") or product.get("id") or "").strip()


def _variant_label(product: dict) -> str:
    return str(product.get("variant_name") or product.get("name") or product.get("sku") or "").strip()


def _parse_variant_options(value: object) -> dict[str, str]:
    if isinstance(value, dict):
        return {str(k): str(v) for k, v in value.items() if str(k).strip() and str(v).strip()}
    if not isinstance(value, str) or not value.strip():
        return {}

    try:
        parsed = json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return {}

    if not isinstance(parsed, dict):
        return {}

    return {
        str(key): str(option_value)
        for key, option_value in parsed.items()
        if str(key).strip() and str(option_value).strip()
    }


def _option_names_from_variants(variants: list[dict]) -> str | None:
    keys: list[str] = []
    for variant in variants:
        options = variant.get("options") or {}
        if not isinstance(options, dict):
            continue
        for key in options.keys():
            key_text = str(key).strip()
            if key_text and key_text not in keys:
                keys.append(key_text)

    return "|".join(keys) if keys else None


def _format_variant(product: dict) -> dict:
    old_price = _as_float(product.get("old_price"))
    status = product.get("status")
    options = _parse_variant_options(product.get("variant_options"))
    return {
        "id": product.get("id"),
        "sku": product.get("sku"),
        "name": _variant_label(product),
        "title": product.get("name"),
        "variant_name": product.get("variant_name"),
        "price": _as_float(product.get("price")),
        "old_price": old_price if old_price > 0 else None,
        "discount": product.get("discount") or 0,
        "status": status,
        "stock": 1 if status in ("available", "in_stock") else 0,
        "remains": product.get("remains"),
        "image": product.get("image"),
        "images": product.get("images"),
        "parent_sku": product.get("parent_sku"),
        "options": options,
        "is_hit": bool(product.get("is_hit")),
        "is_new": bool(product.get("is_new")),
        "is_promotion": bool(product.get("is_promotion")),
    }


def _sort_group_variants(variants: list[dict], group_key: str, selected_id: int | None = None) -> list[dict]:
    def sort_key(product: dict):
        sku = str(product.get("sku") or "").strip()
        parent_sku = str(product.get("parent_sku") or "").strip()
        product_id = int(product.get("id") or 0)

        if selected_id and product_id == selected_id:
            primary = 0
        elif sku and sku == group_key:
            primary = 1
        elif parent_sku and sku == parent_sku:
            primary = 1
        else:
            primary = 2

        return (
            primary,
            _as_float(product.get("price")),
            int(product.get("sort_order") or 2147483647),
            product_id,
        )

    return sorted(variants, key=sort_key)


def _attach_group_variants(conn, product: dict) -> dict:
    """Attach Horoshop SKU variants to a product detail response.

    Horoshop exports each variant as a separate product row. The mobile PDP
    needs the whole group so variant selection can change price/SKU/images like
    on the site.
    """
    normalized = normalize_product_row(product)
    group_key = _product_group_key(normalized)
    if not group_key:
        return normalized

    rows = conn.execute(
        f"""
        SELECT {PRODUCT_SELECT_FIELDS}
        FROM products
        WHERE {PRODUCT_GROUP_EXPR} = ?
        ORDER BY COALESCE(sort_order, 2147483647), id DESC
        """,
        (group_key,),
    ).fetchall()

    variants = [normalize_product_row(dict(row)) for row in rows]
    if not variants:
        return normalized

    selected_id = int(normalized.get("id") or 0)
    ordered = _sort_group_variants(variants, group_key, selected_id=selected_id)
    formatted_variants = [_format_variant(item) for item in ordered]

    min_price = min((_as_float(item.get("price")) for item in ordered), default=_as_float(normalized.get("price")))
    max_old_price = max((_as_float(item.get("old_price")) for item in ordered), default=_as_float(normalized.get("old_price")))

    normalized["variants"] = formatted_variants
    normalized["minPrice"] = min_price
    normalized["old_price"] = max_old_price if max_old_price > 0 else normalized.get("old_price")
    normalized["option_names"] = _option_names_from_variants(formatted_variants) or normalized.get("option_names") or ("\u0412\u0430\u0440\u0456\u0430\u043d\u0442" if len(formatted_variants) > 1 else normalized.get("option_names"))
    normalized["status"] = "available" if any(item.get("status") == "available" for item in ordered) else normalized.get("status")
    normalized["stock"] = 1 if normalized.get("status") in ("available", "in_stock") else 0

    return normalized


def _build_grouped_product(group_key: str, variants: list[dict]) -> dict | None:
    if not variants:
        return None

    ordered = _sort_group_variants(variants, group_key)
    main_variant = ordered[0].copy()
    price_sorted = sorted(ordered, key=lambda item: _as_float(item.get("price")))

    min_price = _as_float(price_sorted[0].get("price")) if price_sorted else _as_float(main_variant.get("price"))
    max_old_price = max((_as_float(item.get("old_price")) for item in ordered), default=0.0)

    formatted_variants = [_format_variant(item) for item in ordered]

    # Horoshop is the source of truth: the card price must stay equal to
    # the primary/catalog variant price. minPrice is metadata only and must
    # not override the visible product card price.
    main_variant["variants"] = formatted_variants
    main_variant["price"] = _as_float(main_variant.get("price"))
    main_variant["minPrice"] = min_price
    main_variant["old_price"] = max_old_price if max_old_price > 0 else None
    main_variant["option_names"] = _option_names_from_variants(formatted_variants) or main_variant.get("option_names") or ("\u0412\u0430\u0440\u0456\u0430\u043d\u0442" if len(formatted_variants) > 1 else main_variant.get("option_names"))

    if any(item.get("status") == "available" for item in ordered):
        main_variant["status"] = "available"
    elif any(item.get("status") != "out_of_stock" for item in ordered) and main_variant.get("status") == "out_of_stock":
        main_variant["status"] = "in_stock"

    main_variant["stock"] = 1 if main_variant.get("status") in ("available", "in_stock") else 0
    main_variant["is_hit"] = any(bool(item.get("is_hit")) for item in ordered)
    main_variant["is_new"] = any(bool(item.get("is_new")) for item in ordered)
    main_variant["is_promotion"] = any(bool(item.get("is_promotion")) for item in ordered)

    return main_variant


# 1. ТОВАРЫ
@router.get("/api/products")
@router.get("/products")
async def get_products_paginated(page: int = 1, limit: int = 50, category: str = None, status: str = None, search: str = None):
    conn = get_db_connection()
    cur = conn.cursor()
    
    # Categories for filter: only categories that contain visible Horoshop products.
    cur.execute(f"""
        SELECT DISTINCT category
        FROM products
        WHERE category IS NOT NULL
          AND TRIM(category) != ''
          AND {VISIBLE_PRODUCT_WHERE_SQL}
          AND COALESCE(status, '') != 'out_of_stock'
        ORDER BY category ASC
    """)
    all_categories = []
    for r in cur.fetchall():
        if isinstance(r, dict):
            all_categories.append(r.get('category') or list(r.values())[0])
        elif hasattr(r, "keys"):
            all_categories.append(dict(r).get('category') or r[0])
        else:
            all_categories.append(r[0] if r else "")
            
    all_categories = [c for c in all_categories if c]
    
    where_clauses = VISIBLE_PRODUCT_CONDITIONS.copy()
    params = []
    if category:
        where_clauses.append("category = ?")
        params.append(category)
    if status:
        if status in ('in_stock', 'available'):
            where_clauses.append("COALESCE(status, '') != 'out_of_stock'")
        elif status == 'out_of_stock':
            where_clauses.append("status = 'out_of_stock'")
    else:
        where_clauses.append("COALESCE(status, '') != 'out_of_stock'")

    if search:
        search_term = f"%{search}%"
        where_clauses.append("(name ILIKE ? OR sku ILIKE ?)")
        params.extend([search_term, search_term])
        
    where_str = ""
    if where_clauses:
        where_str = " WHERE " + " AND ".join(where_clauses)
        
    cur.execute(f"SELECT COUNT(DISTINCT {PRODUCT_GROUP_EXPR}) as count FROM products {where_str}", tuple(params))
    row = cur.fetchone()
    if isinstance(row, dict):
        total_count = row.get('count', 0)
    elif hasattr(row, 'keys'):
        total_count = dict(row).get('count', 0)
    else:
        total_count = row[0] if row else 0
    
    offset = (page - 1) * limit
    
    # Get paginated group keys
    keys_sql = f"""
        SELECT {PRODUCT_GROUP_EXPR} as group_key
        FROM products 
        {where_str}
        GROUP BY {PRODUCT_GROUP_EXPR}
        ORDER BY COALESCE(MIN(sort_order), 2147483647), MAX(id) DESC
        LIMIT ? OFFSET ?
    """
    cur.execute(keys_sql, tuple(params + [limit, offset]))
    
    group_keys = []
    for r in cur.fetchall():
        if isinstance(r, dict):
            group_keys.append(r.get('group_key') or list(r.values())[0])
        elif hasattr(r, 'keys'):
            group_keys.append(dict(r).get('group_key') or r[0])
        else:
            group_keys.append(r[0])
            
    grouped_products = []
    
    if group_keys:
        placeholders = ",".join(["?"] * len(group_keys))
        items_sql = f"""
            SELECT {PRODUCT_SELECT_FIELDS}
            FROM products 
            WHERE {PRODUCT_GROUP_EXPR} IN ({placeholders})
              AND {VISIBLE_PRODUCT_WHERE_SQL}
              AND COALESCE(status, '') != 'out_of_stock'
            ORDER BY COALESCE(sort_order, 2147483647), id DESC
        """
        cur.execute(items_sql, tuple(group_keys))
        all_rows = cur.fetchall()
        
        groups_dict = {}
        for r in all_rows:
            d = normalize_product_row(dict(r))
            gkey = _product_group_key(d)
            if gkey not in groups_dict:
                groups_dict[gkey] = []
            groups_dict[gkey].append(d)
            
        # Assemble resulting products in order of group_keys
        for gkey in group_keys:
            product = _build_grouped_product(str(gkey), groups_dict.get(gkey, []))
            if product:
                grouped_products.append(product)

    conn.close()
    
    return {
        "products": grouped_products,
        "total_pages": (total_count + limit - 1) // limit if total_count > 0 else 1,
        "current_page": page,
        "categories": sorted(list(set([c for c in all_categories if c])))
    }


@router.get("/products/by-external-id")
def get_product_by_external_id_query(external_id: str):
    # Normalize incoming external_id
    normalized = external_id.strip().lower()
    normalized = normalized.replace('https://', '').replace('http://', '')
    normalized = normalized.replace('www.', '')
    normalized = normalized.rstrip('/')
    
    conn = get_db_connection()
    try:
        row = conn.execute(f"""
            SELECT {PRODUCT_SELECT_FIELDS}
            FROM products 
            WHERE LOWER(
                RTRIM(
                    REPLACE(
                        REPLACE(
                            REPLACE(
                                REPLACE(external_id, 'https://', ''),
                                'http://', ''
                            ),
                            'www.', ''
                        ),
                        '/'
                    )
                )
            ) = ?
        """, (normalized,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Product not found")
        return _attach_group_variants(conn, dict(row))
    finally:
        conn.close()


@router.get("/products/external/{external_id:path}")
def get_product_by_external_id(external_id: str):
    conn = get_db_connection()
    try:
        row = conn.execute(f"""
            SELECT {PRODUCT_SELECT_FIELDS}
            FROM products WHERE external_id=?
        """, (external_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Product not found")
        return _attach_group_variants(conn, dict(row))
    finally:
        conn.close()


@router.get("/products/external")
def get_product_by_external_query(external_id: str):
    return get_product_by_external_id_query(external_id)


@router.get("/api/products/{id}")
@router.get("/api/product/{id}")
@router.get("/products/{id}")
@router.get("/product/{id}")
def get_product(id: int):
    conn = get_db_connection()
    try:
        row = conn.execute(f"""
            SELECT {PRODUCT_SELECT_FIELDS}
            FROM products WHERE id=?
        """, (id,)).fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Product not found")

        return _attach_group_variants(conn, dict(row))
    finally:
        conn.close()



def _parse_product_form(form) -> tuple:
    """Parse multipart form into (name, price, category, images, description, usage, composition, old_price, discount, unit, variants_json, option_names, delivery_info, return_info, is_bestseller, is_promotion, is_new)."""
    def _str(v):
        val = form.get(v)
        return (val or "").strip() or None if isinstance(val, str) else None
    def _float(v):
        val = form.get(v)
        if val is None or val == "":
            return None
        try:
            return float(val)
        except (TypeError, ValueError):
            return None
    def _int(v):
        val = form.get(v)
        if val is None or val == "":
            return 0
        try:
            return int(float(val))
        except (TypeError, ValueError):
            return 0
    name = _str("name") or ""
    price = _float("price") or 0.0
    category = _str("category")
    images = _str("images")
    description = _str("description")
    usage = _str("usage")
    composition = _str("composition")
    old_price = _float("old_price")
    discount = _int("discount")
    unit = _str("unit") or "шт"
    option_names = _str("option_names")
    delivery_info = _str("delivery_info")
    return_info = _str("return_info")
    def _bool(v):
        val = form.get(v)
        if val is None:
            return False
        if isinstance(val, bool):
            return val
        if isinstance(val, str):
            return val.strip().lower() in ("1", "true", "yes", "on")
        return bool(val)
    is_bestseller = _bool("is_bestseller")
    is_promotion = _bool("is_promotion")
    is_new = _bool("is_new")
    variants_raw = form.get("variants")
    if isinstance(variants_raw, str) and variants_raw.strip():
        try:
            variants_json = variants_raw
            json.loads(variants_json)
        except json.JSONDecodeError:
            variants_json = None
    else:
        variants_json = None
    return (name, price, category, images, description, usage, composition, old_price, discount, unit, variants_json, option_names, delivery_info, return_info, is_bestseller, is_promotion, is_new)


@router.post("/products")
async def create_product(request: Request):
    conn = get_db_connection()
    try:
        content_type = request.headers.get("content-type", "")
        image_path = None

        if "application/json" in content_type:
            body = await request.json()
            item = ProductCreate(**body)
            image_path = item.image
            name, price, category = item.name, item.price, item.category
            images = item.images
            description, usage, composition = item.description, item.usage, item.composition
            old_price, unit = item.old_price, item.unit
            discount = int(getattr(item, "discount", 0) or 0)
            variants_json = json.dumps(item.variants) if item.variants else None
            option_names = item.option_names
            delivery_info, return_info = item.delivery_info, item.return_info
            is_bestseller = getattr(item, "is_bestseller", False) or False
            is_promotion = getattr(item, "is_promotion", False) or False
            is_new = getattr(item, "is_new", False) or False
        else:
            form = await request.form()
            image_file = form.get("image_file") or form.get("image")
            if image_file and hasattr(image_file, "read"):
                image_path = await save_uploaded_image(image_file)
            else:
                image_path = (image_file or "").strip() or None
                if isinstance(image_path, str) and not image_path:
                    image_path = None

            name, price, category, images, description, usage, composition, old_price, discount, unit, variants_json, option_names, delivery_info, return_info, is_bestseller, is_promotion, is_new = _parse_product_form(form)
            discount = int(form.get("discount", 0) or 0)

        if not str(name or "").strip():
            raise HTTPException(status_code=400, detail="Product name is required")
        if price is None or float(price) <= 0:
            raise HTTPException(status_code=400, detail="Product price must be greater than zero")

        conn.execute("""
            INSERT INTO products (name, price, category, image, images, description, usage, composition, old_price, discount, unit, variants, option_names, delivery_info, return_info, is_bestseller, is_promotion, is_new)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (name, price, category, image_path, images, description, usage, composition, old_price, discount, unit, variants_json, option_names, delivery_info, return_info, is_bestseller, is_promotion, is_new))
        conn.commit()
        return {"status": "ok"}
    finally:
        conn.close()


@router.put("/products/{id}")
async def update_product(id: int, request: Request):
    conn = get_db_connection()
    try:
        row = conn.execute(
            "SELECT id, name, price, category, image, images, description, usage, composition, old_price, discount, unit, variants, option_names, delivery_info, return_info, is_bestseller, is_promotion, is_new FROM products WHERE id=?",
            (id,),
        ).fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Product not found")

        row = dict(row)

        content_type = request.headers.get("content-type", "")
        image_path = None

        if "application/json" in content_type:
            body = await request.json()
            item = ProductUpdate(**body)
            payload = item.model_dump(exclude_unset=True)

            if payload.get("image") in (None, "", "null", []):
                payload.pop("image", None)
            if payload.get("images") in (None, "", "null", []):
                payload.pop("images", None)

            def _get(key, default=None):
                return payload[key] if key in payload else row.get(key, default)

            name = _get("name") or ""
            price = _get("price") if "price" in payload else row["price"]
            category = _get("category")
            image_path = _get("image")
            images = _get("images")

            if not image_path or (isinstance(image_path, str) and not image_path.strip()):
                image_path = row.get("image")
            if images is None or (isinstance(images, str) and not images.strip()):
                images = row.get("images")

            description = _get("description")
            usage = _get("usage")
            composition = _get("composition")
            old_price = _get("old_price")
            unit = _get("unit") or "шт"
            discount = int(payload["discount"]) if "discount" in payload else (row.get("discount") or 0)
            variants_json = json.dumps(payload["variants"]) if "variants" in payload else row.get("variants")
            option_names = _get("option_names")
            delivery_info = _get("delivery_info")
            return_info = _get("return_info")
            is_bestseller = payload["is_bestseller"] if "is_bestseller" in payload else bool(row.get("is_bestseller"))
            is_promotion = payload["is_promotion"] if "is_promotion" in payload else bool(row.get("is_promotion"))
            is_new = payload["is_new"] if "is_new" in payload else bool(row.get("is_new"))
        else:
            form = await request.form()
            image_file = form.get("image_file") or form.get("image")

            if image_file and hasattr(image_file, "read"):
                image_path = await save_uploaded_image(image_file)
            else:
                image_path = (image_file or "").strip() or None
                if isinstance(image_path, str) and not image_path:
                    image_path = None

            name, price, category, images, description, usage, composition, old_price, discount, unit, variants_json, option_names, delivery_info, return_info, is_bestseller, is_promotion, is_new = _parse_product_form(form)
            discount = int(form.get("discount", 0) or 0)

            if image_path is None or (isinstance(image_path, str) and not image_path.strip()):
                image_path = row.get("image")
            if images is None or (isinstance(images, str) and not images.strip()):
                images = row.get("images")

        if not str(name or "").strip():
            raise HTTPException(status_code=400, detail="Product name is required")
        if price is None or float(price) <= 0:
            raise HTTPException(status_code=400, detail="Product price must be greater than zero")

        cur = conn.execute("""
            UPDATE products SET name=?, price=?, category=?, image=?, images=?, description=?, usage=?, composition=?, old_price=?, discount=?, unit=?, variants=?, option_names=?, delivery_info=?, return_info=?, is_bestseller=?, is_promotion=?, is_new=?, is_manually_edited=?
            WHERE id=?
        """, (name, price, category, image_path, images, description, usage, composition, old_price, discount, unit, variants_json, option_names, delivery_info, return_info, is_bestseller, is_promotion, is_new, True, id))
        conn.commit()

        updated_count = getattr(cur, "rowcount", 0)
        if updated_count == 0:
            raise HTTPException(status_code=404, detail="Product not found")

        return {"status": "ok"}
    finally:
        conn.close()


@router.delete("/products/{id}")
async def delete_product(id: int):
    conn = get_db_connection()
    try:
        cur = conn.execute("DELETE FROM products WHERE id=?", (id,))
        conn.commit()
        deleted_count = getattr(cur, "rowcount", 0)

        if deleted_count == 0:
            raise HTTPException(status_code=404, detail="Product not found")

        return {"status": "ok"}
    finally:
        conn.close()
