"""Build structured Horoshop variant option values."""

from __future__ import annotations

import re
from collections import Counter


OPTION_PACKING = "Фасування"
OPTION_WEIGHT = "Вага"
OPTION_VOLUME = "Обʼєм"
OPTION_FORMAT = "Формат"
OPTION_SORT = "Сорт"
OPTION_YEAR = "Рік"
OPTION_CONCENTRATION = "Концентрація"
OPTION_TASTE = "Смак"
OPTION_ARTICLE = "Артикул"

BASE_OPTION_ORDER = [
    OPTION_PACKING,
    OPTION_WEIGHT,
    OPTION_VOLUME,
    OPTION_CONCENTRATION,
    OPTION_TASTE,
    OPTION_YEAR,
    OPTION_FORMAT,
    OPTION_SORT,
]

UNIQUENESS_OPTION_ORDER = [
    OPTION_SORT,
    OPTION_YEAR,
    OPTION_FORMAT,
]

SKU_SUFFIX_TRANSLATION = str.maketrans(
    {
        "C": "С",
        "E": "Е",
        "M": "М",
        "P": "П",
    }
)


def _localized_value(value: object, default: str = "") -> str:
    if isinstance(value, dict):
        return str(value.get("ua") or value.get("ru") or value.get("en") or default)
    return str(value or default)


def _clean(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "").replace("\xa0", " ")).strip()


def _decimal(value: str) -> str:
    text = value.replace(".", ",")
    if "," in text:
        text = text.rstrip("0").rstrip(",")
    return text


def _plural_capsules(amount: int) -> str:
    if amount == 1:
        return "капсула"
    return "капсул"


def _plural_tiles(amount: int) -> str:
    mod100 = amount % 100
    mod10 = amount % 10
    if mod10 == 1 and mod100 != 11:
        return "плитка"
    if mod10 in (2, 3, 4) and mod100 not in (12, 13, 14):
        return "плитки"
    return "плиток"


def _extract_packing(text: str) -> str | None:
    match = re.search(r"(?<!\w)(\d+)\s*(капсул\w*|плит\w*)\b", text, re.IGNORECASE)
    if not match:
        return None

    amount = int(match.group(1))
    unit = match.group(2).lower()
    if unit.startswith("капсул"):
        return f"{amount} {_plural_capsules(amount)}"
    return f"{amount} {_plural_tiles(amount)}"


def _extract_weight(text: str) -> str | None:
    match = re.search(
        r"(?<![\w])(\d+(?:[,.]\d+)?)\s*(грамів|грама|грам|гр|г)\b",
        text,
        re.IGNORECASE,
    )
    if not match:
        return None
    return f"{_decimal(match.group(1))} г"


def _extract_volume(text: str) -> str | None:
    match = re.search(r"(?<![\w])(\d+(?:[,.]\d+)?)\s*мл\b", text, re.IGNORECASE)
    if not match:
        return None
    return f"{_decimal(match.group(1))} мл"


def _extract_concentration(text: str) -> str | None:
    match = re.search(r"(?<![\w])(\d+(?:[,.]\d+)?)\s*%", text, re.IGNORECASE)
    if not match:
        return None
    return f"{_decimal(match.group(1))}%"


def _extract_format(text: str) -> str | None:
    lower = text.lower()
    checks = [
        (r"\bкапсул\w*\b", "капсули"),
        (r"\bпорош\w*\b", "порошок"),
        (r"\bмелен\w*\b", "мелені"),
        (r"\bсушен\w*\b", "цілі"),
        (r"\bціл\w*\b", "цілі"),
        (r"\bшоколад\w*\b", "шоколад"),
        (r"\bнабір\w*\b", "набір"),
        (r"\bприправ\w*\b", "приправа"),
    ]
    for pattern, value in checks:
        if re.search(pattern, lower, re.IGNORECASE):
            return value
    return None


def _extract_sort(text: str) -> str | None:
    lower = text.lower()
    if re.search(r"\bеліт\w*\b", lower, re.IGNORECASE):
        return "Еліт"
    if re.search(r"\bекстра\b", lower, re.IGNORECASE):
        return "Екстра"
    if re.search(r"\b1\s*сорт\b", lower, re.IGNORECASE):
        return "1 сорт"
    if re.search(r"\b2\s*сорт\b", lower, re.IGNORECASE):
        return "2 сорт"
    if re.search(r"\bлом\b", lower, re.IGNORECASE):
        return "Лом"
    return None


def _normalized_article(item: dict) -> str:
    return _clean(item.get("article") or item.get("sku") or item.get("id")).upper().replace(" ", "")


def _normalized_parent_article(item: dict) -> str:
    return _clean(item.get("parent_article") or "").upper().replace(" ", "")


def _article_code(article: str) -> str:
    code = article.split("-", 1)[1] if "-" in article else article
    return code.translate(SKU_SUFFIX_TRANSLATION)


def _strip_short_year_suffix(code: str) -> str:
    # Horoshop uses 24/25 suffixes in SKU for year/harvest batches.
    # Do not strip other trailing numbers: they are often weights, e.g. 50/100/200.
    if code.endswith("24") or code.endswith("25"):
        return code[:-2]
    return code


