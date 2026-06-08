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
logger = logging.getLogger(__name__)

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

UKRPOSHTA_BASE_URL = "https://www.ukrposhta.ua/address-classifier-ws"


def _ukrposhta_bearer() -> str:
    token = os.getenv("UKRPOSHTA_BEARER_ECOM") or os.getenv("UKRPOSHTA_API_KEY")
    if not token:
        raise RuntimeError("UKRPOSHTA_BEARER_ECOM is not set in environment")
    return token


def _ukrposhta_entries(response_json: dict) -> list[dict]:
    entries = (response_json or {}).get("Entries", {}).get("Entry", [])
    if isinstance(entries, dict):
        return [entries]
    if isinstance(entries, list):
        return entries
    return []


async def _ukrposhta_get(endpoint: str, params: dict) -> dict:
    token = _ukrposhta_bearer()
    clean_params = {key: value for key, value in params.items() if value not in (None, "")}

    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"{UKRPOSHTA_BASE_URL}/{endpoint}",
            params=clean_params,
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/json",
            },
            timeout=15.0,
        )
        response.raise_for_status()
        return response.json()


def _ukrposhta_city_name(item: dict) -> str:
    city_type = item.get("SHORTCITYTYPE_UA") or item.get("CITYTYPE_UA") or ""
    city = item.get("CITY_UA") or item.get("CITY_NAME") or ""
    district = item.get("DISTRICT_UA") or item.get("DISTRICT_NAME") or ""
    region = item.get("REGION_UA") or item.get("REGION_NAME") or ""

    name = " ".join(part for part in [city_type, city] if part).strip()
    details = ", ".join(part for part in [district, region] if part).strip()

    return f"{name} ({details})" if details else name


@router.get("/ukrposhta/popular-cities")
async def get_ukrposhta_popular_cities():
    """Return popular Ukrposhta cities with refs."""
    result = []

    for name in POPULAR_CITY_NAMES:
        try:
            response_json = await _ukrposhta_get(
                "get_city_by_region_id_and_district_id_and_city_ua",
                {"city_ua": name},
            )

            entries = _ukrposhta_entries(response_json)
            if not entries:
                continue

            item = entries[0]
            city_id = str(item.get("CITY_ID") or "").strip()
            district_id = str(item.get("DISTRICT_ID") or "").strip()
            region_id = str(item.get("REGION_ID") or "").strip()

            if not city_id or not region_id:
                continue

            result.append({
                "ref": f"{city_id}|{district_id}|{region_id}",
                "name": _ukrposhta_city_name(item),
                "city_id": city_id,
                "district_id": district_id,
                "region_id": region_id,
            })
        except Exception:
            logger.exception("Ukrposhta Proxy Error (Popular Cities)")

    return result


@router.get("/ukrposhta/cities")
async def get_ukrposhta_cities(q: str = ""):
    """Search Ukrposhta cities via address classifier."""
    query = (q or "").strip()
    if len(query) < 2:
        return []

    try:
        response_json = await _ukrposhta_get(
            "get_city_by_region_id_and_district_id_and_city_ua",
            {"city_ua": query},
        )

        result = []
        for item in _ukrposhta_entries(response_json):
            city_id = str(item.get("CITY_ID") or "").strip()
            district_id = str(item.get("DISTRICT_ID") or "").strip()
            region_id = str(item.get("REGION_ID") or "").strip()

            if not city_id or not region_id:
                continue

            result.append({
                "ref": f"{city_id}|{district_id}|{region_id}",
                "name": _ukrposhta_city_name(item),
                "city_id": city_id,
                "district_id": district_id,
                "region_id": region_id,
            })

        return result[:20]
    except Exception:
        logger.exception("Ukrposhta Proxy Error (Cities)")
        return []


@router.get("/ukrposhta/warehouses")
async def get_ukrposhta_warehouses(city_ref: str):
    """Return Ukrposhta post offices for selected city."""
    try:
        parts = (city_ref or "").split("|")
        city_id = parts[0].strip() if len(parts) > 0 else ""
        district_id = parts[1].strip() if len(parts) > 1 else ""
        region_id = parts[2].strip() if len(parts) > 2 else ""

        if not city_id or not region_id:
            return []

        response_json = await _ukrposhta_get(
            "get_postoffices_by_city_id",
            {
                "city_id": city_id,
                "district_id": district_id,
                "region_id": region_id,
            },
        )

        result = []
        for item in _ukrposhta_entries(response_json):
            lock_code = str(item.get("LOCK_CODE") or "").strip()
            is_no_district = str(item.get("IS_NODISTRICT") or "").strip()
            restricted_access = str(item.get("RESTRICTED_ACCESS") or "").strip()

            if lock_code not in ("", "0"):
                continue
            if is_no_district == "1":
                continue
            if restricted_access == "1":
                continue

            postindex = str(item.get("POSTINDEX") or item.get("POSTCODE") or "").strip()
            office_id = str(item.get("ID") or postindex).strip()
            office_name = str(item.get("PO_SHORT") or item.get("PO_LONG") or "").strip()
            address = str(item.get("ADDRESS") or "").strip()

            label_parts = [part for part in [postindex, office_name, address] if part]
            result.append({
                "ref": office_id,
                "name": " - ".join(label_parts),
                "postindex": postindex,
                "address": address,
            })

        return result[:100]
    except Exception:
        logger.exception("Ukrposhta Proxy Error (Warehouses)")
        return []

