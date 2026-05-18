"""Upload and image processing router."""

from __future__ import annotations

from fastapi import APIRouter, File, Request, UploadFile
from fastapi.staticfiles import StaticFiles

from services.images import UPLOADS_DIR, get_resized_uploaded_image, save_uploaded_image


router = APIRouter(tags=["uploads"])
uploads_static = StaticFiles(directory=UPLOADS_DIR)


@router.get("/api/image")
def get_resized_image(
    request: Request,
    src: str,
    w: int = 0,
    h: int = 0,
    q: int = 80,
    format: str = "jpg",
):
    """Serve a resized/cached version of an uploaded image."""
    return get_resized_uploaded_image(request=request, src=src, w=w, h=h, q=q, format=format)


@router.post("/upload")
async def upload_image(file: UploadFile = File(...)):
    """Upload an image file and return its public URL."""
    return {"url": await save_uploaded_image(file)}
