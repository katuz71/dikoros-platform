"""Catalog sync routes."""

from __future__ import annotations

from fastapi import APIRouter

from services.catalog_sync import sync_catalog_from_horoshop


router = APIRouter()


@router.post("/api/sync/catalog")
async def sync_catalog_horoshop():
    return await sync_catalog_from_horoshop()
