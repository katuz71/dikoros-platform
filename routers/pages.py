from datetime import datetime, timezone

from fastapi import APIRouter

router = APIRouter()


@router.get("/api/pages/news")
def get_news_page():
    return {
        "title": "Новини",
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "sections": [
            {
                "heading": "Інформація",
                "body": "Тут будуть оновлення магазину, графік роботи, інформація про доставку, оплату та сервісні повідомлення.",
            }
        ],
        "source": "https://dikoros-ua.com/aktsii/",
    }
