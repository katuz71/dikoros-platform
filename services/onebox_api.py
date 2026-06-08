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


def _env_or_default(name: str, default: str) -> str:
    return (os.getenv(name) or default).strip()


def _set_if_key(target: dict, key: str, value):
    key = (key or "").strip()
    if key:
        target[key] = value

def _onebox_phone(phone: str) -> str:
    digits = "".join(ch for ch in str(phone or "") if ch.isdigit())
    if digits.startswith("0") and len(digits) == 10:
        return "38" + digits
    return digits


def _onebox_env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)) or default)
    except Exception:
        return default


def _onebox_delivery_label(delivery_method: str) -> str:
    labels = {
        "ukrposhta_branch": 'Укрпошта до відділення (Безкоштовно від 1000 грн)',
        "nova_poshta": 'Новою поштою (Безкоштовно від 1500грн)',
        "nova_poshta_international": 'Нова пошта, закордонна доставка',
        "meest": 'Meest Пошта (Безкоштовно від 500грн)',
        "pickup_chernihiv": 'Самовивіз м. Чернігів',
    }
    return labels.get(delivery_method, delivery_method or "")


def _onebox_payment_label(payment_method: str, delivery_method: str = "") -> str:
    if payment_method == "postpaid" and delivery_method == "ukrposhta_branch":
        return 'Післяплата на пошті (Наложений платіж)'
    if payment_method == "postpaid" and delivery_method == "nova_poshta":
        return 'Післяплата на пошті (Контроль оплати )'

    labels = {
        "postpaid": 'Післяплата на пошті (Наложений платіж)',
        "bank_transfer": 'Оплата на карту/рахунок',
        "paypal_request": 'PayPal по запиту',
        "pickup_cash": 'Готівкою при отриманні самовивозом',
    }
    return labels.get(payment_method, payment_method or "")


def _onebox_payment_id(payment_method: str, delivery_method: str = "") -> int:
    if payment_method == "postpaid" and delivery_method == "ukrposhta_branch":
        return _onebox_env_int("ONEBOX_PAYMENT_ID_POSTPAID_UKRPOSHTA", _onebox_env_int("ONEBOX_PAYMENT_ID_POSTPAID", 10))
    if payment_method == "postpaid" and delivery_method == "nova_poshta":
        return _onebox_env_int("ONEBOX_PAYMENT_ID_POSTPAID_NOVA_POSHTA", _onebox_env_int("ONEBOX_PAYMENT_ID_POSTPAID", 17))
    if payment_method == "bank_transfer":
        return _onebox_env_int("ONEBOX_PAYMENT_ID_BANK_TRANSFER", _onebox_env_int("ONEBOX_PAYMENT_ID_CARD", 5))
    if payment_method == "paypal_request":
        return _onebox_env_int("ONEBOX_PAYMENT_ID_PAYPAL", _onebox_env_int("ONEBOX_PAYMENT_ID_BANK_TRANSFER", 18))
    if payment_method == "pickup_cash":
        return _onebox_env_int("ONEBOX_PAYMENT_ID_PICKUP_CASH", _onebox_env_int("ONEBOX_PAYMENT_ID_CASH", 12))
    return _onebox_env_int("ONEBOX_PAYMENT_ID_POSTPAID", _onebox_env_int("ONEBOX_PAYMENT_ID_CASH", 10))


