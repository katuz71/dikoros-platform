"""Database access helpers for the FastAPI backend.

The legacy app currently keeps DB helpers inside main.py. This module provides
an importable DB layer for new routers/services while we split the monolith.
"""

from __future__ import annotations

import os

import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

load_dotenv()


DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is required (PostgreSQL only).")


def pgify_sql(sql: str) -> str:
    """Convert sqlite-style placeholders to psycopg2 placeholders."""
    return sql.replace("?", "%s")


class PGCursorAdapter:
    """Compatibility adapter for the legacy sqlite-like cursor API."""

    def __init__(self, cursor):
        self._cursor = cursor

    def execute(self, sql: str, params=None):
        self._cursor.execute(pgify_sql(sql), params or ())
        return self

    def executemany(self, sql: str, seq_of_params):
        self._cursor.executemany(pgify_sql(sql), seq_of_params)
        return self

    def fetchone(self):
        return self._cursor.fetchone()

    def fetchall(self):
        return self._cursor.fetchall()

    def close(self):
        return self._cursor.close()

    @property
    def rowcount(self):
        return self._cursor.rowcount

    def __getattr__(self, item):
        return getattr(self._cursor, item)


class PGConnAdapter:
    """Compatibility adapter for the legacy sqlite-like connection API."""

    def __init__(self, conn):
        self._conn = conn

    def execute(self, sql: str, params=None):
        cur = PGCursorAdapter(self._conn.cursor(cursor_factory=RealDictCursor))
        return cur.execute(sql, params)

    def cursor(self):
        return PGCursorAdapter(self._conn.cursor(cursor_factory=RealDictCursor))

    def commit(self):
        self._conn.commit()

    def rollback(self):
        self._conn.rollback()

    def close(self):
        self._conn.close()


def get_db_connection() -> PGConnAdapter:
    raw = psycopg2.connect(DATABASE_URL)
    return PGConnAdapter(raw)


def init_db_schema() -> None:
    """Create and migrate database tables.

    This function intentionally mirrors the current legacy startup schema logic.
    It is kept separate so future routers/services do not depend on main.py.
    """
    conn = get_db_connection()
    c = conn.cursor()

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
            variant_name TEXT,
            sort_order INTEGER,
            home_hit_order INTEGER,
            home_new_order INTEGER,
            home_promotion_order INTEGER
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

    c.execute('''
        CREATE TABLE IF NOT EXISTS category_banners (
            id BIGSERIAL PRIMARY KEY,
            category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
            image_url VARCHAR(255)
        )
    ''')

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

    migrations = [
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS composition TEXT",
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS images TEXT",
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS variants TEXT",
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS option_names TEXT",
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS delivery_info TEXT",
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS return_info TEXT",
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS external_id TEXT",
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS is_bestseller BOOLEAN DEFAULT FALSE",
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS is_promotion BOOLEAN DEFAULT FALSE",
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS is_new BOOLEAN DEFAULT FALSE",
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS discount INTEGER DEFAULT 0",
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS is_manually_edited BOOLEAN DEFAULT FALSE",
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS sku TEXT",
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'В наличии'",
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS remains INTEGER DEFAULT 0",
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS parent_sku TEXT",
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS variant_name TEXT",
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS sort_order INTEGER",
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS home_hit_order INTEGER",
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS home_new_order INTEGER",
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS home_promotion_order INTEGER",
        "ALTER TABLE categories ADD COLUMN IF NOT EXISTS banner_url VARCHAR(255)",
        "ALTER TABLE categories ADD COLUMN IF NOT EXISTS external_id TEXT",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS user_ukrposhta TEXT",
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_method TEXT",
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS user_ukrposhta TEXT",
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS push_token TEXT",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id TEXT",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS facebook_id TEXT",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_id TEXT",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_bonus_claimed BOOLEAN DEFAULT FALSE",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS push_token TEXT",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS welcome_push_sent BOOLEAN DEFAULT FALSE",
    ]

    for sql in migrations:
        c.execute(sql)

    optional_index_sql = [
        "CREATE UNIQUE INDEX IF NOT EXISTS products_external_id_uq ON products (external_id)",
        "CREATE UNIQUE INDEX IF NOT EXISTS users_google_id_key ON users (google_id) WHERE google_id IS NOT NULL",
        "CREATE UNIQUE INDEX IF NOT EXISTS users_facebook_id_key ON users (facebook_id) WHERE facebook_id IS NOT NULL",
        "CREATE UNIQUE INDEX IF NOT EXISTS users_telegram_id_key ON users (telegram_id) WHERE telegram_id IS NOT NULL",
    ]
    for sql in optional_index_sql:
        try:
            c.execute(sql)
        except Exception:
            pass

    conn.commit()
    conn.close()
