"""Helpers for exact Horoshop product page URL extraction."""

from __future__ import annotations

from html import unescape
import re
from urllib.parse import urljoin, urlparse


URL_FIELD_NAMES = {
    "url",
    "href",
    "link",
    "canonical",
    "canonical_url",
    "product_url",
    "site_url",
    "source_url",
    "web_url",
    "url_ua",
    "url_uk",
    "url_ru",
    "slug",
    "alias",
    "path",
}

IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg", ".avif")
SKIP_URL_CONTAINER_KEYS = {"parent", "category", "categories", "breadcrumbs", "brand", "icons", "images", "presence"}


def _clean_text(value: object) -> str:
    return re.sub(r"\s+", " ", unescape(str(value or ""))).strip()


def _localized_value(value: object, default: str = "") -> str:
    if isinstance(value, dict):
        return str(value.get("ua") or value.get("uk") or value.get("ru") or value.get("en") or default)
    return str(value or default)


def _is_product_page_url(candidate: str, domain: str) -> bool:
    value = str(candidate or "").strip()
    if not value:
        return False
    if value.startswith("#") or value.startswith("javascript:") or value.startswith("mailto:") or value.startswith("tel:"):
        return False

    parsed = urlparse(value)
    path = parsed.path or value
    lowered_path = path.lower()
    if lowered_path.endswith(IMAGE_EXTENSIONS):
        return False
    if any(part in lowered_path for part in ("/assets/", "/static/", "/uploads/", "/content/images/", "/api/")):
        return False

    expected_host = domain.replace("www.", "")
    if parsed.netloc and expected_host not in parsed.netloc.replace("www.", ""):
        return False

    return True


def normalize_product_url(candidate: str, domain: str) -> str | None:
    value = str(candidate or "").strip()
    if not _is_product_page_url(value, domain):
        return None

    if value.startswith(("http://", "https://")):
        url = value
    else:
        url = urljoin(f"https://{domain}/", value.lstrip("/"))

    return url.split("#", 1)[0]


def _walk_url_candidates(value: object, domain: str, out: list[str]) -> None:
    if isinstance(value, dict):
        for key, nested in value.items():
            lowered = str(key or "").casefold()
            if lowered in SKIP_URL_CONTAINER_KEYS:
                continue
            if lowered in URL_FIELD_NAMES or any(token in lowered for token in ("url", "href", "link", "slug", "alias")):
                if isinstance(nested, (str, int, float)):
                    url = normalize_product_url(str(nested), domain)
                    if url:
                        out.append(url)
                else:
                    _walk_url_candidates(nested, domain, out)
            elif isinstance(nested, (dict, list, tuple)):
                _walk_url_candidates(nested, domain, out)
        return

    if isinstance(value, (list, tuple)):
        for nested in value:
            _walk_url_candidates(nested, domain, out)


def product_url_candidates(item: dict, domain: str) -> list[str]:
    candidates: list[str] = []

    for key in URL_FIELD_NAMES:
        raw = item.get(key)
        if raw is None:
            continue
        if isinstance(raw, dict):
            raw = _localized_value(raw)
        url = normalize_product_url(_clean_text(raw), domain)
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


def primary_product_url(item: dict, domain: str) -> str:
    candidates = product_url_candidates(item, domain)
    return candidates[0] if candidates else ""
