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


# 1. ТОВАРЫ
@router.get("/api/products")
@router.get("/products")
async def get_products_paginated(page: int = 1, limit: int = 50, category: str = None, status: str = None, search: str = None):
    import json
    conn = get_db_connection()
    cur = conn.cursor()
    
    # Categories for filter
    cur.execute("SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND category != ''")
    all_categories = []
    for r in cur.fetchall():
        if isinstance(r, dict):
            all_categories.append(r.get('category') or list(r.values())[0])
        elif hasattr(r, "keys"):
            all_categories.append(dict(r).get('category') or r[0])
        else:
            all_categories.append(r[0] if r else "")
            
    all_categories = [c for c in all_categories if c]
    
    where_clauses = []
    params = []
    if category:
        where_clauses.append("category = ?")
        params.append(category)
    if status:
        if status in ('in_stock', 'available'):
            where_clauses.append("status != 'out_of_stock'")
        elif status == 'out_of_stock':
            where_clauses.append("status = 'out_of_stock'")
    if search:
        search_term = f"%{search}%"
        where_clauses.append("(name ILIKE ? OR sku ILIKE ?)")
        params.extend([search_term, search_term])
        
    where_str = ""
    if where_clauses:
        where_str = " WHERE " + " AND ".join(where_clauses)
        
    group_expr = "COALESCE(NULLIF(parent_sku, ''), NULLIF(sku, ''), CAST(id AS TEXT))"
    
    cur.execute(f"SELECT COUNT(DISTINCT {group_expr}) as count FROM products {where_str}", tuple(params))
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
        SELECT {group_expr} as group_key
        FROM products 
        {where_str}
        GROUP BY {group_expr}
        ORDER BY MAX(id) DESC
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
            SELECT * 
            FROM products 
            WHERE {group_expr} IN ({placeholders})
            ORDER BY id DESC
        """
        cur.execute(items_sql, tuple(group_keys))
        all_rows = cur.fetchall()
        
        groups_dict = {}
        for r in all_rows:
            d = normalize_product_row(dict(r))
            psku = d.get('parent_sku')
            rsku = d.get('sku')
            rid = d.get('id')
            gkey = psku if psku else rsku if rsku else str(rid)
            
            if gkey not in groups_dict:
                groups_dict[gkey] = []
            groups_dict[gkey].append(d)
            
        # Assemble resulting products in order of group_keys
        for gkey in group_keys:
            variants = groups_dict.get(gkey, [])
            if not variants:
                continue
                
            # Sort variants by price ascending to find min price easily
            variants_sorted = sorted(variants, key=lambda x: float(x.get('price') or 0.0))
            
            main_variant = variants_sorted[0].copy()
            min_price = main_variant.get('price') or 0.0
            
            max_old_price = 0.0
            formatted_variants = []
            
            has_available = False
            has_hit = False
            has_new = False
            has_promotion = False
            
            for v in variants_sorted:
                v_name = v.get('variant_name')
                if not v_name or not str(v_name).strip():
                    v_name = v.get('name')
                
                v_old_price = float(v.get('old_price') or 0.0)
                if v_old_price > max_old_price:
                    max_old_price = v_old_price
                
                v_status = v.get('status')
                if v_status == 'available':
                    has_available = True
                
                if v.get('is_hit'):
                    has_hit = True
                if v.get('is_new'):
                    has_new = True
                if v.get('is_promotion'):
                    has_promotion = True
                
                formatted_variants.append({
                    "id": v.get('id'),
                    "sku": v.get('sku'),
                    "name": v_name,
                    "price": float(v.get('price') or 0.0),
                    "old_price": v_old_price if v_old_price > 0 else None,
                    "status": v_status,
                    "stock": 1 if v_status == 'available' else 0,
                    "is_hit": bool(v.get('is_hit')),
                    "is_new": bool(v.get('is_new')),
                    "is_promotion": bool(v.get('is_promotion'))
                })
                
            main_variant['variants'] = formatted_variants
            main_variant['price'] = min_price
            main_variant['old_price'] = max_old_price if max_old_price > 0 else None
            
            if has_available:
                main_variant['status'] = 'available'
            else:
                has_in_stock = any(v.get('status') != 'out_of_stock' for v in variants_sorted)
                if has_in_stock and main_variant.get('status') == 'out_of_stock':
                    main_variant['status'] = 'in_stock'
            
            main_variant['stock'] = 1 if main_variant.get('status') in ('available', 'in_stock') else 0
            
            if has_hit:
                main_variant['is_hit'] = True
            if has_new:
                main_variant['is_new'] = True
            if has_promotion:
                main_variant['is_promotion'] = True
                
            grouped_products.append(main_variant)

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
        row = conn.execute("""
            SELECT id, name, price, discount, image, images, category, pack_sizes,
                   old_price, unit, description, usage, delivery_info, return_info,
                   variants, option_names, external_id, is_bestseller, is_promotion, is_new
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
        d = dict(row)
        d["discount"] = d.get("discount", 0) if d.get("discount") is not None else 0
        variants_value = d.get("variants")
        if isinstance(variants_value, str):
            try:
                d["variants"] = json.loads(variants_value)
            except (json.JSONDecodeError, TypeError):
                d["variants"] = []
        elif isinstance(variants_value, list):
            d["variants"] = variants_value
        else:
            d["variants"] = []
        d["composition"] = None
        return d
    finally:
        conn.close()

