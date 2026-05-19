"""Analytics integrations for server-side event tracking."""

from __future__ import annotations

import hashlib
import logging
import os
import time
import uuid
from typing import Any, Dict

import httpx

logger = logging.getLogger(__name__)


def _hash_data(value: Any) -> str | None:
    if not value:
        return None
    return hashlib.sha256(str(value).strip().lower().encode("utf-8")).hexdigest()


async def send_to_facebook_capi(event_name: str, data: dict, user_data: dict) -> None:
    pixel_id = os.getenv("FB_PIXEL_ID")
    access_token = os.getenv("FB_ACCESS_TOKEN")
    if not pixel_id or not access_token:
        return

    url = f"https://graph.facebook.com/v19.0/{pixel_id}/events?access_token={access_token}"
    fb_event_name = "Purchase" if event_name == "purchase" else event_name

    payload: Dict[str, Any] = {
        "data": [
            {
                "event_name": fb_event_name,
                "event_time": int(time.time()),
                "action_source": "website",
                "user_data": {
                    "ph": [_hash_data(user_data.get("phone"))] if user_data.get("phone") else [],
                    "em": [_hash_data(user_data.get("email"))] if user_data.get("email") else [],
                    "client_user_agent": user_data.get("user_agent"),
                    "client_ip_address": user_data.get("ip"),
                },
                "custom_data": data,
            }
        ]
    }

    async with httpx.AsyncClient() as client:
        try:
            await client.post(url, json=payload)
        except Exception as exc:
            logger.warning("FB CAPI Error: %s", exc)


async def send_to_google_analytics(event_name: str, data: dict, user_data: dict) -> None:
    measurement_id = os.getenv("GA_MEASUREMENT_ID")
    api_secret = os.getenv("GA_API_SECRET")
    if not measurement_id or not api_secret:
        return

    url = f"https://www.google-analytics.com/mp/collect?measurement_id={measurement_id}&api_secret={api_secret}"
    ga_params = data.copy()
    if "value" in ga_params:
        ga_params["value"] = float(ga_params["value"])

    payload = {
        "client_id": user_data.get("client_id") or user_data.get("phone") or str(uuid.uuid4()),
        "events": [
            {
                "name": event_name,
                "params": ga_params,
            }
        ],
    }

    async with httpx.AsyncClient() as client:
        try:
            await client.post(url, json=payload)
        except Exception as exc:
            logger.warning("GA4 Error: %s", exc)


async def track_analytics_event(event_name: str, data: dict, user_data: dict) -> None:
    await send_to_facebook_capi(event_name, data, user_data)
    await send_to_google_analytics(event_name, data, user_data)
