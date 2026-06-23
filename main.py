import json
import logging
import os

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from services.db_schema import fix_db_schema
from routers import (
    admin_page,
    admin_tools,
    analytics,
    auth,
    banners,
    catalog,
    categories,
    chat,
    checkout_profile,
    delivery,
    health,
    orders,
    orders_secure,
    pages,
    posts,
    products,
    promo_codes,
    public_pages,
    referral,
    reviews,
    settings,
    sync,
    uploads,
    users,
)
from services.catalog_scheduler import start_catalog_sync_scheduler
from services.images import UPLOADS_DIR
from services.security import add_admin_guard_middleware, install_admin_route_guard

load_dotenv()

# --- НАСТРОЙКИ ---
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# --- ПАПКИ ---
os.makedirs("uploads", exist_ok=True)

# --- APP ---
install_admin_route_guard()
app = FastAPI()
add_admin_guard_middleware(app)


@app.middleware("http")
async def block_disabled_card_payment(request: Request, call_next):
    """Disable removed card/Monobank payment paths before order routers run."""
    disabled_payment_methods = {"card", "monobank", "mono"}

    if request.method.upper() == "POST" and request.url.path == "/api/payment/callback":
        return JSONResponse(
            status_code=410,
            content={
                "detail": "Card payment callback is disabled. Cashback is applied only on final order status."
            },
        )

    if request.method.upper() == "POST" and request.url.path == "/create_order":
        body = await request.body()
        try:
            payload = json.loads(body.decode("utf-8") or "{}")
        except (json.JSONDecodeError, UnicodeDecodeError):
            payload = {}

        payment_method = str(payload.get("payment_method") or "").strip().lower()
        if payment_method in disabled_payment_methods:
            return JSONResponse(
                status_code=400,
                content={
                    "detail": "Оплата карткою вимкнена. Оберіть післяплату або оплату на рахунок."
                },
            )

        async def receive():
            return {"type": "http.request", "body": body, "more_body": False}

        request = Request(request.scope, receive)

    return await call_next(request)


app.include_router(health.router)
app.include_router(public_pages.router)
app.include_router(pages.router)
app.include_router(delivery.router)
app.include_router(uploads.router)
app.include_router(analytics.router)
app.include_router(categories.router)
app.include_router(banners.router)
app.include_router(catalog.router)
app.include_router(reviews.router)
app.include_router(promo_codes.router)
app.include_router(chat.router)
app.include_router(posts.router)
app.include_router(orders_secure.router)
app.include_router(orders.router)
app.include_router(products.router)
app.include_router(users.router)
app.include_router(checkout_profile.router)
app.include_router(auth.router)
app.include_router(admin_tools.router)
app.include_router(sync.router)
app.include_router(referral.router)
app.include_router(settings.router)
app.include_router(admin_page.router)
templates = Jinja2Templates(directory="templates")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

app.mount("/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/", response_class=HTMLResponse)
async def get_chat_widget(request: Request):
    return templates.TemplateResponse("chat_widget.html", {"request": request})

# --- INITIALIZATION ---
# --- SYNC CONFIG ---
@app.on_event("startup")
def startup_event():
    fix_db_schema()
    start_catalog_sync_scheduler()
    logger.info("Server started successfully")

# --- ONEBOX ---


# --- API ENDPOINTS ---