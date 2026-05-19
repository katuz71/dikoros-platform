from pathlib import Path

main_path = Path("main.py")
main = main_path.read_text(encoding="utf-8")

start_marker = "# --- ВАШ HTML КОД АДМИНКИ"
start = main.find(start_marker)

if start == -1:
    raise SystemExit("ADMIN_HTML_CONTENT start marker not found")

assign_marker = 'ADMIN_HTML_CONTENT = r"""'
assign_pos = main.find(assign_marker, start)
if assign_pos == -1:
    raise SystemExit("ADMIN_HTML_CONTENT assignment not found")

content_start = assign_pos + len(assign_marker)
end = main.find('"""', content_start)

if end == -1:
    raise SystemExit("ADMIN_HTML_CONTENT closing triple quote not found")

end = end + 3

new_main = main[:start].rstrip() + "\n\n" + main[end:].lstrip()
main_path.write_text(new_main, encoding="utf-8")

print("OK: removed ADMIN_HTML_CONTENT from main.py")
