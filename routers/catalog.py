"""Dynamic catalog API for the mobile app."""

from __future__ import annotations

import os
import re

import httpx
from fastapi import APIRouter, HTTPException

from db import get_db_connection
from services.products import normalize_product_row

router = APIRouter(prefix="/api/catalog", tags=["catalog"])

DEFAULT_LIMIT = 500
HOME_LIMIT = 16
HOROSHOP