"""Dynamic catalog API for the mobile app.

Website/Horoshop-backed database is the source of truth. These routes expose
app-friendly aggregated payloads so the app does not need manual edits for
products, categories, promotions, hits, images or simple content pages.
"""

from __future__ import annotations

import os
import re
from typing import Iterable

import httpx
from fastapi import APIRouter, HTTPException

from db import get_db_connection
from services.products import normalize_product_row

router = APIRouter(prefix="/api/catalog", tags=["catalog"])

DEFAULT_LIMIT = 500
DEFAULT_HOME_LIMIT = 16
HOROSHOP_SITE_URL = os.getenv("HOROSHOP_SITE_URL", "https://