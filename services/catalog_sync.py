"""Horoshop catalog synchronization helpers."""

from __future__ import annotations

from dataclasses import dataclass
from html import unescape
from html.parser import HTMLParser
import logging
import os
import re
import traceback

import httpx
from fastapi import HTTPException

from db import get_db_connection


logger = logging.getLogger(__name__)

EXPORT_PAGE_SIZE = 500
MAX_EXPORT_PAGES = 100
HOME_SECTION_COLUMNS = {
    "hit": "home_hit_order",
    "new": "home_new_order",
    "promotion": "home_promotion_order",
}


@dataclass
class HomepageProductRef:
    section: str
    sku: str | None = None
    external_id: str | None = None


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


class HomepageSectionsParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.products: dict[str, list[HomepageProductRef]] = {
            "hit": [],
            "new": [],
            "promotion": [],
        }
        self.current_section: str | None = None
        self.special_content_index = 0
        self.special_depth: int | None = None
        self.current_card: HomepageProductRef | None = None
        self.seen: set[tuple[str, str, str]] = set()

    def handle_starttag(self, tag: str, attrs_list: list[tuple[str, str | None]]) -> None:
        attrs = {key: value or "" for key, value in attrs_list}

        if self.special_depth is not None:
            self.special_depth += 1

        if tag == "div" and _class_contains(attrs, "catalogTabs-content") and _class_contains(attrs, "j-special-offers-content"):
            self.special_content_index += 1
            self._append_current_card()
            
            if self.special_content_index == 1:
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

        if tag == "img" and self.current_card:
            sku = _extract_sku_from_alt(attrs.get("alt") or attrs.get("title"))
            if sku:
                self.current_card.sku = sku

    def handle_endtag(self, tag: str) -> None:
        if self.special_depth is not None:
            self.special_depth -= 1
            if self.special_depth <= 0:
                self._append_current_card()
                self.special_depth = None
                self.current_section = None

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
    response = await client.get(f"https://{domain}/")
    parser = HomepageSectionsParser()
    parser.feed(response.text)
    parser._append_current_card()
    return parser.products


def _row_value(row: object, key: str, index: int = 0) -> object:
    if row is None:
        return None
    if isinstance(row, dict):
        return row.get(key)
    try:
        return row[key]  # type: ignore[index]
    except Exception:
        return row[index]  # type: ignore[index]


def _apply_home_section_order(
    cur,
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
            SET {column} = ?
            WHERE {where_sql}
            """,
            (order, param),
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
    return {
        section: _apply_home_section_order(cur, section, refs)
        for section, refs in sections.items()
    }


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

            cur.execute(
                """
                UPDATE products
                SET sort_order = NULL,
                    is_hit = FALSE,
                    is_new = FALSE,
                    is_promotion = FALSE,
                    home_hit_order = NULL,
                    home_new_order = NULL,
                    home_promotion_order = NULL
                """
            )

            for item in products_list:
                sku = str(item.get("article") or item.get("parent_article") or "").strip()
                if not sku:
                    continue

                external_id = str(item.get("id") or item.get("external_id") or "").strip() or None
                parent_sku = str(item.get("parent_article") or "").strip()
                group_key = parent_sku or sku
                if group_key not in group_order:
                    group_order[group_key] = len(group_order) + 1
                sort_order = group_order[group_key]

                variant_name = _localized_value(item.get("mod_title") or {})
                title = _localized_value(item.get("title") or {}, "Без назви")
                description = _localized_value(item.get("description") or {})

                parent_obj = item.get("parent") or {}
                category = parent_obj.get("value") or "Загальне"

                try:
                    price = float(item.get("price") or 0)
                except (TypeError, ValueError):
                    price = 0.0

                try:
                    old_price = float(item.get("old_price") or 0)
                except (TypeError, ValueError):
                    old_price = 0.0

                status = "available"
                presence_obj = item.get("presence") or {}
                if presence_obj.get("id") == 2:
                    status = "out_of_stock"

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
                            description = ?, image = ?, images = ?,
                            parent_sku = ?, variant_name = ?,
                            is_hit = ?, is_promotion = ?, is_new = ?,
                            old_price = ?, sort_order = ?, external_id = ?
                        WHERE id = ?
                        """,
                        (
                            title,
                            price,
                            category,
                            status,
                            description,
                            img,
                            images_str,
                            parent_sku,
                            variant_name,
                            is_hit,
                            is_promotion,
                            is_new,
                            old_price,
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
                            image, images, parent_sku, variant_name, external_id,
                            is_hit, is_promotion, is_new, old_price, sort_order
                        )
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            sku,
                            title,
                            price,
                            category,
                            status,
                            description,
                            img,
                            images_str,
                            parent_sku,
                            variant_name,
                            external_id,
                            is_hit,
                            is_promotion,
                            is_new,
                            old_price,
                            sort_order,
                        ),
                    )
                count += 1

            home_section_counts = await _apply_homepage_section_orders(client, cur, domain)

        conn.commit()
        return {
            "success": True,
            "count": count,
            "home_sections": home_section_counts,
            "message": f"Synced products: {count}",
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
