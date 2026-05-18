"""Check FastAPI route declarations for duplicate method/path pairs.

This script is intentionally static and lightweight: it scans Python source files
for decorator-style routes, for example:

    @app.get("/health")
    @router.post("/api/track")

It helps during the monolith split: before connecting extracted routers to
main.py, we can detect whether the same method/path still exists in both places.
"""

from __future__ import annotations

import ast
from collections import defaultdict
from pathlib import Path

HTTP_METHODS = {"get", "post", "put", "delete", "patch", "options", "head"}
PROJECT_ROOT = Path(__file__).resolve().parents[1]
SCAN_PATHS = [PROJECT_ROOT / "main.py", PROJECT_ROOT / "routers"]


def _decorator_route(decorator: ast.AST) -> tuple[str, str] | None:
    if not isinstance(decorator, ast.Call):
        return None
    func = decorator.func
    if not isinstance(func, ast.Attribute):
        return None
    method = func.attr.lower()
    if method not in HTTP_METHODS:
        return None
    if not decorator.args:
        return None
    first_arg = decorator.args[0]
    if not isinstance(first_arg, ast.Constant) or not isinstance(first_arg.value, str):
        return None
    return method.upper(), first_arg.value


def _iter_python_files(path: Path):
    if path.is_file() and path.suffix == ".py":
        yield path
    elif path.is_dir():
        yield from sorted(path.rglob("*.py"))


def main() -> int:
    routes: dict[tuple[str, str], list[str]] = defaultdict(list)
    for scan_path in SCAN_PATHS:
        for file_path in _iter_python_files(scan_path):
            tree = ast.parse(file_path.read_text(encoding="utf-8"), filename=str(file_path))
            for node in ast.walk(tree):
                if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    continue
                for decorator in node.decorator_list:
                    route = _decorator_route(decorator)
                    if route:
                        location = f"{file_path.relative_to(PROJECT_ROOT)}:{node.lineno}:{node.name}"
                        routes[route].append(location)

    duplicates = {route: locations for route, locations in routes.items() if len(locations) > 1}
    if not duplicates:
        print("No duplicate FastAPI route decorators found.")
        return 0

    print("Duplicate FastAPI route decorators found:")
    for (method, path), locations in sorted(duplicates.items()):
        print(f"\n{method} {path}")
        for location in locations:
            print(f"  - {location}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
