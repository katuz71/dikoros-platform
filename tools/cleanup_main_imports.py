"""Remove imports from main.py only when their imported names are unused.

This cleanup is conservative: it targets imports that became likely-unused after
moving logic into services/routers, but removes a name only when Python AST shows
that the name is not referenced anywhere else in main.py.
"""

from __future__ import annotations

import ast
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
MAIN_FILE = PROJECT_ROOT / "main.py"

TARGET_PLAIN_IMPORTS = {
    "hashlib",
    "hmac",
    "jwt",
    "psycopg2",
}

TARGET_FROM_IMPORTS = {
    "datetime": {"timedelta"},
    "io": {"BytesIO"},
    "pydantic": {"BaseModel", "ConfigDict"},
    "psycopg2.extras": {"RealDictCursor"},
    "fastapi.responses": {"FileResponse"},
}


def collect_used_names(tree: ast.AST) -> set[str]:
    used: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Name):
            used.add(node.id)
    return used


def _format_import_from(module: str | None, names: list[ast.alias]) -> str:
    imported = ", ".join(alias.name if alias.asname is None else f"{alias.name} as {alias.asname}" for alias in names)
    return f"from {module} import {imported}"


def main() -> int:
    content = MAIN_FILE.read_text(encoding="utf-8")
    tree = ast.parse(content, filename=str(MAIN_FILE))
    used_names = collect_used_names(tree)

    lines = content.splitlines()
    replacements: dict[int, str | None] = {}

    for node in tree.body:
        if isinstance(node, ast.Import):
            kept: list[ast.alias] = []
            changed = False
            for alias in node.names:
                bound_name = alias.asname or alias.name.split(".")[0]
                if alias.name in TARGET_PLAIN_IMPORTS and bound_name not in used_names:
                    changed = True
                    continue
                kept.append(alias)
            if changed:
                replacements[node.lineno] = None if not kept else "import " + ", ".join(
                    alias.name if alias.asname is None else f"{alias.name} as {alias.asname}" for alias in kept
                )

        elif isinstance(node, ast.ImportFrom) and node.module in TARGET_FROM_IMPORTS:
            removable = TARGET_FROM_IMPORTS[node.module]
            kept = []
            changed = False
            for alias in node.names:
                bound_name = alias.asname or alias.name
                if alias.name in removable and bound_name not in used_names:
                    changed = True
                    continue
                kept.append(alias)
            if changed:
                replacements[node.lineno] = None if not kept else _format_import_from(node.module, kept)

    if not replacements:
        print("No unused targeted imports found in main.py.")
        return 0

    new_lines = []
    for idx, line in enumerate(lines, start=1):
        if idx in replacements:
            replacement = replacements[idx]
            if replacement is not None:
                new_lines.append(replacement)
        else:
            new_lines.append(line)

    MAIN_FILE.write_text("\n".join(new_lines) + "\n", encoding="utf-8")
    print("Removed unused targeted imports from main.py:")
    for lineno in sorted(replacements):
        print(f"- line {lineno}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
