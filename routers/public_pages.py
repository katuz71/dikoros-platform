"""Public HTML pages router."""

from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, Response
from fastapi.templating import Jinja2Templates


templates = Jinja2Templates(directory="templates")
router = APIRouter()


@router.head("/delete-account")
async def head_delete_account():
    return Response(status_code=200)


@router.get("/delete-account", response_class=HTMLResponse)
async def get_delete_account(request: Request):
    """Public account deletion request page for Google Play policy compliance."""
    return templates.TemplateResponse("delete_account.html", {"request": request})


@router.head("/privacy-policy")
async def head_privacy_page():
    return Response(status_code=200)


@router.get("/privacy-policy", response_class=HTMLResponse)
async def get_privacy_page(request: Request):
    """Public privacy policy page."""
    return templates.TemplateResponse("privacy_policy.html", {"request": request})


@router.get("/delivery-payment", response_class=HTMLResponse)
async def get_delivery_page(request: Request):
    """Public delivery and payment page."""
    return templates.TemplateResponse("delivery_payment.html", {"request": request})


@router.get("/returns", response_class=HTMLResponse)
async def get_returns_page(request: Request):
    """Public returns page."""
    return templates.TemplateResponse("returns.html", {"request": request})


@router.get("/about", response_class=HTMLResponse)
async def get_about_page(request: Request):
    """Public about page."""
    return templates.TemplateResponse("about.html", {"request": request})

