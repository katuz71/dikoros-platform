"""Apply user helpers service migration.

This script updates main.py by:
1. importing user helpers from `services.users`;
2. removing duplicate local helper functions from main.py.

The migration is intentionally narrow and idempotent.
"""

from __future__ import annotations

import re
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
MAIN_FILE = PROJECT_ROOT / "main.py"

IMPORT_MARKER = "from services.auth import (\n"
USERS_IMPORT = """from services.users import (
    calculate_cashback_percent,
    clean_warehouse_value,
    normalize_phone,
)
"""

CLEAN_WAREHOUSE_RE = re.compile(
    r'''\n\ndef clean_warehouse_value\(s: Optional\[str\]\) -> Optional\[str\]:\n'''
    r'''    """.*?"""\n'''
    r'''    if not s or not isinstance\(s, str\):\n'''
    r'''        return s\n'''
    r'''.*?'''
    r'''    return t if t else None\n''',
    re.DOTALL,
)

NORMALIZE_AND_CASHBACK_RE = re.compile(
    r'''\n# --- HELPER FUNCTIONS ---\n'''
    r'''def normalize_phone\(phone: str\) -> str:\n'''
    r'''.*?'''
    r'''def calculate_cashback_percent\(total_spent: float\) -> int:\n'''
    r'''    """.*?"""\n'''
    r'''    if total_spent < 2000:\n'''
    r'''        return 0\n'''
    r'''    elif total_spent < 5000:\n'''
    r'''        return 5\n'''
    r'''    elif total_spent < 10000:\n'''
    r'''        return 10\n'''
    r'''    elif total_spent < 25000:\n'''
    r'''        return 15\n'''
    r'''    else:\n'''
    r'''        return 20\n''',
    re.DOTALL,
)


def main() -> int:
    content = MAIN_FILE.read_text(encoding="utf-8")
    changed = False

    if USERS_IMPORT not in content:
        if IMPORT_MARKER not in content:
            raise RuntimeError("Could not find services.auth import marker in main.py")
        content = content.replace(IMPORT_MARKER, USERS_IMPORT + IMPORT_MARKER, 1)
        changed = True

    content, clean_count = CLEAN_WAREHOUSE_RE.subn("\n", content, count=1)
    changed = changed or clean_count > 0

    content, user_count = NORMALIZE_AND_CASHBACK_RE.subn("\n", content, count=1)
    changed = changed or user_count > 0

    if not changed:
        print("No changes needed. User helpers migration is already applied.")
        return 0

    MAIN_FILE.write_text(content, encoding="utf-8")
    print("Updated main.py: imported user helpers from services.users and removed duplicate helpers.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
