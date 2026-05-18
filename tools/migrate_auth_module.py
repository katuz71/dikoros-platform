"""Apply auth service migration.

This script updates main.py by:
1. importing auth constants/helpers from `services.auth`;
2. removing duplicate local JWT/Telegram auth helpers from main.py.

It intentionally keeps auth-related third-party imports for now. They can be
cleaned after heavy user/auth routers are extracted and static analysis is run.
"""

from __future__ import annotations

import re
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
MAIN_FILE = PROJECT_ROOT / "main.py"

IMPORT_MARKER = "from db import DATABASE_URL, get_db_connection\n"
AUTH_IMPORT = """from services.auth import (
    JWT_ALGORITHM,
    JWT_EXPIRE_HOURS,
    JWT_SECRET,
    PUBLIC_BASE_URL,
    TELEGRAM_BOT_NAME,
    TELEGRAM_BOT_TOKEN,
    create_access_token,
    get_current_user_phone,
    verify_telegram_hash,
)
"""

AUTH_BLOCK_RE = re.compile(
    r'''\nJWT_SECRET = os\.getenv\("JWT_SECRET"\)\n'''
    r'''if not JWT_SECRET:\n'''
    r'''    raise RuntimeError\("JWT_SECRET is not set in environment"\)\n'''
    r'''JWT_ALGORITHM = "HS256"\n'''
    r'''JWT_EXPIRE_HOURS = 24 \* 30.*?\n'''
    r'''TELEGRAM_BOT_TOKEN = os\.getenv\("TELEGRAM_BOT_TOKEN", ""\)\n'''
    r'''TELEGRAM_BOT_NAME = os\.getenv\("TELEGRAM_BOT_NAME", "DikorosUaBot"\).*?\n'''
    r'''PUBLIC_BASE_URL = os\.getenv\("PUBLIC_BASE_URL", ""\)\.rstrip\("/"\).*?\n'''
    r'''\n\ndef create_access_token\(phone: str\) -> str:\n'''
    r'''.*?'''
    r'''def get_current_user_phone\(authorization: Optional\[str\] = Header\(None, alias="Authorization"\)\) -> str:\n'''
    r'''.*?'''
    r'''    except jwt\.InvalidTokenError:\n'''
    r'''        raise HTTPException\(status_code=401, detail="Invalid token"\)\n''',
    re.DOTALL,
)


def main() -> int:
    content = MAIN_FILE.read_text(encoding="utf-8")
    changed = False

    if AUTH_IMPORT not in content:
        if IMPORT_MARKER not in content:
            raise RuntimeError("Could not find db import marker in main.py")
        content = content.replace(IMPORT_MARKER, IMPORT_MARKER + AUTH_IMPORT, 1)
        changed = True

    content, auth_count = AUTH_BLOCK_RE.subn("\n", content, count=1)
    changed = changed or auth_count > 0

    if not changed:
        print("No changes needed. Auth service migration is already applied.")
        return 0

    MAIN_FILE.write_text(content, encoding="utf-8")
    print("Updated main.py: imported auth helpers from services.auth and removed duplicate auth block.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
