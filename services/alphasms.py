from __future__ import annotations

import os
import requests


ALPHASMS_API_URL = os.getenv("ALPHASMS_API_URL", "https://alphasms.ua/api/json.php")
ALPHASMS_API_KEY = os.getenv("ALPHASMS_API_KEY", "")
ALPHASMS_SENDER = os.getenv("ALPHASMS_SENDER", "Dikoros")


def send_sms_code(phone: str, code: str) -> dict:
    """
    Send SMS verification code via AlphaSMS JSON API.
    """
    if not ALPHASMS_API_KEY:
        raise RuntimeError("ALPHASMS_API_KEY is not set")

    clean_phone = "".join(filter(str.isdigit, str(phone)))
    if not clean_phone:
        raise ValueError("Invalid phone")

    if clean_phone.startswith("0") and len(clean_phone) == 10:
        clean_phone = "38" + clean_phone

    text = f"DikorosUA code: {code}"

    payload = {
        "auth": ALPHASMS_API_KEY,
        "data": [
            {
                "type": "sms",
                "id": int(__import__("time").time()),
                "phone": int(clean_phone),
                "sms_signature": ALPHASMS_SENDER,
                "sms_message": text,
            }
        ],
    }

    response = requests.post(
        ALPHASMS_API_URL,
        json=payload,
        headers={"Content-Type": "application/json"},
        timeout=15,
    )

    try:
        data = response.json()
    except Exception:
        data = {"raw": response.text}

    if response.status_code >= 400:
        raise RuntimeError(f"AlphaSMS HTTP error {response.status_code}: {data}")

    if not data.get("success"):
        raise RuntimeError(f"AlphaSMS API error: {data}")

    for item in data.get("data") or []:
        if isinstance(item, dict) and not item.get("success", False):
            raise RuntimeError(f"AlphaSMS message error: {item}")

    return data
