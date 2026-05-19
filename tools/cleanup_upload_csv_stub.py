from pathlib import Path

p = Path("routers/admin_tools.py")
s = p.read_text(encoding="utf-8")

old = '''@router.post("/upload_csv")
async def upload_csv(file: UploadFile = File(...)):
    # Заглушка для импорта CSV
    return {"count": 0, "message": "CSV Import not implemented yet"}
'''

new = '''@router.post("/upload_csv")
async def upload_csv(file: UploadFile = File(...)):
    raise HTTPException(
        status_code=501,
        detail="CSV import is not implemented in this deployment.",
    )
'''

if old not in s:
    raise SystemExit("upload_csv stub block not found")

s = s.replace(old, new)
p.write_text(s, encoding="utf-8")

print("OK: changed CSV import stub to explicit 501")
