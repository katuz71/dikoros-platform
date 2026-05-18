"""Apply Pydantic schemas module migration.

This script updates main.py by:
1. importing existing Pydantic schemas from `models.schemas`;
2. removing duplicate schema classes from main.py.

It intentionally does not remove `BaseModel` / `ConfigDict` imports yet because
main.py can still contain legacy model references while the monolith is being
split. That cleanup should happen after the heavy routers are extracted.
"""

from __future__ import annotations

import re
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
MAIN_FILE = PROJECT_ROOT / "main.py"

IMPORT_MARKER = "from services.images import UPLOADS_DIR\n"
SCHEMAS_IMPORT = """from models.schemas import (
    AdminUserUpdate,
    BannerCreate,
    BatchDelete,
    BatchDeleteUsers,
    CategoryCreate,
    CategoryResponse,
    ChatMessage,
    ChatRequest,
    ChatResponse,
    OrderItem,
    OrderRequest,
    OrderStatusUpdate,
    ProductCreate,
    ProductResponse,
    ProductUpdate,
    PromoCodeCreate,
    PromoCodeValidate,
    PushTokenRequest,
    ReviewCreate,
    SocialAuthRequest,
    SocialLoginRequest,
    UserAuth,
    UserInfoUpdate,
    UserResponse,
)
"""

CHAT_MODELS_RE = re.compile(
    r'''\n\nclass ProductCreate\(BaseModel\):\n.*?'''
    r'''class ChatResponse\(BaseModel\):\n'''
    r'''    message: str\n'''
    r'''    products: List\[dict\]\n'''
    r'''\n\n# --- CHAT SEARCH HELPERS ---''',
    re.DOTALL,
)

USER_ORDER_MODELS_RE = re.compile(
    r'''\nclass ReviewCreate\(BaseModel\):\n.*?'''
    r'''class UserResponse\(BaseModel\):\n.*?'''
    r'''    model_config = ConfigDict\(from_attributes=True\)\n'''
    r'''\n# --- APP ---''',
    re.DOTALL,
)


def main() -> int:
    content = MAIN_FILE.read_text(encoding="utf-8")
    changed = False

    if SCHEMAS_IMPORT not in content:
        if IMPORT_MARKER not in content:
            raise RuntimeError("Could not find services.images import marker in main.py")
        content = content.replace(IMPORT_MARKER, IMPORT_MARKER + SCHEMAS_IMPORT, 1)
        changed = True

    content, chat_count = CHAT_MODELS_RE.subn("\n\n# --- CHAT SEARCH HELPERS ---", content, count=1)
    changed = changed or chat_count > 0

    content, user_count = USER_ORDER_MODELS_RE.subn("\n# --- APP ---", content, count=1)
    changed = changed or user_count > 0

    if not changed:
        print("No changes needed. Schemas module migration is already applied.")
        return 0

    MAIN_FILE.write_text(content, encoding="utf-8")
    print("Updated main.py: imported schemas from models.schemas and removed duplicate classes.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
