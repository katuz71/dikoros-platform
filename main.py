import logging
import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from services.db_schema import fix_db_schema
from routers import (
    admin_page,
    admin_tools,
    analytics,
    auth,
    banners,
    categories,
    chat,
    delivery,
    health,
    orders,
    posts,
    products,
    promo_codes,
    public_pages,
    reviews,
    sync,
    uploads,
    users,
)
from services.images import UPLOADS_DIR

load_dotenv()

# --- НАСТРОЙКИ ---
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# --- ПАПКИ ---
os.makedirs("uploads", exist_ok=True)

# --- APP ---
app = FastAPI()
app.include_router(health.router)
app.include_router(public_pages.router)
app.include_router(delivery.router)
app.include_router(uploads.router)
app.include_router(analytics.router)
app.include_router(categories.router)
app.include_router(banners.router)
app.include_router(reviews.router)
app.include_router(promo_codes.router)
app.include_router(chat.router)
app.include_router(posts.router)
app.include_router(orders.router)
app.include_router(products.router)
app.include_router(users.router)
app.include_router(auth.router)
app.include_router(admin_tools.router)
app.include_router(sync.router)
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

# --- INITIALIZATION ---
# --- SYNC CONFIG ---
@app.on_event("startup")
def startup_event():
    fix_db_schema()
    print("✅ Server started successfully")

# --- ONEBOX ---


# --- API ENDPOINTS ---
