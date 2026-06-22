"""Database schema initialization and lightweight migrations."""

from __future__ import annotations

from db import get_db_connection


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
            variant_options TEXT,
            external_id TEXT UNIQUE,
            is_bestseller BOOLEAN DEFAULT FALSE,
            is_hit BOOLEAN DEFAULT FALSE,
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
            last_name TEXT,
            middle_name TEXT,
            city TEXT,
            city_ref TEXT,
            warehouse TEXT,
            warehouse_ref TEXT,
            user_ukrposhta TEXT,
            email TEXT,
            contact_preference TEXT DEFAULT 'call',
            recipient_name TEXT,
            recipient_phone TEXT,
            is_different_recipient BOOLEAN DEFAULT FALSE,
            do_not_call BOOLEAN DEFAULT FALSE,
            delivery_method TEXT,
            payment_method TEXT,
            checkout_comment TEXT,
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
        CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
    ''')
    c.execute(
        """
        INSERT INTO app_settings (key, value)
        VALUES ('global_cashback_percent', '5')
        ON CONFLICT (key) DO NOTHING
        """
    )

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
    c.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS variant_options TEXT")
    c.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS delivery_info TEXT")
    c.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS return_info TEXT")
    c.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS external_id TEXT")
    c.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS is_bestseller BOOLEAN DEFAULT FALSE")
    c.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS is_hit BOOLEAN DEFAULT FALSE")
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
        c.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS sort_order INTEGER")
        c.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS home_hit_order INTEGER")
        c.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS home_new_order INTEGER")
        c.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS home_promotion_order INTEGER")
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
    c.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS referrer TEXT")
    c.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name TEXT")
    c.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS middle_name TEXT")
    c.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS city_ref TEXT")
    c.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS warehouse_ref TEXT")
    c.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS recipient_name TEXT")
    c.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS recipient_phone TEXT")
    c.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_different_recipient BOOLEAN DEFAULT FALSE")
    c.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS do_not_call BOOLEAN DEFAULT FALSE")
    c.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS delivery_method TEXT")
    c.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS payment_method TEXT")
    c.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS checkout_comment TEXT")
    # Orders: delivery type and Ukrposhta address
    c.execute("ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_method TEXT")
    c.execute("ALTER TABLE orders ADD COLUMN IF NOT EXISTS user_ukrposhta TEXT")
    c.execute("ALTER TABLE orders ADD COLUMN IF NOT EXISTS push_token TEXT")
    c.execute("ALTER TABLE orders ADD COLUMN IF NOT EXISTS subtotal_price DOUBLE PRECISION")
    c.execute("ALTER TABLE orders ADD COLUMN IF NOT EXISTS cumulative_discount_percent INTEGER DEFAULT 0")
    c.execute("ALTER TABLE orders ADD COLUMN IF NOT EXISTS cumulative_discount_amount DOUBLE PRECISION DEFAULT 0")
    c.execute("ALTER TABLE orders ADD COLUMN IF NOT EXISTS cashback_earned INTEGER DEFAULT 0")
    c.execute("ALTER TABLE orders ADD COLUMN IF NOT EXISTS cashback_applied BOOLEAN DEFAULT FALSE")
    # User: social ids and bonus protection
    c.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id TEXT")
    c.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS facebook_id TEXT")
    c.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_id TEXT")
    c.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_bonus_claimed BOOLEAN DEFAULT FALSE")
    c.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS push_token TEXT")
    c.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS welcome_push_sent BOOLEAN DEFAULT FALSE")
    c.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT")
    c.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE")
    c.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN DEFAULT FALSE")
    # cashback_percent is retained as a legacy compatibility field for the
    # cumulative discount. Global cashback lives in app_settings.
    c.execute(
        """
        UPDATE users
        SET cashback_percent = CASE
            WHEN COALESCE(total_spent, 0) < 1999 THEN 0
            WHEN COALESCE(total_spent, 0) < 5000 THEN 5
            WHEN COALESCE(total_spent, 0) < 10000 THEN 10
            WHEN COALESCE(total_spent, 0) < 25000 THEN 15
            ELSE 20
        END
        """
    )
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
