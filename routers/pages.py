from datetime import datetime, timezone
from html import unescape
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen

from fastapi import APIRouter, HTTPException, Query

router = APIRouter()

NEWS_SOURCE_URL = "https://dikoros-ua.com/aktsii/"

TITLE_FALLBACK = "\u0410\u043a\u0446\u0456\u0457"
INFO_HEADING = "\u0406\u043d\u0444\u043e\u0440\u043c\u0430\u0446\u0456\u044f"
UNAVAILABLE_TEXT = "\u0406\u043d\u0444\u043e\u0440\u043c\u0430\u0446\u0456\u044f \u0442\u0438\u043c\u0447\u0430\u0441\u043e\u0432\u043e \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u043d\u0430. \u0421\u043f\u0440\u043e\u0431\u0443\u0439\u0442\u0435 \u043e\u043d\u043e\u0432\u0438\u0442\u0438 \u0441\u0442\u043e\u0440\u0456\u043d\u043a\u0443 \u043f\u0456\u0437\u043d\u0456\u0448\u0435."
TITLE_PREFIX = "\u0410\u043a\u0446\u0456\u0457 \u043d\u0430 \u043f\u0440\u043e\u0434\u0443\u043a\u0446\u0456\u044e"
MONTH_WORDS = [
    "\u0441\u0456\u0447\u043d\u044f", "\u043b\u044e\u0442\u043e\u0433\u043e", "\u0431\u0435\u0440\u0435\u0437\u043d\u044f",
    "\u043a\u0432\u0456\u0442\u043d\u044f", "\u0442\u0440\u0430\u0432\u043d\u044f", "\u0447\u0435\u0440\u0432\u043d\u044f",
    "\u043b\u0438\u043f\u043d\u044f", "\u0441\u0435\u0440\u043f\u043d\u044f", "\u0432\u0435\u0440\u0435\u0441\u043d\u044f",
    "\u0436\u043e\u0432\u0442\u043d\u044f", "\u043b\u0438\u0441\u0442\u043e\u043f\u0430\u0434\u0430", "\u0433\u0440\u0443\u0434\u043d\u044f",
]


def _normalize_text(value: str) -> str:
    return " ".join(unescape(value).replace("\xa0", " ").split()).strip()


def _first_srcset_url(value: str) -> str:
    candidates = [
        item.strip().split()[0]
        for item in value.split(",")
        if item.strip()
    ]
    return candidates[-1] if candidates else ""


def _absolute_image_url(value: str) -> str | None:
    candidate = unescape(value).strip()
    if not candidate or candidate.startswith("data:"):
        return None
    return urljoin(NEWS_SOURCE_URL, candidate)


def _absolute_page_url(value: str) -> str | None:
    candidate = unescape(value).strip()
    if not candidate or candidate.startswith(("#", "javascript:", "mailto:", "tel:")):
        return None
    return urljoin(NEWS_SOURCE_URL, candidate)


def _is_allowed_news_url(value: str) -> bool:
    parsed = urlparse(value)
    source = urlparse(NEWS_SOURCE_URL)
    return (
        parsed.scheme in {"http", "https"}
        and parsed.netloc == source.netloc
        and parsed.path not in {"", "/", source.path}
    )


def _image_url_from_attrs(attrs: dict[str, str]) -> str | None:
    for name in ("data-srcset", "srcset"):
        value = attrs.get(name, "")
        if value:
            url = _absolute_image_url(_first_srcset_url(value))
            if url:
                return url

    for name in ("data-src", "data-original", "data-lazy-src", "data-lazy", "src"):
        value = attrs.get(name, "")
        if value:
            url = _absolute_image_url(value)
            if url:
                return url

    return None


def _is_content_image(url: str) -> bool:
    parsed = urlparse(url)
    path = parsed.path.lower()
    filename = path.rsplit("/", 1)[-1]

    if not path.endswith((".jpg", ".jpeg", ".png", ".webp", ".gif")):
        return False

    ignored_markers = (
        "logo",
        "favicon",
        "icon",
        "sprite",
        "placeholder",
        "blank",
        "no-image",
        "no_photo",
    )
    return not any(marker in filename for marker in ignored_markers)


def _is_date_text(value: str) -> bool:
    low = value.lower()
    return any(month in low for month in MONTH_WORDS)


def _fetch_html(url: str) -> str:
    request = Request(
        url,
        headers={
            "User-Agent": "DikorosUA-App/1.0 (+https://app.dikoros.ua)",
            "Accept": "text/html,application/xhtml+xml",
        },
    )
    with urlopen(request, timeout=8) as response:
        return response.read().decode("utf-8", errors="ignore")


class ArticleDetailExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.skip_depth = 0
        self.in_heading = False
        self.in_date = False
        self.date_found = False
        self.in_text_depth = 0
        self.text_parts = []
        self.paragraphs = []
        self.title_parts = []
        self.date_parts = []
        self.image_url = None

    def _flush_paragraph(self):
        text = _normalize_text("".join(self.text_parts))
        self.text_parts = []
        if text:
            self.paragraphs.append(text)

    def _handle_image(self, attrs: list[tuple[str, str | None]]):
        attr_map = dict(attrs)
        class_parts = set(attr_map.get("class", "").split())
        if self.image_url and "article__cover-img" not in class_parts:
            return

        image_url = _image_url_from_attrs(attr_map)
        if image_url and _is_content_image(image_url):
            self.image_url = image_url

    def handle_starttag(self, tag, attrs):
        attr_map = dict(attrs)

        if tag in {"script", "style", "noscript", "svg"}:
            self.skip_depth += 1
            return

        if self.skip_depth:
            return

        class_parts = set(attr_map.get("class", "").split())

        if tag == "h1" and "main-h" in class_parts:
            self.in_heading = True
            return

        if (
            tag == "div"
            and "article__meta-item" in class_parts
            and "j-comments-count-container" not in class_parts
            and not self.date_found
        ):
            self.in_date = True
            return

        if tag == "div" and "article-text" in class_parts:
            self.in_text_depth = 1
            return

        if self.in_text_depth:
            self.in_text_depth += 1
            if tag in {"p", "li", "h2", "h3"}:
                self._flush_paragraph()
            elif tag == "br":
                self.text_parts.append("\n")

        if tag == "img":
            self._handle_image(attrs)

    def handle_startendtag(self, tag, attrs):
        if self.skip_depth:
            return

        if tag == "img":
            self._handle_image(attrs)
        elif tag == "br" and self.in_text_depth:
            self.text_parts.append("\n")

    def handle_endtag(self, tag):
        if tag in {"script", "style", "noscript", "svg"}:
            self.skip_depth = max(0, self.skip_depth - 1)
            return

        if self.skip_depth:
            return

        if self.in_heading and tag == "h1":
            self.in_heading = False
            return

        if self.in_date and tag == "div":
            self.in_date = False
            self.date_found = True
            return

        if self.in_text_depth:
            if tag in {"p", "li", "h2", "h3"}:
                self._flush_paragraph()

            self.in_text_depth -= 1
            if self.in_text_depth <= 0:
                self._flush_paragraph()

    def handle_data(self, data):
        if self.skip_depth:
            return

        if self.in_heading:
            self.title_parts.append(data)
        elif self.in_date:
            self.date_parts.append(data)
        elif self.in_text_depth:
            self.text_parts.append(data)

    def result(self, source_url: str) -> dict[str, str | None]:
        title = _normalize_text("".join(self.title_parts))
        date = _normalize_text("".join(self.date_parts))
        body = "\n\n".join(self.paragraphs).strip()

        return {
            "title": title,
            "heading": date or INFO_HEADING,
            "body": body,
            "image_url": self.image_url,
            "source_url": source_url,
        }


def _extract_article_detail(html: str, source_url: str) -> dict[str, str | None]:
    parser = ArticleDetailExtractor()
    parser.feed(html)
    parser.close()
    return parser.result(source_url)


class EntriesExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.skip_depth = 0
        self.entry_depth = 0
        self.current = None
        self.text_parts = []
        self.entries = []

    def _flush_text(self):
        if not self.current:
            self.text_parts = []
            return

        text = _normalize_text("".join(self.text_parts))
        self.text_parts = []

        if text:
            self.current["texts"].append(text)

    def _start_entry(self):
        self._flush_text()
        self.current = {"texts": [], "image_url": None, "source_url": None}
        self.entry_depth = 1

    def _finish_entry(self):
        self._flush_text()

        if self.current:
            texts = [
                text for text in self.current["texts"]
                if text.strip().lower() not in {"\u0430\u043a\u0446\u0456\u044f", "\u0430\u043a\u0446\u0438\u0438"}
            ]
            heading = next((text for text in texts if _is_date_text(text)), "")
            body_candidates = [text for text in texts if text != heading]
            body = body_candidates[-1] if body_candidates else ""

            if heading and body:
                self.entries.append({
                    "heading": heading,
                    "body": body,
                    "image_url": self.current.get("image_url"),
                    "source_url": self.current.get("source_url"),
                })

        self.current = None
        self.entry_depth = 0

    def _handle_image(self, attrs: list[tuple[str, str | None]]):
        if not self.current:
            return

        image_url = _image_url_from_attrs(dict(attrs))
        if image_url and _is_content_image(image_url) and not self.current.get("image_url"):
            self.current["image_url"] = image_url

    def handle_starttag(self, tag, attrs):
        attr_map = dict(attrs)

        if tag in {"script", "style", "noscript", "svg"}:
            self.skip_depth += 1
            return

        if self.skip_depth:
            return

        if self.current and tag in {"footer", "main", "section"}:
            self._finish_entry()
            return

        class_name = attr_map.get("class", "")
        class_parts = set(class_name.split())

        if tag == "li" and "entries-i" in class_parts:
            if self.current:
                self._finish_entry()
            self._start_entry()
            return

        if self.current:
            self.entry_depth += 1

            if tag in {"h1", "h2", "h3", "p", "li", "a", "div", "span"}:
                self._flush_text()

            if tag == "a" and not self.current.get("source_url"):
                source_url = _absolute_page_url(attr_map.get("href", ""))
                if source_url and urlparse(source_url).path != urlparse(NEWS_SOURCE_URL).path:
                    self.current["source_url"] = source_url

            if tag == "img":
                self._flush_text()
                self._handle_image(attrs)

    def handle_startendtag(self, tag, attrs):
        if self.skip_depth or not self.current:
            return

        if tag == "img":
            self._flush_text()
            self._handle_image(attrs)

    def handle_endtag(self, tag):
        if tag in {"script", "style", "noscript", "svg"}:
            self.skip_depth = max(0, self.skip_depth - 1)
            return

        if self.skip_depth or not self.current:
            return

        if tag in {"ul", "ol", "main", "section", "footer"}:
            self._finish_entry()
            return

        if tag in {"h1", "h2", "h3", "p", "li", "a", "div", "span"}:
            self._flush_text()

        self.entry_depth -= 1
        if self.entry_depth <= 0:
            self._finish_entry()

    def handle_data(self, data):
        if self.current and not self.skip_depth:
            self.text_parts.append(data)


def _extract_entries(html: str) -> list[dict[str, str | None]]:
    parser = EntriesExtractor()
    parser.feed(html)
    parser.close()
    if parser.current:
        parser._finish_entry()
    return parser.entries


class PageExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.skip_depth = 0
        self.text_parts = []
        self.events = []

    def _flush_text(self):
        text = _normalize_text("".join(self.text_parts))
        self.text_parts = []

        if text:
            self.events.append({"type": "text", "text": text})

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style", "noscript", "svg"}:
            self.skip_depth += 1
            return

        if self.skip_depth:
            return

        if tag in {"h1", "h2", "h3", "p", "li", "a", "div", "span"}:
            self._flush_text()

        if tag == "img":
            self._flush_text()
            image_url = _image_url_from_attrs(dict(attrs))
            if image_url and _is_content_image(image_url):
                self.events.append({"type": "image", "url": image_url})

    def handle_startendtag(self, tag, attrs):
        if self.skip_depth:
            return

        if tag == "img":
            self._flush_text()
            image_url = _image_url_from_attrs(dict(attrs))
            if image_url and _is_content_image(image_url):
                self.events.append({"type": "image", "url": image_url})

    def handle_endtag(self, tag):
        if tag in {"script", "style", "noscript", "svg"}:
            self.skip_depth = max(0, self.skip_depth - 1)
            return

        if self.skip_depth:
            return

        if tag in {"h1", "h2", "h3", "p", "li", "a", "div", "span"}:
            self._flush_text()

    def handle_data(self, data):
        if not self.skip_depth:
            self.text_parts.append(data)


def _extract_events(html: str) -> list[dict[str, str]]:
    parser = PageExtractor()
    parser.feed(html)
    parser.close()
    parser._flush_text()
    return parser.events


def _fetch_source_html() -> str:
    return _fetch_html(NEWS_SOURCE_URL)


