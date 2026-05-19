from pathlib import Path

p = Path("routers/products.py")
s = p.read_text(encoding="utf-8")

start = s.find('@router.put("/products/{id}")')
end = s.find('\n@router.delete("/products/{id}")', start)

if start == -1:
    raise SystemExit("update_product start not found")
if end == -1:
    raise SystemExit("delete_product marker not found")

new_block = '''@router.put("/products/{id}")
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

'''

s = s[:start] + new_block + s[end:]
p.write_text(s, encoding="utf-8")

print("OK: update_product now closes DB connection with finally")
