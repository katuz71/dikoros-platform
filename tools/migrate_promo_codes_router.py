"""Connect promo codes router and remove legacy promo code routes from main.py.

This script updates main.py by:
1. importing `routers.promo_codes`;
2. including `promo_codes.router` after `reviews.router`;
3. removing the legacy promo codes block from main.py.

It is intentionally narrow and idempotent.
"""

from __future__ import annotations

import re
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
MAIN_FILE = PROJECT_ROOT / "main.py"

IMPORT_OLD = "from routers import health, public_pages, delivery, uploads, analytics, categories, banners, reviews\n"
IMPORT_NEW = "from routers import health, public_pages, delivery, uploads, analytics, categories, banners, reviews, promo_codes\n"
REVIEWS_INCLUDE = "app.include_router(reviews.router)\n"
PROMO_CODES_INCLUDE = "app.include_router(promo_codes.router)\n"

PROMO_CODES_BLOCK_RE = re.compile(
    r'''\n# 5\. ПРОМОКОДЫ\n'''
    r'''.*?'''
    r'''\n# 5\.5 ОТЗЫВЫ\n''',
    re.DOTALL,
)


def main() -> int:
    content = MAIN_FILE.read_text(encoding="utf-8")
    changed = False

    if IMPORT_NEW not in content:
        if IMPORT_OLD not in content:
            raise RuntimeError("Could not find reviews router import in main.py")
        content = content.replace(IMPORT_OLD, IMPORT_NEW, 1)
        changed = True

    if PROMO_CODES_INCLUDE not in content:
        if REVIEWS_INCLUDE not in content:
            raise RuntimeError("Could not find reviews router include in main.py")
        content = content.replace(REVIEWS_INCLUDE, REVIEWS_INCLUDE + PROMO_CODES_INCLUDE, 1)
        changed = True

    content, block_count = PROMO_CODES_BLOCK_RE.subn("\n# 5.5 ОТЗЫВЫ\n", content, count=1)
    changed = changed or block_count > 0

    if not changed:
        print("No changes needed. Promo codes router migration is already applied.")
        return 0

    MAIN_FILE.write_text(content, encoding="utf-8")
    print("Updated main.py: promo codes router connected and legacy promo codes block removed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
