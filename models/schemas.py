"""Pydantic schemas used by the FastAPI backend.

The legacy backend still defines these classes in main.py. This module is the
first step toward splitting the monolithic file into routers and service
modules. New code should import schemas from here.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict


class ProductCreate(BaseModel):
    name: str
    price: float
    category: Optional[str] = None
    image: Optional[str] = None
    images: Optional[str] = None
    description: Optional[str] = None
    usage: Optional[str] = None
    composition: Optional[str] = None
    old_price: Optional[float] = None
    discount: Optional[int] = 0
    cashback_percent: Optional[int] = 5
    unit: str = "шт"
    variants: Optional[List[Dict[str, Any]]] = None
    option_names: Optional[str] = None
    delivery_info: Optional[str] = None
    return_info: Optional[str] = None
    pack_sizes: Optional[Any] = None
    is_bestseller: Optional[bool] = False
    is_promotion: Optional[bool] = False
    is_new: Optional[bool] = False


class ProductUpdate(BaseModel):
    """Partial product update payload."""

    name: Optional[str] = None
    price: Optional[float] = None
    category: Optional[str] = None
    image: Optional[str] = None
    images: Optional[str] = None
    description: Optional[str] = None
    usage: Optional[str] = None
    composition: Optional[str] = None
    old_price: Optional[float] = None
    discount: Optional[int] = None
    cashback_percent: Optional[int] = None
    unit: Optional[str] = None
    variants: Optional[List[Dict[str, Any]]] = None
    option_names: Optional[str] = None
    delivery_info: Optional[str] = None
    return_info: Optional[str] = None
    pack_sizes: Optional[Any] = None
    is_bestseller: Optional[bool] = None
    is_promotion: Optional[bool] = None
    is_new: Optional[bool] = None


class ProductResponse(BaseModel):
    """Product response model used by catalog/product routes."""

    model_config = ConfigDict(extra="allow")

    id: int
    name: Optional[str] = None
    price: Optional[float] = None
    image: Optional[str] = None
    images: Optional[str] = None
    category: Optional[str] = None
    old_price: Optional[float] = None
    discount: Optional[int] = 0
    cashback_percent: int = 5
    unit: Optional[str] = "шт"
    description: Optional[str] = None
    usage: Optional[str] = None
    composition: Optional[str] = None
    pack_sizes: Optional[Any] = None
    delivery_info: Optional[str] = None
    return_info: Optional[str] = None
    variants: Optional[List[Dict[str, Any]]] = None
    option_names: Optional[str] = None
    external_id: Optional[str] = None
    is_bestseller: Optional[bool] = False
    is_promotion: Optional[bool] = False
    is_new: Optional[bool] = False
    sku: Optional[str] = None
    status: Optional[str] = "available"


class OrderStatusUpdate(BaseModel):
    new_status: str


class BatchDelete(BaseModel):
    ids: List[int]


class BatchDeleteUsers(BaseModel):
    phones: List[str]


class CategoryCreate(BaseModel):
    name: str
    banner_url: Optional[str] = None


class CategoryResponse(BaseModel):
    id: int
    name: str
    banner_url: Optional[str] = None
    banners: List[str] = []


class BannerCreate(BaseModel):
    image_url: str


class PromoCodeCreate(BaseModel):
    code: str
    discount_percent: int = 0
    discount_amount: float = 0
    max_uses: int = 0
    expires_at: Optional[str] = None


class PromoCodeValidate(BaseModel):
    code: str


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: Optional[List[ChatMessage]] = None
    message: Optional[str] = None
    session_id: Optional[str] = None


class ChatResponse(BaseModel):
    message: str
    products: List[dict]
    reply: Optional[str] = None
    items: Optional[List[dict]] = None
    quick_replies: Optional[List[str]] = None
    session_id: Optional[str] = None


class ReviewCreate(BaseModel):
    product_id: int
    user_name: str
    user_phone: Optional[str] = None
    rating: int
    comment: Optional[str] = None


class OrderItem(BaseModel):
    id: int
    product_id: Optional[int] = None
    name: str
    price: float
    quantity: int
    cashback_percent: Optional[int] = None
    packSize: Optional[str] = None
    unit: Optional[str] = None
    variant_info: Optional[str] = None


class OrderRequest(BaseModel):
    name: str
    last_name: Optional[str] = None
    middle_name: Optional[str] = None
    client_full_name: Optional[str] = None
    recipient_name: Optional[str] = None
    recipient_phone: Optional[str] = None
    do_not_call: bool = False
    phone: str
    email: Optional[str] = None
    contact_preference: Optional[str] = "call"
    city: str
    cityRef: Optional[str] = None
    warehouse: str
    warehouseRef: Optional[str] = None
    items: List[OrderItem]
    totalPrice: float
    payment_method: str = "card"
    bonus_used: int = 0
    use_bonuses: bool = False
    promo_code: Optional[str] = None
    promo_discount_percent: int = 0
    promo_discount_amount: float = 0
    cumulative_discount_percent: int = 0
    cumulative_discount_amount: float = 0
    user_phone: Optional[str] = None
    delivery_method: Optional[str] = None
    bonus_balance: Optional[int] = None
    total_spent: Optional[float] = None
    push_token: Optional[str] = None
    return_url: Optional[str] = None
    comment: Optional[str] = None
    comments: Optional[str] = None
    note: Optional[str] = None

    model_config = ConfigDict(populate_by_name=True)


class AdminUserUpdate(BaseModel):
    phone: Optional[str] = None
    name: Optional[str] = None
    city: Optional[str] = None
    warehouse: Optional[str] = None
    user_ukrposhta: Optional[str] = None
    email: Optional[str] = None
    contact_preference: Optional[str] = None
    bonus_balance: Optional[int] = None
    total_spent: Optional[float] = None


class UserInfoUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    city: Optional[str] = None
    warehouse: Optional[str] = None
    user_ukrposhta: Optional[str] = None
    email: Optional[str] = None
    contact_preference: Optional[str] = None


class UserAuth(BaseModel):
    phone: str


class EmailRegisterRequest(BaseModel):
    email: str
    password: str
    name: Optional[str] = None


class EmailLoginRequest(BaseModel):
    email: str
    password: str


class SmsAuthStartRequest(BaseModel):
    phone: str
    referrer: Optional[str] = None


class SmsAuthVerifyRequest(BaseModel):
    phone: str
    code: str
    referrer: Optional[str] = None


class SocialAuthRequest(BaseModel):
    token: str
    provider: str
    phone: Optional[str] = None


class SocialLoginRequest(BaseModel):
    provider: str
    token: str


class PushTokenRequest(BaseModel):
    auth_id: Optional[str] = None
    token: str
    send_welcome: bool = False


class UserResponse(BaseModel):
    phone: Optional[str] = None
    bonus_balance: int = 0
    total_spent: float = 0.0
    cashback_percent: int = 0
    cumulative_discount_percent: int = 0
    global_cashback_percent: int = 5
    name: Optional[str] = None
    city: Optional[str] = None
    warehouse: Optional[str] = None
    ukrposhta: Optional[str] = None
    email: Optional[str] = None
    contact_preference: Optional[str] = None
    phone_verified: bool = False
    google_connected: bool = False
    facebook_connected: bool = False
    referrer: Optional[str] = None
    created_at: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class CashbackSettingsUpdate(BaseModel):
    percent: int


class AnalyticsEventReq(BaseModel):
    event_name: str
    properties: dict = {}
    user_data: dict = {}
