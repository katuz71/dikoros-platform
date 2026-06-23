"""Sync Horoshop product page tab content into local product fields."""

from __future__ import annotations

import asyncio
import logging
import os
import re
from html import unescape
from urllib.parse import urljoin, urlparse

import httpx
from fastapi import HTTPException

from db import get_db_connection
from services.catalog_sync import HOROSHOP_PAGE_HEADERS, _export_catalog_products, _localized_value


logger = logging.getLogger(__name__)

PRODUCT_TAB_CONCURRENCY = int(os.getenv("HOROSHOP_PRODUCT_TAB_CONCURRENCY", "8") or "8")
PRODUCT_TAB_MAX_GROUPS = int(os.getenv("HOROSHOP_PRODUCT_TAB_MAX_GROUPS", "0") or "0")

URL_FIELD_NAMES = {
    "url",
    "href",
    "link",
    "canonical",
    "product_url",
    "site_url",
    "web_url",
    "url_ua",
    "url_uk",
    "url_ru",
    "slug",
    "alias",
    "path",
}

IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg", ".avif")

SECTION_ALIASES = {
    "description": {
        "опис",
        "опис товару",
        "огляд",
        "про товар",
        "детальніше",
    },
    "usage": {
        "інструкція",
        "інструкція із застосування",
        "інструкція до застосування",
        "спосіб застосування",
        "застосування",
        "як приймати",
        "рекомендації щодо застосування",
    },
    "composition": {
        "протипоказання",
        "застереження",
        "попередження",
        "обмеження",
        "кому не можна",
    },
    "delivery_info": {
        "доставка",
        "оплата",
        "доставка і оплата",
        "доставка та оплата",
        "доставка, оплата",
        "доставка, оплата і повернення",
        "доставка, оплата та повернення",
    },
    "return_info": {
        "повернення",
        "обмін",
        "обмін і повернення",
        "обмін та повернення",
        "гарантія",
    },
}

SECTION_KEYS = tuple(SECTION_ALIASES.keys())