@router.get("/products/external/{external_id:path}")
def get_product_by_external_id(external_id: str):
    conn = get_db_connection()
    try:
        row = conn.execute("""
            SELECT id, name, price, discount, image, images, category, pack_sizes,
                   old_price, unit, description, usage, delivery_info, return_info,
                   variants, option_names, external_id, is_bestseller, is_promotion, is_new
            FROM products WHERE external_id=?
        """, (external_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Product not found")
        d = dict(row)
        d["discount"] = d.get("discount", 0) if d.get("discount") is not None else 0
        variants_value = d.get("variants")
        if isinstance(variants_value, str):
            try:
                d["variants"] = json.loads(variants_value)
            except (json.JSONDecodeError, TypeError):
                d["variants"] = []
        elif isinstance(variants_value, list):
            d["variants"] = variants_value
        else:
            d["variants"] = []
        d["composition"] = None
        return d
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
    row = conn.execute("""
        SELECT id, name, price, discount, image, images, category, pack_sizes,
               old_price, unit, description, usage, composition, delivery_info, return_info,
               variants, option_names, external_id, is_bestseller, is_promotion, is_new
        FROM products WHERE id=?
    """, (id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Product not found")
    d = normalize_product_row(dict(row))
    conn.close()
    return d



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
    conn.execute("""
        INSERT INTO products (name, price, category, image, images, description, usage, composition, old_price, discount, unit, variants, option_names, delivery_info, return_info, is_bestseller, is_promotion, is_new)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (name, price, category, image_path, images, description, usage, composition, old_price, discount, unit, variants_json, option_names, delivery_info, return_info, is_bestseller, is_promotion, is_new))
    conn.commit()
    conn.close()
    return {"status": "ok"}


@router.put("/products/{id}")
async def update_product(id: int, request: Request):
    conn = get_db_connection()
    row = conn.execute(
        "SELECT id, name, price, category, image, images, description, usage, composition, old_price, discount, unit, variants, option_names, delivery_info, return_info, is_bestseller, is_promotion, is_new FROM products WHERE id=?",
        (id,),
    ).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Product not found")
    row = dict(row)

    content_type = request.headers.get("content-type", "")
    image_path = None
    if "application/json" in content_type:
        body = await request.json()
        item = ProductUpdate(**body)
        payload = item.model_dump(exclude_unset=True)
        # Предохранитель: фронт может присылать image/images пустыми (null, "", []) — не затирать имеющиеся в БД
        if payload.get("image") in (None, "", "null", []):
            payload.pop("image", None)
        if payload.get("images") in (None, "", "null", []):
            payload.pop("images", None)
        # Partial update: only overwrite fields that were present in the request. Preserve image/images if not sent.
        def _get(key, default=None):
            return payload[key] if key in payload else row.get(key, default)
        name = _get("name") or ""
        price = _get("price") if "price" in payload else row["price"]
        category = _get("category")
        image_path = _get("image")
        images = _get("images")
        # Жёсткая защита: не затирать картинки пустыми значениями — брать из БД, если пришло пусто
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
    conn.execute("""
        UPDATE products SET name=?, price=?, category=?, image=?, images=?, description=?, usage=?, composition=?, old_price=?, discount=?, unit=?, variants=?, option_names=?, delivery_info=?, return_info=?, is_bestseller=?, is_promotion=?, is_new=?, is_manually_edited=?
        WHERE id=?
    """, (name, price, category, image_path, images, description, usage, composition, old_price, discount, unit, variants_json, option_names, delivery_info, return_info, is_bestseller, is_promotion, is_new, True, id))
    conn.commit()
    conn.close()
    return {"status": "ok"}

@router.delete("/products/{id}")
async def delete_product(id: int):
    conn = get_db_connection()
    cur = conn.execute("DELETE FROM products WHERE id=?", (id,))
    conn.commit()
    deleted_count = getattr(cur, "rowcount", 0)
    conn.close()

    if deleted_count == 0:
        raise HTTPException(status_code=404, detail="Product not found")

    return {"status": "ok"}
