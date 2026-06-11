"""Auth API router."""

from __future__ import annotations

import logging
import os
import random
import time
import requests
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests

from db import get_db_connection
from models.schemas import (
    EmailLoginRequest,
    EmailRegisterRequest,
    SmsAuthStartRequest,
    SmsAuthVerifyRequest,
    SocialAuthRequest,
    UserAuth,
)
from services.alphasms import send_sms_code
from services.auth import create_access_token, get_current_user_phone
from services.users import migrate_phone_references, normalize_phone, phone_lookup_variants


router = APIRouter()
logger = logging.getLogger(__name__)

SMS_AUTH_CODES = {}
SMS_CODE_TTL_SECONDS = 10 * 60
REGISTRATION_BONUS_AMOUNT = 150
REFERRAL_BONUS_AMOUNT = 50
DEFAULT_CASHBACK_PERCENT = 5

GOOGLE_WEB_CLIENT_ID = "451079322222-j59emqplkjkecod099fh759t2mmlr5jo.apps.googleusercontent.com"
GOOGLE_ANDROID_CLIENT_ID = "451079322222-49sf5d8pc3kb2fr10022b5im58s21ao6.apps.googleusercontent.com"


def _normalize_email(email: str) -> str:
    return (email or "").strip().lower()


def _normalize_referrer(raw_referrer: str | None, new_user_phone: str) -> str | None:
    referrer = normalize_phone(raw_referrer or "")
    if not referrer or referrer == new_user_phone:
        return None
    return referrer


def _apply_referral_bonus(cur, referrer: str | None, new_user_phone: str) -> str | None:
    """Credit 50 UAH to an existing referrer once, only when a new user is created."""
    clean_referrer = _normalize_referrer(referrer, new_user_phone)
    if not clean_referrer:
        return None

    referrer_user = cur.execute("SELECT phone FROM users WHERE phone = ?", (clean_referrer,)).fetchone()
    if not referrer_user:
        logger.info(
            "Referral skipped: referrer not found referrer=%s new_user=%s",
            clean_referrer,
            new_user_phone,
        )
        return None

    cur.execute(
        "UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + ? WHERE phone = ?",
        (REFERRAL_BONUS_AMOUNT, clean_referrer),
    )
    logger.info(
        "Referral bonus applied: referrer=%s new_user=%s amount=%s",
        clean_referrer,
        new_user_phone,
        REFERRAL_BONUS_AMOUNT,
    )
    return clean_referrer


def _verify_social_token(provider: str, token: str) -> dict:
    provider = (provider or "").strip().lower()
    token = (token or "").strip()
    if not token or provider not in ("google", "facebook"):
        raise HTTPException(status_code=400, detail="Invalid provider or token")

    if provider == "google":
        if token.count(".") != 2 or len(token) < 100:
            raise HTTPException(
                status_code=400,
                detail="Send Google id_token (JWT) from Implicit/ID Token flow",
            )

        google_web_id = os.getenv("GOOGLE_CLIENT_ID")
        allowed_audiences = [a for a in [google_web_id, GOOGLE_WEB_CLIENT_ID, GOOGLE_ANDROID_CLIENT_ID] if a]
        try:
            decoded = id_token.verify_oauth2_token(
                token,
                google_requests.Request(),
                audience=allowed_audiences if allowed_audiences else None,
            )
        except Exception:
            raise HTTPException(status_code=401, detail="Invalid Google token")

        social_id = decoded.get("sub") if decoded else None
        if not social_id:
            raise HTTPException(status_code=401, detail="Google token missing sub")

        return {
            "provider": "google",
            "social_id": social_id,
            "email": _normalize_email(decoded.get("email") or ""),
            "name": (decoded.get("name") or decoded.get("given_name") or "").strip() or None,
        }

    r = requests.get(
        "https://graph.facebook.com/me",
        params={"fields": "id,email,name", "access_token": token},
        timeout=10,
    )
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid Facebook token")

    data = r.json()
    social_id = data.get("id") if data else None
    if not social_id:
        raise HTTPException(status_code=401, detail="Facebook token missing id")

    return {
        "provider": "facebook",
        "social_id": social_id,
        "email": _normalize_email(data.get("email") or ""),
        "name": (data.get("name") or "").strip() or None,
    }


