"""Horoshop catalog synchronization helpers."""

from __future__ import annotations

from dataclasses import dataclass
from html import unescape
from html.parser import HTMLParser
import asyncio
import json
import logging
import os
import re
import traceback
from urllib.parse import urljoin
import urllib.request

import httpx
from fastapi import HTTPException

from db import get_db_connection
from services.variant_options import build_variant_options


logger = logging.getLogger(__name__)

EXPORT_PAGE_SIZE = 500
MAX_EXPORT_PAGES = 100
HOROSHOP_PAGE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
    "Accept-Language": "uk-UA,uk;q=0.9,en;q=0.8",
}
HOME_SECTION_COLUMNS = {
    "hit": "home_hit_order",
    "new": "home_new_order",
    "promotion": "home_promotion_order",
}

HOME_SECTION_REL_ALIASES = {
    "hits": "hit",
    "hit": "hit",
    "popular": "hit",
    "global_action": "promotion",
    "promotion": "promotion",
    "promotions": "promotion",
    "sale": "promotion",
    "discount": "promotion",
    "discounts": "promotion",
    "novelties": "new",
    "new": "new",
    "new_products": "new",
}

HOME_SECTION_TITLE_ALIASES = {
    "хіти": "hit",
    "хіти продажу": "hit",
    "популярне": "hit",
    "акції": "promotion",
    "акційні товари": "promotion",
    "розпродаж": "promotion",
    "новинки": "new",
    "нові товари": "new",
}


@dataclass
class HomepageProductRef:
    section: str
    sku: str | None = None
    external_id: str | None = None
    href: str | None = None


def _class_contains(attrs: dict[str, str], value: str) -> bool:
    return value in attrs.get("class", "").split()


def _extract_sku_from_alt(value: str | None) -> str | None:
    if not value:
        return None

    text = unescape(value).replace("&mdash;", "—")
    before_brand = re.split(r"\s+—\s*Dikoros", text, maxsplit=1)[0].strip()
    if not before_brand:
        return None

    candidate = before_brand.split()[-1].strip()
    if "-" not in candidate:
        return None
    return candidate


def _normalize_home_section_text(value: str | None) -> str:
    return re.sub(r"\s+", " ", unescape(value or "")).strip().casefold()


def _home_section_from_rel_or_title(rel: str | None = None, title: str | None = None) -> str | None:
    rel_key = _normalize_home_section_text(rel)
    if rel_key in HOME_SECTION_REL_ALIASES:
        return HOME_SECTION_REL_ALIASES[rel_key]

    title_key = _normalize_home_section_text(re.sub(r"<[^>]+>", " ", title or ""))
    return HOME_SECTION_TITLE_ALIASES.get(title_key)


class HomepageSectionsParser(HTMLParser):
    def __init__(self, default_section: str | None = None) -> None:
        super().__init__(convert_charrefs=True)
        self.products: dict[str, list[HomepageProductRef]] = {
            "hit": [],
            "new": [],
            "promotion": [],
        }
        self.default_section = default_section
        self.current_section: str | None = default_section
        self.latest_active_tab_section: str | None = None
        self.current_tab: dict[str, object] | None = None
        self.special_content_index = 0
        self.special_depth: int | None = None
        self.current_card: HomepageProductRef | None = None
        self.seen: set[tuple[str, str, str]] = set()

    def handle_starttag(self, tag: str, attrs_list: list[tuple[str, str | None]]) -> None:
        attrs = {key: value or "" for key, value in attrs_list}

        if self.special_depth is not None:
            self.special_depth += 1

        if tag == "div" and _class_contains(attrs, "catalogTabs"):
            self.latest_active_tab_section = None

        if tag == "li" and attrs.get("rel") and "catalogTabs-nav-i" in attrs.get("class", ""):
            self.current_tab = {
                "rel": attrs.get("rel"),
                "active": _class_contains(attrs, "__active"),
                "text": [],
            }

        if tag == "div" and _class_contains(attrs, "catalogTabs-content") and _class_contains(attrs, "j-special-offers-content"):
            self.special_content_index += 1
            self._append_current_card()

            if self.latest_active_tab_section:
                self.current_section = self.latest_active_tab_section
            elif self.special_content_index == 1:
                self.current_section = "hit"
            elif self.special_content_index == 2:
                self.current_section = "new"
            elif self.special_content_index == 3:
                self.current_section = "promotion"
            else:
                self.current_section = None

            self.special_depth = 1
            return

        if (
            tag == "div"
            and self.current_section
            and _class_contains(attrs, "j-product-container")
            and attrs.get("data-id")
        ):
            self._append_current_card()
            self.current_card = HomepageProductRef(
                section=self.current_section,
                external_id=attrs.get("data-id"),
            )
            return

        if tag == "a" and self.current_card and attrs.get("href"):
            href = attrs.get("href")
            if href and not self.current_card.href and not href.startswith("#") and not href.startswith("javascript:"):
                self.current_card.href = href
            return

        if tag == "img" and self.current_card:
            sku = _extract_sku_from_alt(attrs.get("alt") or attrs.get("title"))
            if sku:
                self.current_card.sku = sku

    def handle_data(self, data: str) -> None:
        if self.current_tab is not None:
            text = self.current_tab.get("text")
            if isinstance(text, list):
                text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "li" and self.current_tab is not None:
            rel = str(self.current_tab.get("rel") or "")
            text = "".join(str(part) for part in self.current_tab.get("text") or [])
            section = _home_section_from_rel_or_title(rel, text)
            if bool(self.current_tab.get("active")) and section:
                self.latest_active_tab_section = section
            self.current_tab = None

        if self.special_depth is not None:
            self.special_depth -= 1
            if self.special_depth <= 0:
                self._append_current_card()
                self.special_depth = None
                self.current_section = self.default_section

    def _append_current_card(self) -> None:
        if not self.current_card:
            return

        key = (
            self.current_card.section or "",
            self.current_card.sku or "",
            self.current_card.external_id or "",
        )
        if key not in self.seen:
            if self.current_card.section:
                self.products[self.current_card.section].append(self.current_card)
            self.seen.add(key)

        self.current_card = None


