"""
OneBox OS CRM — direct API v2 integration.
"""

import asyncio
import httpx
import logging
import os
import time
import json
from types import SimpleNamespace
import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger(__name__)

ONEBOX_URL          = os.getenv("ONEBOX_URL", "https://osmarina.crm-onebox.com").rstrip("/")
ONEBOX_LOGIN        = os.getenv("ONEBOX_LOGIN")
ONEBOX_API_PASSWORD = os.getenv("ONEBOX_API_PASSWORD")
ONEBOX_WORKFLOW_ID  = int(os.getenv("ONEBOX_WORKFLOW_ID", "11"))
ONEBOX_STATUS_ID    = int(os.getenv("ONEBOX_STATUS_ID",   "62"))
DATABASE_URL        = os.getenv("DATABASE_URL")

_cached_token = ""
_token_timestamp = 0.0
TOKEN_TTL = 3000

async def get_onebox_token() -> str:
    global _cached_token, _token_timestamp
    if _cached_token and (time.time() - _token_timestamp < TOKEN_TTL):
        return _cached_token
    logger.info("[OneBox] Requesting new API token…")
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{ONEBOX_URL}/api/v2/token/get/",
            json={"login": ONEBOX_LOGIN, "restapipassword": ONEBOX_API_PASSWORD},
            timeout=15.0,
        )
        resp.raise_for_status()
        data = resp.json()
    _cached_token = data.get("token") or data.get("dataArray", {}).get("token")
    _token_timestamp = time.time()
    return _cached_token

def _sync_fetch_sku(product_id: str) -> str:
    if not DATABASE_URL or not product_id: return ""
    try:
        conn = psycopg2.connect(DATABASE_URL)
        cur  = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("SELECT sku FROM products WHERE id = %s LIMIT 1", (str(product_id),))
        row = cur.fetchone()
        cur.close()
        conn.close()
        if row and row.get("sku"): return str(row["sku"]).strip()
    except Exception as exc:
        logger.error(f"[OneBox] DB error fetching SKU: {exc}")
    return ""

async def _fetch_sku(product_id) -> str:
    return await asyncio.to_thread(_sync_fetch_sku, product_id)

async def _onebox_find_product_id_by_articul(client, headers, articul) -> int | None:
    articul = str(articul or "").strip()
    if not articul: return None
    try:
        payload = {
            "fields": ["id", "name", "articul"],
            "limit": 5,
            "filter": {"articul": articul}
        }
        resp = await client.post(
            f"{ONEBOX_URL}/api/v2/product/get/",
            json=payload,
            headers=headers,
            timeout=30.0,
        )
        data = resp.json()
        items = data.get("dataArray") or []
        if isinstance(items, list) and items and isinstance(items[0], dict):
            pid = items[0].get("id") or items[0].get("productid")
            if pid: return int(pid)
    except Exception: pass
    return None

class Product:
    """Legacy marker class."""

class OneBoxDbSession:
    def __init__(self, database_url: str | None = None):
        self._database_url = (database_url or DATABASE_URL or "").strip()

    def _sync_get_product(self, product_id: int | str):
        if not self._database_url or not product_id: return None
        try:
            conn = psycopg2.connect(self._database_url)
            cur = conn.cursor(cursor_factory=RealDictCursor)
            cur.execute("SELECT id, sku FROM products WHERE id = %s LIMIT 1", (str(product_id),))
            row = cur.fetchone()
            cur.close()
            conn.close()
            if not row: return None
            return SimpleNamespace(id=row.get("id"), sku=row.get("sku"))
        except Exception: return None

    async def get(self, model, pk):
        return await asyncio.to_thread(self._sync_get_product, pk)

