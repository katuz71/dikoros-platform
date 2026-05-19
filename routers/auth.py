"""Auth API router."""

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


@router.post("/api/auth")
def auth_user(ua: UserAuth):
    """
    Вход или Регистрация по номеру телефона.
    Если юзера нет - создаем и даем 150 грн бонусов.
    """
    clean_phone = "".join(filter(str.isdigit, str(ua.phone)))
    if not clean_phone:
        raise HTTPException(status_code=400, detail="Invalid phone")

    conn = get_db_connection()
    user = conn.execute("SELECT * FROM users WHERE phone=?", (clean_phone,)).fetchone()
    
    if not user:
        # Pегистрация с бонусом 150 грн
        print(f"🆕 New user registration: {clean_phone}. Granting 150 bonus.")
        conn.execute("INSERT INTO users (phone, bonus_balance, total_spent, cashback_percent, created_at) VALUES (?, 150, 0, 0, ?)", (clean_phone, datetime.now().isoformat()))
        conn.commit()
        user = conn.execute("SELECT * FROM users WHERE phone=?", (clean_phone,)).fetchone()
    
    conn.close()
    return dict(user)


@router.get("/user/{identifier}")
def get_user_by_phone(identifier: str):
    """
    Поиск пользователя по номеру телефона.
    Ищет в таблице app_users.
    """
    conn = get_db_connection()
    c = conn.cursor()
    identifier = (identifier or "").strip()
    if not identifier:
        conn.close()
        raise HTTPException(status_code=400, detail="identifier is required")
    clean_phone = "".join(filter(str.isdigit, identifier))
    if not clean_phone:
        conn.close()
        raise HTTPException(status_code=400, detail="Invalid phone")
    row = c.execute(
        "SELECT id, telegram_id, phone, name, bonus_balance FROM app_users WHERE phone = ?",
        (clean_phone,),
    ).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    r = dict(row)
    r["auth_id"] = None  # поиск только по телефону
    return r


