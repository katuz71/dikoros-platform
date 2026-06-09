"""User-related helpers for the FastAPI backend."""

from __future__ import annotations

import re
from typing import Optional


def clean_warehouse_value(value: Optional[str]) -> Optional[str]:
    """Remove delivery provider prefixes before storing warehouse/address values."""
    if not value or not isinstance(value, str):
        return value
    cleaned = value.strip()
    for prefix in ("Нова Пошта:", "Нова почта:", "Нова Пошта：", "Укрпошта:", "Укрпочта:"):
        if cleaned.lower().startswith(prefix.rstrip(":").lower()):
            cleaned = cleaned[len(prefix) :].strip()
            break
    cleaned = re.sub(r"\s*Нова\s+[Пп]очта\s*:?\s*", "", cleaned, flags=re.I).strip()
    cleaned = re.sub(r"\s*Укрпошта\s*:?\s*", "", cleaned, flags=re.I).strip()
    return cleaned if cleaned else None


def normalize_phone(phone: str) -> str:
    """Normalize phone/auth identifier while preserving social auth technical IDs."""
    value = str(phone).strip()
    if value.startswith("google_") or value.startswith("fb_") or value.startswith("tg_"):
        return value

    digits = "".join(filter(str.isdigit, value))
    if not digits:
        return ""

    if digits.startswith("380") and len(digits) == 12:
        return digits
    if digits.startswith("80") and len(digits) == 11:
        return f"3{digits}"
    if digits.startswith("0") and len(digits) == 10:
        return f"38{digits}"
    if len(digits) == 9:
        return f"380{digits}"

    return digits


def phone_lookup_variants(phone: str) -> list[str]:
    """Return canonical and legacy phone spellings for the same Ukrainian number."""
    canonical = normalize_phone(phone)
    if not canonical:
        return []

    variants = [canonical]
    if canonical.startswith("380") and len(canonical) == 12:
        local = f"0{canonical[3:]}"
        variants.extend([local, f"8{local}", canonical[3:]])

    seen = set()
    unique = []
    for variant in variants:
        if variant and variant not in seen:
            seen.add(variant)
            unique.append(variant)
    return unique


def migrate_phone_references(conn, old_phone: str, new_phone: str) -> None:
    """Move legacy phone references to the canonical account phone."""
    old_clean = str(old_phone or "").strip()
    new_clean = normalize_phone(new_phone)
    if not old_clean or not new_clean or old_clean == new_clean:
        return

    cur = conn.cursor()
    cur.execute("UPDATE users SET phone = ? WHERE phone = ?", (new_clean, old_clean))
    cur.execute("UPDATE orders SET phone = ? WHERE phone = ?", (new_clean, old_clean))
    cur.execute("UPDATE orders SET user_phone = ? WHERE user_phone = ?", (new_clean, old_clean))
    cur.execute("UPDATE reviews SET user_phone = ? WHERE user_phone = ?", (new_clean, old_clean))
    cur.execute("UPDATE app_users SET phone = ? WHERE phone = ?", (new_clean, old_clean))


def calculate_cashback_percent(total_spent: float) -> int:
    """Calculate cashback percent from lifetime spend."""
    if total_spent < 2000:
        return 0
    if total_spent < 5000:
        return 5
    if total_spent < 10000:
        return 10
    if total_spent < 25000:
        return 15
    return 20
