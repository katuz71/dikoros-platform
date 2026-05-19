from pathlib import Path

main_path = Path("main.py")
products_path = Path("routers/products.py")

main = main_path.read_text(encoding="utf-8")

start_marker = "# 1. ТОВАРЫ"
end_marker = '@app.get("/user/{phone}"'

start = main.find(start_marker)
end = main.find(end_marker)

if start == -1:
    raise SystemExit("Products block start not found")
if end == -1:
    raise SystemExit("User profile marker not found")
if end <= start:
    raise SystemExit("Invalid products block range")

products_block = main[start:end].strip()

products_block = products_block.replace("@app.get(", "@router.get(")
products_block = products_block.replace("@app.post(", "@router.post(")
products_block = products_block.replace("@app.put(", "@router.put(")
products_block = products_block.replace("@app.delete(", "@router.delete(")

# На случай если в блоке осталось старое имя нормализатора
products_block = products_block.replace("_normalize_product_row(", "normalize_product_row(")

products_content = '''"""Products API router."""

from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter, HTTPException, Request

from db import get_db_connection
from models.schemas import ProductCreate, ProductUpdate
from services.images import save_uploaded_image
from services.products import normalize_product_row


router = APIRouter()


''' + products_block + "\n"

products_path.write_text(products_content, encoding="utf-8")

new_main = main[:start].rstrip() + "\n\n" + main[end:]

old_import = "from routers import health, public_pages, delivery, uploads, analytics, categories, banners, reviews, promo_codes, chat, posts, orders"
new_import = "from routers import health, public_pages, delivery, uploads, analytics, categories, banners, reviews, promo_codes, chat, posts, orders, products"

if old_import in new_main:
    new_main = new_main.replace(old_import, new_import)
elif new_import not in new_main:
    raise SystemExit("Router import line not found")

include_marker = "app.include_router(orders.router)"
include_line = "app.include_router(products.router)"

if include_line not in new_main:
    if include_marker in new_main:
        new_main = new_main.replace(include_marker, include_marker + "\n" + include_line)
    else:
        raise SystemExit("orders router include marker not found")

main_path.write_text(new_main, encoding="utf-8")

print("OK: products router extracted and connected")
