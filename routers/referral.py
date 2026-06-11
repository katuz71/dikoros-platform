"""Referral program API and deep-link landing page."""

from __future__ import annotations

from html import escape

from fastapi import APIRouter, Depends, Query
from fastapi.responses import HTMLResponse

from services.auth import get_current_user_phone
from services.users import normalize_phone


router = APIRouter()

REFERRAL_BONUS_AMOUNT = 50
REGISTRATION_BONUS_AMOUNT = 150
APP_SCHEME = "dikoros"
PUBLIC_APP_URL = "https://app.dikoros.ua"


def referral_payload(phone: str) -> dict:
    referrer = normalize_phone(phone)
    web_link = f"{PUBLIC_APP_URL}/ref?referrer={referrer}"
    app_link = f"{APP_SCHEME}://ref?referrer={referrer}"
    return {
        "referrer": referrer,
        "web_link": web_link,
        "app_link": app_link,
        "referral_bonus": REFERRAL_BONUS_AMOUNT,
        "registration_bonus": REGISTRATION_BONUS_AMOUNT,
        "message": (
            f"Запрошую тебе в DikorosUA 🍄\n"
            f"За реєстрацію отримаєш {REGISTRATION_BONUS_AMOUNT} грн бонусами.\n"
            f"Моє реферальне посилання: {web_link}"
        ),
    }


@router.get("/api/referral/me")
def get_my_referral(phone: str = Depends(get_current_user_phone)):
    return referral_payload(phone)


@router.get("/ref", response_class=HTMLResponse)
def referral_landing(referrer: str = Query("", alias="referrer"), ref: str = Query("")):
    clean_referrer = normalize_phone(referrer or ref)
    safe_referrer = escape(clean_referrer)
    app_link = f"{APP_SCHEME}://ref?referrer={safe_referrer}"

    return f"""
<!doctype html>
<html lang="uk">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>DikorosUA — реферальне запрошення</title>
  <style>
    body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 32px; background: #f6f7f3; color: #172018; }}
    .card {{ max-width: 520px; margin: 0 auto; background: #fff; border-radius: 20px; padding: 28px; box-shadow: 0 12px 40px rgba(0,0,0,.08); }}
    h1 {{ margin-top: 0; font-size: 26px; }}
    p {{ line-height: 1.5; }}
    a.button {{ display: inline-block; margin-top: 16px; background: #2f7d32; color: #fff; text-decoration: none; padding: 14px 18px; border-radius: 12px; font-weight: 700; }}
    .muted {{ color: #687267; font-size: 14px; }}
  </style>
  <script>
    setTimeout(function () {{ window.location.href = {app_link!r}; }}, 400);
  </script>
</head>
<body>
  <div class="card">
    <h1>Запрошення в DikorosUA 🍄</h1>
    <p>Встановіть або відкрийте додаток DikorosUA. За SMS-реєстрацію новий користувач отримує 150 грн бонусами.</p>
    <p class="muted">Реферер: {safe_referrer or 'не вказано'}</p>
    <a class="button" href="{app_link}">Відкрити додаток</a>
  </div>
</body>
</html>
"""
