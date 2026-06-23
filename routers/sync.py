"""Catalog sync routes."""

from __future__ import annotations

from fastapi import APIRouter

from services.catalog_sync import sync_catalog_from_horoshop
from services.horoshop_product_tabs import sync_horoshop_product_tabs


router = APIRouter()


@router.post("/api/sync/catalog")
async def sync_catalog_horoshop():
    catalog_result = await sync_catalog_from_horoshop()
    product_tabs_result = await sync_horoshop_product_tabs()
    return {**catalog_result, "product_tabs": product_tabs_result}
