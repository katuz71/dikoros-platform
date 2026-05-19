from pathlib import Path

p = Path("routers/users.py")
s = p.read_text(encoding="utf-8")

start = s.find('@router.post("/api/recalculate-cashback")')
end = s.find('\n\n@router.get("/api/users")', start)

if start == -1:
    raise SystemExit("recalculate_cashback start not found")
if end == -1:
    raise SystemExit("get_users marker not found")

new_block = '''@router.post("/api/recalculate-cashback")
def recalculate_cashback():
    """Recalculate cashback_percent for all users based on total_spent."""
    conn = get_db_connection()
    try:
        cur = conn.cursor()
        users = cur.execute("SELECT phone, total_spent FROM users").fetchall()
        updated_count = 0

        for user in users:
            phone = user["phone"]
            total_spent = float(user["total_spent"] or 0)
            cashback_percent = calculate_cashback_percent(total_spent)
            cur.execute("UPDATE users SET cashback_percent=? WHERE phone=?", (cashback_percent, phone))
            updated_count += 1
            logger.info("Updated cashback percent: phone=%s total_spent=%s cashback_percent=%s", phone, total_spent, cashback_percent)

        conn.commit()
        return {
            "status": "ok",
            "message": f"Updated cashback_percent for {updated_count} users"
        }
    finally:
        conn.close()
'''

s = s[:start] + new_block + s[end:]
p.write_text(s, encoding="utf-8")

print("OK: recalculate_cashback now closes DB connection with finally")
