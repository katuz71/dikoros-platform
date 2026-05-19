from pathlib import Path

p = Path("routers/products.py")
s = p.read_text(encoding="utf-8")

old = '''@router.delete("/products/{id}")
async def delete_product(id: int):
    conn = get_db_connection()
    conn.execute("DELETE FROM products WHERE id=?", (id,))
    conn.commit()
    conn.close()
    return {"status": "ok"}
'''

new = '''@router.delete("/products/{id}")
async def delete_product(id: int):
    conn = get_db_connection()
    cur = conn.execute("DELETE FROM products WHERE id=?", (id,))
    conn.commit()
    deleted_count = getattr(cur, "rowcount", 0)
    conn.close()

    if deleted_count == 0:
        raise HTTPException(status_code=404, detail="Product not found")

    return {"status": "ok"}
'''

if old not in s:
    raise SystemExit("delete_product block not found")

s = s.replace(old, new)
p.write_text(s, encoding="utf-8")

print("OK: delete_product now returns 404 for missing product")
