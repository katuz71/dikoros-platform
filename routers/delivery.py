"""Delivery API router.

Contains public delivery helpers for Nova Poshta city and warehouse lookup.
This router is prepared for the gradual split of the legacy main.py monolith.
"""

from __future__ import annotations

import logging
import os

import httpx
from fastapi import APIRouter


router = APIRouter(prefix="/api/delivery", tags=["delivery"])

POPULAR_CITY_NAMES = ["Київ", "Львів", "Одеса", "Дніпро", "Харків", "Івано-Франківськ"]


def _nova_poshta_api_key() -> str:
    api_key = os.getenv("NOVA_POSHTA_API_KEY")
    if not api_key:
        raise RuntimeError("NOVA_POSHTA_API_KEY is not set in environment")
    return api_key


@router.get("/popular-cities")
async def get_popular_cities():
    """Return popular Nova Poshta cities with refs."""
    api_key = _nova_poshta_api_key()
    result = []
    async with httpx.AsyncClient() as client:
        for name in POPULAR_CITY_NAMES:
            payload = {
                "apiKey": api_key,
                "modelName": "Address",
                "calledMethod": "getCities",
                "methodProperties": {"FindByString": name, "Limit": "1"},
            }
            response = await client.post("https://api.novaposhta.ua/v2.0/json/", json=payload)
            data = response.json().get("data", [])
            if data:
                result.append({"ref": data[0].get("Ref"), "name": data[0].get("Description")})
    return result


@router.get("/cities")
async def get_np_cities(q: str = ""):
    """Search Nova Poshta cities."""
    try:
        api_key = _nova_poshta_api_key()
        payload = {
            "apiKey": api_key,
            "modelName": "Address",
            "calledMethod": "getCities",
            "methodProperties": {"FindByString": q, "Limit": "20"},
        }
        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://api.novaposhta.ua/v2.0/json/",
                json=payload,
                timeout=10.0,
            )
            response_json = response.json()
            if not response_json.get("success"):
                logger.warning("Nova Poshta API Error (Cities): %s", response_json.get("errors"))
                return []
            items = response_json.get("data", [])
            return [{"ref": item.get("Ref"), "name": item.get("Description")} for item in items]
    except Exception as exc:
        logger.exception("Nova Poshta Proxy Error (Cities)")
        return []


@router.get("/warehouses")
async def get_np_warehouses(city_ref: str):
    """Search Nova Poshta warehouses for a city ref."""
    try:
        api_key = _nova_poshta_api_key()
        payload = {
            "apiKey": api_key,
            "modelName": "Address",
            "calledMethod": "getWarehouses",
            "methodProperties": {"CityRef": city_ref, "Limit": "100"},
        }
        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://api.novaposhta.ua/v2.0/json/",
                json=payload,
                timeout=10.0,
            )
            response_json = response.json()
            if not response_json.get("success"):
                logger.warning("Nova Poshta API Error (Warehouses): %s", response_json.get("errors"))
                return []
            items = response_json.get("data", [])
            return [{"ref": item.get("Ref"), "name": item.get("Description")} for item in items]
    except Exception as exc:
        logger.exception("Nova Poshta Proxy Error (Warehouses)")
        return []