def _clean_text(value: object) -> str:
    text = unescape(str(value or ""))
    text = text.replace("\xa0", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n[ \t]+", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _html_to_text(html: str) -> str:
    source = str(html or "")
    source = re.sub(r"<script[\s\S]*?</script>", " ", source, flags=re.IGNORECASE)
    source = re.sub(r"<style[\s\S]*?</style>", " ", source, flags=re.IGNORECASE)
    source = re.sub(r"<svg[\s\S]*?</svg>", " ", source, flags=re.IGNORECASE)
    source = re.sub(r"<br\s*/?>", "\n", source, flags=re.IGNORECASE)
    source = re.sub(r"</(?:p|div|li|tr|section|article|h[1-6])>", "\n", source, flags=re.IGNORECASE)
    source = re.sub(r"<li[^>]*>", "\n- ", source, flags=re.IGNORECASE)
    source = re.sub(r"<h[1-6][^>]*>", "\n", source, flags=re.IGNORECASE)
    source = re.sub(r"<[^>]+>", " ", source)
    return _clean_text(source)


def _heading_key(line: str) -> str | None:
    normalized = _clean_text(line).casefold()
    normalized = re.sub(r"^[\-•·\d\s.)]+", "", normalized)
    normalized = re.sub(r"[\s:：.]+$", "", normalized)
    normalized = re.sub(r"\s+", " ", normalized)

    if not normalized or len(normalized) > 80:
        return None

    for key, aliases in SECTION_ALIASES.items():
        if normalized in aliases:
            return key

    return None


def extract_product_tab_sections_from_html(html: str) -> dict[str, str]:
    """Extract product tab sections from a Horoshop product page HTML."""
    sections = {key: "" for key in SECTION_KEYS}
    text = _html_to_text(html)
    if not text:
        return sections

    active_key: str | None = None
    seen_headings = set()

    for raw_line in text.splitlines():
        line = _clean_text(raw_line)
        if not line:
            continue

        key = _heading_key(line)
        if key:
            active_key = key
            seen_headings.add(key)
            continue

        if not active_key:
            continue

        sections[active_key] = f"{sections[active_key]}\n{line}".strip()

    for key in list(sections.keys()):
        sections[key] = _clean_text(sections[key])

    # If the page has no product headings, do not try to infer from the full page:
    # it would mix header/footer/legal text into product fields.
    if not seen_headings:
        return {key: "" for key in SECTION_KEYS}

    return sections


def _is_product_page_url(candidate: str, domain: str) -> bool:
    value = str(candidate or "").strip()
    if not value:
        return False
    if value.startswith("#") or value.startswith("javascript:") or value.startswith("mailto:") or value.startswith("tel:"):
        return False

    parsed = urlparse(value)
    path = parsed.path or value
    if path.lower().endswith(IMAGE_EXTENSIONS):
        return False
    if any(part in path.lower() for part in ("/assets/", "/static/", "/uploads/", "/content/images/", "/api/")):
        return False

    if parsed.netloc and domain.replace("www.", "") not in parsed.netloc.replace("www.", ""):
        return False

    return True


def _normalize_product_url(candidate: str, domain: str) -> str | None:
    value = str(candidate or "").strip()
    if not _is_product_page_url(value, domain):
        return None

    if value.startswith(("http://", "https://")):
        url = value
    else:
        url = urljoin(f"https://{domain}/", value.lstrip("/"))

    return url.split("#", 1)[0]


def _walk_url_candidates(value: object, domain: str, out: list[str], parent_key: str = "") -> None:
    if isinstance(value, dict):
        for key, nested in value.items():
            lowered = str(key or "").casefold()
            if lowered in URL_FIELD_NAMES or any(token in lowered for token in ("url", "href", "link", "slug", "alias")):
                if isinstance(nested, (str, int, float)):
                    url = _normalize_product_url(str(nested), domain)
                    if url:
                        out.append(url)
                else:
                    _walk_url_candidates(nested, domain, out, lowered)
            elif isinstance(nested, (dict, list, tuple)):
                _walk_url_candidates(nested, domain, out, lowered)
        return

    if isinstance(value, (list, tuple)):
        for nested in value:
            _walk_url_candidates(nested, domain, out, parent_key)


def product_url_candidates(item: dict, domain: str) -> list[str]:
    candidates: list[str] = []

    for key in URL_FIELD_NAMES:
        raw = item.get(key)
        if raw is None:
            continue
        if isinstance(raw, dict):
            raw = _localized_value(raw)
        url = _normalize_product_url(str(raw), domain)
        if url:
            candidates.append(url)

    _walk_url_candidates(item, domain, candidates)

    seen = set()
    result = []
    for url in candidates:
        if url in seen:
            continue
        seen.add(url)
        result.append(url)
    return result


def _api_text(item: dict, *keys: str) -> str:
    for key in keys:
        value = item.get(key)
        if value is None:
            continue
        text = _localized_value(value) if isinstance(value, dict) else str(value or "")
        text = _clean_text(text)
        if text:
            return text
    return ""


async def _fetch_group_sections(client: httpx.AsyncClient, domain: str, group_key: str, items: list[dict]) -> dict:
    first_item = items[0]
    fallback_description = _api_text(first_item, "description")
    fallback_usage = _api_text(first_item, "usage", "instruction", "instructions", "how_to_use")
    fallback_composition = _api_text(first_item, "contraindications", "contraindication", "composition")
    fallback_delivery = _api_text(first_item, "delivery_info", "delivery", "payment", "shipping")
    fallback_return = _api_text(first_item, "return_info", "returns", "return", "warranty")

    best_sections = {key: "" for key in SECTION_KEYS}
    used_url = None

    for url in product_url_candidates(first_item, domain):
        try:
            response = await client.get(url, headers=HOROSHOP_PAGE_HEADERS, follow_redirects=True)
            if response.status_code >= 400:
                continue
        except httpx.HTTPError:
            continue

        sections = extract_product_tab_sections_from_html(response.text)
        if any(sections.values()):
            best_sections = sections
            used_url = str(response.url)
            break

    return {
        "group_key": group_key,
        "skus": [str(item.get("article") or item.get("parent_article") or "").strip() for item in items],
        "url": used_url,
        "sections": {
            "description": best_sections.get("description") or fallback_description,
            "usage": best_sections.get("usage") or fallback_usage,
            "composition": best_sections.get("composition") or fallback_composition,
            "delivery_info": best_sections.get("delivery_info") or fallback_delivery,
            "return_info": best_sections.get("return_info") or fallback_return,
        },
    }


async def sync_horoshop_product_tabs() -> dict:
    """Fetch product page tabs from Horoshop site and persist them in products."""
    domain = os.getenv("HOROSHOP_DOMAIN")
    login = os.getenv("HOROSHOP_LOGIN")
    password = os.getenv("HOROSHOP_PASSWORD")

    if not domain or not login or not password:
        raise HTTPException(status_code=500, detail="Horoshop sync credentials are not configured")

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

        product_groups: dict[str, list[dict]] = {}
        for item in products_list:
            sku = str(item.get("article") or item.get("parent_article") or "").strip()
            if not sku:
                continue
            parent_sku = str(item.get("parent_article") or "").strip()
            group_key = parent_sku or sku
            product_groups.setdefault(group_key, []).append(item)

        group_items = list(product_groups.items())
        if PRODUCT_TAB_MAX_GROUPS > 0:
            group_items = group_items[:PRODUCT_TAB_MAX_GROUPS]

        semaphore = asyncio.Semaphore(max(1, PRODUCT_TAB_CONCURRENCY))

        async def fetch_one(group_key: str, items: list[dict]) -> dict:
            async with semaphore:
                return await _fetch_group_sections(client, domain, group_key, items)

        fetched = await asyncio.gather(*(fetch_one(group_key, items) for group_key, items in group_items))

    conn = get_db_connection()
    updated_rows = 0
    groups_with_site_url = 0
    groups_with_content = 0
    try:
        cur = conn.cursor()
        for result in fetched:
            sections = result.get("sections") or {}
            skus = [sku for sku in result.get("skus") or [] if sku]
            if not skus:
                continue

            has_content = any(_clean_text(sections.get(key)) for key in ("description", "usage", "composition", "delivery_info", "return_info"))
            if not has_content:
                continue

            if result.get("url"):
                groups_with_site_url += 1
            groups_with_content += 1

            placeholders = ",".join(["?"] * len(skus))
            cur.execute(
                f"""
                UPDATE products
                SET description = COALESCE(NULLIF(?, ''), description),
                    usage = COALESCE(NULLIF(?, ''), usage),
                    composition = COALESCE(NULLIF(?, ''), composition),
                    delivery_info = COALESCE(NULLIF(?, ''), delivery_info),
                    return_info = COALESCE(NULLIF(?, ''), return_info)
                WHERE sku IN ({placeholders})
                """,
                (
                    _clean_text(sections.get("description")),
                    _clean_text(sections.get("usage")),
                    _clean_text(sections.get("composition")),
                    _clean_text(sections.get("delivery_info")),
                    _clean_text(sections.get("return_info")),
                    *skus,
                ),
            )
            updated_rows += int(getattr(cur, "rowcount", 0) or 0)

        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    result = {
        "success": True,
        "groups_checked": len(group_items),
        "groups_with_site_url": groups_with_site_url,
        "groups_with_content": groups_with_content,
        "updated_rows": updated_rows,
    }
    logger.info("Horoshop product tabs sync completed: %s", result)
    return result