async def create_onebox_order(order_data: dict) -> dict:
    try:
        token = await get_onebox_token()
        headers = {"Token": token, "Content-Type": "application/json"}

        raw_items = order_data.get("items") or order_data.get("products") or []
        name = str(order_data.get("name") or "").strip()
        phone = str(order_data.get("phone") or "").strip()
        city = str(order_data.get("city") or "").strip()
        warehouse = str(order_data.get("warehouse") or "").strip()
        payment_method = str(order_data.get("payment_method") or "").strip()
        delivery_method = str(order_data.get("delivery_method") or "").strip()
        externalid = str(order_data.get("order_id") or order_data.get("id") or "")
        full_address = f"{city}, {warehouse}".strip(", ")

        product_array = []
        total_sum = 0.0
        item_lines = []

        async with httpx.AsyncClient() as client:
            for item in raw_items:
                item_dict = item if isinstance(item, dict) else vars(item)

                lookup_articul = str(item_dict.get("sku") or item_dict.get("articul") or item_dict.get("code") or "").strip()
                if not lookup_articul:
                    item_id = item_dict.get("id") or item_dict.get("product_id")
                    if item_id:
                        lookup_articul = await _fetch_sku(item_id)

                product_id = None
                if lookup_articul:
                    product_id = await _onebox_find_product_id_by_articul(client, headers, lookup_articul)

                amount_int = int(item_dict.get("amount") or item_dict.get("quantity") or 1)
                price_val = float(item_dict.get("price") or 0.0)
                total_sum += price_val * amount_int

                base_name = str(item_dict.get("name") or "").strip()
                variant_label = str(
                    item_dict.get("variant_info")
                    or item_dict.get("packSize")
                    or item_dict.get("unit")
                    or ""
                ).strip()

                product_name = (
                    f"{base_name} ? {variant_label}"
                    if variant_label and variant_label not in base_name
                    else base_name
                )

                item_lines.append(f"- {product_name}: {amount_int} x {price_val} ???")

                p_obj = {
                    "name": product_name,
                    "articul": lookup_articul,
                    "amount": amount_int,
                    "count": amount_int,
                    "price": price_val,
                    "pricepurchase": price_val,
                    "pricesale": price_val,
                }

                if product_id:
                    p_obj["productid"] = product_id
                    p_obj["productinfo"] = {"id": product_id}

                product_array.append(p_obj)

        sum_str = "{:.4f}".format(total_sum)

        desc_lines = [
            "?? ????? ?? ??????????",
            f"???: {name}",
            f"???????: {phone}",
            f"?????: {sum_str} ???",
            f"??????: {payment_method}",
            f"????????: {delivery_method}",
            f"?????: {full_address}",
            "",
            "??????:",
            *item_lines,
        ]
        full_description = "\n".join(desc_lines)

        order_obj = {
            "clientfio": name,
            "clientname": name,
            "clientphone": phone,
            "phone": phone,

            "name": f"????? ?? ?????????? ?? {name}",
            "description": full_description,
            "comments": full_description,
            "order_content": full_description,

            "delivery_address": full_address,
            "clientaddress": full_address,
            "address": full_address,
            "order_clientaddress": full_address,

            "sum": sum_str,
            "order_sum": sum_str,

            "customorder_istochnikDP": "Mobile App",
            "customorder_Sposoboplatidp": payment_method,
            "customorder_sposobdostavkidp": delivery_method,

            "products": product_array,

            "workflowid": ONEBOX_WORKFLOW_ID,
            "statusid": ONEBOX_STATUS_ID,
            "externalid": externalid,
        }

        payload = [order_obj]

        logger.info("[OneBox] Final Payload (JSON):")
        logger.info(json.dumps(payload, ensure_ascii=False, indent=2))

        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{ONEBOX_URL}/api/v2/order/set/",
                json=payload,
                headers=headers,
                timeout=30.0,
            )

        logger.info(f"[OneBox] Response: {resp.text}")
        return resp.json()

    except Exception as exc:
        logger.error(f"[OneBox] ? Error: {exc}", exc_info=True)
        raise
