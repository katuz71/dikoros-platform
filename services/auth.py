"""Authentication helpers for the FastAPI backend."""

from __future__ import annotations

import hashlib
import hmac
import os
from datetime import datetime, timedelta
from typing import Any, Dict, Optional

import jwt
from fastapi import Header, HTTPException


JWT_SECRET = os.getenv("JWT_SECRET")
if not JWT_SECRET:
    raise RuntimeError("JWT_SECRET is not set in environment")

JWT_ALGORITHM = "HS256"
JWT_EXPIRE_HOURS = 24 * 30
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_BOT_NAME = os.getenv("TELEGRAM_BOT_NAME", "DikorosUaBot")
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "").rstrip("/")


PASSWORD_PEPPER = os.getenv("PASSWORD_PEPPER", JWT_SECRET)


def hash_password(password: str) -> str:
    """Hash password with PBKDF2-HMAC-SHA256."""
    if not password or len(password) < 6:
        raise ValueError("Password must be at least 6 characters")

    salt = os.urandom(16)
    password_bytes = (password + PASSWORD_PEPPER).encode("utf-8")
    digest = hashlib.pbkdf2_hmac("sha256", password_bytes, salt, 120_000)
    return f"pbkdf2_sha256$120000${salt.hex()}${digest.hex()}"


def verify_password(password: str, password_hash: str) -> bool:
    """Verify password against stored PBKDF2 hash."""
    try:
        algorithm, iterations_raw, salt_hex, digest_hex = (password_hash or "").split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False

        iterations = int(iterations_raw)
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(digest_hex)
        password_bytes = (password + PASSWORD_PEPPER).encode("utf-8")
        actual = hashlib.pbkdf2_hmac("sha256", password_bytes, salt, iterations)
        return hmac.compare_digest(actual, expected)
    except Exception:
        return False


def create_access_token(phone: str) -> str:
    """Create a JWT access token for a user identifier."""
    payload = {"sub": phone, "exp": datetime.utcnow() + timedelta(hours=JWT_EXPIRE_HOURS)}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def verify_telegram_hash(data: Dict[str, Any], received_hash: str) -> bool:
    """Verify Telegram Login Widget signature."""
    if not TELEGRAM_BOT_TOKEN or not received_hash:
        return False
    data_copy = {
        key: (str(value) if value is not None else "")
        for key, value in data.items()
        if key != "hash" and value is not None and value != ""
    }
    data_check_string = "\n".join(f"{key}={value}" for key, value in sorted(data_copy.items()))
    secret_key = hashlib.sha256(TELEGRAM_BOT_TOKEN.encode("utf-8")).digest()
    computed_hash = hmac.new(secret_key, data_check_string.encode("utf-8"), hashlib.sha256).hexdigest()
    return hmac.compare_digest(computed_hash, received_hash)


def get_current_user_phone(authorization: Optional[str] = Header(None, alias="Authorization")) -> str:
    """Read and validate Bearer JWT; return payload subject."""
    if not authorization or not authorization.strip().startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid authorization")
    token = authorization.strip()[7:]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        subject = payload.get("sub")
        if not subject:
            raise HTTPException(status_code=401, detail="Invalid token")
        return str(subject)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
