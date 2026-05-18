"""Connect reviews router and remove legacy review routes from main.py.

This script updates main.py by:
1. importing `routers.reviews`;
2. including `reviews.router` after `banners.router`;
3. removing the legacy review endpoints from main.py.

It is intentionally narrow and idempotent.
"""

from __future__ import annotations

import re
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
MAIN_FILE = PROJECT_ROOT / "main.py"

IMPORT_OLD = "from routers import health, public_pages, delivery, uploads, analytics, categories, banners\n"
IMPORT_NEW = "from routers import health, public_pages, delivery, uploads, analytics, categories, banners, reviews\n"
BANNERS_INCLUDE = "app.include_router(banners.router)\n"
REVIEWS_INCLUDE = "app.include_router(reviews.router)\n"

REVIEWS_BLOCK_RE = re.compile(
    r'''\n# 6\. \n'''
    r'''.*?'''
    r'''\n@app\.post\("/api/auth"\)\n''',
    re.DOTALL,
)


def main() -> int:
    content = MAIN_FILE.read_text(encoding="utf-8")
    changed = False

    if IMPORT_NEW not in content:
        if IMPORT_OLD not in content:
            raise RuntimeError("Could not find banners router import in main.py")
        content = content.replace(IMPORT_OLD, IMPORT_NEW, 1)
        changed = True

    if REVIEWS_INCLUDE not in content:
        if BANNERS_INCLUDE not in content:
            raise RuntimeError("Could not find banners router include in main.py")
        content = content.replace(BANNERS_INCLUDE, BANNERS_INCLUDE + REVIEWS_INCLUDE, 1)
        changed = True

    content, block_count = REVIEWS_BLOCK_RE.subn('\n@app.post("/api/auth")\n', content, count=1)
    changed = changed or block_count > 0

    if not changed:
        print("No changes needed. Reviews router migration is already applied.")
        return 0

    MAIN_FILE.write_text(content, encoding="utf-8")
    print("Updated main.py: reviews router connected and legacy reviews block removed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