@router.post("/api/auth/email/register")
def auth_email_register(body: EmailRegisterRequest):
    raise HTTPException(
        status_code=410,
        detail="Email registration is disabled. Use SMS registration.",
    )


@router.post("/api/auth/email/login")
def auth_email_login(body: EmailLoginRequest):
    raise HTTPException(
        status_code=410,
        detail="Email login is disabled. Use SMS or Google login.",
    )


@router.post("/api/auth/sms/start")
def auth_sms_start(body: SmsAuthStartRequest):
    """
    Start SMS login/registration.
    New users can pass referrer here; it is stored with the pending SMS code.
    """
    clean_phone = normalize_phone(body.phone)
    if not clean_phone or not clean_phone.startswith("380") or len(clean_phone) != 12:
        raise HTTPException(status_code=400, detail="Invalid phone")

    code = f"{random.randint(100000, 999999)}"
    SMS_AUTH_CODES[clean_phone] = {
        "code": code,
        "expires_at": time.time() + SMS_CODE_TTL_SECONDS,
        "attempts": 0,
        "referrer": _normalize_referrer(getattr(body, "referrer", None), clean_phone),
    }

    try:
        sms_result = send_sms_code(clean_phone, code)
        logger.info("[SMS AUTH] code sent via AlphaSMS phone=%s result=%s", clean_phone, sms_result)
    except Exception:
        SMS_AUTH_CODES.pop(clean_phone, None)
        logger.exception("[SMS AUTH] AlphaSMS send failed")
        raise HTTPException(status_code=502, detail="SMS provider error")

    return {
        "status": "ok",
        "message": "SMS code sent",
        "dev_mode": False,
    }


@router.post("/api/auth/sms/verify")
def auth_sms_verify(body: SmsAuthVerifyRequest):
    """
    Verify SMS code and login/register user.
    New users receive 150 UAH once. If a valid referrer exists, the referrer receives 50 UAH once.
    """
    clean_phone = normalize_phone(body.phone)
    code = "".join(filter(str.isdigit, str(body.code or "")))

    if not clean_phone or not clean_phone.startswith("380") or len(clean_phone) != 12 or not code:
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

    pending_referrer = _normalize_referrer(getattr(body, "referrer", None), clean_phone) or record.get("referrer")

    conn = get_db_connection()
    try:
        cur = conn.cursor()
        user = cur.execute("SELECT * FROM users WHERE phone=?", (clean_phone,)).fetchone()
        is_new_user = False
        applied_referrer = None

        if not user:
            legacy_user = None
            for legacy_phone in phone_lookup_variants(clean_phone)[1:]:
                legacy_user = cur.execute("SELECT * FROM users WHERE phone=?", (legacy_phone,)).fetchone()
                if legacy_user:
                    migrate_phone_references(conn, legacy_phone, clean_phone)
                    logger.info("Migrated SMS user phone: %s -> %s", legacy_phone, clean_phone)
                    break

            if legacy_user:
                cur.execute(
                    "UPDATE users SET phone_verified = TRUE, cashback_percent = GREATEST(COALESCE(cashback_percent, 0), ?) WHERE phone = ?",
                    (DEFAULT_CASHBACK_PERCENT, clean_phone),
                )
            else:
                is_new_user = True
                applied_referrer = _apply_referral_bonus(cur, pending_referrer, clean_phone)
                logger.info(
                    "New SMS user registration: phone=%s bonus=%s cashback=%s referrer=%s",
                    clean_phone,
                    REGISTRATION_BONUS_AMOUNT,
                    DEFAULT_CASHBACK_PERCENT,
                    applied_referrer,
                )
                cur.execute(
                    """
                    INSERT INTO users (
                        phone, bonus_balance, total_spent, cashback_percent, referrer, created_at, phone_verified
                    ) VALUES (?, ?, 0, ?, ?, ?, TRUE)
                    """,
                    (
                        clean_phone,
                        REGISTRATION_BONUS_AMOUNT,
                        DEFAULT_CASHBACK_PERCENT,
                        applied_referrer,
                        datetime.now().isoformat(),
                    ),
                )
        else:
            cur.execute(
                "UPDATE users SET phone_verified = TRUE, cashback_percent = GREATEST(COALESCE(cashback_percent, 0), ?) WHERE phone = ?",
                (DEFAULT_CASHBACK_PERCENT, clean_phone),
            )

        conn.commit()
        user = cur.execute("SELECT * FROM users WHERE phone=?", (clean_phone,)).fetchone()

        SMS_AUTH_CODES.pop(clean_phone, None)

        out = dict(user)
        out["access_token"] = create_access_token(clean_phone)
        out["is_new_user"] = is_new_user
        out["referral_bonus_applied"] = bool(applied_referrer)
        out["applied_referrer"] = applied_referrer
        return out
    finally:
        conn.close()


