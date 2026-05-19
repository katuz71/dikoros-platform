from pathlib import Path

p = Path("routers/users.py")
s = p.read_text(encoding="utf-8")

start = s.find('@router.post("/api/admin/users/delete-batch")')
end = s.find('\n\n@router.put("/api/user/info/{phone}")', start)

if start == -1:
    raise SystemExit("delete_users_batch start not found")
if end == -1:
    raise SystemExit("update_user_info marker not found")

new_block = '''@router.post("/api/admin/users/delete-batch")
def delete_users_batch(batch: BatchDeleteUsers):
    """Массовое удаление клиентов по списку телефонов."""
    if not batch.phones:
        return {"status": "ok", "deleted": 0}

    conn = get_db_connection()
    try:
        cur = conn.cursor()
        cleaned = [normalize_phone(p) for p in batch.phones if normalize_phone(p)]
        if not cleaned:
            return {"status": "ok", "deleted": 0}

        placeholders = ",".join("?" for _ in cleaned)
        cur.execute(f"DELETE FROM users WHERE phone IN ({placeholders})", cleaned)
        conn.commit()

        deleted_count = getattr(cur, "rowcount", len(cleaned))
        return {"status": "ok", "deleted": deleted_count}
    finally:
        conn.close()
'''

s = s[:start] + new_block + s[end:]
p.write_text(s, encoding="utf-8")

print("OK: delete_users_batch now closes DB connection with finally")
