import requests
import logging

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


def send_expo_push(token: str, title: str, body: str, data: dict = None):
    """
    Отправляет push-уведомление через сервера Expo.
    """
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
        "data": _default_push_data(title, data),
    }

    try:
        response = requests.post(url, json=payload, timeout=5)
        response.raise_for_status()
        logger.info(f"Пуш успешно отправлен на токен {token}")
    except requests.exceptions.RequestException as e:
        logger.error(f"Ошибка при отправке Expo Push: {e}")