def _infer_sort_from_article(item: dict, *, allow_group_default: bool = False) -> str | None:
    """Infer missing sort only for Horoshop dried mushroom groups that use sort SKUs.

    Some Horoshop variants omit "1 сорт" in mod_title, while the same group has
    other variants with explicit sort values. In those groups the base SKU suffix
    is the source of truth: С/СП/СМ without elite/лом/2-sort marker means 1 сорт.
    """
    article = _normalized_article(item)
    parent_article = _normalized_parent_article(item)
    code = _strip_short_year_suffix(_article_code(article))

    if not article:
        return None

    # Guarded legacy rule for the red amanita cap group already verified against
    # Horoshop raw export. It can run without group context for direct parser tests.
    if article.startswith("МХМЧ-") and (article == "МХМЧ-01С" or parent_article == "МХМЧ-01С"):
        if code.endswith("СЛ"):
            return "Лом"
        if code.endswith("ЕСП") or code.endswith("ЕС"):
            return "Еліт"
        base = code[:-1] if code.endswith("П") else code
        if re.fullmatch(r"(?:0?2|52|102|202)С", base):
            return "2 сорт"
        if re.fullmatch(r"(?:0?1|50|100|200)С", base):
            return "1 сорт"
        return None

    if not allow_group_default:
        return None

    # Generic guarded rule for dried mushroom groups where at least one sibling
    # already has a sort value. This covers SKU families like СК, ЛН and МХМКС.
    if code.endswith("СЛ"):
        return "Лом"
    if code.endswith("ЕСП") or code.endswith("ЕС"):
        return "Еліт"

    # Explicit 2-sort patterns: 02С, 52С, 102С, 202С and their powder variants.
    explicit_second_sort = re.fullmatch(r"(?:0?2|52|102|202)С(?:П|М)?", code)
    if explicit_second_sort:
        return "2 сорт"

    # Base/default sort patterns when the group already uses sort options.
    base_first_sort = re.fullmatch(
        r"(?:0?1С(?:П|М)?|0?1С(?:П|М)?\d+|50С(?:П|М)?|100С(?:П|М)?|200С(?:П|М)?)",
        code,
    )
    if base_first_sort:
        return "1 сорт"

    return None


def _extract_year(text: str) -> str | None:
    match = re.search(r"\b(20\d{2})\b", text)
    return match.group(1) if match else None


def _extract_taste(text: str) -> str | None:
    lower = text.lower()
    checks = [
        (r"\boriginal\b", "Original"),
        (r"\bmint\b", "Mint"),
        (r"\bcoconut\b", "Coconut"),
        (r"\bcherry\b", "Cherry"),
        (r"\bmandarin\b", "Mandarin"),
        (r"\bяблук\w*\b", "яблука"),
        (r"\bвишн\w*\b", "вишні"),
        (r"\bапельсин\w*\b", "апельсина"),
    ]
    for pattern, value in checks:
        if re.search(pattern, lower, re.IGNORECASE):
            return value
    return None


def _item_text(item: dict) -> str:
    return _clean(
        " ".join(
            [
                _localized_value(item.get("mod_title") or {}),
                _localized_value(item.get("title") or {}),
            ]
        )
    )


def _raw_variant_options(item: dict) -> dict[str, str]:
    text = _item_text(item)
    options: dict[str, str] = {}

    extractors = [
        (OPTION_PACKING, _extract_packing),
        (OPTION_WEIGHT, _extract_weight),
        (OPTION_VOLUME, _extract_volume),
        (OPTION_CONCENTRATION, _extract_concentration),
        (OPTION_TASTE, _extract_taste),
        (OPTION_FORMAT, _extract_format),
        (OPTION_SORT, _extract_sort),
        (OPTION_YEAR, _extract_year),
    ]
    for key, extractor in extractors:
        value = extractor(text)
        if value:
            options[key] = value

    if not options.get(OPTION_SORT):
        inferred_sort = _infer_sort_from_article(item)
        if inferred_sort:
            options[OPTION_SORT] = inferred_sort

    return options


def _article(item: dict) -> str:
    return _clean(item.get("article") or item.get("sku") or item.get("id"))


def _combo(options: dict[str, str], keys: list[str]) -> tuple[str, ...]:
    return tuple(options.get(key, "") for key in keys)


def _has_duplicates(raw_options: list[dict[str, str]], keys: list[str]) -> bool:
    combos = [_combo(options, keys) for options in raw_options]
    counts = Counter(combos)
    return any(count > 1 for count in counts.values())


def _visible_keys(raw_options: list[dict[str, str]]) -> list[str]:
    keys: list[str] = []
    for key in BASE_OPTION_ORDER:
        values = {options.get(key) for options in raw_options if options.get(key)}
        if len(values) > 1:
            keys.append(key)

    for key in UNIQUENESS_OPTION_ORDER:
        if not _has_duplicates(raw_options, keys):
            break
        if key not in keys and any(options.get(key) for options in raw_options):
            keys.append(key)

    if _has_duplicates(raw_options, keys):
        keys.append(OPTION_ARTICLE)

    return keys


def build_variant_options(item: dict, group_items: list[dict]) -> dict[str, str]:
    """Return JSON-compatible structured options for one Horoshop variant."""
    group = group_items or [item]
    raw_by_article: dict[str, dict[str, str]] = {}
    group_rows: list[tuple[str, dict[str, str], dict]] = []

    for group_item in group:
        raw = _raw_variant_options(group_item)
        article = _article(group_item)
        group_rows.append((article, raw, group_item))

    group_has_sort = any(raw.get(OPTION_SORT) for _, raw, _ in group_rows)

    raw_options: list[dict[str, str]] = []
    for article, raw, group_item in group_rows:
        if group_has_sort and not raw.get(OPTION_SORT):
            inferred_sort = _infer_sort_from_article(group_item, allow_group_default=True)
            if inferred_sort:
                raw[OPTION_SORT] = inferred_sort
        if article:
            raw[OPTION_ARTICLE] = article
        raw_by_article[article] = raw
        raw_options.append(raw)

    current_article = _article(item)
    current_raw = raw_by_article.get(current_article) or _raw_variant_options(item)
    keys = _visible_keys(raw_options)

    return {
        key: current_raw[key]
        for key in keys
        if current_raw.get(key)
    }
