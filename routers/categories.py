"""Category routes."""

from __future__ import annotations

from typing import List

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from db import get_db_connection
from models.schemas import CategoryResponse
from services.images import save_uploaded_image


router = APIRouter()


def _resolve_category_internal_id(conn, category_id: int):
    """Return category PK by PK id or Horoshop external_id."""
    row = conn.execute("SELECT id FROM categories WHERE id = ?", (category_id,)).fetchone()
    if row:
        return row["id"]
    row = conn.execute("SELECT id FROM categories WHERE external_id = ?", (str(category_id),)).fetchone()
    return row["id"] if row else None


@router.get("/api/all-categories", response_model=List[CategoryResponse])
@router.get("/all-categories", response_model=List[CategoryResponse])
@router.get("/api/categories", response_model=List[CategoryResponse])
def get_categories():
    conn = get_db_connection()

    rows = conn.execute("SELECT id, name, banner_url FROM categories").fetchall()

    banners_map = {}
    banner_items_map = {}
    try:
        banners_rows = conn.execute(
            """
            SELECT id, category_id, image_url,
                   COALESCE(source, 'manual') AS source,
                   COALESCE(source_url, '') AS source_url,
                   COALESCE(link_type, 'none') AS link_type,
                   COALESCE(link_value, '') AS link_value,
                   COALESCE(sort_order, 0) AS sort_order
            FROM category_banners
            ORDER BY category_id ASC, COALESCE(sort_order, 0) ASC, id ASC
            """
        ).fetchall()
        for banner in banners_rows:
            banners_map.setdefault(banner["category_id"], []).append(banner["image_url"])
            banner_items_map.setdefault(banner["category_id"], []).append({
                "id": banner["id"],
                "image_url": banner["image_url"],
                "source": banner.get("source") or "manual",
                "source_url": banner.get("source_url") or "",
                "link_type": banner.get("link_type") or "none",
                "link_value": banner.get("link_value") or "",
                "sort_order": int(banner.get("sort_order") or 0),
            })
    except Exception:
        pass

    conn.close()

    return [
        {
            "id": row["id"],
            "name": row["name"],
            "banner_url": row["banner_url"] if row["banner_url"] else None,
            "banners": banners_map.get(row["id"], []),
            "banner_items": banner_items_map.get(row["id"], []),
        }
        for row in rows
    ]


@router.post("/categories/{category_id}/banners")
async def upload_category_banner(category_id: int, file: UploadFile = File(...)):
    """Upload a banner image for a category by PK id or Horoshop external_id."""
    conn = get_db_connection()
    internal_id = _resolve_category_internal_id(conn, category_id)
    if internal_id is None:
        conn.close()
        raise HTTPException(
            status_code=404,
            detail=(
                f"Категория с id или external_id={category_id} не найдена. "
                "Используйте внутренний id из таблицы categories (GET /all-categories)."
            ),
        )
    try:
        file_path = await save_uploaded_image(file)
        conn.execute(
            """
            INSERT INTO category_banners (
                category_id, image_url, source, source_url,
                link_type, link_value, sort_order
            ) VALUES (?, ?, 'manual', '', 'none', '', 0)
            """,
            (internal_id, file_path),
        )
        conn.commit()
        conn.close()
        return {"success": True, "image_url": file_path}
    except Exception as exc:
        conn.close()
        raise HTTPException(status_code=500, detail=str(exc))


@router.delete("/categories/{category_id}/banners")
def delete_category_banner(category_id: int, image_url: str):
    conn = get_db_connection()
    internal_id = _resolve_category_internal_id(conn, category_id)
    if internal_id is None:
        conn.close()
        raise HTTPException(
            status_code=404,
            detail=f"Категория с id или external_id={category_id} не найдена. Используйте внутренний id из GET /all-categories.",
        )
    try:
        conn.execute("DELETE FROM category_banners WHERE category_id = ? AND image_url = ?", (internal_id, image_url))
        conn.execute("UPDATE categories SET banner_url = NULL WHERE id = ? AND banner_url = ?", (internal_id, image_url))
        conn.commit()
        return {"success": True}
    except Exception as exc:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        conn.close()


@router.post("/categories")
async def add_category(name: str = Form(...), banner: UploadFile = File(None)):
    banner_url = None
    if banner and banner.filename:
        banner_url = await save_uploaded_image(banner)
    conn = get_db_connection()
    conn.execute("INSERT INTO categories (name, banner_url) VALUES (?, ?) ON CONFLICT (name) DO NOTHING", (name, banner_url))
    conn.commit()
    row = conn.execute("SELECT id FROM categories WHERE name = ?", (name,)).fetchone()
    conn.close()
    return {"status": "ok", "id": row["id"] if row else None}


@router.put("/categories/{id}")
async def update_category(id: int, name: str = Form(...), banner: UploadFile = File(None)):
    conn = get_db_connection()
    row = conn.execute("SELECT banner_url FROM categories WHERE id=?", (id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Category not found")
    banner_url = row.get("banner_url") if row else None
    if banner and banner.filename:
        banner_url = await save_uploaded_image(banner)
    conn.execute("UPDATE categories SET name=?, banner_url=? WHERE id=?", (name, banner_url, id))
    conn.commit()
    conn.close()
    return {"status": "ok"}


@router.delete("/categories/{category_id}")
def delete_category(category_id: int):
    conn = get_db_connection()
    conn.execute("DELETE FROM categories WHERE id = ?", (category_id,))
    conn.commit()
    conn.close()
    return {"success": True, "message": "Категория удалена"}