def _extract_page_content(events: list[dict[str, str]]) -> tuple[str, list[dict[str, str | None]]]:
    title = TITLE_FALLBACK
    start = -1

    for index, event in enumerate(events):
        if event.get("type") != "text":
            continue

        text = event.get("text", "")
        if text.startswith(TITLE_PREFIX):
            title = text
            start = index + 1
            break

    if start == -1:
        return title, []

    blocked_exact = {
        "\u0413\u043e\u043b\u043e\u0432\u043d\u0430",
        "\u0410\u043a\u0446\u0456\u0457",
        "0",
    }

    blocked_contains = [
        "\u043c\u0456\u0439 \u043a\u043e\u0448\u0438\u043a",
        "\u043f\u043e\u0448\u0443\u043a \u0442\u043e\u0432\u0430\u0440\u0456\u0432",
        "\u0433\u0440\u0430\u0444\u0456\u043a \u0440\u043e\u0431\u043e\u0442\u0438",
        "\u043f\u0435\u0440\u0435\u0434\u0437\u0432\u043e\u043d\u0438\u0442\u0438",
        "\u043f\u043e\u0440\u0456\u0432\u043d\u044f\u043d\u043d\u044f",
        "\u0431\u0430\u0436\u0430\u043d\u043d\u044f",
        "\u0432\u0445\u0456\u0434",
        "\u043a\u0430\u0442\u0430\u043b\u043e\u0433",
    ]

    stop_contains = [
        "DIKOROS -",
        "\u041c\u043e\u0431\u0456\u043b\u044c\u043d\u0430 \u0432\u0435\u0440\u0441\u0456\u044f",
        "\u0406\u043d\u0442\u0435\u0440\u043d\u0435\u0442-\u043c\u0430\u0433\u0430\u0437\u0438\u043d \u0441\u0442\u0432\u043e\u0440\u0435\u043d\u0438\u0439",
    ]

    content = []
    seen_text = set()

    for event in events[start:]:
        event_type = event.get("type")

        if event_type == "image":
            url = event.get("url", "")
            if not url:
                continue

            content.append(event)
            continue

        if event_type != "text":
            continue

        line = event.get("text", "")
        low = line.lower()

        if any(marker.lower() in low for marker in stop_contains):
            break
        if line in blocked_exact:
            continue
        if any(fragment in low for fragment in blocked_contains):
            continue
        if line in seen_text:
            continue

        seen_text.add(line)
        content.append(event)

    sections = []
    pending_image_url = None
    index = 0

    while index < len(content):
        event = content[index]

        if event.get("type") == "image":
            pending_image_url = event.get("url") or pending_image_url
            index += 1
            continue

        line = event.get("text", "")
        is_date = _is_date_text(line)

        if is_date:
            heading = line

            if (
                index + 1 < len(content)
                and content[index + 1].get("type") == "text"
                and content[index + 1].get("text", "").isdigit()
            ):
                heading = f"{line} {content[index + 1].get('text', '')}"
                index += 1

            body_lines = []
            image_url = pending_image_url
            pending_image_url = None
            index += 1

            while index < len(content):
                next_event = content[index]

                if next_event.get("type") == "image":
                    image_url = image_url or next_event.get("url")
                    index += 1
                    continue

                next_line = next_event.get("text", "")
                next_is_date = _is_date_text(next_line)

                if next_is_date:
                    break

                body_lines.append(next_line)
                index += 1

            body = "\n\n".join(
                part for part in body_lines
                if part.strip()
            ).strip()

            sections.append({
                "heading": heading,
                "body": body,
                "image_url": image_url,
                "source_url": None,
            })
            continue

        sections.append({"heading": INFO_HEADING, "body": line, "image_url": None, "source_url": None})
        index += 1

    sections = [section for section in sections if section.get("body")]

    return title, sections


@router.get("/api/pages/news/detail")
def get_news_detail(source_url: str = Query(..., min_length=1)):
    absolute_url = _absolute_page_url(source_url)

    if not absolute_url or not _is_allowed_news_url(absolute_url):
        raise HTTPException(status_code=400, detail="Invalid news source URL")

    try:
        detail = _extract_article_detail(_fetch_html(absolute_url), absolute_url)
    except Exception:
        raise HTTPException(status_code=502, detail="News detail is temporarily unavailable")

    if not detail.get("title") and not detail.get("body"):
        raise HTTPException(status_code=404, detail="News detail not found")

    return {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        **detail,
    }


@router.get("/api/pages/news")
def get_news_page():
    try:
        html = _fetch_source_html()
        title, fallback_sections = _extract_page_content(_extract_events(html))
        sections = _extract_entries(html) or fallback_sections
    except Exception:
        title, sections = TITLE_FALLBACK, []

    cleaned_sections = []
    redundant_labels = {"\u0430\u043a\u0446\u0456\u044f", "\u0430\u043a\u0446\u0438\u0438"}

    for section in sections:
        body = str(section.get("body", "")).strip()
        heading = str(section.get("heading", INFO_HEADING)).strip() or INFO_HEADING

        parts = [
            part.strip()
            for part in body.split("\n\n")
            if part.strip() and part.strip().lower() not in redundant_labels
        ]
        body = "\n\n".join(parts).strip()

        if body:
            cleaned_sections.append({
                "heading": heading,
                "body": body,
                "image_url": section.get("image_url") or None,
                "source_url": section.get("source_url") or None,
            })

    sections = cleaned_sections

    if not sections:
        sections = [{"heading": INFO_HEADING, "body": UNAVAILABLE_TEXT, "image_url": None, "source_url": None}]

    return {
        "title": title,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "sections": sections,
        "source": NEWS_SOURCE_URL,
    }
