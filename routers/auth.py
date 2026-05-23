"""Auth API router."""

from __future__ import annotations

import logging
import os
import random
import time
import requests
from datetime import datetime

from fastapi import APIRouter, HTTPException
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests

from db import get_db_connection
from models.schemas import SocialAuthRequest, UserAuth, SmsAuthStartRequest, SmsAuthVerifyRequest, EmailRegisterRequest, EmailLoginRequest
from services.auth import create_access_token, hash_password, verify_password


router = APIRouter()
logger = logging.getLogger(__name__)

SMS_AUTH_CODES = {}
SMS_CODE_TTL_SECONDS = 10 * 60



def _normalize_email(email: str) -> str:
    return (email or "").strip().lower()


@router.post("/api/auth/email/register")
def auth_email_register(body: EmailRegisterRequest):
    email = _normalize_email(body.email)
    password = body.password or ""
    name = (body.name or "").strip() or None

    if not email or "@" not in email or "." not in email:
        raise HTTPException(status_code=400, detail="Invalid email")

    try:
        password_hash = hash_password(password)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    auth_id = f"email_{email}"

    conn = get_db_connection()
    try:
        existing = conn.execute(
            "SELECT * FROM users WHERE email = %s OR phone = %s",
            (email, auth_id),
        ).fetchone()

        if existing:
            raise HTTPException(status_code=409, detail="Email already registered")

        logger.info("New email user registration: email=%s bonus=%s", email, 150)

        conn.execute(
            """INSERT INTO users (
                phone, name, email, password_hash, email_verified,
                bonus_balance, total_spent, cashback_percent, created_at, is_bonus_claimed
            ) VALUES (%s, %s, %s, %s, TRUE, 150, 0, 0, %s, TRUE)""",
            (auth_id, name, email, password_hash, datetime.now().isoformat()),
        )
        conn.commit()

        user = conn.execute("SELECT * FROM users WHERE phone = %s", (auth_id,)).fetchone()
        if not user:
            raise HTTPException(status_code=500, detail="Failed to create user")

        out = dict(user)
        out["access_token"] = create_access_token(auth_id)
        out["is_new_user"] = True
        out["phone"] = None
        out["needs_phone"] = True
        out["auth_id"] = auth_id
        return out
    finally:
        conn.close()


@router.post("/api/auth/email/login")
def auth_email_login(body: EmailLoginRequest):
    email = _normalize_email(body.email)
    password = body.password or ""

    if not email or not password:
        raise HTTPException(status_code=400, detail="Invalid email or password")

    conn = get_db_connection()
    try:
        user = conn.execute("SELECT * FROM users WHERE email = %s", (email,)).fetchone()

        if not user:
            raise HTTPException(status_code=401, detail="Invalid email or password")

        user_dict = dict(user)
        if not verify_password(password, user_dict.get("password_hash") or ""):
            raise HTTPException(status_code=401, detail="Invalid email or password")

        auth_id = user_dict.get("phone") or f"email_{email}"

        out = dict(user_dict)
        out["access_token"] = create_access_token(auth_id)
        out["is_new_user"] = False

        if str(auth_id).startswith("email_"):
            out["phone"] = None
            out["needs_phone"] = True
            out["auth_id"] = auth_id

        return out
    finally:
        conn.close()


@router.post("/api/auth/sms/start")
def auth_sms_start(body: SmsAuthStartRequest):
    """
    Start SMS login/registration.
    Dev mode: generates code and writes it to backend logs.
    Later this function will call the real SMS provider.
    """
    clean_phone = "".join(filter(str.isdigit, str(body.phone)))
    if not clean_phone:
        raise HTTPException(status_code=400, detail="Invalid phone")

    code = f"{random.randint(100000, 999999)}"
    SMS_AUTH_CODES[clean_phone] = {
        "code": code,
        "expires_at": time.time() + SMS_CODE_TTL_SECONDS,
        "attempts": 0,
    }

    logger.warning("[SMS AUTH DEV] phone=%s code=%s", clean_phone, code)

    return {
        "status": "ok",
        "message": "SMS code generated",
        "dev_mode": True,
    }


@router.post("/api/auth/sms/verify")
def auth_sms_verify(body: SmsAuthVerifyRequest):
    """
    Verify SMS code and login/register user.
    New users receive 150 bonus only once at account creation.
    """
    clean_phone = "".join(filter(str.isdigit, str(body.phone)))
    code = (body.code or "").strip()

    if not clean_phone or not code:
        raise HTTPException(status_code=400, detail="Invalid phone or code")

    record = SMS_AUTH_CODES.get(clean_phone)
    if not record:
        raise HTTPException(status_code=400, detail="SMS code not found")

    if time.time() > float(record.get("expires_at") or 0):
        SMS_AUTH_CODES.pop(clean_phone, None)
        raise HTTPException(status_code=400, detail="SMS code expired")

    record["attempts"] = int(record.get("attempts") or 0) + 1
    if record["attempts"] > 5:
        SMS_AUTH_CODES.pop(clean_phone, None)
        raise HTTPException(status_code=429, detail="Too many attempts")

    if str(record.get("code")) != code:
        raise HTTPException(status_code=400, detail="Invalid SMS code")

    conn = get_db_connection()
    try:
        user = conn.execute("SELECT * FROM users WHERE phone=?", (clean_phone,)).fetchone()
        is_new_user = False

        if not user:
            is_new_user = True
            logger.info("New SMS user registration: phone=%s bonus=%s", clean_phone, 150)
            conn.execute(
                "INSERT INTO users (phone, bonus_balance, total_spent, cashback_percent, created_at) VALUES (?, 150, 0, 0, ?)",
                (clean_phone, datetime.now().isoformat()),
            )
            conn.commit()
            user = conn.execute("SELECT * FROM users WHERE phone=?", (clean_phone,)).fetchone()

        SMS_AUTH_CODES.pop(clean_phone, None)

        out = dict(user)
        out["access_token"] = create_access_token(clean_phone)
        out["is_new_user"] = is_new_user
        return out
    finally:
        conn.close()


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
        logger.info("New user registration: phone=%s bonus=%s", clean_phone, 150)
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
        out["is_new_user"] = False
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
                out["is_new_user"] = False
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
    out["is_new_user"] = True
    # Новий соц. юзер — телефон не заповнювали; клієнт має запросити номер при першому вході.
    out["phone"] = None
    out["needs_phone"] = True
    out["auth_id"] = phone_key
    return out