def _localized_value(value: object, default: str = "") -> str:
    if isinstance(value, dict):
        return str(value.get("ua") or value.get("ru") or value.get("en") or default)
    return str(value or default)


def _parse_float(value: object, default: float = 0.0) -> float:
    try:
        return float(value or default)
    except (TypeError, ValueError):
        return default


def _old_price_from_discount(price: float, discount_percent: float) -> float:
    """Reconstruct regular price when Horoshop sends discount percent only."""
    if price <= 0 or discount_percent <= 0 or discount_percent >= 100:
        return 0.0
    return round(price / (1 - discount_percent / 100), 2)


def _parse_remains(item: dict, status: str) -> int:
    for key in ("remains", "quantity", "qty", "stock", "balance", "rest"):
        value = item.get(key)
        if isinstance(value, dict):
            value = value.get("value") or value.get("amount") or value.get("quantity")
        if value is None or value == "":
            continue
        try:
            return max(0, int(float(value)))
        except (TypeError, ValueError):
            continue

    return 0 if status == "out_of_stock" else 1


async def _export_catalog_products(
    client: httpx.AsyncClient,
    domain: str,
    token: str,
) -> list[dict]:
    products: list[dict] = []
    offset = 0

    for _ in range(MAX_EXPORT_PAGES):
        export_response = await client.post(
            f"https://{domain}/api/catalog/export/",
            json={"token": token, "limit": EXPORT_PAGE_SIZE, "offset": offset},
        )
        export_data = export_response.json()

        if export_data.get("status") != "OK":
            raise HTTPException(status_code=400, detail=f"Horoshop export error: {export_data}")

        page_products = export_data.get("response", {}).get("products", [])
        products.extend(page_products)

        if len(page_products) < EXPORT_PAGE_SIZE:
            return products
        offset += EXPORT_PAGE_SIZE

    raise HTTPException(status_code=400, detail="Horoshop export pagination did not finish")


async def _fetch_homepage_sections(
    client: httpx.AsyncClient,
    domain: str,
) -> dict[str, list[HomepageProductRef]]:
    response = await client.get(f"https://{domain}/", headers=HOROSHOP_PAGE_HEADERS)
    parser = HomepageSectionsParser()
    parser.feed(response.text)
    parser._append_current_card()
    await _fetch_inactive_homepage_tabs(client, domain, response.text, parser.products)
    logger.info(
        "Horoshop homepage refs: hit=%s promotion=%s new=%s",
        len(parser.products.get("hit", [])),
        len(parser.products.get("promotion", [])),
        len(parser.products.get("new", [])),
    )
    return parser.products


def _extract_product_page_sku(html: str) -> str | None:
    match = re.search(r"Артикул:\s*([^<]+)", html)
    if not match:
        return None

    sku = unescape(match.group(1)).strip()
    return sku or None


