from pathlib import Path

main_path = Path("main.py")
auth_path = Path("routers/auth.py")

main = main_path.read_text(encoding="utf-8")

start_marker = '@app.post("/api/auth")'
end_marker = '@app.post("/upload_csv")'

start = main.find(start_marker)
end = main.find(end_marker)

if start == -1:
    raise SystemExit("Auth block start not found")
if end == -1:
    raise SystemExit("upload_csv marker not found")
if end <= start:
    raise SystemExit("Invalid auth block range")

auth_block = main[start:end].strip()

auth_block = auth_block.replace("@app.get(", "@router.get(")
auth_block = auth_block.replace("@app.post(", "@router.post(")
auth_block = auth_block.replace("@app.put(", "@router.put(")
auth_block = auth_block.replace("@app.delete(", "@router.delete(")

auth_content = '''"""Auth API router."""

from __future__ import annotations

import os
import requests
from datetime import datetime

from fastapi import APIRouter, HTTPException
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests

from db import get_db_connection
from models.schemas import SocialAuthRequest, UserAuth
from services.auth import create_access_token


router = APIRouter()


''' + auth_block + "\n"

auth_path.write_text(auth_content, encoding="utf-8")

new_main = main[:start].rstrip() + "\n\n" + main[end:]

old_import = "from routers import health, public_pages, delivery, uploads, analytics, categories, banners, reviews, promo_codes, chat, posts, orders, products, users"
new_import = "from routers import health, public_pages, delivery, uploads, analytics, categories, banners, reviews, promo_codes, chat, posts, orders, products, users, auth"

if old_import in new_main:
    new_main = new_main.replace(old_import, new_import)
elif new_import not in new_main:
    raise SystemExit("Router import line not found")

include_marker = "app.include_router(users.router)"
include_line = "app.include_router(auth.router)"

if include_line not in new_main:
    if include_marker in new_main:
        new_main = new_main.replace(include_marker, include_marker + "\n" + include_line)
    else:
        raise SystemExit("users router include marker not found")

main_path.write_text(new_main, encoding="utf-8")

print("OK: auth router extracted and connected")
