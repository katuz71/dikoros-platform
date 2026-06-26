"""Sync Horoshop product page tab content into local product fields."""

from __future__ import annotations

import asyncio
import logging
import os
import re
from html import unescape

import httpx
from fastapi import HTTPException

from db import get_db_connection
from services.catalog_sync import HOROSHOP_PAGE_HEADERS, _export_catalog_products, _extract_product_note_from_item, _extract_product_note_from_text, _localized_value, _normalize_product_note_text
from services.horoshop_product_urls import product_url_candidates


logger = logging.getLogger(__name__)

PRODUCT_TAB_CONCURRENCY = int(os.getenv("HOROSHOP_PRODUCT_TAB_CONCURRENCY", "8") or "8")
PRODUCT_TAB_MAX_GROUPS = int(os.getenv("HOROSHOP_PRODUCT_TAB_MAX_GROUPS", "0") or "0")

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
        "спосіб застосування та протипоказання",
        "спосіб застосування і протипоказання",
        "застосування",
        "застосування та протипоказання",
        "застосування і протипоказання",
        "як приймати",
        "інструкція та протипоказання",
        "інструкція і протипоказання",
        "рекомендації щодо застосування",
        "способ применения и противопоказания",
        "применение и противопоказания",
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
    "product_note": {
        "примітка",
        "примечание",
        "note",
        "notes",
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


def _section_key_from_tab_id(tab_id: str) -> str | None:
    normalized = _clean_text(tab_id).casefold()
    normalized = (
        normalized
        .replace("і", "i")
        .replace("ї", "i")
        .replace("є", "e")
        .replace("ґ", "g")
    )

    if "opis" in normalized:
        return "description"
    has_usage_marker = "instruk" in normalized or "sposib" in normalized or "zastos" in normalized or "primen" in normalized
    has_contra_marker = "protipokaz" in normalized or "protypokaz" in normalized or "protivopokaz" in normalized or "contraind" in normalized

    if has_usage_marker and has_contra_marker:
        return "usage"
    if "instruk" in normalized:
        return "usage"
    if "protipokaz" in normalized:
        return "composition"
    if "dostav" in normalized or "oplat" in normalized:
        return "delivery_info"
    if "povern" in normalized or "obmin" in normalized:
        return "return_info"
    if "prymit" in normalized or "primit" in normalized or "primechan" in normalized or "note" in normalized:
        return "product_note"

    return None


def _find_balanced_element_html(html: str, start_pos: int, tag_name: str) -> str:
    tag = re.escape(tag_name)
    pattern = re.compile(rf"</?{tag}\b[^>]*>", re.IGNORECASE | re.DOTALL)
    depth = 0

    for match in pattern.finditer(html, start_pos):
        token = match.group(0)
        if token.startswith("</"):
            depth -= 1
            if depth <= 0:
                return html[start_pos:match.end()]
        elif token.endswith("/>"):
            continue
        else:
            depth += 1

    return html[start_pos:]


def _classed_div_pattern(class_name: str) -> re.Pattern:
    escaped = re.escape(class_name)
    return re.compile(
        rf"<div\b[^>]*class\s*=\s*(['\"])(?=[^'\"]*\b{escaped}\b)[^'\"]*\1[^>]*>",
        re.IGNORECASE | re.DOTALL,
    )


def _first_classed_div_html(html: str, class_name: str) -> str:
    match = _classed_div_pattern(class_name).search(html)
    if not match:
        return ""
    return _find_balanced_element_html(html, match.start(), "div")


def _product_group_note_text(group_html: str) -> str:
    title_html = _first_classed_div_html(group_html, "product-heading__title")
    if _heading_key(_html_to_text(title_html)) != "product_note":
        return ""

    for section_match in _classed_div_pattern("product__section").finditer(group_html):
        section_html = _find_balanced_element_html(group_html, section_match.start(), "div")
        text_html = _first_classed_div_html(section_html, "text")
        text = _clean_tab_text(_html_to_text(text_html))
        normalized_note = _normalize_product_note_text(text)
        if normalized_note:
            return normalized_note

    return ""


def _extract_product_group_note_from_html(html: str) -> str:
    notes: list[str] = []
    for group_match in _classed_div_pattern("product__group").finditer(html):
        group_html = _find_balanced_element_html(html, group_match.start(), "div")
        note_text = _product_group_note_text(group_html)
        if note_text:
            notes.append(note_text)

    return _clean_text("\n\n".join(notes))


def _split_long_text_line(line: str) -> list[str]:
    text = _clean_text(line)
    if len(text) <= 800:
        return [text]

    # Horoshop often stores description as one huge paragraph.
    # Split by sentence boundaries instead of dropping the whole description.
    parts = re.split(r"(?<=[.!?…])\s+", text)
    chunks: list[str] = []
    current = ""

    for part in parts:
        part = _clean_text(part)
        if not part:
            continue

        if len(part) > 1200:
            for i in range(0, len(part), 800):
                piece = _clean_text(part[i:i + 800])
                if piece:
                    chunks.append(piece)
            continue

        candidate = f"{current} {part}".strip()
        if len(candidate) > 900:
            if current:
                chunks.append(current)
            current = part
        else:
            current = candidate

    if current:
        chunks.append(current)

    return chunks


def _clean_tab_text(text: str) -> str:
    stop_headings = {
        "відгуки",
        "залишити відгук",
        "схожі товари",
        "рекомендовані товари",
        "переглянуті товари",
        "нещодавно переглянуті",
    }

    garbage_exact = {
        "купити",
        "в кошик",
        "додати до кошика",
        "в наявності",
        "немає в наявності",
        "артикул",
    }

    garbage_markers = (
        "footer__",
        "header__",
        "site-menu",
        "p-review",
        "j-comment",
        "data-href",
        "javascript:",
        "особистий кабінет",
        "схожі товари",
        "переглянуті товари",
    )

    lines = []
    for raw in str(text or "").splitlines():
        line = _clean_text(raw)
        if not line:
            continue

        lowered = line.casefold().strip(" .:-")
        if lowered in stop_headings:
            break
        if lowered in garbage_exact:
            continue
        if any(marker in lowered for marker in garbage_markers):
            continue
        if re.search(r"^(\+?38|\w+@\w+)", lowered):
            continue

        lines.extend(_split_long_text_line(line))

    cleaned = _clean_text("\n".join(lines))

    return cleaned

def extract_product_tab_sections_from_html(html: str) -> dict[str, str]:
    """Extract only real Horoshop tab blocks: div.j-product-block__tab[data-content-id]."""
    sections = {key: "" for key in SECTION_KEYS}

    source = str(html or "")
    source = re.sub(r"<script[\s\S]*?</script>", " ", source, flags=re.IGNORECASE)
    source = re.sub(r"<style[\s\S]*?</style>", " ", source, flags=re.IGNORECASE)
    source = re.sub(r"<svg[\s\S]*?</svg>", " ", source, flags=re.IGNORECASE)

    page_group_note = _extract_product_group_note_from_html(source)
    if page_group_note:
        sections["product_note"] = page_group_note

    tab_pattern = re.compile(
        r"<div\b(?=[^>]*\bj-product-block__tab\b)(?=[^>]*\bdata-content-id\s*=\s*(['\"])(?P<tab_id>.*?)\1)[^>]*>",
        re.IGNORECASE | re.DOTALL,
    )

    for match in tab_pattern.finditer(source):
        tab_id = unescape(match.group("tab_id")).strip()
        block_html = _find_balanced_element_html(source, match.start(), "div")
        text = _clean_tab_text(_html_to_text(block_html))
        if not text:
            continue

        product_note_text = _extract_product_note_from_text(text)
        if product_note_text:
            if sections["product_note"]:
                sections["product_note"] = f"{sections['product_note']}\n\n{product_note_text}".strip()
            else:
                sections["product_note"] = product_note_text

        key = _section_key_from_tab_id(tab_id)
        if not key:
            first_line = next((line for line in text.splitlines() if _clean_text(line)), "")
            key = _heading_key(first_line)
        if not key:
            continue

        if key == "product_note":
            continue

        max_len = 60000 if key == "description" else 25000
        if len(text) > max_len:
            logger.warning("Skip oversized Horoshop tab %s: %s chars", tab_id, len(text))
            continue

        if sections[key]:
            sections[key] = f"{sections[key]}\n\n{text}".strip()
        else:
            sections[key] = text

    for key in SECTION_KEYS:
        sections[key] = _clean_text(sections[key])
    sections["product_note"] = _normalize_product_note_text(sections["product_note"])

    return sections

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
    url_candidates = product_url_candidates(first_item, domain)
    fallback_description = ""
    fallback_usage = ""
    fallback_composition = ""
    fallback_delivery = ""
    fallback_return = ""
    fallback_product_note = ""

    for item in items:
        fallback_product_note = _extract_product_note_from_item(item)
        if fallback_product_note:
            break

    best_sections = {key: "" for key in SECTION_KEYS}
    used_url = None

    for url in url_candidates:
        try:
            response = await client.get(url, headers=HOROSHOP_PAGE_HEADERS, follow_redirects=True)
            if response.status_code >= 400:
                continue
        except httpx.HTTPError:
            continue

        sections = extract_product_tab_sections_from_html(response.text)
        if any(sections.values()):
            if not any(best_sections.values()):
                best_sections = sections
                used_url = str(response.url)
            elif sections.get("product_note") and not best_sections.get("product_note"):
                best_sections["product_note"] = sections["product_note"]
                used_url = str(response.url)

            if best_sections.get("product_note"):
                break

    return {
        "group_key": group_key,
        "skus": [str(item.get("article") or item.get("parent_article") or "").strip() for item in items],
        "site_url": url_candidates[0] if url_candidates else "",
        "url": used_url,
        "sections": {
            "description": best_sections.get("description") or fallback_description,
            "usage": best_sections.get("usage") or fallback_usage,
            "composition": best_sections.get("composition") or fallback_composition,
            "delivery_info": best_sections.get("delivery_info") or fallback_delivery,
            "return_info": best_sections.get("return_info") or fallback_return,
            "product_note": best_sections.get("product_note") or fallback_product_note,
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

            site_url = _clean_text(result.get("url") or result.get("site_url"))
            has_content = any(_clean_text(sections.get(key)) for key in ("description", "usage", "composition", "delivery_info", "return_info", "product_note"))
            if not has_content and not site_url:
                continue

            if site_url:
                groups_with_site_url += 1
            if has_content:
                groups_with_content += 1

            placeholders = ",".join(["?"] * len(skus))
            cur.execute(
                f"""
                UPDATE products
                SET description = COALESCE(NULLIF(?, ''), description),
                    usage = COALESCE(NULLIF(?, ''), usage),
                    composition = COALESCE(NULLIF(?, ''), composition),
                    delivery_info = COALESCE(NULLIF(?, ''), delivery_info),
                    return_info = COALESCE(NULLIF(?, ''), return_info),
                    product_note = COALESCE(NULLIF(?, ''), product_note),
                    site_url = COALESCE(NULLIF(?, ''), site_url),
                    canonical_url = COALESCE(NULLIF(?, ''), canonical_url),
                    source_url = COALESCE(NULLIF(?, ''), source_url)
                WHERE sku IN ({placeholders})
                """,
                (
                    _clean_text(sections.get("description")),
                    _clean_text(sections.get("usage")),
                    _clean_text(sections.get("composition")),
                    _clean_text(sections.get("delivery_info")),
                    _clean_text(sections.get("return_info")),
                    _clean_text(sections.get("product_note")),
                    site_url,
                    site_url,
                    site_url,
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
