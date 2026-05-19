from pathlib import Path

p = Path("routers/auth.py")
s = p.read_text(encoding="utf-8")

if "import logging\n" not in s:
    s = s.replace("import os\n", "import logging\nimport os\n")

if "logger = logging.getLogger(__name__)" not in s:
    s = s.replace("router = APIRouter()\n", "router = APIRouter()\nlogger = logging.getLogger(__name__)\n")

s = s.replace(
    '        print(f"🆕 New user registration: {clean_phone}. Granting 150 bonus.")',
    '        logger.info("New user registration: phone=%s bonus=%s", clean_phone, 150)',
)

p.write_text(s, encoding="utf-8")

print("OK: cleaned auth logging")
