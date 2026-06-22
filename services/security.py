"""Security helpers for backend routes."""

from __future__ import annotations

import hmac
import os
from typing import Iterable, Optional

from fastapi import Depends, Header, HTTPException
from fastapi.applications import FastAPI
from fastapi.responses import JSONResponse


def require_admin(x_admin_key: Optional[str] = Header(None, alias="X-Admin-Key")) -> bool:
    """Require a server-side admin key for administrative API endpoints."""
    expected_key = os.getenv("ADMIN_API_KEY")
    if not expected_key:
        raise HTTPException(status_code=403, detail="Admin API is disabled")
    if not x_admin_key or not hmac.compare_digest(str(x_admin_key), str(expected_key)):
        raise HTTPException(status_code=403, detail="Forbidden")
    return True


def _method_set(methods: Optional[Iterable[str]]) -> set[str]:
    return {str(method).upper() for method in (methods or [])}


ADMIN_EXACT_ROUTES: set[tuple[str, str]] = {
    ("GET", "/api/clear_products"),
    ("GET", "/api/orders"),
    ("GET", "/orders/export"),
    ("GET", "/api/users"),
    ("GET", "/api/admin/users"),
    ("GET", "/api/users/export"),
    ("POST", "/api/recalculate-cashback"),
    ("GET", "/api/admin/settings/cashback"),
    ("PUT", "/api/admin/settings/cashback"),
    ("POST", "/posts"),
    ("POST", "/upload"),
    ("POST", "/upload_csv"),
    ("POST", "/api/sync/catalog"),
    ("POST", "/api/admin/sync/horoshop-banners"),
    ("GET", "/api/promo-codes"),
    ("POST", "/api/promo-codes"),
}


ADMIN_PREFIX_ROUTES: tuple[tuple[str, str], ...] = (
    ("GET", "/api/orders/"),
    ("PUT", "/orders/"),
    ("PUT", "/api/orders/"),
    ("DELETE", "/orders/"),
    ("DELETE", "/api/orders/"),
    ("POST", "/orders/delete-batch"),
    ("POST", "/api/orders/delete-batch"),
    ("PUT", "/api/users/"),
    ("DELETE", "/api/admin/user/"),
    ("POST", "/api/admin/users/delete-batch"),
    ("POST", "/products"),
    ("PUT", "/products/"),
    ("DELETE", "/products/"),
    ("POST", "/categories"),
    ("PUT", "/categories/"),
    ("DELETE", "/categories/"),
    ("POST", "/categories/"),
    ("POST", "/banners"),
    ("PUT", "/banners/"),
    ("DELETE", "/banners/"),
    ("DELETE", "/posts/"),
    ("DELETE", "/api/reviews/"),
    ("DELETE", "/api/promo-codes/"),
    ("PUT", "/api/promo-codes/"),
)


def is_admin_route(path: str, methods: Optional[Iterable[str]]) -> bool:
    normalized_path = str(path)
    method_names = _method_set(methods) or {"GET"}

    for method in method_names:
        if (method, normalized_path) in ADMIN_EXACT_ROUTES:
            return True
        for admin_method, prefix in ADMIN_PREFIX_ROUTES:
            if method == admin_method and normalized_path.startswith(prefix):
                return True
    return False


def add_admin_guard_middleware(app: FastAPI) -> None:
    """Protect administrative routes at request time."""
    @app.middleware("http")
    async def admin_guard_middleware(request, call_next):
        if is_admin_route(request.url.path, [request.method]):
            expected_key = os.getenv("ADMIN_API_KEY")
            provided_key = request.headers.get("X-Admin-Key")

            if not expected_key:
                return JSONResponse(
                    status_code=403,
                    content={"detail": "Admin API is disabled"},
                )

            if not provided_key or not hmac.compare_digest(str(provided_key), str(expected_key)):
                return JSONResponse(
                    status_code=403,
                    content={"detail": "Forbidden"},
                )

        return await call_next(request)


def install_admin_route_guard() -> None:
    """Deprecated compatibility hook. Admin protection is enforced by middleware."""
    return None