async def _resolve_ref_sku_from_href(
    client: httpx.AsyncClient,
    domain: str,
    ref: HomepageProductRef,
) -> str | None:
    if not ref.href:
        return None

    try:
        url = urljoin(f"https://{domain}/", ref.href)
        request = urllib.request.Request(url, headers=HOROSHOP_PAGE_HEADERS)
        html = await asyncio.to_thread(
            lambda: urllib.request.urlopen(request, timeout=30.0).read().decode("utf-8", "replace")
        )
    except httpx.HTTPError:
        return None
    except OSError:
        return None

    return _extract_product_page_sku(html)


def _extract_special_offer_tab_requests(html: str) -> list[tuple[str, str, str, dict]]:
    requests: list[tuple[str, str, str, dict]] = []
    configs = re.finditer(r"SpecialOffers\.init\((\{.*?\})\);", html, re.DOTALL)

    for match in configs:
        try:
            config = json.loads(match.group(1))
        except json.JSONDecodeError:
            continue

        token = str(config.get("token") or "").strip()
        if not token:
            continue

        active_block = str(config.get("activeBlock") or config.get("active_block") or "").strip()
        settings_storage = config.get("settingsStorage") or {}
        if not isinstance(settings_storage, dict):
            settings_storage = {}

        logger.info(
            "Horoshop SpecialOffers config: token=%s activeBlock=%s settingsStorage=%s",
            token,
            active_block,
            settings_storage,
        )

        token_marker = f'id="special_offers_{token}"'
        token_pos = html.find(token_marker)
        block_html = html[token_pos:] if token_pos >= 0 else html
        next_block = block_html.find('id="special_offers_', len(token_marker))
        if next_block > 0:
            block_html = block_html[:next_block]

        tab_pattern = re.compile(
            r"<li\b(?=[^>]*\bj-special-offers-tab\b)(?=[^>]*\brel=[\"']([^\"']+)[\"'])[^>]*>(.*?)</li>",
            re.DOTALL | re.IGNORECASE,
        )
        for tab_match in tab_pattern.finditer(block_html):
            rel = unescape(tab_match.group(1)).strip()
            title = re.sub(r"<[^>]+>", " ", tab_match.group(2))
            section = _home_section_from_rel_or_title(rel, title)
            logger.info(
                "Horoshop SpecialOffers tab: token=%s rel=%s title=%s section=%s active=%s",
                token,
                rel,
                _normalize_home_section_text(title),
                section,
                rel == active_block,
            )
            if not rel or rel == active_block:
                continue
            if not section:
                continue

            requests.append((section, token, rel, settings_storage))

    return requests


async def _fetch_inactive_homepage_tabs(
    client: httpx.AsyncClient,
    domain: str,
    html: str,
    products: dict[str, list[HomepageProductRef]],
) -> None:
    for section, token, rel, settings_storage in _extract_special_offer_tab_requests(html):
        data = {"token": token}
        for key, value in settings_storage.items():
            data[f"settingsStorage[{key}]"] = str(value)

        try:
            response = await client.post(
                f"https://{domain}/_widget/special_offers/block/{rel}/",
                data=data,
                headers={
                    **HOROSHOP_PAGE_HEADERS,
                    "X-Requested-With": "XMLHttpRequest",
                    "Referer": f"https://{domain}/",
                    "Origin": f"https://{domain}",
                },
            )
            payload = response.json()
        except (httpx.HTTPError, ValueError):
            logger.warning("Failed to fetch Horoshop homepage tab %s/%s", token, rel)
            continue

        if payload.get("status") != "OK":
            logger.warning("Horoshop homepage tab %s/%s returned %s", token, rel, payload)
            continue

        tab_html = payload.get("response", {}).get("html") or payload.get("html") or ""
        if not tab_html:
            logger.warning("Horoshop homepage tab %s/%s returned no html: %s", token, rel, payload)
            continue

        parser = HomepageSectionsParser(default_section=section)
        parser.feed(str(tab_html))
        parser._append_current_card()
        refs = parser.products.get(section, [])
        logger.info(
            "Horoshop inactive homepage tab fetched: token=%s rel=%s section=%s html_len=%s refs=%s",
            token,
            rel,
            section,
            len(str(tab_html)),
            len(refs),
        )
        products[section].extend(refs)


def _row_value(row: object, key: str, index: int = 0) -> object:
    if row is None:
        return None
    if isinstance(row, dict):
        return row.get(key)
    try:
        return row[key]  # type: ignore[index]
    except Exception:
        return row[index]  # type: ignore[index]


