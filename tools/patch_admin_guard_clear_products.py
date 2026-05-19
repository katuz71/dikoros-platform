from pathlib import Path

p = Path("services/security.py")
s = p.read_text(encoding="utf-8")

old = '''ADMIN_EXACT_ROUTES: set[tuple[str, str]] = {
    ("GET", "/api/orders"),
'''

new = '''ADMIN_EXACT_ROUTES: set[tuple[str, str]] = {
    ("GET", "/api/clear_products"),
    ("GET", "/api/orders"),
'''

if old not in s:
    raise SystemExit("ADMIN_EXACT_ROUTES start not found")

s = s.replace(old, new)
p.write_text(s, encoding="utf-8")

print("OK: protected /api/clear_products")
