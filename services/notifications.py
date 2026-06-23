import json
import requests
import logging
from datetime import datetime

from db import get_db_connection
from services.users import normalize_phone

logger = logging.getLogger(__name__)


def _default_push_data(title: str, data: dict | None) -> dict:
    """Add navigation data for legacy order pushes that were sent without payload data."""
    if data:
        return data

    normalized_title = str(title or "").strip().lower()
    if "замовлення" in normalized_title or "заказ" in normalized_title:
        return {
            "type": "order_notification",
            "screen": "orders",
        }

    return {}


def create_user_notification(user_phone: str, notification_type: str, title: str, body: str, data: dict | None = None) -> int | None:
    """Persist an in-app notification for the user notification center."""
    clean_phone = normalize_phone(user_phone or "")
    if not clean_phone:
        return None

    payload = data or {}
    conn = get_db_connection()
    try:
        row = conn.execute(
            """
            INSERT INTO user_notifications (user_phone, type, title, body, data, is_read, created_at)
            VALUES (?, ?, ?, ?, ?, FALSE, ?)
            RETURNING id
            """,
            (
                clean_phone,
                str(notification_type or "system").strip() or "system",
                str(title or "").strip(),
                str(body or "").strip(),
                json.dumps(payload, ensure_ascii=False),
                datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            ),
        ).fetchone()
        conn.commit()
        return int((row or {}).get("id") or 0) or None
    except Exception:
        conn.rollback()
        logger.exception("Failed to persist user notification: phone=%s type=%s", clean_phone, notification_type)
        return None
    finally:
        conn.close()


def send_expo_push(
    token: str,
    title: str,
    body: str,
    data: dict = None,
    user_phone: str | None = None,
    notification_type: str | None = None,
):
    """
    Отправляет push-уведомление через сервера Expo и сохраняет его в центр оповещений, если передан user_phone.
    """
    push_data = _default_push_data(title, data)

    if user_phone:
        create_user_notification(
            user_phone=user_phone,
            notification_type=notification_type or str(push_data.get("type") or "system"),
            title=title,
            body=body,
            data=push_data,
        )

    if not token or not token.startswith("ExponentPushToken"):
        logger.warning(f"Неверный формат токена для пуша: {token}")
        return

    url = "https://exp.host/--/api/v2/push/send"

    payload = {
        "to": token,
        "title": title,
        "body": body,
        "sound": "default",
        "priority": "high",
        "channelId": "default",
        "projectId": "66618f31-dc39-46f1-ba09-55c52d037f4a",
        "experienceId": "@katuz71/dikorosua",
        "_displayInForeground": True,
        "data": push_data,
    }

    try:
        response = requests.post(url, json=payload, timeout=5)
        response.raise_for_status()
        logger.info(f"Пуш успешно отправлен на токен {token}")
    except requests.exceptions.RequestException as e:
        logger.error(f"Ошибка при отправке Expo Push: {e}")
