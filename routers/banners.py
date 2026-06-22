"""Banner routes."""

from __future__ import annotations

from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException

from db import get_db_connection
from models.schemas import BannerCreate, BannerUpdate


router = APIRouter()

VALID_LINK_TYPES = {"none", "product", "category", "promotions", "post", "external"}


def _normalize_destination(link_type, link_value) -> tuple[str, str]:
    normalized_type = str(link_type or "none").strip().lower()
    if normalized_type not in VALID_LINK_TYPES:
        normalized_type = "none"

    normalized_value = str(link_value or "").strip()
    if normalized_type in {"none", "promotions"}:
        return normalized_type, ""

    if normalized_type == "external" and normalized_value:
        if not normalized_value.lower().startswith(("http://", "https://")):
            if "://" in normalized_value:
                raise HTTPException(status_code=400, detail="External banner link must use HTTP(S)")
            normalized_value = f"https://{normalized_value.lstrip('/')}"

        parsed = urlparse(normalized_value)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc or not parsed.hostname:
            raise HTTPException(status_code=400, detail="External banner link must be a valid HTTP(S) URL")

    return normalized_type, normalized_value


def _serialize_banner(row) -> dict:
    banner = dict(row)
    try:
        link_type, link_value = _normalize_destination(
            banner.get("link_type"),
            banner.get("link_value"),
        )
    except HTTPException:
        link_type, link_value = "none", ""
    banner["link_type"] = link_type
    banner["link_value"] = link_value
    return banner


@router.get("/api/banners")
@router.get("/banners")
def get_banners():
    conn = get_db_connection()
    try:
        rows = conn.execute(
            """
            SELECT id, image_url, COALESCE(link_type, 'none') AS link_type,
                   COALESCE(link_value, '') AS link_value
            FROM banners
            ORDER BY id ASC
            """
        ).fetchall()
        return [_serialize_banner(row) for row in rows]
    finally:
        conn.close()


@router.post("/banners")
async def create_banner(banner: BannerCreate):
    image_url = str(banner.image_url or "").strip()
    if not image_url:
        raise HTTPException(status_code=400, detail="Banner image URL is required")

    link_type, link_value = _normalize_destination(banner.link_type, banner.link_value)
    conn = get_db_connection()
    try:
        conn.execute(
            "INSERT INTO banners (image_url, link_type, link_value) VALUES (?, ?, ?)",
            (image_url, link_type, link_value),
        )
        conn.commit()
        return {"status": "ok"}
    finally:
        conn.close()


@router.put("/banners/{id}")
async def update_banner(id: int, banner: BannerUpdate):
    conn = get_db_connection()
    try:
        current = conn.execute(
            "SELECT id, image_url FROM banners WHERE id = ?",
            (id,),
        ).fetchone()
        if not current:
            raise HTTPException(status_code=404, detail="Banner not found")

        image_url = str(banner.image_url or current.get("image_url") or "").strip()
        if not image_url:
            raise HTTPException(status_code=400, detail="Banner image URL is required")

        link_type, link_value = _normalize_destination(banner.link_type, banner.link_value)
        conn.execute(
            "UPDATE banners SET image_url = ?, link_type = ?, link_value = ? WHERE id = ?",
            (image_url, link_type, link_value, id),
        )
        conn.commit()
        return {"status": "ok"}
    finally:
        conn.close()


@router.delete("/banners/{id}")
async def delete_banner(id: int):
    conn = get_db_connection()
    try:
        conn.execute("DELETE FROM banners WHERE id=?", (id,))
        conn.commit()
        return {"status": "ok"}
    finally:
        conn.close()
