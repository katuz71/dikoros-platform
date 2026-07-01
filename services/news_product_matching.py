"""Conservative product matching for numbered promotion lines."""

from __future__ import annotations

import re
import unicodedata
from collections import Counter
from fractions import Fraction
from html import unescape


NUMBERED_PROMOTION_LINE_PATTERN = re.compile(r"^\s*\d+\.\s+")
PROMOTION_DATE_PREFIX_PATTERN = re.compile(
    r"^\s*\d{1,2}[./]\d{1,2}\s*[-\u2013\u2014]\s*"
    r"\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?\s*"
)
PROMOTION_GENERIC_TOKENS = {
    "в", "г", "гр", "грам", "грама", "грамм", "грамів",
    "гриб", "з", "і", "из", "із", "й", "капсул", "капсула",
    "капсули", "лат", "мікродозінг", "микродозинг", "на", "по",
    "порошок", "сушений", "сушеный", "та", "у", "шт", "штук",
}


def _tokens(value: object) -> list[str]:
    text = unicodedata.normalize("NFKC", unescape(str(value or ""))).casefold()
    return re.findall(r"[^\W_]+", text, flags=re.UNICODE)


def _product_text(line: str) -> str | None:
    if not NUMBERED_PROMOTION_LINE_PATTERN.match(line):
        return None

    text = NUMBERED_PROMOTION_LINE_PATTERN.sub("", line, count=1)
    return PROMOTION_DATE_PREFIX_PATTERN.sub("", text, count=1).strip()


def _counter_overlap(left: Counter[str], right: Counter[str]) -> int:
    return sum((left & right).values())


def _identity_counter(tokens: list[str]) -> Counter[str]:
    return Counter(
        token
        for token in tokens
        if token not in PROMOTION_GENERIC_TOKENS and not token.isdigit()
    )


def _match_score(line: str, product: dict) -> tuple[int, Fraction, Fraction, int, int] | None:
    product_text = _product_text(line)
    if product_text is None:
        return None

    line_tokens = _tokens(product_text)
    match_name = product.get("variant_name") or product.get("name")
    name_tokens = _tokens(match_name)
    if not line_tokens or not name_tokens:
        return None

    padded_line = f" {' '.join(line_tokens)} "
    padded_name = f" {' '.join(name_tokens)} "
    full_name_in_line = int(padded_name in padded_line)

    line_identity = _identity_counter(line_tokens)
    name_identity = _identity_counter(name_tokens)
    identity_overlap = _counter_overlap(line_identity, name_identity)
    line_identity_count = sum(line_identity.values())
    name_identity_count = sum(name_identity.values())
    numeric_overlap = _counter_overlap(
        Counter(token for token in line_tokens if token.isdigit()),
        Counter(token for token in name_tokens if token.isdigit()),
    )
    has_numeric_name_signature = (
        identity_overlap == 1
        and line_identity_count == 1
        and name_identity_count == 1
        and numeric_overlap >= 2
    )

    if not line_identity_count or not name_identity_count:
        return None
    if identity_overlap < 2 and not (
        (full_name_in_line and identity_overlap == 1 and len(name_tokens) >= 4)
        or has_numeric_name_signature
    ):
        return None

    name_coverage = Fraction(identity_overlap, name_identity_count)
    line_coverage = Fraction(identity_overlap, line_identity_count)
    if name_coverage < Fraction(3, 4) or line_coverage < Fraction(3, 5):
        return None

    line_counter = Counter(line_tokens)
    name_counter = Counter(name_tokens)
    token_overlap = _counter_overlap(line_counter, name_counter)
    token_f1 = Fraction(2 * token_overlap, len(line_tokens) + len(name_tokens))
    identity_f1 = Fraction(
        2 * identity_overlap,
        line_identity_count + name_identity_count,
    )

    return (
        full_name_in_line,
        identity_f1,
        token_f1,
        token_overlap,
        len(name_tokens),
    )


def select_promotion_product(line: str, products: list[dict]) -> dict | None:
    scored = []
    for product in products:
        score = _match_score(line, product)
        if score is not None:
            scored.append((score, product))

    if not scored:
        return None

    scored.sort(key=lambda item: item[0], reverse=True)
    best_score, best_product = scored[0]
    tied_best = [product for score, product in scored if score == best_score]
    if len(tied_best) > 1:
        group_keys = {
            str(product.get("parent_sku") or product.get("sku") or product.get("id"))
            for product in tied_best
        }
        if len(group_keys) != 1:
            return None

        best_product = min(
            tied_best,
            key=lambda product: (
                0 if str(product.get("status") or "").lower() in {"available", "in_stock"} else 1,
                int(product.get("sort_order") or 2_147_483_647),
                -int(product.get("id") or 0),
            ),
        )

    lower_scores = [score for score, _ in scored if score < best_score]
    if not lower_scores:
        return best_product

    second_score = lower_scores[0]

    best_phrase, best_identity, best_tokens, _, _ = best_score
    second_phrase, second_identity, second_tokens, _, _ = second_score
    has_clear_margin = (
        best_phrase > second_phrase
        or best_identity - second_identity >= Fraction(1, 10)
        or (
            best_identity == second_identity
            and best_tokens - second_tokens >= Fraction(1, 10)
        )
    )
    return best_product if has_clear_margin else None


def build_news_body_items(body: object, products: list[dict]) -> list[dict]:
    lines = [line.strip() for line in re.split(r"\n+", str(body or "")) if line.strip()]
    items = []

    for line in lines:
        product = select_promotion_product(line, products)
        product_name = (
            str(product.get("variant_name") or product.get("name") or "") or None
        ) if product else None
        product_sku = (str(product.get("sku") or "") or None) if product else None
        items.append({
            "text": line,
            "product_id": int(product["id"]) if product else None,
            "product_name": product_name,
            "product_sku": product_sku,
        })

    return items
