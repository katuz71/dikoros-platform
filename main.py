import tempfile
import time
import requests
import json
import os
import httpx
import asyncio
import uuid
import logging
import csv
from io import StringIO
from datetime import datetime
from typing import List, Optional, Any, Dict
from urllib.parse import quote
import re
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests

from fastapi import FastAPI, HTTPException, Request, UploadFile, File, Form, BackgroundTasks, Depends, Header, Body
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
load_dotenv()

from services.notifications import send_expo_push
from services.onebox_api import create_onebox_order, OneBoxDbSession, Product
from routers import health, public_pages, delivery, uploads, analytics, categories, banners, reviews, promo_codes, chat, posts, orders, products, users, auth, admin_tools, sync, admin_page
from services.images import UPLOADS_DIR, save_uploaded_image
from db import DATABASE_URL, get_db_connection
from services.products import get_products_by_ids
from services.users import (
    calculate_cashback_percent,
    clean_warehouse_value,
    normalize_phone,
)
from services.auth import (
    JWT_ALGORITHM,
    JWT_EXPIRE_HOURS,
    JWT_SECRET,
    PUBLIC_BASE_URL,
    TELEGRAM_BOT_NAME,
    TELEGRAM_BOT_TOKEN,
    create_access_token,
    get_current_user_phone,
    verify_telegram_hash,
)
from models.schemas import (
    AdminUserUpdate,
    BannerCreate,
    BatchDelete,
    BatchDeleteUsers,
    CategoryCreate,
    CategoryResponse,
    ChatMessage,
    ChatRequest,
    ChatResponse,
    OrderItem,
    OrderRequest,
    OrderStatusUpdate,
    ProductCreate,
    ProductResponse,
    ProductUpdate,
    PromoCodeCreate,
    PromoCodeValidate,
    PushTokenRequest,
    ReviewCreate,
    SocialAuthRequest,
    SocialLoginRequest,
    UserAuth,
    UserInfoUpdate,
    UserResponse,
)

from PIL import Image as PILImage, ImageOps

import psycopg2
from sqlalchemy import Column, String, Boolean, Integer, Float, Text
from sqlalchemy.ext.declarative import declarative_base

Base = declarative_base()



class LegacyUser(Base):
    """Legacy: пользователь по телефону (таблица users)."""
    __tablename__ = "users"
    phone = Column(Text, primary_key=True)
    bonus_balance = Column(Integer, default=0)
    total_spent = Column(Float, default=0)
    cashback_percent = Column(Integer, default=0)
    referrer = Column(Text, nullable=True)
    created_at = Column(Text, nullable=True)
    name = Column(Text, nullable=True)
    city = Column(Text, nullable=True)
    warehouse = Column(Text, nullable=True)
    user_ukrposhta = Column(Text, nullable=True)
    email = Column(Text, nullable=True)
    contact_preference = Column(Text, default="call")
    google_id = Column(String(255), unique=True, index=True, nullable=True)
    facebook_id = Column(String(255), unique=True, index=True, nullable=True)
    telegram_id = Column(String(64), unique=True, index=True, nullable=True)
    is_bonus_claimed = Column(Boolean, default=False)
    push_token = Column(String, nullable=True)


class User(Base):
    """Пользователь приложения: id, telegram_id, phone, name, bonus_balance (таблица app_users)."""
    __tablename__ = "app_users"
    id = Column(Integer, primary_key=True, autoincrement=True)
    telegram_id = Column(String(64), unique=True, nullable=True, index=True)
    phone = Column(String(50), nullable=True, index=True)
    name = Column(String(255), nullable=False, default="")
    bonus_balance = Column(Float, default=150.0)


# Initialize OpenAI Client
openai_client = None



# Ключ Нової Пошти (з середовища або дефолтний)
NOVA_POSHTA_API_KEY = os.getenv("NOVA_POSHTA_API_KEY")
if not NOVA_POSHTA_API_KEY:
    raise RuntimeError("NOVA_POSHTA_API_KEY is not set in environment")


api_key = os.getenv("OPENAI_API_KEY")

if api_key:
    try:
        from openai import AsyncOpenAI
        openai_client = AsyncOpenAI(api_key=api_key)
        print("✅ OpenAI client initialized")
    except ImportError:
        print("⚠️ OpenAI library not installed. Install via: pip install openai")
else:
    print("⚠️ No OPENAI_API_KEY found. Chat will use basic search.")