def _onebox_delivery_id(delivery_method: str) -> int:
    if delivery_method == "ukrposhta_branch":
        return _onebox_env_int("ONEBOX_DELIVERY_ID_UKRPOSHTA", 2)
    if delivery_method == "nova_poshta_international":
        return _onebox_env_int("ONEBOX_DELIVERY_ID_NOVA_POSHTA_INTERNATIONAL", _onebox_env_int("ONEBOX_DELIVERY_ID_NOVA_POSHTA", 1))
    if delivery_method == "meest":
        return _onebox_env_int("ONEBOX_DELIVERY_ID_MEEST", _onebox_env_int("ONEBOX_DELIVERY_ID_NOVA_POSHTA", 1))
    if delivery_method == "pickup_chernihiv":
        return _onebox_env_int("ONEBOX_DELIVERY_ID_PICKUP_CHERNIHIV", _onebox_env_int("ONEBOX_DELIVERY_ID_NOVA_POSHTA", 1))
    return _onebox_env_int("ONEBOX_DELIVERY_ID_NOVA_POSHTA", 1)




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
        last_name = str(order_data.get("last_name") or "").strip()
        middle_name = str(order_data.get("middle_name") or "").strip()
        client_full_name = str(order_data.get("client_full_name") or "").strip()
        if not client_full_name:
            client_full_name = " ".join([x for x in [last_name, name, middle_name] if x]).strip() or name
        recipient_name = str(order_data.get("recipient_name") or "").strip() or client_full_name or name
        recipient_parts = recipient_name.split()
        recipient_first_name = recipient_parts[0] if recipient_parts else recipient_name
        recipient_last_name = " ".join(recipient_parts[1:]) if len(recipient_parts) > 1 else ""
        recipient_phone = str(order_data.get("recipient_phone") or "").strip()
        phone = str(order_data.get("phone") or "").strip()
        if not recipient_phone:
            recipient_phone = phone
        do_not_call = bool(order_data.get("do_not_call"))
        do_not_call_text = "\u0434\u0430" if do_not_call else "\u043d\u0435\u0442"
        user_phone = str(order_data.get("user_phone") or "").strip()
        email = str(order_data.get("email") or "").strip()
        contact_preference = str(order_data.get("contact_preference") or "").strip()

        city = str(order_data.get("city") or "").strip()
        city_ref = str(order_data.get("cityRef") or order_data.get("city_ref") or "").strip()
        warehouse = str(order_data.get("warehouse") or "").strip()
        warehouse_ref = str(order_data.get("warehouseRef") or order_data.get("warehouse_ref") or "").strip()

        payment_method = str(order_data.get("payment_method") or "").strip()
        delivery_method = str(order_data.get("delivery_method") or "").strip()
        bonus_used = str(order_data.get("bonus_used") or "0").strip()
        bonus_balance = str(order_data.get("bonus_balance") or "").strip()
        return_url = str(order_data.get("return_url") or "").strip()
        client_comment = str(order_data.get("comment") or order_data.get("comments") or order_data.get("note") or "").strip()

        externalid = str(order_data.get("order_id") or order_data.get("id") or "")
        full_address = f"{city}, {warehouse}".strip(", ")

        product_array = []
        total_sum = 0.0
        item_lines = []

        async with httpx.AsyncClient() as client:
            for item in raw_items:
                item_dict = item if isinstance(item, dict) else vars(item)

                app_product_id = item_dict.get("product_id") or item_dict.get("id") or ""
                lookup_articul = str(item_dict.get("sku") or item_dict.get("articul") or item_dict.get("code") or "").strip()

                if not lookup_articul and app_product_id:
                    lookup_articul = await _fetch_sku(app_product_id)

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
                    or item_dict.get("pack_size")
                    or item_dict.get("unit")
                    or ""
                ).strip()
                item_unit = str(item_dict.get("unit") or "").strip()
                item_pack_size = str(item_dict.get("packSize") or item_dict.get("pack_size") or "").strip()

                product_name = base_name
                if variant_label:
                    base_norm = base_name.strip().lower()
                    variant_norm = variant_label.strip().lower()
                    base_words = set(base_norm.split())
                    variant_words = set(variant_norm.split())
                    shared_words = len(base_words & variant_words)

                    if variant_norm == base_norm or base_norm in variant_norm:
                        product_name = base_name
                    elif len(variant_label) > 25 and shared_words >= 3:
                        product_name = variant_label
                    else:
                        product_name = f"{base_name} - {variant_label}"

                item_lines.append(
                    f"- {product_name}: {amount_int} x {price_val} \u0433\u0440\u043d"
                    f" | app_product_id={app_product_id}"
                    f" | sku={lookup_articul}"
                    f" | variant={variant_label}"
                    f" | pack_size={item_pack_size}"
                    f" | unit={item_unit}"
                )

                p_obj = {
                    "name": product_name,
                    "articul": lookup_articul,
                    "amount": amount_int,
                    "count": amount_int,
                    "price": price_val,
                    "pricepurchase": price_val,
                    "pricesale": price_val,
                    "app_product_id": str(app_product_id),
                    "variant_info": variant_label,
                    "pack_size": item_pack_size,
                    "unit": item_unit,
                }

                if product_id:
                    p_obj["productid"] = product_id
                    p_obj["productinfo"] = {"id": product_id}

                product_array.append(p_obj)

        sum_str = "{:.4f}".format(total_sum)

        source_id = int(os.getenv("ONEBOX_SOURCE_ID", "1"))
        payment_label = _onebox_payment_label(payment_method, delivery_method)
        delivery_label = _onebox_delivery_label(delivery_method)
        payment_id = _onebox_payment_id(payment_method, delivery_method)
        delivery_id = _onebox_delivery_id(delivery_method)

        recipient_phone_onebox = _onebox_phone(recipient_phone)
        client_phone_onebox = _onebox_phone(phone)

        buyer_first_for_onebox = name
        buyer_last_for_onebox = last_name
        buyer_middle_for_onebox = middle_name

        # The app sends recipient_name as a human-readable full name.
        recipient_last_for_onebox = recipient_parts[0] if recipient_parts else (recipient_name or name)
        recipient_first_for_onebox = " ".join(recipient_parts[1:]) if len(recipient_parts) > 1 else ""

        app_order_number = str(externalid or order_data.get("order_id") or order_data.get("id") or "").strip()
        onebox_order_name = (
            f"{app_order_number} / {client_full_name or name} / Mobile App"
            if app_order_number
            else f"{client_full_name or name} / Mobile App"
        )

        # Official OneBox order creation endpoint.
        # OneBox standard customer block is used for shipment recipient.
        # Real app buyer data stays in comments/custom fields to avoid mixing buyer and recipient.
        params = {
            "login": ONEBOX_LOGIN,
            "password": ONEBOX_API_PASSWORD,
            "ordercode": app_order_number or f"app-{int(time.time())}",
            "workflowid": str(ONEBOX_WORKFLOW_ID),
            "statusid": str(ONEBOX_STATUS_ID),
            "name": onebox_order_name,
            "externalid": app_order_number,
            "clientnamefirst": buyer_first_for_onebox,
            "clientnamelast": buyer_last_for_onebox,
            "clientnamemiddle": buyer_middle_for_onebox,
            "clientphone": client_phone_onebox,
            "clientemail": email,
            "clientaddress": full_address,
            "setorderclientphone": "1",
            "order_clientphone": recipient_phone,
            "source": "Mobile App",
            "sourceid": str(source_id),
            "paymentid": str(payment_id),
            "deliveryid": str(delivery_id),
            "sum": sum_str,
            "comments": client_comment,
            "customorder_Komentarzsaitu": client_comment,

            "customorder_Neperezvanivat": "1" if do_not_call else "0",
            "customorder_Otrimuvachmya": recipient_first_for_onebox,
            "customorder_OtrimuvachPrizvsche": recipient_last_for_onebox,
            "customorder_istochnikDP": "Mobile App",
            "customorder_Sposoboplatidp": payment_label,
            "customorder_sposobdostavkidp": delivery_label,
            "customorder_email": email,
            "customorder_user_phone": phone,
            "customorder_city_ref": city_ref,
            "customorder_warehouse_ref": warehouse_ref,
            "customorder_bonus_used": bonus_used,
            "customorder_bonus_balance": bonus_balance,
        }

        for idx, product in enumerate(product_array):
            prefix = f"productArray[{idx}]"
            params[f"{prefix}[name]"] = str(product.get("name") or "")
            params[f"{prefix}[price]"] = str(product.get("price") or "0")
            params[f"{prefix}[count]"] = str(product.get("amount") or product.get("count") or "1")
            if product.get("articul"):
                params[f"{prefix}[articul]"] = str(product.get("articul"))
            if product.get("productid"):
                params[f"{prefix}[productid]"] = str(product.get("productid"))

        logger.info("[OneBox] Official /api/orders/add params:")
        safe_params = {k: v for k, v in params.items() if k not in {"password"}}
        logger.info(json.dumps(safe_params, ensure_ascii=False, indent=2))

        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{ONEBOX_URL}/api/orders/add/",
                params=params,
                timeout=30.0,
            )

        logger.info(f"[OneBox] Response: {resp.text}")
        data = resp.json()
        if data.get("result") == "ok" and data.get("orderId"):
            return {"status": 1, "dataArray": [data.get("orderId")], "raw": data}
        return data

    except Exception as exc:
        logger.error(f"[OneBox] Error: {exc}", exc_info=True)
        raise

