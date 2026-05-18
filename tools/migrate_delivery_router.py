"""Apply delivery router migration.

This script updates main.py by:
1. importing `routers.delivery`;
2. including `delivery.router` after `public_pages.router`;
3. removing legacy Nova Poshta delivery endpoints from main.py.

It is intentionally narrow and idempotent.
"""

from __future__ import annotations

from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
MAIN_FILE = PROJECT_ROOT / "main.py"

IMPORT_OLD = "from routers import health, public_pages\n"
IMPORT_NEW = "from routers import health, public_pages, delivery\n"
PUBLIC_INCLUDE = "app.include_router(public_pages.router)\n"
DELIVERY_INCLUDE = "app.include_router(delivery.router)\n"

LEGACY_BLOCKS = [
    '''\n\n# Популярні міста для швидкого вибору (назви для запиту до API НП)\nPOPULAR_CITY_NAMES = ["Київ", "Львів", "Одеса", "Дніпро", "Харків", "Івано-Франківськ"]\n\n\n@app.get("/api/delivery/popular-cities")\nasync def get_popular_cities():\n    """Повертає список популярних міст з ref для Нова Пошта."""\n    api_key = NOVA_POSHTA_API_KEY\n    result = []\n    async with httpx.AsyncClient() as client:\n        for name in POPULAR_CITY_NAMES:\n            payload = {\n                "apiKey": api_key,\n                "modelName": "Address",\n                "calledMethod": "getCities",\n                "methodProperties": {"FindByString": name, "Limit": "1"}\n            }\n            r = await client.post("https://api.novaposhta.ua/v2.0/json/", json=payload)\n            data = r.json().get("data", [])\n            if data:\n                result.append({"ref": data[0].get("Ref"), "name": data[0].get("Description")})\n    return result\n''',
    '''\n\n@app.get("/api/delivery/cities")\nasync def get_np_cities(q: str = ""):\n    """Пошук міст через API Нової Пошти."""\n    try:\n        api_key = os.getenv("NOVA_POSHTA_API_KEY") or NOVA_POSHTA_API_KEY\n        payload = {\n            "apiKey": api_key,\n            "modelName": "Address",\n            "calledMethod": "getCities",\n            "methodProperties": {"FindByString": q, "Limit": "20"}\n        }\n        async with httpx.AsyncClient() as client:\n            r = await client.post("https://api.novaposhta.ua/v2.0/json/", json=payload, timeout=10.0)\n            res_json = r.json()\n            if not res_json.get("success"):\n                print(f"⚠️ Nova Poshta API Error (Cities): {res_json.get('errors')}")\n                return []\n            items = res_json.get("data", [])\n            return [{"ref": i.get("Ref"), "name": i.get("Description")} for i in items]\n    except Exception as e:\n        print(f"❌ Nova Poshta Proxy Error (Cities): {str(e)}")\n        return []\n''',
    '''\n\n@app.get("/api/delivery/warehouses")\nasync def get_np_warehouses(city_ref: str):\n    """Пошук відділень для конкретного міста (ref) через API Нової Пошти."""\n    try:\n        api_key = os.getenv("NOVA_POSHTA_API_KEY") or NOVA_POSHTA_API_KEY\n        payload = {\n            "apiKey": api_key,\n            "modelName": "Address",\n            "calledMethod": "getWarehouses",\n            "methodProperties": {"CityRef": city_ref, "Limit": "100"}\n        }\n        async with httpx.AsyncClient() as client:\n            r = await client.post("https://api.novaposhta.ua/v2.0/json/", json=payload, timeout=10.0)\n            res_json = r.json()\n            if not res_json.get("success"):\n                print(f"⚠️ Nova Poshta API Error (Warehouses): {res_json.get('errors')}")\n                return []\n            items = res_json.get("data", [])\n            return [{"ref": i.get("Ref"), "name": i.get("Description")} for i in items]\n    except Exception as e:\n        print(f"❌ Nova Poshta Proxy Error (Warehouses): {str(e)}")\n        return []\n''',
]


def main() -> int:
    content = MAIN_FILE.read_text(encoding="utf-8")
    changed = False

    if IMPORT_NEW not in content:
        if IMPORT_OLD not in content:
            raise RuntimeError("Could not find public_pages router import in main.py")
        content = content.replace(IMPORT_OLD, IMPORT_NEW, 1)
        changed = True

    if DELIVERY_INCLUDE not in content:
        if PUBLIC_INCLUDE not in content:
            raise RuntimeError("Could not find public_pages router include in main.py")
        content = content.replace(PUBLIC_INCLUDE, PUBLIC_INCLUDE + DELIVERY_INCLUDE, 1)
        changed = True

    for block in LEGACY_BLOCKS:
        if block in content:
            content = content.replace(block, "\n", 1)
            changed = True

    if not changed:
        print("No changes needed. Delivery router migration is already applied.")
        return 0

    MAIN_FILE.write_text(content, encoding="utf-8")
    print("Updated main.py: delivery router connected and legacy delivery endpoints removed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
