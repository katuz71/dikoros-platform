from pathlib import Path

p = Path("main.py")
s = p.read_text(encoding="utf-8")

s = s.replace("from services.db_schema import fix_db_schema, init_db", "from services.db_schema import fix_db_schema")

# Убираем второй load_dotenv(), оставляем первый после imports
first = s.find("load_dotenv()")
second = s.find("load_dotenv()", first + len("load_dotenv()"))
if second != -1:
    s = s[:second].rstrip() + "\n\n" + s[second + len("load_dotenv()"):].lstrip()

# Нормализуем лишние пустые строки перед app.mount
while "\n\n\n\n\napp.mount" in s:
    s = s.replace("\n\n\n\n\napp.mount", "\n\napp.mount")

p.write_text(s, encoding="utf-8")

print("OK: cleaned duplicate dotenv and unused init_db import")
