"""Dynamic catalog API for the mobile app.

The website/Horoshop-backed products database is the source of truth. These
routes expose app-friendly aggregated payloads so the app does not need manual
product/category/promotion edits.
"""

from __future__ import annotations

import os
import re
from typing import Iterable

import httpx
from fastapi import APIRouter, HTTPException

from db import get_db_connection
from services.products import normalize_product_row


router = APIRouter