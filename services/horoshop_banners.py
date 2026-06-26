"""Synchronize clickable home and category banners from the Horoshop site."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from html import unescape
from html.parser import HTMLParser
import json
import logging
import os
import re
from urllib.parse import parse_qs, unquote, urljoin, urlparse, urlunparse
import urllib.request

import httpx

from db import get_db_connection
from services.catalog_sync import HOROSHOP_PAGE_HEADERS


logger = logging.getLogger(__name__)

DEFAULT_HOROSHOP_DOMAIN = "dikoros-ua.com"
PROMOTION_PATH_MARKERS = ("/aktsii", "/akcii", "/sale", "/promotions")
PRODUCT_ID_QUERY_KEYS = ("id", "product_id", "external_id", "product", "productid")
PRODUCT_ID_PATH_MARKERS = ("id", "product", "products", "tovar", "tovary", "goods", "item", "p")
PRODUCT_SKU_QUERY_KEYS = ("sku", "article", "articul", "code", "vendor_code", "parent_sku")
PRODUCT_URL_COLUMNS = ("site_url", "canonical_url", "source_url", "link_url", "product_url", "url", "href")
PRODUCT_PAGE_FETCH_TIMEOUT = 12.0
NON_PRODUCT_PAGE_PREFIXES = (
    "/api",
    "/assets",
    "/blog",
    "/cart",
    "/checkout",
    "/content",
    "/images",
    "/news",
    "/static",
    "/statti",
    "/stattya",
    "/uploads",
)
NON_PRODUCT_FILE_RE = re.compile(r"\.(?:avif|css|gif|ico|jpe?g|js|pdf|png|svg|webp|xml)$", re.IGNORECASE)
HTML_SKU_LABEL_RE = re.compile(
    "(?:\\bsku\\b|\\barticle\\b|\\barticul\\b|\\u0410\\u0440\\u0442\\u0438\\u043a\\u0443\\u043b)"
    "\\s*[:#\\-]?\\s*([A-Za-z0-9_.\\-/\\u0400-\\u04FF]{2,80})",
    re.IGNORECASE,
)
GENERIC_PRODUCT_URL_TOKENS = {
    "mix",
    "miks",
    "mikrodozinh",
    "mikrodozing",
    "microdosing",
    "kapsul",
    "kapsuly",
    "capsule",
    "capsules",
    "60",
    "05",
}


@dataclass
class BannerCandidate:
    image_url: str
    source_url: str = ""
    title: str = ""


@dataclass
class SiteLink:
    href: str
    label: str = ""


def _class_names(attrs: dict[str, str]) -> set[str]:
    return {item for item in attrs.get("class", "").split() if item}


def _clean_text(value: object) -> str:
    return re.sub(r"\s+", " ", unescape(str(value or "")).replace("\xa0", " ")).strip()


def _canonical_url(value: str, base_url: str) -> str:
    candidate = _clean_text(value)
    if not candidate or candidate.startswith(("#", "javascript:", "mailto:", "tel:")):
        return ""
    absolute = urljoin(base_url, candidate)
    parsed = urlparse(absolute)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return ""
    return urlunparse((parsed.scheme.lower(), parsed.netloc.lower(), parsed.path or "/", "", parsed.query, ""))


def _url_key(value: str) -> str:
    parsed = urlparse(value)
    path = re.sub(r"/+", "/", parsed.path or "/").rstrip("/") or "/"
    return f"{parsed.netloc.lower()}:{path.casefold()}"


TRANSLITERATION = {
    "а": "a", "б": "b", "в": "v", "г": "h", "ґ": "g", "д": "d", "е": "e",
    "є": "ye", "ж": "zh", "з": "z", "и": "y", "і": "i", "ї": "yi", "й": "i",
    "к": "k", "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r",
    "с": "s", "т": "t", "у": "u", "ф": "f", "х": "kh", "ц": "ts", "ч": "ch",
    "ш": "sh", "щ": "shch", "ь": "", "ю": "yu", "я": "ya", "ы": "y", "э": "e",
    "ё": "yo", "ъ": "",
}


def _slugify(value: object) -> str:
    text = _clean_text(value).casefold()
    transliterated = "".join(TRANSLITERATION.get(char, char) for char in text)
    return re.sub(r"[^a-z0-9]+", "-", transliterated).strip("-")


def _slug_tokens(value: object) -> set[str]:
    return {token for token in _slugify(value).split("-") if len(token) > 1}


class FirstBannerSliderParser(HTMLParser):
    """Extract banners from the first Horoshop ``banners__slider`` block."""

    def __init__(self, page_url: str) -> None:
        super().__init__(convert_charrefs=True)
        self.page_url = page_url
        self.div_depth = 0
        self.slider_depth: int | None = None
        self.completed = False
        self.pending_href = ""
        self.banners: list[BannerCandidate] = []
        self.seen_images: set[str] = set()

    def handle_starttag(self, tag: str, attrs_list: list[tuple[str, str | None]]) -> None:
        attrs = {key: value or "" for key, value in attrs_list}

        if tag == "div":
            self.div_depth += 1
            if (
                self.slider_depth is None
                and not self.completed
                and "banners__slider" in _class_names(attrs)
            ):
                self.slider_depth = self.div_depth

        if self.slider_depth is None or self.completed:
            return

        classes = _class_names(attrs)
        if tag == "a" and "banner-a" in classes:
            href = _canonical_url(attrs.get("href", ""), self.page_url)
            if self.banners and not self.banners[-1].source_url:
                self.banners[-1].source_url = href
            else:
                self.pending_href = href
            return

        if tag == "img" and "banner-img" in classes:
            image_url = _canonical_url(
                attrs.get("src") or attrs.get("data-src") or attrs.get("data-original") or "",
                self.page_url,
            )
            if not image_url or image_url in self.seen_images:
                return
            self.seen_images.add(image_url)
            self.banners.append(
                BannerCandidate(
                    image_url=image_url,
                    source_url=self.pending_href,
                    title=_clean_text(attrs.get("alt") or attrs.get("title")),
                )
            )
            self.pending_href = ""

    def handle_endtag(self, tag: str) -> None:
        if tag != "div":
            return
        if self.slider_depth is not None and self.div_depth == self.slider_depth:
            self.completed = True
            self.slider_depth = None
        self.div_depth = max(0, self.div_depth - 1)


class SiteLinksParser(HTMLParser):
    def __init__(self, page_url: str) -> None:
        super().__init__(convert_charrefs=True)
        self.page_url = page_url
        self.current: dict[str, object] | None = None
        self.links: list[SiteLink] = []

    def handle_starttag(self, tag: str, attrs_list: list[tuple[str, str | None]]) -> None:
        attrs = {key: value or "" for key, value in attrs_list}
        if tag == "a" and attrs.get("href"):
            href = _canonical_url(attrs["href"], self.page_url)
            self.current = {
                "href": href,
                "texts": [attrs.get("title", ""), attrs.get("aria-label", "")],
            }
        elif tag == "img" and self.current is not None:
            texts = self.current.get("texts")
            if isinstance(texts, list):
                texts.extend([attrs.get("alt", ""), attrs.get("title", "")])

    def handle_data(self, data: str) -> None:
        if self.current is not None:
            texts = self.current.get("texts")
            if isinstance(texts, list):
                texts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag != "a" or self.current is None:
            return
        href = str(self.current.get("href") or "")
        texts = self.current.get("texts")
        label = _clean_text(" ".join(str(item) for item in texts or []))
        if href:
            self.links.append(SiteLink(href=href, label=label))
        self.current = None


class SkuMetaParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.candidates: list[str] = []
        self._capture_depth = 0
        self._capture_parts: list[str] = []

    def handle_starttag(self, tag: str, attrs_list: list[tuple[str, str | None]]) -> None:
        attrs = {key.lower(): value or "" for key, value in attrs_list}
        is_sku_tag = any(
            _clean_text(attrs.get(key)).casefold() == "sku"
            for key in ("itemprop", "name", "property")
        )
        if self._capture_depth:
            self._capture_depth += 1

        if not is_sku_tag:
            return

        for key in ("content", "value", "data-value"):
            value = _clean_sku_candidate(attrs.get(key))
            if value:
                self.candidates.append(value)

        if tag not in {"input", "link", "meta"}:
            self._capture_depth = 1
            self._capture_parts = []

    def handle_data(self, data: str) -> None:
        if self._capture_depth:
            self._capture_parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if not self._capture_depth:
            return
        self._capture_depth -= 1
        if self._capture_depth:
            return
        value = _clean_sku_candidate(" ".join(self._capture_parts))
        if value:
            self.candidates.append(value)
        self._capture_parts = []


def parse_first_banner_slider(html: str, page_url: str) -> list[BannerCandidate]:
    parser = FirstBannerSliderParser(page_url)
    parser.feed(html)
    parser.close()
    return parser.banners


def parse_site_links(html: str, page_url: str) -> list[SiteLink]:
    parser = SiteLinksParser(page_url)
    parser.feed(html)
    parser.close()
    return parser.links


def _same_host(left: str, right: str) -> bool:
    def host(value: str) -> str:
        return urlparse(value).netloc.casefold().removeprefix("www.")

    return bool(host(left)) and host(left) == host(right)


def _find_category_destination(conn, path: str) -> str:
    segments = [segment for segment in path.split("/") if segment]
    first_segment = segments[0] if segments else ""
    path_tokens = _slug_tokens(first_segment)
    if not path_tokens:
        return ""

    rows = conn.execute("SELECT id, name, external_id FROM categories ORDER BY id ASC").fetchall()
    for row in rows:
        external_id = str(row.get("external_id") or "").strip()
        if external_id and external_id in segments:
            return str(row.get("name") or "").strip()

    for row in rows:
        name = str(row.get("name") or "").strip()
        root_name = name.split("/", 1)[0].strip()
        category_tokens = _slug_tokens(root_name)
        if category_tokens and category_tokens == path_tokens:
            return root_name

    product_categories = conn.execute(
        "SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND TRIM(category) != ''"
    ).fetchall()
    for row in product_categories:
        root_name = str(row.get("category") or "").split("/", 1)[0].strip()
        category_tokens = _slug_tokens(root_name)
        if category_tokens and category_tokens == path_tokens:
            return root_name
    return ""


def _url_segments(value: str) -> list[str]:
    return [unquote(segment).strip() for segment in value.split("/") if segment.strip()]


def _normalize_product_code(value: object) -> str:
    return "".join(char for char in _clean_text(value).casefold() if char.isalnum())


def _clean_sku_candidate(value: object) -> str:
    text = _clean_text(value)
    if not text:
        return ""
    text = re.sub(r"^[\s#:\-./]+|[\s#:\-./,;]+$", "", text)
    if len(text) < 2 or len(text) > 80:
        return ""
    if not re.search("[A-Za-z0-9\\u0400-\\u04FF]", text):
        return ""
    return text


def _normalized_sku_candidates(values: set[str] | list[str]) -> set[str]:
    result: set[str] = set()
    for value in values:
        normalized = _normalize_product_code(_clean_sku_candidate(value))
        if normalized:
            result.add(normalized)
    return result


def _json_sku_values(value: object) -> list[str]:
    values: list[str] = []

    def walk(item: object) -> None:
        if isinstance(item, dict):
            for key, child in item.items():
                if str(key or "").casefold() == "sku":
                    sku = _clean_sku_candidate(child)
                    if sku:
                        values.append(sku)
                else:
                    walk(child)
        elif isinstance(item, list):
            for child in item:
                walk(child)

    walk(value)
    return values


def _variant_sku_candidates(value: object) -> set[str]:
    if value is None:
        return set()

    parsed: object = value
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return set()
        try:
            parsed = json.loads(text)
        except (TypeError, ValueError):
            return set()

    return _normalized_sku_candidates(_json_sku_values(parsed))


def _json_ld_sku_candidates(html: str) -> list[str]:
    result: list[str] = []
    script_re = re.compile(
        r"<script\b(?=[^>]*application/ld\+json)[^>]*>(.*?)</script>",
        re.IGNORECASE | re.DOTALL,
    )
    for match in script_re.finditer(html):
        script_text = unescape(match.group(1)).strip()
        if not script_text:
            continue
        try:
            parsed = json.loads(script_text)
        except (TypeError, ValueError):
            continue
        result.extend(_json_sku_values(parsed))
    return result


def _meta_sku_candidates(html: str) -> list[str]:
    parser = SkuMetaParser()
    try:
        parser.feed(html)
        parser.close()
    except Exception:
        return parser.candidates
    return parser.candidates


def _html_text_sku_candidates(html: str) -> list[str]:
    text = re.sub(r"(?is)<script\b.*?</script>", " ", html)
    text = re.sub(r"(?is)<style\b.*?</style>", " ", text)
    text = re.sub(r"(?s)<[^>]+>", " ", text)
    text = _clean_text(text)
    return [_clean_sku_candidate(match.group(1)) for match in HTML_SKU_LABEL_RE.finditer(text)]


def _html_sku_candidates(html: str) -> set[str]:
    values = (
        _json_ld_sku_candidates(html)
        + _meta_sku_candidates(html)
        + _html_text_sku_candidates(html)
    )
    return _normalized_sku_candidates([value for value in values if value])


def _product_id_sort_key(value: str) -> tuple[int, object]:
    try:
        return (0, int(value))
    except (TypeError, ValueError):
        return (1, value)


def _is_product_like_source_url(absolute_url: str, site_url: str) -> bool:
    if not _same_host(absolute_url, site_url):
        return False

    parsed = urlparse(absolute_url)
    path = re.sub(r"/+", "/", parsed.path or "/").rstrip("/").casefold()
    if not path or path == "/":
        return False
    if any(path == prefix or path.startswith(f"{prefix}/") for prefix in NON_PRODUCT_PAGE_PREFIXES):
        return False
    if any(marker in path for marker in PROMOTION_PATH_MARKERS):
        return False
    if NON_PRODUCT_FILE_RE.search(path):
        return False
    return True


def _fetch_product_page_html(absolute_url: str) -> str:
    request = urllib.request.Request(absolute_url, headers=HOROSHOP_PAGE_HEADERS)
    try:
        return urllib.request.urlopen(request, timeout=PRODUCT_PAGE_FETCH_TIMEOUT).read().decode(
            "utf-8",
            "replace",
        )
    except Exception as exc:
        logger.warning("Horoshop product page fetch failed for %s: %s", absolute_url, exc)
    return ""


def _path_code_candidates(segments: list[str]) -> set[str]:
    candidates: set[str] = set()
    for segment in segments:
        normalized = _normalize_product_code(segment)
        if (
            len(normalized) >= 4
            and normalized not in GENERIC_PRODUCT_URL_TOKENS
            and any(char.isalpha() for char in normalized)
        ):
            candidates.add(normalized)
    return candidates


def _query_values(parsed) -> dict[str, list[str]]:
    result: dict[str, list[str]] = {}
    for key, values in parse_qs(parsed.query, keep_blank_values=False).items():
        normalized_key = str(key or "").strip().lower()
        if not normalized_key:
            continue
        result.setdefault(normalized_key, []).extend(
            unquote(item).strip() for item in values if str(item or "").strip()
        )
    return result


def _explicit_product_id_candidates(parsed) -> list[str]:
    query = _query_values(parsed)
    candidates: list[str] = []
    for key in PRODUCT_ID_QUERY_KEYS:
        candidates.extend(query.get(key, []))

    segments = _url_segments(parsed.path or "")
    for index, segment in enumerate(segments[:-1]):
        marker = _slugify(segment)
        next_segment = segments[index + 1].strip()
        if marker in PRODUCT_ID_PATH_MARKERS and re.fullmatch(r"[A-Za-z0-9_-]{2,}", next_segment):
            candidates.append(next_segment)

    seen: set[str] = set()
    result: list[str] = []
    for candidate in candidates:
        value = str(candidate or "").strip()
        if value and value not in seen:
            result.append(value)
            seen.add(value)
    return result


def _explicit_product_sku_candidates(parsed) -> set[str]:
    query = _query_values(parsed)
    candidates: set[str] = set()
    for key in PRODUCT_SKU_QUERY_KEYS:
        for value in query.get(key, []):
            normalized = _normalize_product_code(value)
            if normalized:
                candidates.add(normalized)
    candidates.update(_path_code_candidates(_url_segments(parsed.path or "")))
    return candidates


def _find_product_by_external_id(conn, candidates: list[str]) -> str:
    for external_id in candidates:
        row = conn.execute(
            "SELECT id FROM products WHERE external_id = ? ORDER BY id ASC LIMIT 1",
            (external_id,),
        ).fetchone()
        if row:
            return str(row.get("id"))
    return ""


def _find_product_by_sku(conn, candidates: set[str]) -> str:
    normalized_candidates = _normalized_sku_candidates(candidates)
    if not normalized_candidates:
        return ""

    rows = conn.execute(
        """
        SELECT id, sku, parent_sku, variants
        FROM products
        WHERE (sku IS NOT NULL AND TRIM(sku) != '')
           OR (parent_sku IS NOT NULL AND TRIM(parent_sku) != '')
           OR (variants IS NOT NULL AND TRIM(variants) != '')
        ORDER BY id ASC
        """
    ).fetchall()
    matches_by_group: dict[str, list[tuple[int, str]]] = {}
    for row in rows:
        product_id = str(row.get("id") or "").strip()
        if not product_id:
            continue

        sku = _normalize_product_code(row.get("sku"))
        parent_sku = _normalize_product_code(row.get("parent_sku"))
        variant_skus = _variant_sku_candidates(row.get("variants"))
        priority = 100

        if sku and sku in normalized_candidates:
            priority = min(priority, 0)
        if parent_sku and parent_sku in normalized_candidates:
            priority = min(priority, 1)
        if variant_skus & normalized_candidates:
            priority = min(priority, 2)
        if priority == 100:
            continue

        group_key = parent_sku or sku or product_id
        matches_by_group.setdefault(group_key, []).append((priority, product_id))

    if len(matches_by_group) != 1:
        return ""

    matches = next(iter(matches_by_group.values()))
    matches.sort(key=lambda item: (item[0], _product_id_sort_key(item[1])))
    return matches[0][1]


def _existing_product_url_columns(conn) -> list[str]:
    placeholders = ",".join(["?"] * len(PRODUCT_URL_COLUMNS))
    rows = conn.execute(
        f"""
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'products'
          AND column_name IN ({placeholders})
        """,
        PRODUCT_URL_COLUMNS,
    ).fetchall()
    return [str(row.get("column_name") or "").strip() for row in rows if row.get("column_name")]


def _find_product_by_source_url(conn, absolute_url: str, site_url: str) -> str:
    columns = _existing_product_url_columns(conn)
    if not columns:
        return ""

    target_key = _url_key(absolute_url)
    select_columns = ", ".join(columns)
    where_sql = " OR ".join(f"({column} IS NOT NULL AND TRIM({column}) != '')" for column in columns)
    rows = conn.execute(
        f"""
        SELECT id, {select_columns}
        FROM products
        WHERE {where_sql}
        ORDER BY id ASC
        """
    ).fetchall()
    for row in rows:
        for column in columns:
            product_url = _canonical_url(str(row.get(column) or ""), site_url)
            if product_url and _url_key(product_url) == target_key:
                return str(row.get("id"))
    return ""


def _find_product_destination(conn, absolute_url: str, site_url: str) -> str:
    parsed = urlparse(absolute_url)

    product_id = _find_product_by_external_id(conn, _explicit_product_id_candidates(parsed))
    if product_id:
        return product_id

    product_id = _find_product_by_sku(conn, _explicit_product_sku_candidates(parsed))
    if product_id:
        return product_id

    product_id = _find_product_by_source_url(conn, absolute_url, site_url)
    if product_id:
        return product_id

    if not _is_product_like_source_url(absolute_url, site_url):
        return ""

    html = _fetch_product_page_html(absolute_url)
    if not html:
        return ""

    return _find_product_by_sku(conn, _html_sku_candidates(html))


def resolve_banner_destination(
    url: str,
    conn,
    site_url: str,
    known_post_urls: set[str] | None = None,
) -> dict[str, str]:
    absolute_url = _canonical_url(url, site_url)
    if not absolute_url:
        return {"link_type": "none", "link_value": "", "source_url": ""}

    if not _same_host(absolute_url, site_url):
        return {"link_type": "external", "link_value": absolute_url, "source_url": absolute_url}

    parsed = urlparse(absolute_url)
    path = re.sub(r"/+", "/", parsed.path or "/").casefold()
    if any(marker in path for marker in PROMOTION_PATH_MARKERS):
        return {"link_type": "promotions", "link_value": "", "source_url": absolute_url}

    product_id = _find_product_destination(conn, absolute_url, site_url)
    if product_id:
        return {"link_type": "product", "link_value": product_id, "source_url": absolute_url}

    category = _find_category_destination(conn, path)
    if category:
        return {"link_type": "category", "link_value": category, "source_url": absolute_url}

    if known_post_urls and _url_key(absolute_url) in known_post_urls:
        return {"link_type": "post", "link_value": absolute_url, "source_url": absolute_url}

    if "/blog/" in path or "/statti/" in path or "/stattya/" in path:
        return {"link_type": "post", "link_value": absolute_url, "source_url": absolute_url}

    return {"link_type": "none", "link_value": "", "source_url": absolute_url}


def _find_category_page_url(category: dict, links: list[SiteLink], site_url: str) -> str:
    name = str(category.get("name") or "").split("/", 1)[0].strip()
    normalized_name = _clean_text(name).casefold()
    category_tokens = _slug_tokens(name)
    best_url = ""
    best_score = 0

    for link in links:
        if not _same_host(link.href, site_url):
            continue
        parsed = urlparse(link.href)
        segments = [segment for segment in parsed.path.split("/") if segment]
        if not segments or len(segments) > 2 or any(segment.isdigit() for segment in segments):
            continue
        if segments[0] in {"blog", "aktsii", "katalog", "content", "api"}:
            continue

        label = _clean_text(link.label).casefold()
        path_tokens = _slug_tokens(segments[0])
        score = 0
        if label == normalized_name:
            score = 100
        elif normalized_name and normalized_name in label:
            score = 70
        elif category_tokens and category_tokens == path_tokens:
            score = 80

        if score > best_score:
            best_url = link.href
            best_score = score

    return best_url


def _stdlib_fetch(url: str) -> str:
    request = urllib.request.Request(url, headers=HOROSHOP_PAGE_HEADERS)
    return urllib.request.urlopen(request, timeout=35.0).read().decode("utf-8", "replace")


async def _fetch_html(client: httpx.AsyncClient, url: str) -> str:
    try:
        response = await client.get(url, headers=HOROSHOP_PAGE_HEADERS, follow_redirects=True)
        response.raise_for_status()
        if response.text:
            return response.text
    except (httpx.HTTPError, UnicodeError) as exc:
        logger.warning("Horoshop banner httpx fetch failed for %s: %s", url, exc)
    return await asyncio.to_thread(_stdlib_fetch, url)


def _known_blog_urls(blog_html: str, blog_url: str, home_links: list[SiteLink]) -> set[str]:
    home_keys = {_url_key(link.href) for link in home_links}
    known: set[str] = set()
    for link in parse_site_links(blog_html, blog_url):
        parsed = urlparse(link.href)
        key = _url_key(link.href)
        path = parsed.path.casefold()
        if key in home_keys or path in {"/", "/blog/"} or "/blog/page-" in path:
            continue
        known.add(key)
    return known


def _upsert_home_banners(conn, candidates: list[BannerCandidate], site_url: str, post_urls: set[str]) -> int:
    updated = 0
    active_images: list[str] = []
    for order, candidate in enumerate(candidates):
        destination = resolve_banner_destination(candidate.source_url, conn, site_url, post_urls)
        active_images.append(candidate.image_url)
        existing = conn.execute(
            """
            SELECT id FROM banners
            WHERE source = 'horoshop' AND placement = 'home' AND image_url = ?
            LIMIT 1
            """,
            (candidate.image_url,),
        ).fetchone()
        values = (
            candidate.source_url or destination["source_url"],
            destination["link_type"],
            destination["link_value"],
            candidate.title or None,
            order,
        )
        if existing:
            conn.execute(
                """
                UPDATE banners
                SET source_url = ?, link_type = ?, link_value = ?, title = ?, sort_order = ?
                WHERE id = ?
                """,
                values + (existing.get("id"),),
            )
        else:
            conn.execute(
                """
                INSERT INTO banners (
                    image_url, source, placement, source_url,
                    link_type, link_value, title, sort_order
                ) VALUES (?, 'horoshop', 'home', ?, ?, ?, ?, ?)
                """,
                (candidate.image_url,) + values,
            )
        updated += 1

    if active_images:
        placeholders = ",".join(["?"] * len(active_images))
        conn.execute(
            f"""
            DELETE FROM banners
            WHERE source = 'horoshop' AND placement = 'home'
              AND image_url NOT IN ({placeholders})
            """,
            tuple(active_images),
        )
    return updated


def _upsert_category_banners(
    conn,
    category_id: int,
    candidates: list[BannerCandidate],
    site_url: str,
    post_urls: set[str],
) -> int:
    updated = 0
    active_images: list[str] = []
    for order, candidate in enumerate(candidates):
        destination = resolve_banner_destination(candidate.source_url, conn, site_url, post_urls)
        active_images.append(candidate.image_url)
        existing = conn.execute(
            """
            SELECT id FROM category_banners
            WHERE category_id = ? AND source = 'horoshop' AND image_url = ?
            LIMIT 1
            """,
            (category_id, candidate.image_url),
        ).fetchone()
        values = (
            candidate.source_url or destination["source_url"],
            destination["link_type"],
            destination["link_value"],
            order,
        )
        if existing:
            conn.execute(
                """
                UPDATE category_banners
                SET source_url = ?, link_type = ?, link_value = ?, sort_order = ?
                WHERE id = ?
                """,
                values + (existing.get("id"),),
            )
        else:
            conn.execute(
                """
                INSERT INTO category_banners (
                    category_id, image_url, source, source_url,
                    link_type, link_value, sort_order
                ) VALUES (?, ?, 'horoshop', ?, ?, ?, ?)
                """,
                (category_id, candidate.image_url) + values,
            )
        updated += 1

    if active_images:
        placeholders = ",".join(["?"] * len(active_images))
        conn.execute(
            f"""
            DELETE FROM category_banners
            WHERE category_id = ? AND source = 'horoshop'
              AND image_url NOT IN ({placeholders})
            """,
            (category_id, *active_images),
        )
    return updated


async def sync_horoshop_banners() -> dict:
    domain = (os.getenv("HOROSHOP_DOMAIN") or DEFAULT_HOROSHOP_DOMAIN).strip().strip("/")
    if domain.startswith(("http://", "https://")):
        site_url = f"{domain}/"
    else:
        site_url = f"https://{domain}/"

    report = {
        "status": "ok",
        "home_banners": 0,
        "category_banners": 0,
        "updated": 0,
        "skipped": 0,
        "failed": 0,
        "notes": [],
    }
    conn = get_db_connection()
    try:
        async with httpx.AsyncClient(timeout=45.0) as client:
            try:
                home_html = await _fetch_html(client, site_url)
            except Exception as exc:
                report["status"] = "partial"
                report["failed"] += 1
                report["notes"].append(f"Homepage fetch failed: {exc}")
                return report

            home_links = parse_site_links(home_html, site_url)
            home_banners = parse_first_banner_slider(home_html, site_url)

            post_urls: set[str] = set()
            blog_url = urljoin(site_url, "/blog/?v=desktop")
            try:
                blog_html = await _fetch_html(client, blog_url)
                post_urls = _known_blog_urls(blog_html, blog_url, home_links)
            except Exception as exc:
                report["notes"].append(f"Blog link discovery skipped: {exc}")

            if home_banners:
                report["home_banners"] = len(home_banners)
                report["updated"] += _upsert_home_banners(conn, home_banners, site_url, post_urls)
            else:
                report["skipped"] += 1
                report["notes"].append("No homepage banner slider found; existing banners were preserved")

            categories = conn.execute(
                "SELECT id, name, external_id FROM categories ORDER BY id ASC"
            ).fetchall()
            category_requests: list[tuple[dict, str]] = []
            for row in categories:
                category = dict(row)
                category_url = _find_category_page_url(category, home_links, site_url)
                if category_url:
                    category_requests.append((category, category_url))
                else:
                    report["skipped"] += 1

            async def fetch_category(category: dict, category_url: str):
                try:
                    html = await _fetch_html(client, category_url)
                    return category, category_url, parse_first_banner_slider(html, category_url), None
                except Exception as exc:
                    return category, category_url, [], exc

            results = await asyncio.gather(
                *(fetch_category(category, category_url) for category, category_url in category_requests)
            )
            for category, category_url, candidates, error in results:
                if error is not None:
                    report["failed"] += 1
                    report["notes"].append(
                        f"Category {category.get('name')} fetch failed: {error}"
                    )
                    continue
                if not candidates:
                    report["skipped"] += 1
                    continue
                report["category_banners"] += len(candidates)
                report["updated"] += _upsert_category_banners(
                    conn,
                    int(category["id"]),
                    candidates,
                    site_url,
                    post_urls,
                )

        conn.commit()
        if report["failed"]:
            report["status"] = "partial"
        return report
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
