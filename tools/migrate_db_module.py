"""Apply database module migration.

This script updates main.py by:
1. importing `DATABASE_URL` and `get_db_connection` from `db.py`;
2. removing duplicate local DB adapter code from main.py.

It intentionally keeps `fix_db_schema()` in main.py for now because startup still
calls it and the schema function is large. Moving startup/schema bootstrap to
`db.init_db_schema()` should be a separate PR after this migration is verified.
"""

from __future__ import annotations

import re
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
MAIN_FILE = PROJECT_ROOT / "main.py"

IMPORT_MARKER = "from services.images import UPLOADS_DIR\n"
DB_IMPORT = "from db import DATABASE_URL, get_db_connection\n"

DATABASE_URL_BLOCK_RE = re.compile(
    r'''\nDATABASE_URL = os\.getenv\("DATABASE_URL"\)\n'''
    r'''if not DATABASE_URL:\n'''
    r'''    raise RuntimeError\("DATABASE_URL is required \(PostgreSQL only\)\."\)\n''',
    re.MULTILINE,
)

DB_ADAPTER_BLOCK_RE = re.compile(
    r'''\n\ndef _pgify_sql\(sql: str\) -> str:\n'''
    r'''.*?'''
    r'''class _PGConnAdapter:\n'''
    r'''.*?'''
    r'''    def close\(self\):\n'''
    r'''        self\._conn\.close\(\)\n''',
    re.DOTALL,
)


def main() -> int:
    content = MAIN_FILE.read_text(encoding="utf-8")
    changed = False

    if DB_IMPORT not in content:
        if IMPORT_MARKER not in content:
            raise RuntimeError("Could not find services.images import marker in main.py")
        content = content.replace(IMPORT_MARKER, IMPORT_MARKER + DB_IMPORT, 1)
        changed = True

    content, db_url_count = DATABASE_URL_BLOCK_RE.subn("\n", content, count=1)
    changed = changed or db_url_count > 0

    content, adapter_count = DB_ADAPTER_BLOCK_RE.subn("\n", content, count=1)
    changed = changed or adapter_count > 0

    if not changed:
        print("No changes needed. DB module migration is already applied.")
        return 0

    MAIN_FILE.write_text(content, encoding="utf-8")
    print("Updated main.py: imported DB helpers from db.py and removed duplicate adapters.")
    print("Note: fix_db_schema() remains in main.py until startup bootstrap is migrated.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