@router.post("/api/auth")
def auth_user(ua: UserAuth):
    """
    Legacy phone-only auth is intentionally disabled.
    Registration/login must go through /api/auth/sms/start + /api/auth/sms/verify.
    """
    raise HTTPException(
        status_code=410,
        detail="Legacy phone auth is disabled. Use SMS authentication.",
    )


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
    clean_phone = normalize_phone(identifier)
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
    Login through Google/Facebook is allowed only for accounts already linked
    after SMS registration. This endpoint must not create or link accounts by
    arbitrary phone values from the request body.
    """
    social = _verify_social_token(body.provider, body.token)
    provider = social["provider"]
    social_id = social["social_id"]

    conn = get_db_connection()
    try:
        # Search only by existing linked social_id. Do not link by request phone here.
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
            linked_phone = normalize_phone(str(user_dict.get("phone") or ""))

            if not linked_phone or not user_dict.get("phone_verified"):
                raise HTTPException(
                    status_code=409,
                    detail="Use SMS login or registration first. Then Google can be linked to the account.",
                )

            out = dict(user_dict)
            out["phone"] = linked_phone
            out["access_token"] = create_access_token(linked_phone)
            out["is_new_user"] = False
            return out

        # Social login is allowed only for existing/linked accounts.
        # Registration must be completed via SMS first, so every real user has a verified phone.
        raise HTTPException(
            status_code=409,
            detail="Use SMS login or registration first. Then Google can be linked to the account.",
        )
    finally:
        conn.close()


@router.post("/api/auth/social-link")
def auth_social_link(
    body: SocialAuthRequest,
    current_user_phone: str = Depends(get_current_user_phone),
):
    """
    Securely link Google/Facebook to the currently SMS-authenticated user.
    The phone comes only from Bearer JWT, never from request body.
    """
    social = _verify_social_token(body.provider, body.token)
    provider = social["provider"]
    social_id = social["social_id"]
    clean_phone = normalize_phone(current_user_phone)

    if not clean_phone:
        raise HTTPException(status_code=401, detail="Invalid authenticated user")

    conn = get_db_connection()
    try:
        user = conn.execute(
            "SELECT * FROM users WHERE phone = %s",
            (clean_phone,),
        ).fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        user_dict = dict(user)
        if not user_dict.get("phone_verified"):
            raise HTTPException(status_code=403, detail="SMS verification is required before social linking")

        social_column = "google_id" if provider == "google" else "facebook_id"
        existing = conn.execute(
            f"SELECT phone FROM users WHERE {social_column} = %s AND phone <> %s",
            (social_id, clean_phone),
        ).fetchone()
        if existing:
            raise HTTPException(status_code=409, detail="This social account is already linked to another user")

        update_fields = [f"{social_column} = %s"]
        update_values = [social_id]

        if social.get("email") and not user_dict.get("email"):
            update_fields.append("email = %s")
            update_values.append(social["email"])

        if social.get("name") and not user_dict.get("name"):
            update_fields.append("name = %s")
            update_values.append(social["name"])

        update_values.append(clean_phone)
        conn.execute(
            f"UPDATE users SET {', '.join(update_fields)} WHERE phone = %s",
            tuple(update_values),
        )
        conn.commit()

        linked_user = conn.execute(
            "SELECT * FROM users WHERE phone = %s",
            (clean_phone,),
        ).fetchone()
        out = dict(linked_user)
        out["access_token"] = create_access_token(clean_phone)
        out["is_new_user"] = False
        out["linked_provider"] = provider
        return out
    finally:
        conn.close()