async def _apply_home_section_order(
    client: httpx.AsyncClient,
    cur,
    domain: str,
    section: str,
    refs: list[HomepageProductRef],
) -> int:
    column = HOME_SECTION_COLUMNS[section]
    updated = 0
    seen_items = set()

    for order, ref in enumerate(refs, start=1):
        where_sql = ""
        param = ""
        row = None

        # Берем конкретный товар, а не его группу
        if ref.external_id:
            where_sql = "external_id = ?"
            param = ref.external_id
            cur.execute(f"SELECT old_price, price, is_new FROM products WHERE {where_sql} LIMIT 1", (param,))
            row = cur.fetchone()

        if not row and ref.sku:
            where_sql = "sku = ?"
            param = ref.sku
            cur.execute(f"SELECT old_price, price, is_new FROM products WHERE {where_sql} LIMIT 1", (param,))
            row = cur.fetchone()

        if not row and ref.href:
            resolved_sku = await _resolve_ref_sku_from_href(client, domain, ref)
            if resolved_sku:
                where_sql = "sku = ?"
                param = resolved_sku
                cur.execute(f"SELECT old_price, price, is_new FROM products WHERE {where_sql} LIMIT 1", (param,))
                row = cur.fetchone()

        if not row or param in seen_items:
            continue

        if section == "promotion":
            old_price = float(_row_value(row, "old_price") or 0.0)
            price = float(_row_value(row, "price") or 0.0)
            is_new = bool(_row_value(row, "is_new"))
            if not (old_price > 0 and old_price > price):
                continue
            if is_new:
                continue

        # Обновляем ТОЛЬКО одну конкретную карточку
        cur.execute(
            f"""
            UPDATE products
            SET {column} = ?,
                external_id = COALESCE(external_id, ?)
            WHERE {where_sql}
            """,
            (order, ref.external_id, param),
        )
        seen_items.add(param)
        updated += 1

    return updated


async def _apply_homepage_section_orders(
    client: httpx.AsyncClient,
    cur,
    domain: str,
) -> dict[str, int]:
    sections = await _fetch_homepage_sections(client, domain)
    result: dict[str, int] = {}
    for section, refs in sections.items():
        result[section] = await _apply_home_section_order(client, cur, domain, section, refs)
    return result


def _mark_stale_horoshop_products_out_of_stock(cur, active_skus: set[str]) -> int:
    """Hide local products that disappeared from the Horoshop export.

    Horoshop is the source of truth for catalog products. If a product SKU is no
    longer returned by /api/catalog/export/, the app must stop showing it while
    preserving local order history and product ids.
    """
    if not active_skus:
        return 0

    placeholders = ",".join(["?"] * len(active_skus))
    cur.execute(
        f"""
        UPDATE products
        SET status = 'out_of_stock',
            remains = 0,
            is_hit = FALSE,
            is_new = FALSE,
            is_promotion = FALSE,
            home_hit_order = NULL,
            home_new_order = NULL,
            home_promotion_order = NULL,
            sort_order = NULL
        WHERE sku IS NOT NULL
          AND TRIM(sku) != ''
          AND sku NOT IN ({placeholders})
        """,
        tuple(sorted(active_skus)),
    )

    return int(getattr(cur, "rowcount", 0) or 0)


