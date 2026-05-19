from pathlib import Path

main_path = Path("main.py")
main = main_path.read_text(encoding="utf-8")

start_marker = "# Initialize OpenAI Client"
end_marker = "# --- НАСТРОЙКИ ---"

start = main.find(start_marker)
end = main.find(end_marker)

if start == -1:
    raise SystemExit("OpenAI init block start not found")
if end == -1:
    raise SystemExit("settings marker not found")
if end <= start:
    raise SystemExit("Invalid OpenAI init block range")

new_main = main[:start].rstrip() + "\n\n" + main[end:]
main_path.write_text(new_main, encoding="utf-8")

print("OK: removed OpenAI init block from main.py")
