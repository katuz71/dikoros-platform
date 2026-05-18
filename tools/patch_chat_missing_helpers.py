"""Patch missing chat constants/helpers after router extraction.

This is a fallback-safe patch. It restores the helpers required by
`chat_endpoint()` so the chat route cannot fail with NameError:
- CHAT_PRODUCTS_BASE
- _parse_chat_products_base()
- _CHAT_PRODUCTS_NAME_TO_ID
- _extract_ids_from_ids_line()
- _strip_ids_line_from_response()
- _extract_product_ids_from_text()

The product base is intentionally empty here. The main recommendation flow still
uses live products loaded from DB and the explicit `IDs: [...]` line produced by
GPT. Name-based fallback can be populated later from a DB/service source.
"""

from __future__ import annotations

from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
CHAT_FILE = PROJECT_ROOT / "routers" / "chat.py"
INSERT_MARKER = "# --- CHAT SEARCH HELPERS ---"

HELPERS_BLOCK = r'''
# --- CHAT BOT: fallback product base and ID helpers ---
CHAT_PRODUCTS_BASE = """"""


def _parse_chat_products_base() -> List[tuple]:
    """Parse CHAT_PRODUCTS_BASE into a list of (name, id), sorted by name length descending."""
    out = []
    for line in CHAT_PRODUCTS_BASE.strip().split("\n"):
        line = line.strip()
        if not line:
            continue
        if " — " in line:
            name, _, id_part = line.rpartition(" — ")
            name = name.strip()
            try:
                out.append((name, int(id_part.strip())))
            except ValueError:
                continue
    out.sort(key=lambda item: -len(item[0]))
    return out


_CHAT_PRODUCTS_NAME_TO_ID = _parse_chat_products_base()


def _extract_ids_from_ids_line(text: str) -> List[int]:
    """Parse a technical line like `IDs: [1, 2, 3]` from model output."""
    match = re.search(r"IDs:\s*\[([^\]]+)\]", text or "", re.IGNORECASE)
    if not match:
        return []
    ids = []
    for raw_item in re.split(r"[\s,]+", match.group(1).strip()):
        item = raw_item.strip()
        if item.isdigit():
            ids.append(int(item))
    return ids[:3]


def _strip_ids_line_from_response(text: str) -> str:
    """Remove the technical `IDs: [...]` line before returning text to the user."""
    if not text or "IDs:" not in text:
        return text.strip() if text else text
    stripped = re.sub(
        r"\s*IDs:\s*\[\s*\d+(?:\s*,\s*\d+)*\s*\]\s*",
        "",
        text,
        flags=re.IGNORECASE,
    )
    return stripped.strip()


def _extract_product_ids_from_text(text: str, max_count: int = 3) -> List[int]:
    """Extract product ids from `IDs: [...]`, falling back to product-name mentions."""
    if not text:
        return []

    ids_from_line = _extract_ids_from_ids_line(text)
    if ids_from_line:
        return ids_from_line[:max_count]

    if not _CHAT_PRODUCTS_NAME_TO_ID:
        return []

    text_lower = text.lower()
    seen_ids = set()
    matches: List[tuple] = []
    for name, product_id in _CHAT_PRODUCTS_NAME_TO_ID:
        if product_id in seen_ids:
            continue
        pos = text_lower.find(name.lower())
        if pos != -1:
            seen_ids.add(product_id)
            matches.append((pos, product_id))
    matches.sort(key=lambda item: item[0])
    return [product_id for _, product_id in matches[:max_count]]
'''


def main() -> int:
    if not CHAT_FILE.exists():
        raise RuntimeError("routers/chat.py does not exist")

    content = CHAT_FILE.read_text(encoding="utf-8")
    if "def _extract_product_ids_from_text" in content and "def _strip_ids_line_from_response" in content:
        print("No changes needed. Chat helper functions are already present.")
        return 0

    if INSERT_MARKER not in content:
        raise RuntimeError("Could not find chat search helpers marker")

    content = content.replace(INSERT_MARKER, HELPERS_BLOCK.strip() + "\n\n\n" + INSERT_MARKER, 1)
    CHAT_FILE.write_text(content, encoding="utf-8")
    print("Patched routers/chat.py with missing chat helper functions.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