# --- НАСТРОЙКИ ---
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

load_dotenv()

# --- ПАПКИ ---
os.makedirs("uploads", exist_ok=True)

# --- БАЗА ДАННЫХ ---

def fix_db_schema():
    conn = get_db_connection()
    c = conn.cursor()

    # Tables (PostgreSQL)
    c.execute('''
        CREATE TABLE IF NOT EXISTS products (
            id BIGSERIAL PRIMARY KEY,
            name TEXT,
            price DOUBLE PRECISION,
            discount INTEGER DEFAULT 0,
            image TEXT,
            images TEXT,
            category TEXT,
            pack_sizes TEXT,
            old_price DOUBLE PRECISION,
            unit TEXT DEFAULT 'шт',
            description TEXT,
            usage TEXT,
            composition TEXT,
            delivery_info TEXT,
            return_info TEXT,
            variants TEXT,
            option_names TEXT,
            external_id TEXT UNIQUE,
            is_bestseller BOOLEAN DEFAULT FALSE,
            is_promotion BOOLEAN DEFAULT FALSE,
            is_new BOOLEAN DEFAULT FALSE,
            sku TEXT,
            status TEXT DEFAULT 'В наличии',
            remains INTEGER DEFAULT 0,
            parent_sku TEXT,
            variant_name TEXT
        )
    ''')

    c.execute('''
        CREATE TABLE IF NOT EXISTS users (
            phone TEXT PRIMARY KEY,
            bonus_balance INTEGER DEFAULT 0,
            total_spent DOUBLE PRECISION DEFAULT 0,
            cashback_percent INTEGER DEFAULT 0,
            referrer TEXT,
            created_at TEXT,
            name TEXT,
            city TEXT,
            warehouse TEXT,
            user_ukrposhta TEXT,
            email TEXT,
            contact_preference TEXT DEFAULT 'call',
            google_id TEXT UNIQUE,
            facebook_id TEXT UNIQUE,
            is_bonus_claimed BOOLEAN DEFAULT FALSE
        )
    ''')

    c.execute('''
        CREATE TABLE IF NOT EXISTS app_users (
            id BIGSERIAL PRIMARY KEY,
            telegram_id VARCHAR(64) UNIQUE,
            phone VARCHAR(50),
            name TEXT NOT NULL DEFAULT '',
            bonus_balance DOUBLE PRECISION DEFAULT 150
        )
    ''')

    c.execute('''
        CREATE TABLE IF NOT EXISTS orders (
            id BIGSERIAL PRIMARY KEY,
            name TEXT,
            phone TEXT,
            user_phone TEXT,
            email TEXT,
            contact_preference TEXT DEFAULT 'call',
            city TEXT,
            city_ref TEXT,
            warehouse TEXT,
            warehouse_ref TEXT,
            items TEXT,
            total_price DOUBLE PRECISION,
            payment_method TEXT DEFAULT 'card',
            bonus_used INTEGER DEFAULT 0,
            status TEXT DEFAULT 'New',
            date TEXT
        )
    ''')

    c.execute('''
        CREATE TABLE IF NOT EXISTS categories (
            id BIGSERIAL PRIMARY KEY,
            name TEXT UNIQUE,
            banner_url VARCHAR(255)
        )
    ''')

    c.execute('''CREATE TABLE IF NOT EXISTS category_banners (
        id BIGSERIAL PRIMARY KEY,
        category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
        image_url VARCHAR(255)
    )''')

    c.execute('''
        CREATE TABLE IF NOT EXISTS banners (
            id BIGSERIAL PRIMARY KEY,
            image_url TEXT
        )
    ''')

    c.execute('''
        CREATE TABLE IF NOT EXISTS promo_codes (
            id BIGSERIAL PRIMARY KEY,
            code TEXT UNIQUE NOT NULL,
            discount_percent INTEGER DEFAULT 0,
            discount_amount DOUBLE PRECISION DEFAULT 0,
            max_uses INTEGER DEFAULT 0,
            current_uses INTEGER DEFAULT 0,
            active INTEGER DEFAULT 1,
            expires_at TEXT,
            created_at TEXT
        )
    ''')

    c.execute('''
        CREATE TABLE IF NOT EXISTS reviews (
            id BIGSERIAL PRIMARY KEY,
            product_id BIGINT NOT NULL,
            user_name TEXT,
            user_phone TEXT,
            rating INTEGER NOT NULL,
            comment TEXT,
            created_at TEXT
        )
    ''')

    c.execute('''
        CREATE TABLE IF NOT EXISTS posts (
            id BIGSERIAL PRIMARY KEY,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            image_url TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    # Column migrations (idempotent in Postgres)
    c.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS composition TEXT")
    c.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS images TEXT")
    c.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS variants TEXT")
    c.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS option_names TEXT")
    c.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS delivery_info TEXT")
    c.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS return_info TEXT")
    c.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS external_id TEXT")
    c.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS is_bestseller BOOLEAN DEFAULT FALSE")
    c.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS is_promotion BOOLEAN DEFAULT FALSE")
    c.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS is_new BOOLEAN DEFAULT FALSE")
    c.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS discount INTEGER DEFAULT 0")
    c.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS is_manually_edited BOOLEAN DEFAULT FALSE")
    
    try:
        c.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS sku TEXT")
        c.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'В наличии'")
        c.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS remains INTEGER DEFAULT 0")
        c.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS parent_sku TEXT")
        c.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS variant_name TEXT")
    except Exception:
        pass
    try:
        c.execute("CREATE UNIQUE INDEX IF NOT EXISTS products_external_id_uq ON products (external_id)")
    except Exception:
        # If duplicates already exist, index creation may fail; keep server running.
        pass

    c.execute("ALTER TABLE categories ADD COLUMN IF NOT EXISTS banner_url VARCHAR(255)")
    c.execute("ALTER TABLE categories ADD COLUMN IF NOT EXISTS external_id TEXT")
    # User: Nova Poshta branch (warehouse) and Ukrposhta address
    c.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS user_ukrposhta TEXT")
    # Orders: delivery type and Ukrposhta address
    c.execute("ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_method TEXT")
    c.execute("ALTER TABLE orders ADD COLUMN IF NOT EXISTS user_ukrposhta TEXT")
    c.execute("ALTER TABLE orders ADD COLUMN IF NOT EXISTS push_token TEXT")
    # User: social ids and bonus protection
    c.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id TEXT")
    c.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS facebook_id TEXT")
    c.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_id TEXT")
    c.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_bonus_claimed BOOLEAN DEFAULT FALSE")
    c.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS push_token TEXT")
    c.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS welcome_push_sent BOOLEAN DEFAULT FALSE")
    try:
        c.execute("CREATE UNIQUE INDEX IF NOT EXISTS users_google_id_key ON users (google_id) WHERE google_id IS NOT NULL")
    except Exception:
        pass
    try:
        c.execute("CREATE UNIQUE INDEX IF NOT EXISTS users_facebook_id_key ON users (facebook_id) WHERE facebook_id IS NOT NULL")
    except Exception:
        pass
    try:
        c.execute("CREATE UNIQUE INDEX IF NOT EXISTS users_telegram_id_key ON users (telegram_id) WHERE telegram_id IS NOT NULL")
    except Exception:
        pass

    conn.commit()
    conn.close()


def init_db():
    """Инициализация БД (создание таблиц в т.ч. posts для блога). Вызывает fix_db_schema()."""
    fix_db_schema()


# --- APP ---
app = FastAPI()
app.include_router(health.router)
app.include_router(public_pages.router)
app.include_router(delivery.router)
app.include_router(uploads.router)
app.include_router(analytics.router)
app.include_router(categories.router)
app.include_router(banners.router)
app.include_router(reviews.router)
app.include_router(promo_codes.router)
app.include_router(chat.router)
app.include_router(posts.router)
app.include_router(orders.router)
app.include_router(products.router)
app.include_router(users.router)
app.include_router(auth.router)
app.include_router(admin_tools.router)
app.include_router(sync.router)
app.include_router(admin_page.router)
templates = Jinja2Templates(directory="templates")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)










app.mount("/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")

# --- INITIALIZATION ---
# --- SYNC CONFIG ---
@app.on_event("startup")
def startup_event():
    fix_db_schema()
    # Создаем admin.html из строки только если его нет
    # Это позволяет вручную обновлять admin.html без перезаписи
    # if not os.path.exists("admin.html"):
    #     with open("admin.html", "w", encoding="utf-8") as f:
    #         f.write(ADMIN_HTML_CONTENT)
    print("✅ Server started successfully")

# --- ONEBOX ---


# --- API ENDPOINTS ---
