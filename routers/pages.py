from datetime import datetime, timezone
from html import unescape
from html.parser import HTMLParser
from urllib.request import Request, urlopen

from fastapi import APIRouter

router = APIRouter()

NEWS_SOURCE_URL = "https://dikoros-ua.com/aktsii/"

TITLE_FALLBACK = "\u0410\u043a\u0446\u0456\u0457"
INFO_HEADING = "\u0406\u043d\u0444\u043e\u0440\u043c\u0430\u0446\u0456\u044f"
UNAVAILABLE_TEXT = "\u0406\u043d\u0444\u043e\u0440\u043c\u0430\u0446\u0456\u044f \u0442\u0438\u043c\u0447\u0430\u0441\u043e\u0432\u043e \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u043d\u0430. \u0421\u043f\u0440\u043e\u0431\u0443\u0439\u0442\u0435 \u043e\u043d\u043e\u0432\u0438\u0442\u0438 \u0441\u0442\u043e\u0440\u0456\u043d\u043a\u0443 \u043f\u0456\u0437\u043d\u0456\u0448\u0435."
TITLE_PREFIX = "\u0410\u043a\u0446\u0456\u0457 \u043d\u0430 \u043f\u0440\u043e\u0434\u0443\u043a\u0446\u0456\u044e"


class TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.skip = False
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style", "noscript", "svg"}:
            self.skip = True
            return
        if tag in {"h1", "h2", "h3", "p", "li", "a", "div", "span"}:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in {"script", "style", "noscript", "svg"}:
            self.skip = False
            return
        if tag in {"h1", "h2", "h3", "p", "li", "a", "div", "span"}:
            self.parts.append("\n")

    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)


def _clean_lines(html: str) -> list[str]:
    parser = TextExtractor()
    parser.feed(html)
    text = unescape("".join(parser.parts))

    lines = []
    for raw in text.splitlines():
        line = " ".join(raw.replace("\xa0", " ").split()).strip()
        if line:
            lines.append(line)

    return lines


def _fetch_source_lines() -> list[str]:
    request = Request(
        NEWS_SOURCE_URL,
        headers={
            "User-Agent": "DikorosUA-App/1.0 (+https://app.dikoros.ua)",
            "Accept": "text/html,application/xhtml+xml",
        },
    )
    with urlopen(request, timeout=8) as response:
        html = response.read().decode("utf-8", errors="ignore")
    return _clean_lines(html)


def _extract_page_content(lines: list[str]) -> tuple[str, list[dict[str, str]]]:
    title = TITLE_FALLBACK
    start = -1

    for index, line in enumerate(lines):
        if line.startswith(TITLE_PREFIX):
            title = line
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
    seen = set()

    for line in lines[start:]:
        low = line.lower()

        if any(marker.lower() in low for marker in stop_contains):
            break
        if line in blocked_exact:
            continue
        if any(fragment in low for fragment in blocked_contains):
            continue
        if line in seen:
            continue

        seen.add(line)
        content.append(line)

    sections = []
    current_date = None

    month_words = [
        "\u0441\u0456\u0447\u043d\u044f", "\u043b\u044e\u0442\u043e\u0433\u043e", "\u0431\u0435\u0440\u0435\u0437\u043d\u044f",
        "\u043a\u0432\u0456\u0442\u043d\u044f", "\u0442\u0440\u0430\u0432\u043d\u044f", "\u0447\u0435\u0440\u0432\u043d\u044f",
        "\u043b\u0438\u043f\u043d\u044f", "\u0441\u0435\u0440\u043f\u043d\u044f", "\u0432\u0435\u0440\u0435\u0441\u043d\u044f",
        "\u0436\u043e\u0432\u0442\u043d\u044f", "\u043b\u0438\u0441\u0442\u043e\u043f\u0430\u0434\u0430", "\u0433\u0440\u0443\u0434\u043d\u044f",
    ]

    index = 0
    while index < len(content):
        line = content[index]
        low = line.lower()
        is_date = any(month in low for month in month_words)

        if is_date:
            heading = line

            if index + 1 < len(content) and content[index + 1].isdigit():
                heading = f"{line} {content[index + 1]}"
                index += 1

            body_lines = []
            index += 1

            while index < len(content):
                next_line = content[index]
                next_low = next_line.lower()
                next_is_date = any(month in next_low for month in month_words)

                if next_is_date:
                    break

                body_lines.append(next_line)
                index += 1

            body = "\n\n".join(
                part for part in body_lines
                if part.strip().lower() not in {"?????", "?????"}
            ).strip()

            sections.append({
                "heading": heading,
                "body": body,
            })
            continue

        sections.append({"heading": INFO_HEADING, "body": line})
        index += 1

    sections = [section for section in sections if section.get("body")]

    return title, sections


@router.get("/api/pages/news")
def get_news_page():
    try:
        title, sections = _extract_page_content(_fetch_source_lines())
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
            cleaned_sections.append({"heading": heading, "body": body})

    sections = cleaned_sections

    if not sections:
        sections = [{"heading": INFO_HEADING, "body": UNAVAILABLE_TEXT}]

    return {
        "title": title,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "sections": sections,
        "source": NEWS_SOURCE_URL,
    }