@router.post("/api/auth/social-login")
def auth_social_login(body: SocialAuthRequest):
    """
    Вход через Google або Facebook. Перевіряє токен (google-auth / graph.facebook.com),
    шукає юзера по google_id/facebook_id або по phone; якщо phone вказано і юзер існує — прив'язує social_id.
    Новий юзер отримує bonus_balance=150 та is_bonus_claimed=True. Повертає JWT та дані юзера.
    """
    provider = (body.provider or "").strip().lower()
    token = (body.token or "").strip()
    if not token or provider not in ("google", "facebook"):
        raise HTTPException(status_code=400, detail="Invalid provider or token")

    social_id = None
    email = None
    name_from_token = None

    # Допустимі Google Client ID: Web (для Android з IdToken) та Android (legacy)
    GOOGLE_WEB_CLIENT_ID = "451079322222-j59emqplkjkecod099fh759t2mmlr5jo.apps.googleusercontent.com"
    GOOGLE_ANDROID_CLIENT_ID = "451079322222-49sf5d8pc3kb2fr10022b5im58s21ao6.apps.googleusercontent.com"
    google_web_id = os.getenv("GOOGLE_CLIENT_ID")
    allowed_audiences = [a for a in [google_web_id, GOOGLE_WEB_CLIENT_ID, GOOGLE_ANDROID_CLIENT_ID] if a]

    if provider == "google":
        # Лише id_token (JWT). Implicit Flow — без обміну кода на токен.
        if token.count(".") != 2 or len(token) < 100:
            raise HTTPException(
                status_code=400,
                detail="Send Google id_token (JWT) from Implicit/ID Token flow",
            )
        try:
            decoded = id_token.verify_oauth2_token(
                token,
                google_requests.Request(),
                audience=allowed_audiences if allowed_audiences else None,
            )
        except Exception:
            raise HTTPException(status_code=401, detail="Invalid Google token")
        social_id = decoded.get("sub")
        email = (decoded.get("email") or "") if decoded else ""
        name_from_token = (decoded.get("name") or decoded.get("given_name") or "").strip() or None
        if not social_id:
            raise HTTPException(status_code=401, detail="Google token missing sub")
        phone_key = f"google_{social_id}"
    else:  # facebook
        r = requests.get(
            "https://graph.facebook.com/me",
            params={"fields": "id,email,name", "access_token": token},
            timeout=10,
        )
        if r.status_code != 200:
            raise HTTPException(status_code=401, detail="Invalid Facebook token")
        data = r.json()
        social_id = data.get("id")
        email = (data.get("email") or "") if data else ""
        name_from_token = (data.get("name") or "").strip() or None
        if not social_id:
            raise HTTPException(status_code=401, detail="Facebook token missing id")
        phone_key = f"fb_{social_id}"

    conn = get_db_connection()

    # 1) Шукаємо по social_id (google_id / facebook_id)
    if provider == "google":
        user = conn.execute(
            "SELECT * FROM users WHERE google_id = %s",
            (social_id,),
        ).fetchone()
    else:
        user = conn.execute(
            "SELECT * FROM users WHERE facebook_id = %s",
            (social_id,),
        ).fetchone()

    if user:
        user_dict = dict(user)
        conn.close()
        out = dict(user_dict)
        out["access_token"] = create_access_token(user_dict["phone"])
        # Якщо в БД збережено технічний ідентифікатор (google_*/fb_*) — не повертаємо його як телефон; клієнт має запросити номер.
        if (user_dict.get("phone") or "").startswith("google_") or (user_dict.get("phone") or "").startswith("fb_") or (user_dict.get("phone") or "").startswith("tg_"):
            out["phone"] = None
            out["needs_phone"] = True
            out["auth_id"] = user_dict["phone"]
        return out

    # 2) Якщо передано phone — шукаємо юзера по телефону і прив'язуємо social_id (без бонусу)
    if body.phone:
        clean_phone = "".join(filter(str.isdigit, str(body.phone)))
        if clean_phone:
            user_by_phone = conn.execute(
                "SELECT * FROM users WHERE phone = %s",
                (clean_phone,),
            ).fetchone()
            if user_by_phone:
                if provider == "google":
                    conn.execute(
                        "UPDATE users SET google_id = %s WHERE phone = %s",
                        (social_id, clean_phone),
                    )
                else:
                    conn.execute(
                        "UPDATE users SET facebook_id = %s WHERE phone = %s",
                        (social_id, clean_phone),
                    )
                conn.commit()
                user_by_phone = conn.execute(
                    "SELECT * FROM users WHERE phone = %s",
                    (clean_phone,),
                ).fetchone()
                conn.close()
                out = dict(user_by_phone)
                out["access_token"] = create_access_token(clean_phone)
                return out

    conn.close()
    conn = get_db_connection()

    # 3) Новий юзер: створюємо з бонусом 150 і is_bonus_claimed = True
    # Телефон не заповнюємо реальним номером (Google/FB його не дають) — зберігаємо технічний ідентифікатор для JWT/пошуку.
    # city, warehouse залишаємо порожніми (без дефолтів типу «м. Львів» / «Відділення №1»).
    bonus = 150
    conn.execute(
        """INSERT INTO users (
            phone, name, bonus_balance, total_spent, cashback_percent, created_at, email,
            google_id, facebook_id, is_bonus_claimed
        ) VALUES (%s, %s, %s, 0, 0, %s, %s, %s, %s, TRUE)""",
        (
            phone_key,
            name_from_token,
            bonus,
            datetime.now().isoformat(),
            email or None,
            social_id if provider == "google" else None,
            social_id if provider == "facebook" else None,
        ),
    )
    conn.commit()
    user = conn.execute("SELECT * FROM users WHERE phone = %s", (phone_key,)).fetchone()
    conn.close()
    if not user:
        raise HTTPException(status_code=500, detail="Failed to create user")
    out = dict(user)
    out["access_token"] = create_access_token(phone_key)
    # Новий соц. юзер — телефон не заповнювали; клієнт має запросити номер при першому вході.
    out["phone"] = None
    out["needs_phone"] = True
    out["auth_id"] = phone_key
    return out
