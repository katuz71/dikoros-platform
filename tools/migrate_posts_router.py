"""Connect posts router and remove legacy post routes from main.py.

This script updates main.py by:
1. importing `routers.posts`;
2. including `posts.router` after `chat.router`;
3. removing the legacy posts block from main.py.

It is intentionally narrow and idempotent.
"""

from __future__ import annotations

import re
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
MAIN_FILE = PROJECT_ROOT / "main.py"

IMPORT_OLD = "from routers import health, public_pages, delivery, uploads, analytics, categories, banners, reviews, promo_codes, chat\n"
IMPORT_NEW = "from routers import health, public_pages, delivery, uploads, analytics, categories, banners, reviews, promo_codes, chat, posts\n"
CHAT_INCLUDE = "app.include_router(chat.router)\n"
POSTS_INCLUDE = "app.include_router(posts.router)\n"

POSTS_BLOCK_RE = re.compile(
    r'''\n# 0\. БЛОГ \(POST для GPT, GET для приложения\)\n'''
    r'''.*?'''
    r'''\n# 1\. ТОВАРЫ\n''',
    re.DOTALL,
)


def main() -> int:
    content = MAIN_FILE.read_text(encoding="utf-8")
    changed = False

    if IMPORT_NEW not in content:
        if IMPORT_OLD not in content:
            raise RuntimeError("Could not find chat router import in main.py")
        content = content.replace(IMPORT_OLD, IMPORT_NEW, 1)
        changed = True

    if POSTS_INCLUDE not in content:
        if CHAT_INCLUDE not in content:
            raise RuntimeError("Could not find chat router include in main.py")
        content = content.replace(CHAT_INCLUDE, CHAT_INCLUDE + POSTS_INCLUDE, 1)
        changed = True

    content, block_count = POSTS_BLOCK_RE.subn("\n# 1. ТОВАРЫ\n", content, count=1)
    changed = changed or block_count > 0

    if not changed:
        print("No changes needed. Posts router migration is already applied.")
        return 0

    MAIN_FILE.write_text(content, encoding="utf-8")
    print("Updated main.py: posts router connected and legacy posts block removed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