async def sync_catalog_from_horoshop() -> dict:
    domain = os.getenv("HOROSHOP_DOMAIN")
    login = os.getenv("HOROSHOP_LOGIN")
    password = os.getenv("HOROSHOP_PASSWORD")

    if not domain or not login or not password:
        raise HTTPException(status_code=500, detail="Horoshop sync credentials are not configured")

    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()

        async with httpx.AsyncClient(timeout=120.0) as client:
            auth_response = await client.post(
                f"https://{domain}/api/auth/",
                json={"login": login, "password": password},
            )
            auth_data = auth_response.json()
            token = auth_data.get("response", {}).get("token") or auth_data.get("token")
            if not token:
                raise HTTPException(status_code=400, detail=f"Horoshop auth error: {auth_data}")

            products_list = await _export_catalog_products(client, domain, token)
            if not products_list:
                raise HTTPException(status_code=400, detail="Horoshop returned an empty product list")

            count = 0
            group_order: dict[str, int] = {}
            product_groups: dict[str, list[dict]] = {}
            active_skus: set[str] = set()

            for item in products_list:
                sku = str(item.get("article") or item.get("parent_article") or "").strip()
                if not sku:
                    continue
                parent_sku = str(item.get("parent_article") or "").strip()
                group_key = parent_sku or sku
                product_groups.setdefault(group_key, []).append(item)

            cur.execute(
                """
                UPDATE products
                SET sort_order = NULL,
                    is_hit = FALSE,
                    is_new = FALSE,
                    is_promotion = FALSE,
                    home_hit_order = NULL,
                    home_new_order = NULL,
                    home_promotion_order = NULL,
                    variant_options = NULL
                """
            )

            for item in products_list:
                sku = str(item.get("article") or item.get("parent_article") or "").strip()
                if not sku:
                    continue

                active_skus.add(sku)
                external_id = str(item.get("id") or item.get("external_id") or "").strip() or None
                parent_sku = str(item.get("parent_article") or "").strip()
                group_key = parent_sku or sku
                if group_key not in group_order:
                    group_order[group_key] = len(group_order) + 1
                sort_order = group_order[group_key]
                variant_options = build_variant_options(item, product_groups.get(group_key, [item]))
                variant_options_json = json.dumps(variant_options, ensure_ascii=False) if variant_options else None

                variant_name = _localized_value(item.get("mod_title") or {})
                title = _localized_value(item.get("title") or {}, "Без назви")
                description = _localized_value(item.get("description") or {})

                parent_obj = item.get("parent") or {}
                category = parent_obj.get("value") or "Загальне"

                price = _parse_float(item.get("price"))
                discount_percent = int(_parse_float(item.get("discount")))
                old_price = _parse_float(item.get("old_price"))
                if old_price <= price and discount_percent > 0:
                    old_price = _old_price_from_discount(price, discount_percent)

                status = "available"
                presence_obj = item.get("presence") or {}
                if presence_obj.get("id") == 2:
                    status = "out_of_stock"
                remains = _parse_remains(item, status)

                img_list = item.get("images") or []
                img = img_list[0] if img_list else ""
                images_str = ",".join(img_list) if img_list else ""

                icon_texts = []
                for icon in item.get("icons", []) or []:
                    val_obj = icon.get("value", {})
                    if isinstance(val_obj, dict):
                        icon_texts.extend([str(v).lower() for v in val_obj.values()])

                is_hit = bool(
                    item.get("hit") == 1
                    or any("хит" in t or "хіт" in t for t in icon_texts)
                )
                is_new = bool(
                    item.get("new") == 1
                    or any("новинка" in t or "new" in t for t in icon_texts)
                )

                is_promotion = bool(old_price > 0 and old_price > price) and not is_new

                cur.execute("SELECT id FROM products WHERE sku = ?", (sku,))
                exists = cur.fetchone()
                if exists:
                    product_id = exists["id"] if isinstance(exists, dict) else exists[0]
                    cur.execute(
                        """
                        UPDATE products SET
                            name = ?, price = ?, category = ?, status = ?,
                            remains = ?,
                            description = ?, image = ?, images = ?,
                            parent_sku = ?, variant_name = ?, variant_options = ?,
                            is_hit = ?, is_promotion = ?, is_new = ?,
                            old_price = ?, discount = ?, sort_order = ?, external_id = ?
                        WHERE id = ?
                        """,
                        (
                            title,
                            price,
                            category,
                            status,
                            remains,
                            description,
                            img,
                            images_str,
                            parent_sku,
                            variant_name,
                            variant_options_json,
                            is_hit,
                            is_promotion,
                            is_new,
                            old_price,
                            discount_percent,
                            sort_order,
                            external_id,
                            product_id,
                        ),
                    )
                else:
                    cur.execute(
                        """
                        INSERT INTO products (
                            sku, name, price, category, status, description,
                            remains, image, images, parent_sku, variant_name, external_id,
                            variant_options, is_hit, is_promotion, is_new,
                            old_price, discount, sort_order
                        )
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            sku,
                            title,
                            price,
                            category,
                            status,
                            description,
                            remains,
                            img,
                            images_str,
                            parent_sku,
                            variant_name,
                            external_id,
                            variant_options_json,
                            is_hit,
                            is_promotion,
                            is_new,
                            old_price,
                            discount_percent,
                            sort_order,
                        ),
                    )
                count += 1

            stale_count = _mark_stale_horoshop_products_out_of_stock(cur, active_skus)
            home_section_counts = await _apply_homepage_section_orders(client, cur, domain)

        conn.commit()
        return {
            "success": True,
            "count": count,
            "stale_out_of_stock": stale_count,
            "home_sections": home_section_counts,
            "message": f"Synced products: {count}; hidden stale products: {stale_count}",
        }
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as exc:
        if conn:
            conn.rollback()
        logger.error("Horoshop sync error: %s", traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Horoshop sync error: {exc}")
    finally:
        if conn:
            conn.close()
