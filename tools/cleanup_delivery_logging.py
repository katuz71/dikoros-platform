from pathlib import Path

p = Path("routers/delivery.py")
s = p.read_text(encoding="utf-8")

if "import logging\n" not in s:
    s = s.replace("from __future__ import annotations\n\n", "from __future__ import annotations\n\nimport logging\n")

if "logger = logging.getLogger(__name__)" not in s:
    s = s.replace("router = APIRouter()\n", "router = APIRouter()\nlogger = logging.getLogger(__name__)\n")

s = s.replace(
    '                print(f"⚠️ Nova Poshta API Error (Cities): {response_json.get(\'errors\')}")',
    '                logger.warning("Nova Poshta API Error (Cities): %s", response_json.get("errors"))',
)
s = s.replace(
    '        print(f"❌ Nova Poshta Proxy Error (Cities): {str(exc)}")',
    '        logger.exception("Nova Poshta Proxy Error (Cities)")',
)
s = s.replace(
    '                print(f"⚠️ Nova Poshta API Error (Warehouses): {response_json.get(\'errors\')}")',
    '                logger.warning("Nova Poshta API Error (Warehouses): %s", response_json.get("errors"))',
)
s = s.replace(
    '        print(f"❌ Nova Poshta Proxy Error (Warehouses): {str(exc)}")',
    '        logger.exception("Nova Poshta Proxy Error (Warehouses)")',
)

p.write_text(s, encoding="utf-8")

print("OK: cleaned delivery logging")
