"""Fix chat router extraction artifacts.

The first chat extraction moved the route block, but left two issues:
1. `routers/chat.py` can start with an accidental 8-space indentation on the
   module header/import block;
2. the `CHAT_PRODUCTS_BASE` and ID-extraction helpers can remain in `main.py`
   instead of being moved to `routers/chat.py`.

This script fixes both issues and is idempotent.
"""

from __future__ import annotations

import re
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
MAIN_FILE = PROJECT_ROOT / "main.py"
CHAT_FILE = PROJECT_ROOT / "routers" / "chat.py"

CHAT_BASE_BLOCK_RE = re.compile(
    r'''\n# --- CHAT BOT:.*?'''
    r'''\n@app\.post\("/upload"\)\n''',
    re.DOTALL,
)


def _dedent_chat_header(content: str) -> str:
    marker = "# --- CHAT SEARCH HELPERS ---"
    idx = content.find(marker)
    if idx == -1:
        return content

    prefix = content[:idx]
    suffix = content[idx:]
    fixed_prefix_lines = []
    for line in prefix.splitlines():
        if line.startswith("        "):
            fixed_prefix_lines.append(line[8:])
        else:
            fixed_prefix_lines.append(line)
    return "\n".join(fixed_prefix_lines).rstrip() + "\n" + suffix


def main() -> int:
    if not CHAT_FILE.exists():
        raise RuntimeError("routers/chat.py does not exist. Run chat router migration first.")

    main_content = MAIN_FILE.read_text(encoding="utf-8")
    chat_content = CHAT_FILE.read_text(encoding="utf-8")
    changed = False

    fixed_chat = _dedent_chat_header(chat_content)
    if fixed_chat != chat_content:
        chat_content = fixed_chat
        changed = True

    if "CHAT_PRODUCTS_BASE" in main_content and "CHAT_PRODUCTS_BASE" not in chat_content:
        match = CHAT_BASE_BLOCK_RE.search(main_content)
        if not match:
            raise RuntimeError("Could not find leftover CHAT_PRODUCTS_BASE block in main.py")

        base_block = match.group(0)
        base_block_for_chat = base_block.rsplit('@app.post("/upload")', 1)[0].strip()

        insert_marker = "# --- CHAT SEARCH HELPERS ---"
        if insert_marker not in chat_content:
            raise RuntimeError("Could not find chat helper marker in routers/chat.py")
        chat_content = chat_content.replace(insert_marker, base_block_for_chat + "\n\n\n" + insert_marker, 1)
        main_content = main_content[: match.start()] + '\n@app.post("/upload")\n' + main_content[match.end() :]
        changed = True

    if changed:
        CHAT_FILE.write_text(chat_content, encoding="utf-8")
        MAIN_FILE.write_text(main_content, encoding="utf-8")
        print("Fixed chat router formatting and moved leftover chat product base/helpers from main.py.")
    else:
        print("No changes needed. Chat router extraction artifacts are already fixed.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
