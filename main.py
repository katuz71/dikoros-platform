import tempfile
import time
import requests
import json
import os
import httpx
import asyncio
import uuid
import logging
import csv
from io import StringIO
from datetime import datetime
from typing import List, Optional, Any, Dict
from urllib.parse import quote
import re
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests

from fastapi import FastAPI, HTTPException, Request, UploadFile, File, Form, BackgroundTasks, Depends, Header, Body
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
load_dotenv()

from services.notifications import send_expo_push
from services.onebox_api import create_onebox_order, OneBoxDbSession, Product
from routers import health, public_pages, delivery, uploads, analytics, categories, banners, reviews, promo_codes, chat, posts, orders, products
from services.images import UPLOADS_DIR, save_uploaded_image
from db import DATABASE_URL, get_db_connection
from services.products import get_products_by_ids
from services.users import (
    calculate_cashback_percent,
    clean_warehouse_value,
    normalize_phone,
)
from services.auth import (
    JWT_ALGORITHM,
    JWT_EXPIRE_HOURS,
    JWT_SECRET,
    PUBLIC_BASE_URL,
    TELEGRAM_BOT_NAME,
    TELEGRAM_BOT_TOKEN,
    create_access_token,
    get_current_user_phone,
    verify_telegram_hash,
)
from models.schemas import (
    AdminUserUpdate,
    BannerCreate,
    BatchDelete,
    BatchDeleteUsers,
    CategoryCreate,
    CategoryResponse,
    ChatMessage,
    ChatRequest,
    ChatResponse,
    OrderItem,
    OrderRequest,
    OrderStatusUpdate,
    ProductCreate,
    ProductResponse,
    ProductUpdate,
    PromoCodeCreate,
    PromoCodeValidate,
    PushTokenRequest,
    ReviewCreate,
    SocialAuthRequest,
    SocialLoginRequest,
    UserAuth,
    UserInfoUpdate,
    UserResponse,
)

from PIL import Image as PILImage, ImageOps

import psycopg2
from sqlalchemy import Column, String, Boolean, Integer, Float, Text
from sqlalchemy.ext.declarative import declarative_base

Base = declarative_base()



class LegacyUser(Base):
    """Legacy: пользователь по телефону (таблица users)."""
    __tablename__ = "users"
    phone = Column(Text, primary_key=True)
    bonus_balance = Column(Integer, default=0)
    total_spent = Column(Float, default=0)
    cashback_percent = Column(Integer, default=0)
    referrer = Column(Text, nullable=True)
    created_at = Column(Text, nullable=True)
    name = Column(Text, nullable=True)
    city = Column(Text, nullable=True)
    warehouse = Column(Text, nullable=True)
    user_ukrposhta = Column(Text, nullable=True)
    email = Column(Text, nullable=True)
    contact_preference = Column(Text, default="call")
    google_id = Column(String(255), unique=True, index=True, nullable=True)
    facebook_id = Column(String(255), unique=True, index=True, nullable=True)
    telegram_id = Column(String(64), unique=True, index=True, nullable=True)
    is_bonus_claimed = Column(Boolean, default=False)
    push_token = Column(String, nullable=True)


class User(Base):
    """Пользователь приложения: id, telegram_id, phone, name, bonus_balance (таблица app_users)."""
    __tablename__ = "app_users"
    id = Column(Integer, primary_key=True, autoincrement=True)
    telegram_id = Column(String(64), unique=True, nullable=True, index=True)
    phone = Column(String(50), nullable=True, index=True)
    name = Column(String(255), nullable=False, default="")
    bonus_balance = Column(Float, default=150.0)


# Initialize OpenAI Client
openai_client = None



# Ключ Нової Пошти (з середовища або дефолтний)
NOVA_POSHTA_API_KEY = os.getenv("NOVA_POSHTA_API_KEY")
if not NOVA_POSHTA_API_KEY:
    raise RuntimeError("NOVA_POSHTA_API_KEY is not set in environment")


api_key = os.getenv("OPENAI_API_KEY")

if api_key:
    try:
        from openai import AsyncOpenAI
        openai_client = AsyncOpenAI(api_key=api_key)
        print("✅ OpenAI client initialized")
    except ImportError:
        print("⚠️ OpenAI library not installed. Install via: pip install openai")
else:
    print("⚠️ No OPENAI_API_KEY found. Chat will use basic search.")




# --- ВАШ HTML КОД АДМИНКИ (ВСТАВЛЯЕТСЯ АВТОМАТИЧЕСКИ) ---
ADMIN_HTML_CONTENT = r"""
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Super Admin Dashboard</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        .fade-in { animation: fadeIn 0.3s ease-in-out; }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        .modal-backdrop { background-color: rgba(0, 0, 0, 0.75); }
        /* Скроллбар */
        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-track { background: #1f2937; }
        ::-webkit-scrollbar-thumb { background: #4b5563; border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: #6b7280; }
    </style>
</head>
<body class="bg-gray-900 text-gray-100 font-sans min-h-screen p-6">

    <div class="max-w-7xl mx-auto">
        <div class="flex justify-between items-center mb-6 border-b border-gray-700 pb-4">
            <h1 class="text-3xl font-bold text-blue-400">🍕 Super Admin</h1>
            <div class="space-x-4">
                <button onclick="switchTab('orders')" id="tab-orders" class="px-4 py-2 rounded-lg bg-blue-600 text-white font-semibold transition hover:bg-blue-500">
                    📦 Заказы
                </button>
                <button onclick="switchTab('products')" id="tab-products" class="px-4 py-2 rounded-lg bg-gray-700 text-gray-300 font-semibold transition hover:bg-gray-600">
                    🍔 Товары
                </button>
                <button onclick="switchTab('users')" id="tab-users" class="px-4 py-2 rounded-lg bg-gray-700 text-gray-300 font-semibold transition hover:bg-gray-600">
                    👥 Клиенты
                </button>
                <button onclick="switchTab('promocodes')" id="tab-promocodes" class="px-4 py-2 rounded-lg bg-gray-700 text-gray-300 font-semibold transition hover:bg-gray-600">
                    🎁 Промокоды
                </button>
            </div>
        </div>

        <div id="view-orders" class="fade-in">
            <div class="bg-gray-800 rounded-lg p-4 mb-4 border border-gray-700">
                <div style="display: flex; gap: 10px; align-items: center; justify-content: space-between; flex-wrap: wrap;">
                    <h2 class="text-xl font-bold text-blue-400">📦 Управление заказами</h2>
                    <div style="display: flex; gap: 10px; align-items: center;">
                        <button id="delete-selected-orders-btn" onclick="deleteSelectedOrders()" 
                                class="px-4 py-2 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-500 transition whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                                disabled>
                            🗑️ Удалить выбранные
                        </button>
                        <button onclick="exportOrders()" 
                                class="px-4 py-2 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-500 transition whitespace-nowrap">
                            📥 Экспорт в Excel
                        </button>
                    </div>
                </div>
            </div>
            
            <div class="bg-gray-800 rounded-xl shadow-lg overflow-hidden border border-gray-700">
                <table class="w-full text-left border-collapse">
                    <thead>
                        <tr class="bg-gray-700 text-gray-300 uppercase text-xs tracking-wider">
                            <th class="p-4">
                                <input type="checkbox" id="select-all-orders" onchange="toggleSelectAllOrders(this.checked)" 
                                     class="w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500">
                            </th>
                            <th class="p-4">ID</th>
                            <th class="p-4">Дата</th>
                            <th class="p-4">Клиент</th>
                            <th class="p-4">Email</th>
                            <th class="p-4">Связь</th>
                            <th class="p-4">Доставка</th>
                            <th class="p-4 w-1/3">Состав Заказа</th>
                            <th class="p-4">Сумма</th>
                            <th class="p-4">Статус</th>
                            <th class="p-4">Действия</th>
                        </tr>
                    </thead>
                    <tbody id="orders-table" class="divide-y divide-gray-700 text-sm">
                    </tbody>
                </table>
            </div>
        </div>

        <div id="view-products" class="hidden fade-in">
            <div class="bg-gray-800 rounded-lg p-4 mb-4 border border-gray-700">
                <div style="display: flex; gap: 20px; align-items: center; flex-wrap: wrap;">
                    <!-- Old XML import input has been removed -->
                    
                    <div style="display: flex; gap: 10px; align-items: center; flex: 1; min-width: 300px;">
                        <input type="file" id="csvFile" accept=".csv" 
                               class="flex-1 px-4 py-2 bg-gray-700 text-white rounded-lg border border-gray-600 focus:outline-none focus:border-blue-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-green-600 file:text-white hover:file:bg-green-500"
                               onchange="uploadCSV()">
                    </div>
                    
                    <div style="display: flex; gap: 10px; align-items: center;">
                        <button onclick="openAddProductModal()" 
                                class="px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-500 transition">
                            ➕ Добавить товар
                        </button>
                        <button onclick="handleDeleteSelected()" 
                                class="px-4 py-2 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-500 transition">
                            🗑️ Удалить выбранные
                        </button>
                    </div>
                </div>
            </div>

            <div class="bg-gray-800 rounded-xl shadow-lg overflow-hidden border border-gray-700">
                <table class="w-full text-left border-collapse">
                    <thead>
                        <tr class="bg-gray-700 text-gray-300 uppercase text-xs tracking-wider">
                            <th class="p-3">
                                <input type="checkbox" id="select-all-checkbox" onchange="toggleSelectAll(this.checked)" 
                                     class="w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500">
                            </th>
                            <th class="p-3">Фото</th>
                            <th class="p-3">Название</th>
                            <th class="p-3">Категория</th>
                            <th class="p-3">Цена</th>
                            <th class="p-3">Старая цена</th>
                            <th class="p-3">Единица</th>
                            <th class="p-3">Фасування</th>
                            <th class="p-3">Статус</th>
                            <th class="p-3">Действия</th>
                        </tr>
                    </thead>
                    <tbody id="products-table" class="divide-y divide-gray-700 text-sm">
                    </tbody>
                </table>
            </div>

            <div class="bg-gray-800 rounded-xl shadow-lg overflow-hidden border border-gray-700 mt-6 p-6">
                <h2 class="text-2xl font-bold text-blue-400 mb-4">🎨 Управление баннерами</h2>
                
                <div class="mb-6">
                    <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
                        <input type="file" id="bannerFile" accept="image/*" 
                               class="flex-1 px-4 py-2 bg-gray-700 text-white rounded-lg border border-gray-600 focus:outline-none focus:border-blue-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-green-600 file:text-white hover:file:bg-green-500">
                        <input type="text" id="bannerUrl" placeholder="Или введите Image URL" 
                               class="flex-1 px-4 py-2 bg-gray-700 text-white rounded-lg border border-gray-600 focus:outline-none focus:border-blue-500 min-w-300">
                        <button onclick="createBanner()" 
                                class="px-4 py-2 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-500 transition whitespace-nowrap">
                            ➕ Добавить баннер
                        </button>
                    </div>
                </div>
                
                <div id="bannersList" class="grid-container" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 20px;">
                    </div>
            </div>
        </div>

        <div id="view-users" class="hidden fade-in">
            <div class="bg-gray-800 rounded-lg p-4 mb-4 border border-gray-700 shadow-md flex justify-between items-center">
                <h2 class="text-xl font-bold text-blue-400">👥 Клиенты и Бонусы</h2>
                <button onclick="loadUsers()" class="text-gray-400 hover:text-white"><span class="text-xl">🔄</span></button>
            </div>
            <div class="bg-gray-800 rounded-xl shadow-lg overflow-hidden border border-gray-700 overflow-x-auto">
                <table class="w-full text-left border-collapse">
                    <thead>
                        <tr class="bg-gray-700 text-gray-300 uppercase text-xs tracking-wider">
                            <th class="p-4">Телефон</th>
                            <th class="p-4">Баланс Бонусов</th>
                            <th class="p-4">Всего потрачено</th>
                            <th class="p-4">Кешбэк уровень</th>
                            <th class="p-4">Действия</th>
                        </tr>
                    </thead>
                    <tbody id="users-table" class="divide-y divide-gray-700 text-sm"></tbody>
                </table>
            </div>
        </div>

        <div id="view-promocodes" class="hidden fade-in">
            <div class="bg-gray-800 rounded-lg p-4 mb-4 border border-gray-700">
                <div class="flex justify-between items-center">
                    <h2 class="text-xl font-bold text-blue-400">🎁 Промокоды</h2>
                    <button onclick="openAddPromoCodeModal()" 
                            class="px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-500 transition">
                        ➕ Добавить промокод
                    </button>
                </div>
            </div>
            
            <div class="bg-gray-800 rounded-xl shadow-lg overflow-hidden border border-gray-700">
                <table class="w-full text-left border-collapse">
                    <thead>
                        <tr class="bg-gray-700 text-gray-300 uppercase text-xs tracking-wider">
                            <th class="p-4">Код</th>
                            <th class="p-4">Скидка</th>
                            <th class="p-4">Лимит</th>
                            <th class="p-4">Использовано</th>
                            <th class="p-4">Срок действия</th>
                            <th class="p-4">Активен</th>
                            <th class="p-4">Действия</th>
                        </tr>
                    </thead>
                    <tbody id="promocodes-table" class="divide-y divide-gray-700 text-sm">
                    </tbody>
                </table>
            </div>
        </div>

    </div>

    <div id="user-modal" class="hidden fixed inset-0 z-50 modal-backdrop flex items-center justify-center">
        <div class="bg-gray-800 rounded-xl shadow-2xl w-full max-w-sm mx-4 border border-gray-700 fade-in p-6">
            <h2 class="text-xl font-bold text-white mb-4">Редактировать клиента</h2>
            <p class="text-gray-400 text-sm mb-4" id="modal-user-phone"></p>
            
            <label class="block text-sm text-gray-300 mb-1">Баланс Бонусов (₴)</label>
            <input type="number" id="modal-user-bonus" class="w-full bg-gray-700 text-white rounded p-2 border border-gray-600 mb-4 font-bold text-green-400 text-xl">
            
            <label class="block text-sm text-gray-300 mb-1">Всего потрачено (₴)</label>
            <input type="number" id="modal-user-spent" class="w-full bg-gray-700 text-white rounded p-2 border border-gray-600 mb-6 font-bold text-yellow-400 text-xl">
            
            <div class="flex justify-end gap-3">
                <button onclick="document.getElementById('user-modal').classList.add('hidden')" class="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-500">Отмена</button>
                <button onclick="saveUserBonus()" class="px-6 py-2 bg-blue-600 text-white font-bold rounded hover:bg-blue-500">Сохранить</button>
            </div>
        </div>
    </div>

    <div id="order-status-modal" class="hidden fixed inset-0 z-50 modal-backdrop flex items-center justify-center">
        <div class="bg-gray-800 rounded-xl shadow-2xl w-full max-w-md mx-4 border border-gray-700 fade-in">
            <div class="p-6">
                <div class="flex justify-between items-center mb-6">
                    <h2 class="text-2xl font-bold text-blue-400">Изменить статус заказа</h2>
                    <button onclick="closeOrderStatusModal()" class="text-gray-400 hover:text-white text-2xl">&times;</button>
                </div>
                
                <div class="space-y-4">
                    <div>
                        <label class="block text-sm font-medium text-gray-300 mb-2">Статус заказа</label>
                        <select id="order-status-select" 
                                class="w-full px-4 py-2 bg-gray-700 text-white rounded-lg border border-gray-600 focus:outline-none focus:border-blue-500">
                            <option value="Новый">Новый</option>
                            <option value="В обработке">В обработке</option>
                            <option value="Отправлен">Отправлен</option>
                            <option value="Доставлен">Доставлен</option>
                            <option value="Отменен">Отменен</option>
                            <option value="Completed">Выполнен (Кешбэк)</option>
                        </select>
                    </div>
                    
                    <div class="flex justify-end gap-3 pt-4">
                        <button onclick="closeOrderStatusModal()" 
                                class="px-6 py-2 bg-gray-700 text-white font-semibold rounded-lg hover:bg-gray-600 transition">
                            Отмена
                        </button>
                        <button onclick="saveOrderStatus()" 
                                class="px-6 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-500 transition">
                            Сохранить
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <div id="product-modal" class="hidden fixed inset-0 z-50 modal-backdrop flex items-center justify-center">
        <div class="bg-gray-800 rounded-xl shadow-2xl w-full max-w-2xl mx-4 border border-gray-700 fade-in max-h-[85vh] overflow-y-auto">
            <div class="p-6">
                <div class="flex justify-between items-center mb-6">
                    <h2 id="modal-title" class="text-2xl font-bold text-blue-400">Добавить товар</h2>
                    <button onclick="closeProductModal()" class="text-gray-400 hover:text-white text-2xl">&times;</button>
                </div>
                
                <form id="product-form" onsubmit="saveProduct(event)" class="space-y-4">
                    <input type="hidden" id="product-id" value="">
                    
                    <div class="grid grid-cols-3 gap-4" style="overflow: visible;">
                        <div>
                            <label class="block text-sm font-medium text-gray-300 mb-2">Название *</label>
                            <input type="text" id="product-name" required
                                   class="w-full px-4 py-2 bg-gray-700 text-white rounded-lg border border-gray-600 focus:outline-none focus:border-blue-500">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-300 mb-2">Базовая цена (₴)</label>
                            <input type="number" id="product-price" min="0"
                                   class="w-full px-4 py-2 bg-gray-700 text-white rounded-lg border border-gray-600 focus:outline-none focus:border-blue-500"
                                   placeholder="От ... грн (или оставьте пустым, если есть варианты)">
                        </div>
                        <div style="position: relative; overflow: visible;">
                            <label for="productCategory" class="block text-sm font-medium text-gray-300 mb-2">Категория</label>
                            <div style="display: flex; gap: 10px; align-items: center; width: 100%; position: relative; overflow: visible;">
                                <select id="productCategory" required 
                                        class="flex-1 px-4 py-2 bg-gray-700 text-white rounded-lg border border-gray-600 focus:outline-none focus:border-blue-500"
                                        style="min-width: 0;">
                                    <option value="">Загрузка...</option>
                                </select>
                                <button type="button" onclick="openCategoryModal()" 
                                        class="px-4 py-2 text-white font-semibold rounded-lg hover:opacity-90 transition"
                                        style="background: #e67e22 !important; border: 2px solid #d35400 !important; cursor: pointer; font-size: 18px; white-space: nowrap; flex-shrink: 0; min-width: 50px; height: 42px; display: flex !important; align-items: center; justify-content: center; z-index: 10; box-shadow: 0 2px 4px rgba(0,0,0,0.3); visibility: visible !important; opacity: 1 !important;"
                                        title="Управление категориями">
                                    <span style="display: inline-block; font-size: 18px; line-height: 1; font-weight: bold;">⚙</span>
                                </button>
                            </div>
                        </div>
                    </div>
                    
                    <div class="grid grid-cols-3 gap-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-300 mb-2">Старая цена (₴)</label>
                            <input type="number" id="product-old-price" min="0" step="0.01"
                                   class="w-full px-4 py-2 bg-gray-700 text-white rounded-lg border border-gray-600 focus:outline-none focus:border-blue-500">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-300 mb-2">Скидка (%)</label>
                            <input type="number" id="product-discount" placeholder="Скидка %" min="0" max="100" step="0.01"
                                   class="w-full px-4 py-2 bg-gray-700 text-white rounded-lg border border-gray-600 focus:outline-none focus:border-blue-500">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-300 mb-2">Единица измерения</label>
                            <input type="text" id="product-unit" placeholder="шт" value="шт"
                                   class="w-full px-4 py-2 bg-gray-700 text-white rounded-lg border border-gray-600 focus:outline-none focus:border-blue-500">
                        </div>
                    </div>
                    
                    <div>
                        <label class="block text-sm font-medium text-gray-300 mb-2">Главное фото (файл)</label>
                        <input type="file" id="product-image-file" accept="image/*"
                               class="w-full px-4 py-2 bg-gray-700 text-white rounded-lg border border-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-green-600 file:text-white hover:file:bg-green-500">
                        <p class="text-xs text-gray-400 mt-1">При сохранении товара файл загрузится и путь запишется в поле image.</p>
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-300 mb-2">Изображения товара</label>
                        
                        <div class="mb-4">
                            <div class="flex items-center gap-4 mb-2">
                                <input type="file" id="product-images-file" accept="image/*" multiple
                                     class="flex-1 px-4 py-2 bg-gray-700 text-white rounded-lg border border-gray-600 focus:outline-none focus:border-blue-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-green-600 file:text-white hover:file:bg-green-500">
                                <button type="button" onclick="uploadMultipleImages()" 
                                        class="px-4 py-2 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-500 transition">
                                    Загрузить
                                </button>
                            </div>
                            <p class="text-xs text-gray-400">Выберите несколько изображений или перетащите их. Первое изображение будет основным.</p>
                        </div>
                        
                        <div id="images-upload-status" class="hidden mb-2">
                            <div class="flex items-center gap-2">
                                <div class="animate-spin rounded-full h-4 w-4 border-b-2 border-green-500"></div>
                                <span class="text-sm text-gray-300">Загрузка изображений...</span>
                            </div>
                        </div>
                        
                        <div id="uploaded-images-preview" class="grid grid-cols-4 gap-2 mb-3"></div>
                        
                        <div>
                            <label class="block text-sm font-medium text-gray-300 mb-1">URL изображений (через запятую)</label>
                            <textarea id="product-images" placeholder="https://example.com/image1.jpg, https://example.com/image2.jpg"
                                      class="w-full px-4 py-2 bg-gray-700 text-white rounded-lg border border-gray-600 focus:outline-none focus:border-blue-500"
                                      rows="2"></textarea>
                            <p class="text-xs text-gray-400 mt-1">Можно ввести URL вручную или они добавятся автоматически после загрузки.</p>
                        </div>
                    </div>
                    
                    <div>
                        <label class="block text-sm font-medium text-gray-300 mb-2">Названия характеристик (через |)</label>
                        <input type="text" id="productOptionNames" 
                               placeholder="Например: Врожай | Вага | Дозування"
                               class="w-full px-4 py-2 bg-gray-700 text-white rounded-lg border border-gray-600 focus:outline-none focus:border-blue-500">
                    </div>
                    
                    <div>
                        <div class="flex justify-between items-center mb-2">
                            <label class="block text-sm font-medium text-gray-300">Варианты фасовки</label>
                            <button type="button" onclick="addVariant()" 
                                    class="px-3 py-1 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-500 transition">
                                + Добавить вариант
                            </button>
                        </div>
                        <div id="variants-container" class="space-y-2">
                            </div>
                    </div>
                    
                    <div>
                        <label class="block text-sm font-medium text-gray-300 mb-2">Опис</label>
                        <textarea id="product-description" rows="2"
                                  class="w-full px-4 py-2 bg-gray-700 text-white rounded-lg border border-gray-600 focus:outline-none focus:border-blue-500"></textarea>
                    </div>
                    
                    <div>
                        <label class="block text-sm font-medium text-gray-300 mb-2">Інструкція та протипоказання</label>
                        <textarea id="product-usage" rows="4"
                                  class="w-full px-4 py-2 bg-gray-700 text-white rounded-lg border border-gray-600 focus:outline-none focus:border-blue-500"></textarea>
                    </div>
                    
                    <div>
                        <label class="block text-sm font-medium text-gray-300 mb-2">Склад</label>
                        <textarea id="product-composition" rows="3"
                                  class="w-full px-4 py-2 bg-gray-700 text-white rounded-lg border border-gray-600 focus:outline-none focus:border-blue-500"></textarea>
                    </div>
                    
                    <div>
                        <label class="block text-sm font-medium text-gray-300 mb-2">Доставка та оплата</label>
                        <textarea id="product-delivery-info" rows="3"
                                  class="w-full px-4 py-2 bg-gray-700 text-white rounded-lg border border-gray-600 focus:outline-none focus:border-blue-500"></textarea>
                    </div>
                    
                    <div>
                        <label class="block text-sm font-medium text-gray-300 mb-2">Повернення</label>
                        <textarea id="product-return-info" rows="3"
                                  class="w-full px-4 py-2 bg-gray-700 text-white rounded-lg border border-gray-600 focus:outline-none focus:border-blue-500"></textarea>
                    </div>
                    
                    <div class="flex justify-end gap-3 pt-4">
                        <button type="button" onclick="closeProductModal()" 
                                class="px-6 py-2 bg-gray-700 text-white font-semibold rounded-lg hover:bg-gray-600 transition">
                            Отмена
                        </button>
                        <button type="submit" 
                                class="px-6 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-500 transition">
                            Сохранить
                        </button>
                    </div>
                </form>
            </div>
        </div>
    </div>

    <div id="categoryModal" class="hidden fixed inset-0 z-50 modal-backdrop flex items-center justify-center">
        <div class="bg-gray-800 rounded-xl shadow-2xl w-full max-w-md mx-4 border border-gray-700 fade-in">
            <div class="p-6">
                <div class="flex justify-between items-center mb-6">
                    <h2 class="text-2xl font-bold text-blue-400">Управление категориями</h2>
                    <button onclick="closeCategoryModal()" class="text-gray-400 hover:text-white text-2xl">&times;</button>
                </div>
                
                <div style="display: flex; gap: 10px; margin-bottom: 20px;">
                    <input type="text" id="newCategoryName" placeholder="Новая категория" 
                           class="flex-1 px-4 py-2 bg-gray-700 text-white rounded-lg border border-gray-600 focus:outline-none focus:border-blue-500">
                    <button onclick="addCategory()" 
                            class="px-4 py-2 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-500 transition">
                        +
                    </button>
                </div>
                
                <ul id="categoryList" style="list-style: none; padding: 0; max-height: 300px; overflow-y: auto; margin-bottom: 20px;">
                </ul>
                
                <div class="flex justify-end gap-3 pt-4">
                    <button onclick="closeCategoryModal()" 
                            class="px-6 py-2 bg-gray-700 text-white font-semibold rounded-lg hover:bg-gray-600 transition">
                        Закрыть
                    </button>
                </div>
            </div>
        </div>
    </div>

    <div id="promoCodeModal" class="hidden fixed inset-0 z-50 modal-backdrop flex items-center justify-center">
        <div class="bg-gray-800 rounded-xl shadow-2xl w-full max-w-md mx-4 border border-gray-700 fade-in">
            <div class="p-6">
                <div class="flex justify-between items-center mb-6">
                    <h2 class="text-2xl font-bold text-blue-400">Новый промокод</h2>
                    <button onclick="closePromoCodeModal()" class="text-gray-400 hover:text-white text-2xl">&times;</button>
                </div>
                
                <form onsubmit="createPromoCode(event)" class="space-y-4">
                    <div>
                        <label class="block text-sm font-medium text-gray-300 mb-2">Код *</label>
                        <input type="text" id="promo-code" required placeholder="SUMMER2024"
                               class="w-full px-4 py-2 bg-gray-700 text-white rounded-lg border border-gray-600 focus:outline-none focus:border-blue-500 uppercase">
                    </div>
                    
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-300 mb-2">Скидка %</label>
                            <input type="number" id="promo-percent" min="0" max="100" value="0"
                                   class="w-full px-4 py-2 bg-gray-700 text-white rounded-lg border border-gray-600 focus:outline-none focus:border-blue-500">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-300 mb-2">Скидка ₴</label>
                            <input type="number" id="promo-amount" min="0" value="0"
                                   class="w-full px-4 py-2 bg-gray-700 text-white rounded-lg border border-gray-600 focus:outline-none focus:border-blue-500">
                        </div>
                    </div>

                    <div>
                        <label class="block text-sm font-medium text-gray-300 mb-2">Лимит использований (0 = безлимит)</label>
                        <input type="number" id="promo-max-uses" min="0" value="0"
                               class="w-full px-4 py-2 bg-gray-700 text-white rounded-lg border border-gray-600 focus:outline-none focus:border-blue-500">
                    </div>

                    <div>
                        <label class="block text-sm font-medium text-gray-300 mb-2">Действует до (необязательно)</label>
                        <input type="date" id="promo-expires"
                               class="w-full px-4 py-2 bg-gray-700 text-white rounded-lg border border-gray-600 focus:outline-none focus:border-blue-500">
                    </div>
                    
                    <div class="flex justify-end gap-3 pt-4">
                        <button type="button" onclick="closePromoCodeModal()" 
                                class="px-6 py-2 bg-gray-700 text-white font-semibold rounded-lg hover:bg-gray-600 transition">
                            Отмена
                        </button>
                        <button type="submit" 
                                class="px-6 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-500 transition">
                            Создать
                        </button>
                    </div>
                </form>
            </div>
        </div>
    </div>

    <script>
        console.log('🚀 Admin script loading...');
        
        // Global variables
        let currentEditingId = null;
        let currentOrderId = null;
        let currentUserPhone = null; // 🔥 NEW VARIABLE
        
        // API Configuration
        const API_BASE_URL = ''; // Относительные пути работают при открытии через FastAPI server

        console.log('📝 Defining switchTab function...');

        // --- TABS LOGIC ---
        function switchTab(tab) {
            // Скрываем все
            ['orders', 'products', 'users', 'promocodes'].forEach(t => {
                const view = document.getElementById(`view-${t}`);
                if (view) view.classList.add('hidden');
                
                const btn = document.getElementById(`tab-${t}`);
                if (btn) {
                    btn.classList.replace('bg-blue-600', 'bg-gray-700');
                    btn.classList.replace('text-white', 'text-gray-300');
                }
            });

            // Показываем активное
            const activeView = document.getElementById(`view-${tab}`);
            if (activeView) activeView.classList.remove('hidden');
            
            const activeBtn = document.getElementById(`tab-${tab}`);
            if (activeBtn) {
                activeBtn.classList.replace('bg-gray-700', 'bg-blue-600');
                activeBtn.classList.replace('text-gray-300', 'text-white');
            }

            if(tab === 'orders') loadOrders();
            if(tab === 'promocodes') loadPromoCodes();
            if(tab === 'products') loadProducts();
            if(tab === 'users') loadUsers(); // 🔥 NEW CALL
        }
        
        // --- USERS LOGIC (NEW) ---
        async function loadUsers() {
            try {
                const res = await fetch(`${API_BASE_URL}/api/users`);
                const users = await res.json();
                const tbody = document.getElementById('users-table');
                tbody.innerHTML = users.map(u => {
                    const level = u.total_spent > 25000 ? 20 : u.total_spent > 10000 ? 15 : u.total_spent > 5000 ? 10 : u.total_spent > 2000 ? 5 : 0;
                    return `
                    <tr class="hover:bg-gray-750 border-b border-gray-700">
                        <td class="p-4 font-mono text-blue-300">${u.phone}</td>
                        <td class="p-4 font-bold text-green-400 text-lg">${u.bonus_balance} ₴</td>
                        <td class="p-4 text-gray-300">${u.total_spent || 0} ₴</td>
                        <td class="p-4 text-yellow-500 text-xs">${level}%</td>
                        <td class="p-4">
                            <button onclick="openUserModal('${u.phone}', ${u.bonus_balance}, ${u.total_spent})" class="bg-blue-600 p-2 rounded hover:bg-blue-500 text-white">✏️</button>
                        </td>
                    </tr>
                `}).join('');
            } catch(e) { console.error(e); }
        }

        function openUserModal(phone, balance, spent) {
            currentUserPhone = phone;
            document.getElementById('modal-user-phone').innerText = phone;
            document.getElementById('modal-user-bonus').value = balance;
            document.getElementById('modal-user-spent').value = spent || 0;
            document.getElementById('user-modal').classList.remove('hidden');
        }

        async function saveUserBonus() {
            const bonus = document.getElementById('modal-user-bonus').value;
            const spent = document.getElementById('modal-user-spent').value;
            await fetch(`${API_BASE_URL}/api/users/${currentUserPhone}`, {
                method: 'PUT',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ 
                    bonus_balance: parseInt(bonus),
                    total_spent: parseFloat(spent)
                })
            });
            document.getElementById('user-modal').classList.add('hidden');
            loadUsers();
        }

        console.log('✅ switchTab function defined successfully');

        // --- FETCH ORDERS ---
        async function loadOrders() {
            try {
                const response = await fetch('/api/orders?t=' + Date.now());
                const orders = await response.json();
                const tbody = document.getElementById('orders-table');
                tbody.innerHTML = '';

                orders.forEach(order => {
                    let itemsDisplay = '<span class="text-gray-500">-</span>';
                    try {
                        if (order.items) {
                            const items = typeof order.items === 'string' ? JSON.parse(order.items) : order.items;
                            if (Array.isArray(items) && items.length > 0) {
                                itemsDisplay = items.map(item => {
                                    const name = item.name || 'Товар';
                                    const unit = item.unit || item.packSize || 'шт';
                                    const qty = item.quantity || 1;
                                    const variant = item.variant_info || '';
                                    // If variant_info exists, show it in bold; otherwise show unit
                                    const sizeDisplay = variant ? `<strong>${variant}</strong>` : unit;
                                    return `${name} (${sizeDisplay}) x ${qty}`;
                                }).join(', ');
                            }
                        }
                    } catch (e) {
                        console.error('Error parsing items:', e);
                        itemsDisplay = '<span class="text-gray-500">-</span>';
                    }
                    
                    // Get status with fallback
                    const orderStatus = order.status || 'Новый';
                    const statusColors = {
                        'Новый': 'bg-green-900 text-green-300',
                        'В обработке': 'bg-yellow-900 text-yellow-300',
                        'Отправлен': 'bg-blue-900 text-blue-300',
                        'Доставлен': 'bg-purple-900 text-purple-300',
                        'Отменен': 'bg-red-900 text-red-300',
                        'Pending': 'bg-orange-900 text-orange-300'
                    };
                    const statusClass = statusColors[orderStatus] || 'bg-gray-900 text-gray-300';
                    
                    // Escape single quotes in status for JavaScript
                    const escapedStatus = (orderStatus || 'Новый').replace(/'/g, "\\'");
                    // Get user data for email and contact preference
                    const userEmail = order.email || '-';
                    const contactPref = order.contact_preference || 'call';
                    const contactIcons = {
                        'call': '📞',
                        'telegram': '✈️',
                        'viber': '💬'
                    };
                    const contactIcon = contactIcons[contactPref] || '📞';
                    
                    const row = `
                        <tr class="hover:bg-gray-750 transition">
                            <td class="p-4" onclick="event.stopPropagation();">
                                <input type="checkbox" class="order-checkbox w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500" 
                                       value="${order.id}" data-order-id="${order.id}" onchange="updateDeleteButtonState()">
                            </td>
                            <td class="p-4 font-mono text-blue-300 cursor-pointer" onclick="openOrderStatusModal(${order.id}, '${escapedStatus}')">#${order.id}</td>
                            <td class="p-4 text-gray-400 cursor-pointer" onclick="openOrderStatusModal(${order.id}, '${escapedStatus}')">${order.date || ''}</td>
                            <td class="p-4 cursor-pointer" onclick="openOrderStatusModal(${order.id}, '${escapedStatus}')">
                                <div class="font-bold text-white">${order.user_name || order.name || ''}</div>
                                <div class="text-xs text-gray-400">${order.phone || ''}</div>
                            </td>
                            <td class="p-4 text-xs text-gray-400 cursor-pointer" onclick="openOrderStatusModal(${order.id}, '${escapedStatus}')">${userEmail}</td>
                            <td class="p-4 text-center cursor-pointer" onclick="openOrderStatusModal(${order.id}, '${escapedStatus}')" title="${contactPref}">${contactIcon}</td>
                            <td class="p-4 text-gray-300 text-xs cursor-pointer" onclick="openOrderStatusModal(${order.id}, '${escapedStatus}')">
                                ${order.city || ''}<br>${order.warehouse || ''}
                            </td>
                            <td class="p-4 text-gray-300 text-xs italic border-l border-gray-700 cursor-pointer" onclick="openOrderStatusModal(${order.id}, '${escapedStatus}')">
                                ${itemsDisplay}
                            </td>
                            <td class="p-4 font-bold text-green-400 text-lg cursor-pointer" onclick="openOrderStatusModal(${order.id}, '${escapedStatus}')">
                                ${order.total_price || order.total || order.totalprice || 0} ₴
                            </td>
                            <td class="p-4 cursor-pointer" onclick="openOrderStatusModal(${order.id}, '${escapedStatus}')">
                                <span class="px-2 py-1 ${statusClass} rounded text-xs">${orderStatus}</span>
                            </td>
                            <td class="p-4" onclick="event.stopPropagation();">
                                <button onclick="confirmDeleteOrder(${order.id})" 
                                        class="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-500 transition">
                                    🗑️
                                </button>
                            </td>
                        </tr>
                    `;
                    tbody.innerHTML += row;
                });
            } catch (e) { 
                console.error("Err orders", e);
                document.getElementById('orders-table').innerHTML = 
                    '<tr><td colspan="11" class="p-4 text-center text-red-400">Ошибка загрузки заказов</td></tr>';
            }
        }

        // --- FETCH PRODUCTS ---
        async function loadProducts() {
            try {
                console.log('🔄 Loading products...');
                const response = await fetch('/products');
                console.log('📡 Response status:', response.status);
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                
                const products = await response.json();
                console.log('📦 Products loaded:', products.length);
                console.log('📦 Sample product:', products[0]);
                
                const tbody = document.getElementById('products-table');
                if (!tbody) {
                    console.error('❌ Products table tbody not found');
                    return;
                }
                
                tbody.innerHTML = '';

                if (products.length === 0) {
                    console.log('📦 No products found');
                    tbody.innerHTML = '<tr><td colspan="9" class="p-4 text-center text-gray-400">Нет товаров</td></tr>';
                    return;
                }

                console.log('🔄 Rendering products table...');
                products.forEach((p, index) => {
                    const row = `
                        <tr class="hover:bg-gray-750 transition">
                            <td class="p-3">
                                <input type="checkbox" class="product-checkbox w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500" 
                                       value="${p.id}" data-product-id="${p.id}">
                            </td>
                            <td class="p-3">
                                <img src="${p.image || 'https://via.placeholder.com/50'}" 
                                     alt="${p.name}" 
                                     class="w-12 h-12 object-cover rounded">
                            </td>
                            <td class="p-3 font-semibold text-white">${p.name || '-'}</td>
                            <td class="p-3 text-gray-300">${p.category || '-'}</td>
                            <td class="p-3 text-green-400 font-bold">${p.price || 0} ₴</td>
                            <td class="p-3 text-gray-400 line-through">${p.old_price ? p.old_price + ' ₴' : '-'}</td>
                            <td class="p-3 text-gray-300">${p.unit || 'шт'}</td>
                            <td class="p-3 text-gray-300">${p.pack_sizes || '-'}</td>
                            <td class="p-3">
                                <div class="flex gap-2">
                                    <button onclick="openEditProductModal(${p.id})" 
                                            class="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-500 transition">
                                        ✏️
                                    </button>
                                    <button onclick="deleteProduct(${p.id})" 
                                            class="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-500 transition">
                                        🗑️
                                    </button>
                                </div>
                            </td>
                        </tr>
                    `;
                    tbody.innerHTML += row;
                });
                console.log('✅ Products table rendered successfully');
                loadBanners(); // Load banners also
            } catch (e) { 
                console.error("❌ Error loading products:", e);
                const tbody = document.getElementById('products-table');
                if (tbody) {
                    tbody.innerHTML = 
                        '<tr><td colspan="9" class="p-4 text-center text-red-400">Ошибка загрузки товаров: ' + e.message + '</td></tr>';
                }
            }
        }

        // --- PRODUCT MODAL ---
        // Image upload handler
        document.getElementById('product-images-file').addEventListener('change', async function(e) { /* Placeholder logic moved to uploadMultipleImages */ });
        
        // Multiple images upload handler
        async function uploadMultipleImages() {
            const fileInput = document.getElementById('product-images-file');
            const files = fileInput.files;
            
            if (!files || files.length === 0) {
                alert('Пожалуйста, выберите изображения для загрузки');
                return;
            }
            
            const statusDiv = document.getElementById('images-upload-status');
            const previewContainer = document.getElementById('uploaded-images-preview');
            const urlInput = document.getElementById('product-images');
            
            // Show loading
            statusDiv.classList.remove('hidden');
            previewContainer.innerHTML = '';
            
            try {
                const uploadedUrls = [];
                
                // Upload each file
                for (let i = 0; i < files.length; i++) {
                    const file = files[i];
                    const formData = new FormData();
                    formData.append('file', file);
                    
                    const response = await fetch('/upload', {
                        method: 'POST',
                        body: formData
                    });
                    
                    if (!response.ok) {
                        throw new Error(`Ошибка загрузки файла ${file.name}`);
                    }
                    
                    const data = await response.json();
                    uploadedUrls.push(data.url);
                    
                    // Add preview
                    const previewUrl = data.url.startsWith('http') ? data.url : window.location.origin + data.url;
                    const previewDiv = document.createElement('div');
                    previewDiv.className = 'relative group';
                    previewDiv.innerHTML = `
                        <img src="${previewUrl}" class="w-full h-20 object-cover rounded border border-gray-600">
                        <button type="button" onclick="removeUploadedImage('${data.url}')" 
                                class="absolute top-1 right-1 bg-red-500 text-white rounded-full w-5 h-5 text-xs opacity-0 group-hover:opacity-100 transition">
                            ×
                        </button>
                    `;
                    previewContainer.appendChild(previewDiv);
                }
                
                // Update URLs input
                const existingUrls = urlInput.value.trim();
                const allUrls = existingUrls ? [...existingUrls.split(',').map(u => u.trim()), ...uploadedUrls] : uploadedUrls;
                urlInput.value = allUrls.join(', ');
                
                console.log('✅ Изображения загружены:', uploadedUrls);
                
                // Clear file input
                fileInput.value = '';
                
            } catch (error) {
                console.error('❌ Ошибка загрузки изображений:', error);
                alert('Ошибка загрузки изображений: ' + error.message);
            } finally {
                statusDiv.classList.add('hidden');
            }
        }
        
        // Remove uploaded image
        function removeUploadedImage(urlToRemove) {
            const urlInput = document.getElementById('product-images');
            const previewContainer = document.getElementById('uploaded-images-preview');
            
            // Remove from URLs input
            const urls = urlInput.value.split(',').map(u => u.trim()).filter(u => u !== urlToRemove);
            urlInput.value = urls.join(', ');
            
            // Remove from preview
            const previews = previewContainer.querySelectorAll('img');
            previews.forEach(img => {
                const imgSrc = img.src;
                const url = imgSrc.includes(urlToRemove) ? urlToRemove : imgSrc;
                if (url === urlToRemove || imgSrc.endsWith(urlToRemove)) {
                    img.parentElement.remove();
                }
            });
            
            console.log('🗑️ Изображение удалено:', urlToRemove);
        }
        
        function openAddProductModal() {
            currentEditingId = null;
            document.getElementById('modal-title').textContent = 'Добавить товар';
            document.getElementById('product-id').value = '';
            document.getElementById('product-form').reset();
            document.getElementById('variants-container').innerHTML = ''; // Clear variants
            // Reset images field
            document.getElementById('product-images').value = '';
            document.getElementById('uploaded-images-preview').innerHTML = '';
            // Clear option names field
            document.getElementById('productOptionNames').value = '';
            loadCategories(); // Загружаем категории при открытии модального окна
            setupDiscountCalculator();
            document.getElementById('product-modal').classList.remove('hidden');
        }
        
        // --- VARIANTS MANAGEMENT ---
        function addVariant(size = '', price = '') {
            console.log('🔄 Adding variant with size:', size, 'price:', price);
            const container = document.getElementById('variants-container');
            const variantId = Date.now() + Math.random();
            
            const variantDiv = document.createElement('div');
            variantDiv.className = 'flex gap-2 items-center bg-gray-700 p-3 rounded-lg';
            variantDiv.id = `variant-${variantId}`;
            
            variantDiv.innerHTML = `
                <input type="text" 
                       class="flex-1 px-3 py-2 bg-gray-600 text-white rounded border border-gray-500 focus:outline-none focus:border-blue-500" 
                       placeholder="Размер/вес" 
                       value="${size}"
                       data-variant-size>
                <input type="number" 
                       class="w-32 px-3 py-2 bg-gray-600 text-white rounded border border-gray-500 focus:outline-none focus:border-blue-500" 
                       placeholder="Цена" 
                       value="${price}"
                       data-variant-price>
                <button type="button" 
                        onclick="removeVariant('${variantId}')" 
                        class="px-3 py-2 bg-red-600 text-white rounded hover:bg-red-500 transition">
                    🗑️
                </button>
            `;
            container.appendChild(variantDiv);
        }
        
        function removeVariant(variantId) {
            const variantDiv = document.getElementById(`variant-${variantId}`);
            if (variantDiv) {
                variantDiv.remove();
            } else {
                // Try alternative search method
                const allVariants = document.querySelectorAll('[id^="variant-"]');
                allVariants.forEach(element => {
                    if (element.id.includes(variantId)) {
                        element.remove();
                    }
                });
            }
        }
        
        function getVariants() {
            const container = document.getElementById('variants-container');
            const variants = [];
            const variantDivs = container.querySelectorAll('[id^="variant-"]');
            
            variantDivs.forEach(div => {
                const sizeInput = div.querySelector('[data-variant-size]');
                const priceInput = div.querySelector('[data-variant-price]');
                const size = sizeInput ? sizeInput.value.trim() : '';
                const price = priceInput ? parseFloat(priceInput.value) : 0;
                
                if (size && price > 0) {
                    variants.push({ size: size, price: price });
                }
            });
            
            return variants;
        }

        async function openEditProductModal(id) {
            try {
                const response = await fetch('/products');
                const products = await response.json();
                const product = products.find(p => p.id === id);
                
                if (!product) {
                    console.log('Товар не найден');
                    return;
                }
                
                currentEditingId = id;
                document.getElementById('modal-title').textContent = 'Редактировать товар';
                document.getElementById('product-id').value = id;
                const mainImgInput = document.getElementById('product-image-file');
                if (mainImgInput) mainImgInput.value = '';
                document.getElementById('product-name').value = product.name || '';
                document.getElementById('product-price').value = product.price || '';
                
                // Загружаем категории и затем устанавливаем значение
                await loadCategories();
                const categorySelect = document.getElementById('productCategory');
                if (categorySelect) {
                    categorySelect.value = product.category || '';
                }
                
                document.getElementById('product-images').value = product.images || (product.image ? product.image : '') || '';
                
                // Show preview of existing images
                const previewContainer = document.getElementById('uploaded-images-preview');
                previewContainer.innerHTML = '';
                if (product.images) {
                    const imageUrls = product.images.split(',').map(u => u.trim()).filter(u => u);
                    imageUrls.forEach(url => {
                        const previewUrl = url.startsWith('http') ? url : window.location.origin + url;
                        const previewDiv = document.createElement('div');
                        previewDiv.className = 'relative group';
                        previewDiv.innerHTML = `
                            <img src="${previewUrl}" class="w-full h-20 object-cover rounded border border-gray-600">
                            <button type="button" onclick="removeUploadedImage('${url}')" 
                                    class="absolute top-1 right-1 bg-red-500 text-white rounded-full w-5 h-5 text-xs opacity-0 group-hover:opacity-100 transition">
                                ×
                            </button>
                        `;
                        previewContainer.appendChild(previewDiv);
                    });
                }
                
                document.getElementById('product-description').value = product.description || '';
                document.getElementById('product-usage').value = product.usage || '';
                
                // Load new fields
                document.getElementById('product-delivery-info').value = product.delivery_info || '';
                document.getElementById('product-return-info').value = product.return_info || '';
                
                // Load variants
                const variantsContainer = document.getElementById('variants-container');
                variantsContainer.innerHTML = '';
                if (product.variants && Array.isArray(product.variants) && product.variants.length > 0) {
                    product.variants.forEach(variant => {
                        addVariant(variant.size || '', variant.price || '');
                    });
                }
                document.getElementById('product-usage').value = product.usage || '';
                document.getElementById('product-composition').value = product.composition || '';
                document.getElementById('product-old-price').value = product.old_price || '';
                document.getElementById('product-unit').value = product.unit || 'шт';
                document.getElementById('productOptionNames').value = product.option_names || '';
                
                // Setup discount calculator after loading product data
                setupDiscountCalculator();
                
                document.getElementById('product-modal').classList.remove('hidden');
            } catch (e) {
                console.error("Error loading product:", e);
            }
        }

        function closeProductModal() {
            document.getElementById('product-modal').classList.add('hidden');
            currentEditingId = null;
            // Clear variants container
            document.getElementById('variants-container').innerHTML = '';
        }

        // --- DISCOUNT CALCULATOR ---
        function calculateOldPriceFromDiscount() {
            console.log('🔄 Calculating old price from discount...');
            const priceInput = document.getElementById('product-price');
            const discountInput = document.getElementById('product-discount');
            const oldPriceInput = document.getElementById('product-old-price');
            
            const price = parseFloat(priceInput.value);
            const discount = parseFloat(discountInput.value);
            
            // Only calculate if both price and discount are valid numbers
            if (!isNaN(price) && price > 0 && !isNaN(discount) && discount > 0 && discount < 100) {
                // Formula: old_price = price / (1 - (discount / 100))
                const oldPrice = price / (1 - (discount / 100));
                oldPriceInput.value = oldPrice.toFixed(2);
            }
        }

        // Setup event listeners for discount calculation
        function setupDiscountCalculator() {
            const priceInput = document.getElementById('product-price');
            const discountInput = document.getElementById('product-discount');
            
            if (priceInput && discountInput) {
                priceInput.addEventListener('input', calculateOldPriceFromDiscount);
                priceInput.addEventListener('change', calculateOldPriceFromDiscount);
                discountInput.addEventListener('input', calculateOldPriceFromDiscount);
                discountInput.addEventListener('change', calculateOldPriceFromDiscount);
            }
        }

        // --- SAVE PRODUCT ---
        async function saveProduct(event) {
            event.preventDefault();
            
            // Build payload object with all fields
            const variants = getVariants();
            const usageValue = document.getElementById('product-usage').value.trim();
            
            // Smart Price Logic
            const priceInput = document.getElementById('product-price').value.trim();
            let finalPrice = null;
            
            if (priceInput === '') {
                // Цена пустая - проверяем варианты
                if (variants.length > 0) {
                    // Находим минимальную цену среди вариантов
                    finalPrice = Math.min(...variants.map(v => v.price));
                } else {
                    // Нет цены и нет вариантов - ошибка
                    alert('Вкажіть ціну або додайте варіанти');
                    return;
                }
            } else {
                // Цена указана - используем её
                finalPrice = parseFloat(priceInput);
            }
            
            const imageUrlFirst = document.getElementById('product-images').value ? document.getElementById('product-images').value.split(',')[0].trim() : '';
            const mainImageFileInput = document.getElementById('product-image-file');
            const useFormData = mainImageFileInput && mainImageFileInput.files && mainImageFileInput.files.length > 0;
            
            let response;
            try {
                if (useFormData) {
                    const formData = new FormData();
                    formData.append('name', document.getElementById('product-name').value);
                    formData.append('price', String(finalPrice));
                    formData.append('category', document.getElementById('productCategory').value || '');
                    formData.append('image', imageUrlFirst);
                    formData.append('images', document.getElementById('product-images').value.trim() || '');
                    formData.append('description', document.getElementById('product-description').value.trim() || '');
                    formData.append('usage', usageValue || '');
                    formData.append('composition', document.getElementById('product-composition').value.trim() || '');
                    formData.append('old_price', document.getElementById('product-old-price').value ? document.getElementById('product-old-price').value : '');
                    formData.append('unit', document.getElementById('product-unit').value || 'шт');
                    formData.append('variants', variants.length > 0 ? JSON.stringify(variants) : '');
                    formData.append('option_names', document.getElementById('productOptionNames').value.trim() || '');
                    formData.append('delivery_info', document.getElementById('product-delivery-info').value.trim() || '');
                    formData.append('return_info', document.getElementById('product-return-info').value.trim() || '');
                    formData.append('image_file', mainImageFileInput.files[0]);
                    if (currentEditingId) {
                        response = await fetch(`/products/${currentEditingId}`, { method: 'PUT', body: formData });
                    } else {
                        response = await fetch('/products', { method: 'POST', body: formData });
                    }
                } else {
                    const payload = {
                        name: document.getElementById('product-name').value,
                        price: finalPrice,
                        category: document.getElementById('productCategory').value || null,
                        image: imageUrlFirst,
                        images: document.getElementById('product-images').value.trim() || null,
                        description: document.getElementById('product-description').value.trim() || null,
                        usage: usageValue || null,
                        composition: document.getElementById('product-composition').value.trim() || null,
                        old_price: document.getElementById('product-old-price').value ? parseFloat(document.getElementById('product-old-price').value) : null,
                        unit: document.getElementById('product-unit').value || "шт",
                        pack_sizes: [],
                        variants: variants.length > 0 ? variants : null,
                        option_names: document.getElementById('productOptionNames').value.trim() || null,
                        delivery_info: document.getElementById('product-delivery-info').value.trim() || null,
                        return_info: document.getElementById('product-return-info').value.trim() || null
                    };
                    if (currentEditingId) {
                        response = await fetch(`/products/${currentEditingId}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(payload)
                        });
                    } else {
                        response = await fetch('/products', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(payload)
                        });
                    }
                }

                if (response.ok) {
                    closeProductModal();
                    loadProducts();
                    console.log('Товар успешно сохранен');
                } else {
                    const error = await response.json();
                    console.error('Ошибка: ' + (error.detail || 'Неизвестная ошибка'));
                }
            } catch (e) {
                console.error("Error saving product:", e);
            }
        }

        // --- TOGGLE SELECT ALL ---
        function toggleSelectAll(checked) {
            const checkboxes = document.querySelectorAll('.product-checkbox');
            checkboxes.forEach(checkbox => {
                checkbox.checked = checked;
            });
        }

        // --- DELETE PRODUCT ---
        async function deleteProduct(id) {
            try {
                const response = await fetch(`/products/${id}`, {
                    method: 'DELETE'
                });

                if (response.ok) {
                    loadProducts();
                } else {
                    const error = await response.json();
                    alert('❌ Ошибка удаления: ' + (error.detail || 'Неизвестная ошибка'));
                }
            } catch (e) {
                alert('❌ Ошибка сети при удалении товара');
            }
        }

        // --- DELETE SELECTED PRODUCTS ---
        function getSelectedProductIds() {
            const checkboxes = document.querySelectorAll('.product-checkbox:checked');
            return Array.from(checkboxes).map(cb => parseInt(cb.dataset.productId));
        }

        function handleDeleteSelected() {
            const selectedIds = getSelectedProductIds();
            if (selectedIds.length === 0) {
                alert('Выберите товары для удаления');
                return;
            }
            
            deleteSelectedProducts(selectedIds);
        }

        async function deleteSelectedProducts(ids) {
            try {
                // Delete products sequentially
                let successCount = 0;
                let errorCount = 0;

                for (const id of ids) {
                    try {
                        const response = await fetch(`/products/${id}`, {
                            method: 'DELETE'
                        });
                        if (response.ok) {
                            successCount++;
                        } else {
                            errorCount++;
                        }
                    } catch (e) {
                        errorCount++;
                    }
                }

                // Reset select all checkbox
                document.getElementById('select-all-checkbox').checked = false;
                
                // Reload products
                loadProducts();
                
                if (errorCount > 0) {
                    alert(`⚠️ Удалено: ${successCount}, Ошибок: ${errorCount}`);
                } else {
                    console.log(`✅ Успешно удалено товаров: ${successCount}`);
                }
            } catch (e) {
                alert('❌ Критическая ошибка при удалении товаров');
            }
        }

        // --- ORDER STATUS MODAL ---
        function openOrderStatusModal(orderId, currentStatus) {
            currentOrderId = orderId;
            const select = document.getElementById('order-status-select');
            select.value = currentStatus || 'Новый';
            document.getElementById('order-status-modal').classList.remove('hidden');
        }

        function closeOrderStatusModal() {
            document.getElementById('order-status-modal').classList.add('hidden');
            currentOrderId = null;
        }

        async function saveOrderStatus() {
            if (!currentOrderId) return;

            const select = document.getElementById('order-status-select');
            const newStatus = select.value;

            try {
                const response = await fetch(`/orders/${currentOrderId}/status`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ new_status: newStatus })
                });

                if (response.ok) {
                    closeOrderStatusModal();
                    loadOrders(); // Refresh the table
                } else {
                    const error = await response.json();
                    console.error('Ошибка: ' + (error.detail || 'Неизвестная ошибка'));
                }
            } catch (e) {
                console.error("Error updating order status:", e);
            }
        }

        // --- EXPORT ORDERS TO EXCEL ---
        async function exportOrders() {
            try {
                const response = await fetch('/orders/export');
                if (!response.ok) {
                    alert('Ошибка экспорта');
                    return;
                }
                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'orders.csv';
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                document.body.removeChild(a);
            } catch (e) {
                console.error("Error exporting orders:", e);
            }
        }

        // --- DELETE ORDER ---
        function confirmDeleteOrder(orderId) {
            if(confirm('Вы уверены, что хотите удалить этот заказ?')) {
                deleteOrder(orderId);
            }
        }

        async function deleteOrder(orderId) {
            try {
                const response = await fetch(`/orders/${orderId}`, {
                    method: 'DELETE'
                });

                if (response.ok) {
                    loadOrders();
                } else {
                    alert('Ошибка удаления заказа');
                }
            } catch (e) {
                alert('Ошибка при удалении заказа');
            }
        }

        // --- BATCH DELETE ORDERS ---
        function toggleSelectAllOrders(checked) {
            const checkboxes = document.querySelectorAll('.order-checkbox');
            checkboxes.forEach(checkbox => {
                checkbox.checked = checked;
            });
            updateDeleteButtonState();
        }

        function updateDeleteButtonState() {
            const deleteBtn = document.getElementById('delete-selected-orders-btn');
            const selectedIds = getSelectedOrderIds();
            if (selectedIds.length > 0) {
                deleteBtn.disabled = false;
            } else {
                deleteBtn.disabled = true;
            }
        }

        function getSelectedOrderIds() {
            const checkboxes = document.querySelectorAll('.order-checkbox:checked');
            return Array.from(checkboxes).map(cb => parseInt(cb.dataset.orderId));
        }

        async function deleteSelectedOrders() {
            const selectedIds = getSelectedOrderIds();
            if (selectedIds.length === 0) return;
            if (!confirm(`Вы уверены, что хотите удалить ${selectedIds.length} заказ(ов)?`)) return;
            
            try {
                const response = await fetch('/orders/delete-batch', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ids: selectedIds })
                });

                if (response.ok) {
                    loadOrders();
                    updateDeleteButtonState();
                } else {
                    alert('Ошибка удаления заказов');
                }
            } catch (e) {
                alert('Ошибка при удалении заказов');
            }
        }


        // --- UPLOAD CSV ---
        async function uploadCSV() {
            const fileInput = document.getElementById('csvFile');
            if (!fileInput.files[0]) {
                console.log("Пожалуйста, выберите CSV файл!");
                return;
            }

            const formData = new FormData();
            formData.append('file', fileInput.files[0]);

            try {
                const response = await fetch('/upload_csv', { method: 'POST', body: formData });
                const result = await response.json();
                
                if (response.ok) {
                    console.log(result.count ? `Успешно импортировано: ${result.count}` : "Импорт успешен!");
                    fileInput.value = '';
                    loadProducts();
                } else {
                    console.error("Ошибка импорта: " + (result.detail || "Неизвестная ошибка"));
                }
            } catch (e) {
                console.error("Error uploading CSV:", e);
            }
        }

        // --- CATEGORY MANAGEMENT ---
        async function loadCategories() {
            try {
                const response = await fetch('/all-categories');
                const categories = await response.json();
                const select = document.getElementById('productCategory');
                
                if (!select) return;
                const currentValue = select.value;
                select.innerHTML = '<option value="">Выберите категорию...</option>';
                
                categories.forEach(cat => {
                    const option = document.createElement('option');
                    option.value = cat.name;
                    option.textContent = cat.name;
                    select.appendChild(option);
                });
                
                if (currentValue) select.value = currentValue;
                
                // Update list in modal
                const list = document.getElementById('categoryList');
                if(list) {
                    list.innerHTML = '';
                    categories.forEach(cat => {
                        const li = document.createElement('li');
                        li.className = 'flex justify-between items-center p-3 bg-gray-700 rounded-lg mb-2';
                        li.innerHTML = `
                            <span class="text-white">${cat.name}</span>
                            <button onclick="deleteCategory(${cat.id})" class="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-500 transition">🗑️</button>
                        `;
                        list.appendChild(li);
                    });
                }
            } catch (e) {
                console.error("Error loading categories:", e);
            }
        }

        function openCategoryModal() {
            document.getElementById('categoryModal').classList.remove('hidden');
            loadCategories();
        }

        function closeCategoryModal() {
            document.getElementById('categoryModal').classList.add('hidden');
            document.getElementById('newCategoryName').value = '';
            loadCategories();
        }

        async function addCategory() {
            const input = document.getElementById('newCategoryName');
            const name = input.value.trim();
            if (!name) return;
            
            try {
                const formData = new FormData();
                formData.append('name', name);
                const response = await fetch('/categories', {
                    method: 'POST',
                    body: formData
                });
                if (response.ok) {
                    input.value = '';
                    loadCategories();
                }
            } catch (e) {}
        }

        async function deleteCategory(id) {
            if (!id) return;
            try {
                const response = await fetch(`/categories/${id}`, { method: 'DELETE' });
                if (response.ok) loadCategories();
            } catch (e) {}
        }

        // --- BANNER MANAGEMENT ---
        async function loadBanners() {
            try {
                const response = await fetch('/banners');
                const banners = await response.json();
                const container = document.getElementById('bannersList');
                
                if (!container) return;
                
                container.innerHTML = '';
                if (banners.length === 0) {
                    container.innerHTML = '<p class="text-gray-400 col-span-full">Баннеры не найдены</p>';
                    return;
                }
                
                banners.forEach(banner => {
                    const bannerDiv = document.createElement('div');
                    bannerDiv.className = 'bg-gray-700 rounded-lg p-4 border border-gray-600';
                    bannerDiv.innerHTML = `
                        <img src="${banner.image_url}" alt="Banner ${banner.id}" 
                             style="width: 200px; height: auto; border-radius: 8px; margin-bottom: 10px; object-fit: cover; max-height: 150px;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span class="text-gray-300 text-sm">ID: ${banner.id}</span>
                            <button onclick="deleteBanner(${banner.id})" 
                                    class="px-3 py-1 bg-red-600 text-white text-sm font-semibold rounded-lg hover:bg-red-500 transition">
                                🗑️ Удалить
                            </button>
                        </div>
                    `;
                    container.appendChild(bannerDiv);
                });
            } catch (e) { console.error(e); }
        }

        async function createBanner() {
            const fileInput = document.getElementById('bannerFile');
            const urlInput = document.getElementById('bannerUrl');
            let imageUrl = '';
            
            if (fileInput.files && fileInput.files.length > 0) {
                const file = fileInput.files[0];
                const reader = new FileReader();
                reader.onload = async function(e) {
                    imageUrl = e.target.result;
                    await sendBanner(imageUrl);
                };
                reader.readAsDataURL(file);
                return;
            } else if (urlInput.value.trim()) {
                imageUrl = urlInput.value.trim();
            } else {
                return;
            }
            
            await sendBanner(imageUrl);
        }
        
        async function sendBanner(imageUrl) {
            const fileInput = document.getElementById('bannerFile');
            const urlInput = document.getElementById('bannerUrl');
            try {
                const response = await fetch('/banners', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ image_url: imageUrl })
                });
                if (response.ok) {
                    fileInput.value = '';
                    urlInput.value = '';
                    await loadBanners();
                }
            } catch (e) {}
        }

        async function deleteBanner(id) {
            try {
                const response = await fetch(`/banners/${id}`, { method: 'DELETE' });
                if (response.ok) await loadBanners();
            } catch (e) {}
        }

        // --- PROMO CODES ---
        async function loadPromoCodes() {
            try {
                const response = await fetch('/api/promo-codes');
                const promos = await response.json();
                const tbody = document.getElementById('promocodes-table');
                tbody.innerHTML = '';
                
                promos.forEach(p => {
                    const tr = document.createElement('tr');
                    tr.className = 'hover:bg-gray-700/50 transition';
                    const activeClass = p.active ? 'text-green-400' : 'text-red-400';
                    const activeText = p.active ? 'Активен' : 'Отключен';
                    
                    tr.innerHTML = `
                        <td class="p-4 font-bold text-white">${p.code}</td>
                        <td class="p-4 text-green-400 font-bold">${p.discount_percent ? p.discount_percent + '%' : p.discount_amount + ' ₴'}</td>
                        <td class="p-4 text-gray-300">${p.max_uses || '∞'}</td>
                        <td class="p-4 text-gray-300">${p.current_uses}</td>
                        <td class="p-4 text-gray-300">${p.expires_at ? new Date(p.expires_at).toLocaleDateString() : '-'}</td>
                        <td class="p-4 ${activeClass}">${activeText}</td>
                        <td class="p-4">
                            <button onclick="togglePromo(${p.id})" class="text-blue-400 hover:text-blue-300 mr-2" title="Вкл/Выкл">🔄</button>
                            <button onclick="deletePromo(${p.id})" class="text-red-400 hover:text-red-300" title="Удалить">🗑️</button>
                        </td>
                    `;
                    tbody.appendChild(tr);
                });
            } catch (e) { console.error(e); }
        }

        function openAddPromoCodeModal() {
            document.getElementById('promoCodeModal').classList.remove('hidden');
        }

        function closePromoCodeModal() {
            document.getElementById('promoCodeModal').classList.add('hidden');
            document.getElementById('promo-code').value = '';
            document.getElementById('promo-percent').value = '0';
            document.getElementById('promo-amount').value = '0';
            document.getElementById('promo-max-uses').value = '0';
            document.getElementById('promo-expires').value = '';
        }

        async function createPromoCode(e) {
            e.preventDefault();
            const code = document.getElementById('promo-code').value.trim();
            const percent = parseInt(document.getElementById('promo-percent').value) || 0;
            const amount = parseFloat(document.getElementById('promo-amount').value) || 0;
            const maxUses = parseInt(document.getElementById('promo-max-uses').value) || 0;
            const expires = document.getElementById('promo-expires').value;
            
            if (!code) return;

            try {
                const response = await fetch('/api/promo-codes', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        code,
                        discount_percent: percent,
                        discount_amount: amount,
                        max_uses: maxUses,
                        expires_at: expires ? new Date(expires).toISOString() : null
                    })
                });
                
                if (response.ok) {
                    closePromoCodeModal();
                    loadPromoCodes();
                } else {
                    const err = await response.json();
                    alert('Ошибка: ' + err.detail);
                }
            } catch (e) { console.error(e); }
        }

        async function deletePromo(id) {
            if(!confirm('Удалить промокод?')) return;
            try {
                await fetch('/api/promo-codes/' + id, { method: 'DELETE' });
                loadPromoCodes();
            } catch (e) { console.error(e); }
        }

        async function togglePromo(id) {
            try {
                await fetch('/api/promo-codes/' + id + '/toggle', { method: 'PUT' });
                loadPromoCodes();
            } catch (e) { console.error(e); }
        }

        // Init
        console.log('🚀 Initializing admin panel...');
        loadOrders();
        loadCategories();
        loadBanners();
        loadBanners();
        setInterval(() => {
            loadOrders();
        }, 10000);
        console.log('✅ Admin script loaded successfully');
    </script>
</body>
</html>
"""

# --- НАСТРОЙКИ ---
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

load_dotenv()

# --- ПАПКИ ---
os.makedirs("uploads", exist_ok=True)

# --- БАЗА ДАННЫХ ---

def fix_db_schema():
    conn = get_db_connection()
    c = conn.cursor()

    # Tables (PostgreSQL)
    c.execute('''
        CREATE TABLE IF NOT EXISTS products (
            id BIGSERIAL PRIMARY KEY,
            name TEXT,
            price DOUBLE PRECISION,
            discount INTEGER DEFAULT 0,
            image TEXT,
            images TEXT,
            category TEXT,
            pack_sizes TEXT,
            old_price DOUBLE PRECISION,
            unit TEXT DEFAULT 'шт',
            description TEXT,
            usage TEXT,
            composition TEXT,
            delivery_info TEXT,
            return_info TEXT,
            variants TEXT,
            option_names TEXT,
            external_id TEXT UNIQUE,
            is_bestseller BOOLEAN DEFAULT FALSE,
            is_promotion BOOLEAN DEFAULT FALSE,
            is_new BOOLEAN DEFAULT FALSE,
            sku TEXT,
            status TEXT DEFAULT 'В наличии',
            remains INTEGER DEFAULT 0,
            parent_sku TEXT,
            variant_name TEXT
        )
    ''')

    c.execute('''
        CREATE TABLE IF NOT EXISTS users (
            phone TEXT PRIMARY KEY,
            bonus_balance INTEGER DEFAULT 0,
            total_spent DOUBLE PRECISION DEFAULT 0,
            cashback_percent INTEGER DEFAULT 0,
            referrer TEXT,
            created_at TEXT,
            name TEXT,
            city TEXT,
            warehouse TEXT,
            user_ukrposhta TEXT,
            email TEXT,
            contact_preference TEXT DEFAULT 'call',
            google_id TEXT UNIQUE,
            facebook_id TEXT UNIQUE,
            is_bonus_claimed BOOLEAN DEFAULT FALSE
        )
    ''')

    c.execute('''
        CREATE TABLE IF NOT EXISTS app_users (
            id BIGSERIAL PRIMARY KEY,
            telegram_id VARCHAR(64) UNIQUE,
            phone VARCHAR(50),
            name TEXT NOT NULL DEFAULT '',
            bonus_balance DOUBLE PRECISION DEFAULT 150
        )
    ''')

    c.execute('''
        CREATE TABLE IF NOT EXISTS orders (
            id BIGSERIAL PRIMARY KEY,
            name TEXT,
            phone TEXT,
            user_phone TEXT,
            email TEXT,
            contact_preference TEXT DEFAULT 'call',
            city TEXT,
            city_ref TEXT,
            warehouse TEXT,
            warehouse_ref TEXT,
            items TEXT,
            total_price DOUBLE PRECISION,
            payment_method TEXT DEFAULT 'card',
            bonus_used INTEGER DEFAULT 0,
            status TEXT DEFAULT 'New',
            date TEXT
        )
    ''')

    c.execute('''
        CREATE TABLE IF NOT EXISTS categories (
            id BIGSERIAL PRIMARY KEY,
            name TEXT UNIQUE,
            banner_url VARCHAR(255)
        )
    ''')

    c.execute('''CREATE TABLE IF NOT EXISTS category_banners (
        id BIGSERIAL PRIMARY KEY,
        category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
        image_url VARCHAR(255)
    )''')

    c.execute('''
        CREATE TABLE IF NOT EXISTS banners (
            id BIGSERIAL PRIMARY KEY,
            image_url TEXT
        )
    ''')

    c.execute('''
        CREATE TABLE IF NOT EXISTS promo_codes (
            id BIGSERIAL PRIMARY KEY,
            code TEXT UNIQUE NOT NULL,
            discount_percent INTEGER DEFAULT 0,
            discount_amount DOUBLE PRECISION DEFAULT 0,
            max_uses INTEGER DEFAULT 0,
            current_uses INTEGER DEFAULT 0,
            active INTEGER DEFAULT 1,
            expires_at TEXT,
            created_at TEXT
        )
    ''')

    c.execute('''
        CREATE TABLE IF NOT EXISTS reviews (
            id BIGSERIAL PRIMARY KEY,
            product_id BIGINT NOT NULL,
            user_name TEXT,
            user_phone TEXT,
            rating INTEGER NOT NULL,
            comment TEXT,
            created_at TEXT
        )
    ''')

    c.execute('''
        CREATE TABLE IF NOT EXISTS posts (
            id BIGSERIAL PRIMARY KEY,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            image_url TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    # Column migrations (idempotent in Postgres)
    c.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS composition TEXT")
    c.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS images TEXT")
    c.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS variants TEXT")
    c.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS option_names TEXT")
    c.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS delivery_info TEXT")
    c.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS return_info TEXT")
    c.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS external_id TEXT")
    c.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS is_bestseller BOOLEAN DEFAULT FALSE")
    c.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS is_promotion BOOLEAN DEFAULT FALSE")
    c.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS is_new BOOLEAN DEFAULT FALSE")
    c.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS discount INTEGER DEFAULT 0")
    c.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS is_manually_edited BOOLEAN DEFAULT FALSE")
    
    try:
        c.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS sku TEXT")
        c.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'В наличии'")
        c.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS remains INTEGER DEFAULT 0")
        c.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS parent_sku TEXT")
        c.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS variant_name TEXT")
    except Exception:
        pass
    try:
        c.execute("CREATE UNIQUE INDEX IF NOT EXISTS products_external_id_uq ON products (external_id)")
    except Exception:
        # If duplicates already exist, index creation may fail; keep server running.
        pass

    c.execute("ALTER TABLE categories ADD COLUMN IF NOT EXISTS banner_url VARCHAR(255)")
    c.execute("ALTER TABLE categories ADD COLUMN IF NOT EXISTS external_id TEXT")
    # User: Nova Poshta branch (warehouse) and Ukrposhta address
    c.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS user_ukrposhta TEXT")
    # Orders: delivery type and Ukrposhta address
    c.execute("ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_method TEXT")
    c.execute("ALTER TABLE orders ADD COLUMN IF NOT EXISTS user_ukrposhta TEXT")
    c.execute("ALTER TABLE orders ADD COLUMN IF NOT EXISTS push_token TEXT")
    # User: social ids and bonus protection
    c.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id TEXT")
    c.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS facebook_id TEXT")
    c.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_id TEXT")
    c.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_bonus_claimed BOOLEAN DEFAULT FALSE")
    c.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS push_token TEXT")
    c.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS welcome_push_sent BOOLEAN DEFAULT FALSE")
    try:
        c.execute("CREATE UNIQUE INDEX IF NOT EXISTS users_google_id_key ON users (google_id) WHERE google_id IS NOT NULL")
    except Exception:
        pass
    try:
        c.execute("CREATE UNIQUE INDEX IF NOT EXISTS users_facebook_id_key ON users (facebook_id) WHERE facebook_id IS NOT NULL")
    except Exception:
        pass
    try:
        c.execute("CREATE UNIQUE INDEX IF NOT EXISTS users_telegram_id_key ON users (telegram_id) WHERE telegram_id IS NOT NULL")
    except Exception:
        pass

    conn.commit()
    conn.close()


def init_db():
    """Инициализация БД (создание таблиц в т.ч. posts для блога). Вызывает fix_db_schema()."""
    fix_db_schema()


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
templates = Jinja2Templates(directory="templates")


@app.get("/api/clear_products")
async def clear_products_db():
    if os.getenv("ENABLE_DANGEROUS_ADMIN_ENDPOINTS") != "1":
        raise HTTPException(status_code=404, detail="Not found")

    from fastapi import HTTPException
    import traceback
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        # Добавили CASCADE!
        cur.execute("TRUNCATE TABLE products RESTART IDENTITY CASCADE;")
        conn.commit()
        conn.close()
        return {"success": True, "message": "База товаров ПОЛНОСТЬЮ очищена! Теперь можно нажать фиолетовую кнопку."}
    except Exception as e:
        print(f"Ошибка очистки БД: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Ошибка при очистке базы: {str(e)}")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)










app.mount("/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")


async def save_uploaded_image(file: UploadFile) -> str:
    """Save uploaded image to uploads/ with unique name. Returns relative path e.g. /uploads/uuid.jpg"""
    os.makedirs(UPLOADS_DIR, exist_ok=True)
    ext = os.path.splitext(file.filename or "")[1] or ".jpg"
    if ext.lower() not in (".jpg", ".jpeg", ".png", ".gif", ".webp"):
        ext = ".jpg"
    name = f"{uuid.uuid4().hex}{ext}"
    path = os.path.join(UPLOADS_DIR, name)
    content = await file.read()
    with open(path, "wb") as f:
        f.write(content)
    return f"/uploads/{name}"


# --- INITIALIZATION ---
# --- SYNC CONFIG ---
@app.on_event("startup")
def startup_event():
    fix_db_schema()
    # Создаем admin.html из строки только если его нет
    # Это позволяет вручную обновлять admin.html без перезаписи
    # if not os.path.exists("admin.html"):
    #     with open("admin.html", "w", encoding="utf-8") as f:
    #         f.write(ADMIN_HTML_CONTENT)
    print("✅ Server started successfully")

# --- ONEBOX ---


# --- API ENDPOINTS ---

@app.get("/user/{phone}", response_model=UserResponse)
def get_user_profile(phone: str):
    # Для соц. входу (google_*, fb_*, tg_*) не очищаем; для телефону — лише цифри
    raw = str(phone).strip()
    if raw.startswith("google_") or raw.startswith("fb_") or raw.startswith("tg_"):
        lookup_phone = raw
    else:
        lookup_phone = "".join(filter(str.isdigit, raw))
    conn = get_db_connection()
    user = conn.execute("SELECT * FROM users WHERE phone = ?", (lookup_phone,)).fetchone()
    conn.close()
    if user:
        user_dict = dict(user)
        stored_phone = user_dict.get('phone') or lookup_phone
        # Для соц. входу (google_*, fb_*, tg_*) не повертаємо технічний ідентифікатор як телефон — клієнт має запросити номер.
        display_phone = None if (stored_phone.startswith("google_") or stored_phone.startswith("fb_") or stored_phone.startswith("tg_")) else stored_phone
        # При віддачі профілю видаляємо префікси з відділень (для старих записів у БД)
        warehouse_display = user_dict.get('warehouse')
        if warehouse_display and isinstance(warehouse_display, str):
            warehouse_display = clean_warehouse_value(warehouse_display) or warehouse_display
        ukrposhta_display = user_dict.get('user_ukrposhta')
        if ukrposhta_display and isinstance(ukrposhta_display, str):
            ukrposhta_display = clean_warehouse_value(ukrposhta_display) or ukrposhta_display
        return UserResponse(
            phone=display_phone,
            bonus_balance=user_dict.get('bonus_balance', 0),
            total_spent=user_dict.get('total_spent', 0.0),
            cashback_percent=user_dict.get('cashback_percent', 0),
            name=user_dict.get('name'),
            city=user_dict.get('city'),
            warehouse=warehouse_display,
            ukrposhta=ukrposhta_display,
            email=user_dict.get('email'),
            contact_preference=user_dict.get('contact_preference'),
            referrer=user_dict.get('referrer'),
            created_at=user_dict.get('created_at')
        )
    raise HTTPException(status_code=404, detail="User not found")


@app.get("/api/user/me", response_model=UserResponse)
def get_api_user_me(phone: str = Depends(get_current_user_phone)):
    """Текущий пользователь по JWT (Bearer). Возвращает 401 если токен отсутствует или протух."""
    return get_user_profile(phone)

@app.post("/api/recalculate-cashback")
def recalculate_all_cashback():
    """
    Пересчитывает процент кешбэка для всех пользователей на основе их total_spent
    """
    conn = get_db_connection()
    cur = conn.cursor()
    
    users = cur.execute("SELECT phone, total_spent FROM users").fetchall()
    updated_count = 0
    
    for user in users:
        phone = user.get("phone")
        total_spent = user.get("total_spent") or 0
        cashback_percent = calculate_cashback_percent(total_spent)
        cur.execute("UPDATE users SET cashback_percent=? WHERE phone=?", (cashback_percent, phone))
        updated_count += 1
        print(f"📊 Updated {phone}: total_spent={total_spent} → cashback={cashback_percent}%")
    
    conn.commit()
    conn.close()
    
    return {
        "status": "ok", 
        "message": f"Updated cashback_percent for {updated_count} users"
    }

# 5. ПОЛЬЗОВАТЕЛИ
ALLOWED_USER_SORT_FIELDS = {"phone", "name", "city", "warehouse", "email", "contact_preference", "bonus_balance", "total_spent", "created_at"}

@app.get("/api/users")
def get_users(
    search: Optional[str] = None,
    has_bonuses: Optional[bool] = None,
    sort_by: Optional[str] = None,
    source: Optional[str] = None,
):
    """Список пользователей. Параметры: search, has_bonuses, sort_by, source (google|facebook). SELECT * возвращает google_id, facebook_id."""
    conn = get_db_connection()
    cur = conn.cursor()
    conditions = []
    params = []
    # Поиск по фразе "google" или "facebook" — фильтр по источнику
    search_trimmed = (search or "").strip()
    source_from_search = None
    search_for_like = search_trimmed
    if search_trimmed.lower() in ("google", "facebook"):
        source_from_search = search_trimmed.lower()
        search_for_like = None
    effective_source = (source or "").strip().lower() or source_from_search
    if effective_source == "google":
        conditions.append("(google_id IS NOT NULL AND google_id != '')")
    elif effective_source == "facebook":
        conditions.append("(facebook_id IS NOT NULL AND facebook_id != '')")
    if search_for_like:
        q = "%" + search_for_like + "%"
        conditions.append("(name ILIKE ? OR phone ILIKE ? OR email ILIKE ?)")
        params.extend([q, q, q])
    if has_bonuses is True:
        conditions.append("(bonus_balance IS NOT NULL AND bonus_balance > 0)")
    where_sql = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    order_field = "phone"
    if sort_by and sort_by.strip() in ALLOWED_USER_SORT_FIELDS:
        order_field = sort_by.strip()
    order_sql = f"ORDER BY {order_field} NULLS LAST"
    sql = f"SELECT * FROM users {where_sql} {order_sql}"
    rows = cur.execute(sql, tuple(params) if params else ()).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.get("/api/admin/users")
def get_admin_users(
    search: Optional[str] = None,
    has_bonuses: Optional[bool] = None,
    sort_by: Optional[str] = None,
    source: Optional[str] = None,
):
    """Тот же список, что и GET /api/users. Возвращает всех пользователей с полями google_id, facebook_id и остальными."""
    return get_users(search=search, has_bonuses=has_bonuses, sort_by=sort_by, source=source)


@app.get("/api/users/export")
def export_users(
    search: Optional[str] = None,
    has_bonuses: Optional[bool] = None,
    sort_by: Optional[str] = None,
    source: Optional[str] = None,
):
    """Экспорт списка клиентов в CSV с учётом фильтров search, has_bonuses, sort_by, source."""
    conn = get_db_connection()
    cur = conn.cursor()
    conditions = []
    params = []
    search_trimmed = (search or "").strip()
    source_from_search = None
    search_for_like = search_trimmed
    if search_trimmed.lower() in ("google", "facebook"):
        source_from_search = search_trimmed.lower()
        search_for_like = None
    effective_source = (source or "").strip().lower() or source_from_search
    if effective_source == "google":
        conditions.append("(google_id IS NOT NULL AND google_id != '')")
    elif effective_source == "facebook":
        conditions.append("(facebook_id IS NOT NULL AND facebook_id != '')")
    if search_for_like:
        q = "%" + search_for_like + "%"
        conditions.append("(name ILIKE ? OR phone ILIKE ? OR email ILIKE ?)")
        params.extend([q, q, q])
    if has_bonuses is True:
        conditions.append("(bonus_balance IS NOT NULL AND bonus_balance > 0)")
    where_sql = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    order_field = "phone"
    if sort_by and sort_by.strip() in ALLOWED_USER_SORT_FIELDS:
        order_field = sort_by.strip()
    order_sql = f"ORDER BY {order_field} NULLS LAST"
    sql = f"SELECT * FROM users {where_sql} {order_sql}"
    rows = cur.execute(sql, tuple(params) if params else ()).fetchall()
    conn.close()

    output = StringIO()
    output.write("\ufeff")  # BOM для UTF-8 в Excel
    writer = csv.writer(output)
    writer.writerow([
        "Телефон", "Имя", "Город", "Отделение НП", "Укрпошта", "Email", "Способ связи",
        "Баланс бонусов (₴)", "Всего потрачено (₴)", "Кешбэк %", "Дата регистрации"
    ])
    for r in rows:
        row = dict(r)
        total = row.get("total_spent") or 0
        level = 20 if total > 25000 else 15 if total > 10000 else 10 if total > 5000 else 5 if total > 2000 else 0
        writer.writerow([
            row.get("phone") or "",
            row.get("name") or "",
            row.get("city") or "",
            row.get("warehouse") or "",
            row.get("user_ukrposhta") or "",
            row.get("email") or "",
            row.get("contact_preference") or "call",
            row.get("bonus_balance") or 0,
            total,
            level,
            row.get("created_at") or "",
        ])
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=clients.csv"},
    )


@app.put("/api/users/{phone}")
def update_user(phone: str, u: AdminUserUpdate):
    """Обновление клиента админом: phone, name, city, warehouse, email, contact_preference, bonus_balance, total_spent."""
    clean_phone = normalize_phone(phone)
    if not clean_phone:
        raise HTTPException(status_code=400, detail="Invalid phone")
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT 1 FROM users WHERE phone = ?", (clean_phone,))
    if not cur.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="User not found")
    # Если передан новый телефон — меняем PK (сначала обновляем остальные поля, потом телефон)
    new_phone = None
    if u.phone is not None and str(u.phone).strip():
        new_phone = "".join(filter(str.isdigit, str(u.phone).strip()))
        if not new_phone:
            conn.close()
            raise HTTPException(status_code=400, detail="Invalid new phone number")
        if new_phone == clean_phone:
            new_phone = None
    update_fields = []
    update_values = []
    if u.name is not None:
        update_fields.append("name = ?")
        update_values.append(u.name)
    if u.city is not None:
        update_fields.append("city = ?")
        update_values.append(u.city)
    if u.warehouse is not None:
        update_fields.append("warehouse = ?")
        update_values.append(clean_warehouse_value(u.warehouse) or u.warehouse.strip())
    if getattr(u, 'user_ukrposhta', None) is not None:
        update_fields.append("user_ukrposhta = ?")
        update_values.append(clean_warehouse_value(u.user_ukrposhta) or u.user_ukrposhta.strip())
    if u.email is not None:
        update_fields.append("email = ?")
        update_values.append(u.email)
    if u.contact_preference is not None:
        update_fields.append("contact_preference = ?")
        update_values.append(u.contact_preference)
    if u.bonus_balance is not None:
        update_fields.append("bonus_balance = ?")
        update_values.append(u.bonus_balance)
    if u.total_spent is not None:
        update_fields.append("total_spent = ?")
        update_values.append(u.total_spent)
    if update_fields:
        update_values.append(clean_phone)
        cur.execute(
            f"UPDATE users SET {', '.join(update_fields)} WHERE phone = ?",
            tuple(update_values),
        )
        conn.commit()
    if new_phone:
        cur.execute("UPDATE users SET phone = ? WHERE phone = ?", (new_phone, clean_phone))
        conn.commit()
    conn.close()
    return {"status": "ok"}


@app.delete("/api/admin/user/{phone}")
def delete_admin_user(phone: str):
    """Удаление клиента из базы (админ)."""
    clean_phone = normalize_phone(phone)
    if not clean_phone:
        raise HTTPException(status_code=400, detail="Invalid phone")
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT 1 FROM users WHERE phone = ?", (clean_phone,))
    if not cur.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="User not found")
    cur.execute("DELETE FROM users WHERE phone = ?", (clean_phone,))
    conn.commit()
    conn.close()
    return {"status": "ok"}


@app.post("/api/admin/users/delete-batch")
def delete_users_batch(batch: BatchDeleteUsers):
    """Массовое удаление клиентов по списку телефонов."""
    if not batch.phones:
        return {"status": "ok", "deleted": 0}
    conn = get_db_connection()
    cur = conn.cursor()
    cleaned = [normalize_phone(p) for p in batch.phones if normalize_phone(p)]
    if not cleaned:
        conn.close()
        return {"status": "ok", "deleted": 0}
    placeholders = ",".join("?" for _ in cleaned)
    cur.execute(f"DELETE FROM users WHERE phone IN ({placeholders})", cleaned)
    conn.commit()
    conn.close()
    return {"status": "ok", "deleted": len(cleaned)}


@app.put("/api/user/info/{phone}")
def update_user_info(phone: str, info: UserInfoUpdate):
    """Оновлення профілю. phone у path може бути google_*/fb_* для соц. юзерів."""
    clean_phone = normalize_phone(phone)
    if not clean_phone:
        raise HTTPException(status_code=400, detail="Invalid user identifier")
    conn = get_db_connection()
    cur = conn.cursor()

    # Якщо клієнт передав новий телефон (для соц. юзера) — оновлюємо PK
    if info.phone is not None and info.phone.strip():
        new_phone = "".join(filter(str.isdigit, info.phone.strip()))
        if not new_phone:
            raise HTTPException(status_code=400, detail="Invalid phone number")
        cur.execute("SELECT 1 FROM users WHERE phone = ?", (clean_phone,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="User not found")
        cur.execute("UPDATE users SET phone = ? WHERE phone = ?", (new_phone, clean_phone))
        conn.commit()
        clean_phone = new_phone

    update_fields = []
    update_values = []
    
    if info.name is not None:
        update_fields.append("name = ?")
        update_values.append(info.name)
    
    if info.city is not None:
        update_fields.append("city = ?")
        update_values.append(info.city)
    
    if info.warehouse is not None:
        update_fields.append("warehouse = ?")
        update_values.append(clean_warehouse_value(info.warehouse) or info.warehouse.strip())
    
    if getattr(info, 'user_ukrposhta', None) is not None:
        update_fields.append("user_ukrposhta = ?")
        update_values.append(clean_warehouse_value(info.user_ukrposhta) or info.user_ukrposhta.strip())
    
    if info.email is not None:
        update_fields.append("email = ?")
        update_values.append(info.email)
    
    if info.contact_preference is not None:
        update_fields.append("contact_preference = ?")
        update_values.append(info.contact_preference)
    
    if update_fields:
        update_values.append(clean_phone)
        cur.execute(f"""
            UPDATE users 
            SET {', '.join(update_fields)}
            WHERE phone = ?
        """, tuple(update_values))
        conn.commit()
        print(f" Updated user info for {clean_phone}: email={info.email}, contact={info.contact_preference}")
    
    conn.close()
    return {"status": "ok"}


def _send_welcome_push_task(token: str) -> None:
    """Фонова задача: привітальний пуш після збереження токена."""
    send_expo_push(
        token,
        title="Вітаємо в DikorosUA! 🍄",
        body="Раді бачити вас! Тут ви знайдете найкращі лісові гриби та ягоди.",
    )


@app.post("/api/user/push-token")
def save_push_token(body: PushTokenRequest, background_tasks: BackgroundTasks):
    """Зберігає push-токен для користувача за auth_id. Привітальний пуш тільки якщо клієнт передав send_welcome=True (після sign_up) і ще не надсилався."""
    auth_id = (body.auth_id or "").strip()
    token = (body.token or "").strip()
    if not auth_id or not token:
        raise HTTPException(status_code=400, detail="auth_id and token are required")
    conn = get_db_connection()
    cur = conn.cursor()
    row = cur.execute("SELECT push_token, welcome_push_sent FROM users WHERE phone = ?", (auth_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="User not found")
    already_sent = bool(row.get("welcome_push_sent"))
    cur.execute("UPDATE users SET push_token = ? WHERE phone = ?", (token, auth_id))
    if body.send_welcome and not already_sent:
        cur.execute("UPDATE users SET welcome_push_sent = 1 WHERE phone = ?", (auth_id,))
        background_tasks.add_task(_send_welcome_push_task, token)
    conn.commit()
    conn.close()
    return {"status": "success"}


@app.post("/api/auth")
def auth_user(ua: UserAuth):
    """
    Вход или Регистрация по номеру телефона.
    Если юзера нет - создаем и даем 150 грн бонусов.
    """
    clean_phone = "".join(filter(str.isdigit, str(ua.phone)))
    if not clean_phone:
        raise HTTPException(status_code=400, detail="Invalid phone")

    conn = get_db_connection()
    user = conn.execute("SELECT * FROM users WHERE phone=?", (clean_phone,)).fetchone()
    
    if not user:
        # Pегистрация с бонусом 150 грн
        print(f"🆕 New user registration: {clean_phone}. Granting 150 bonus.")
        conn.execute("INSERT INTO users (phone, bonus_balance, total_spent, cashback_percent, created_at) VALUES (?, 150, 0, 0, ?)", (clean_phone, datetime.now().isoformat()))
        conn.commit()
        user = conn.execute("SELECT * FROM users WHERE phone=?", (clean_phone,)).fetchone()
    
    conn.close()
    return dict(user)


@app.get("/user/{identifier}")
def get_user_by_phone(identifier: str):
    """
    Поиск пользователя по номеру телефона.
    Ищет в таблице app_users.
    """
    conn = get_db_connection()
    c = conn.cursor()
    identifier = (identifier or "").strip()
    if not identifier:
        conn.close()
        raise HTTPException(status_code=400, detail="identifier is required")
    clean_phone = "".join(filter(str.isdigit, identifier))
    if not clean_phone:
        conn.close()
        raise HTTPException(status_code=400, detail="Invalid phone")
    row = c.execute(
        "SELECT id, telegram_id, phone, name, bonus_balance FROM app_users WHERE phone = ?",
        (clean_phone,),
    ).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    r = dict(row)
    r["auth_id"] = None  # поиск только по телефону
    return r


@app.post("/api/auth/social-login")
def auth_social_login(body: SocialAuthRequest):
    """
    Вход через Google або Facebook. Перевіряє токен (google-auth / graph.facebook.com),
    шукає юзера по google_id/facebook_id або по phone; якщо phone вказано і юзер існує — прив'язує social_id.
    Новий юзер отримує bonus_balance=150 та is_bonus_claimed=True. Повертає JWT та дані юзера.
    """
    provider = (body.provider or "").strip().lower()
    token = (body.token or "").strip()
    if not token or provider not in ("google", "facebook"):
        raise HTTPException(status_code=400, detail="Invalid provider or token")

    social_id = None
    email = None
    name_from_token = None

    # Допустимі Google Client ID: Web (для Android з IdToken) та Android (legacy)
    GOOGLE_WEB_CLIENT_ID = "451079322222-j59emqplkjkecod099fh759t2mmlr5jo.apps.googleusercontent.com"
    GOOGLE_ANDROID_CLIENT_ID = "451079322222-49sf5d8pc3kb2fr10022b5im58s21ao6.apps.googleusercontent.com"
    google_web_id = os.getenv("GOOGLE_CLIENT_ID")
    allowed_audiences = [a for a in [google_web_id, GOOGLE_WEB_CLIENT_ID, GOOGLE_ANDROID_CLIENT_ID] if a]

    if provider == "google":
        # Лише id_token (JWT). Implicit Flow — без обміну кода на токен.
        if token.count(".") != 2 or len(token) < 100:
            raise HTTPException(
                status_code=400,
                detail="Send Google id_token (JWT) from Implicit/ID Token flow",
            )
        try:
            decoded = id_token.verify_oauth2_token(
                token,
                google_requests.Request(),
                audience=allowed_audiences if allowed_audiences else None,
            )
        except Exception:
            raise HTTPException(status_code=401, detail="Invalid Google token")
        social_id = decoded.get("sub")
        email = (decoded.get("email") or "") if decoded else ""
        name_from_token = (decoded.get("name") or decoded.get("given_name") or "").strip() or None
        if not social_id:
            raise HTTPException(status_code=401, detail="Google token missing sub")
        phone_key = f"google_{social_id}"
    else:  # facebook
        r = requests.get(
            "https://graph.facebook.com/me",
            params={"fields": "id,email,name", "access_token": token},
            timeout=10,
        )
        if r.status_code != 200:
            raise HTTPException(status_code=401, detail="Invalid Facebook token")
        data = r.json()
        social_id = data.get("id")
        email = (data.get("email") or "") if data else ""
        name_from_token = (data.get("name") or "").strip() or None
        if not social_id:
            raise HTTPException(status_code=401, detail="Facebook token missing id")
        phone_key = f"fb_{social_id}"

    conn = get_db_connection()

    # 1) Шукаємо по social_id (google_id / facebook_id)
    if provider == "google":
        user = conn.execute(
            "SELECT * FROM users WHERE google_id = %s",
            (social_id,),
        ).fetchone()
    else:
        user = conn.execute(
            "SELECT * FROM users WHERE facebook_id = %s",
            (social_id,),
        ).fetchone()

    if user:
        user_dict = dict(user)
        conn.close()
        out = dict(user_dict)
        out["access_token"] = create_access_token(user_dict["phone"])
        # Якщо в БД збережено технічний ідентифікатор (google_*/fb_*) — не повертаємо його як телефон; клієнт має запросити номер.
        if (user_dict.get("phone") or "").startswith("google_") or (user_dict.get("phone") or "").startswith("fb_") or (user_dict.get("phone") or "").startswith("tg_"):
            out["phone"] = None
            out["needs_phone"] = True
            out["auth_id"] = user_dict["phone"]
        return out

    # 2) Якщо передано phone — шукаємо юзера по телефону і прив'язуємо social_id (без бонусу)
    if body.phone:
        clean_phone = "".join(filter(str.isdigit, str(body.phone)))
        if clean_phone:
            user_by_phone = conn.execute(
                "SELECT * FROM users WHERE phone = %s",
                (clean_phone,),
            ).fetchone()
            if user_by_phone:
                if provider == "google":
                    conn.execute(
                        "UPDATE users SET google_id = %s WHERE phone = %s",
                        (social_id, clean_phone),
                    )
                else:
                    conn.execute(
                        "UPDATE users SET facebook_id = %s WHERE phone = %s",
                        (social_id, clean_phone),
                    )
                conn.commit()
                user_by_phone = conn.execute(
                    "SELECT * FROM users WHERE phone = %s",
                    (clean_phone,),
                ).fetchone()
                conn.close()
                out = dict(user_by_phone)
                out["access_token"] = create_access_token(clean_phone)
                return out

    conn.close()
    conn = get_db_connection()

    # 3) Новий юзер: створюємо з бонусом 150 і is_bonus_claimed = True
    # Телефон не заповнюємо реальним номером (Google/FB його не дають) — зберігаємо технічний ідентифікатор для JWT/пошуку.
    # city, warehouse залишаємо порожніми (без дефолтів типу «м. Львів» / «Відділення №1»).
    bonus = 150
    conn.execute(
        """INSERT INTO users (
            phone, name, bonus_balance, total_spent, cashback_percent, created_at, email,
            google_id, facebook_id, is_bonus_claimed
        ) VALUES (%s, %s, %s, 0, 0, %s, %s, %s, %s, TRUE)""",
        (
            phone_key,
            name_from_token,
            bonus,
            datetime.now().isoformat(),
            email or None,
            social_id if provider == "google" else None,
            social_id if provider == "facebook" else None,
        ),
    )
    conn.commit()
    user = conn.execute("SELECT * FROM users WHERE phone = %s", (phone_key,)).fetchone()
    conn.close()
    if not user:
        raise HTTPException(status_code=500, detail="Failed to create user")
    out = dict(user)
    out["access_token"] = create_access_token(phone_key)
    # Новий соц. юзер — телефон не заповнювали; клієнт має запросити номер при першому вході.
    out["phone"] = None
    out["needs_phone"] = True
    out["auth_id"] = phone_key
    return out

@app.post("/upload_csv")
async def upload_csv(file: UploadFile = File(...)):
    # Заглушка для импорта CSV
    return {"count": 0, "message": "CSV Import not implemented yet"}

@app.get("/admin", response_class=HTMLResponse)
async def read_admin():
    """Admin panel with proper security headers"""
    base_dir = os.path.dirname(os.path.abspath(__file__))
    admin_path = os.path.join(base_dir, "admin.html")
    if os.path.exists(admin_path):
        with open(admin_path, "r", encoding="utf-8") as f:
            content = f.read()
    else:
        content = ADMIN_HTML_CONTENT
    
    return HTMLResponse(
        content=content,
        headers={
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0"
        }
    )

class AnalyticsEventReq(BaseModel):
    event_name: str
    properties: dict = {}
    user_data: dict = {}

@app.post("/api/track")
async def track_event_endpoint(evt: AnalyticsEventReq, background_tasks: BackgroundTasks):
    """Прокси для отправки событий аналитики с фронта"""
    background_tasks.add_task(track_analytics_event, evt.event_name, evt.properties, evt.user_data)
    return {"status": "ok"}

@app.post("/api/sync/catalog")
async def sync_catalog_horoshop(request: Request):
    import httpx, traceback, os
    from fastapi import HTTPException
    
    domain = os.getenv("HOROSHOP_DOMAIN")
    login = os.getenv("HOROSHOP_LOGIN")
    password = os.getenv("HOROSHOP_PASSWORD")
    
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        async with httpx.AsyncClient(timeout=120.0) as client:
            # 1. Авторизація (отримуємо токен)
            r_auth = await client.post(f"https://{domain}/api/auth/", json={"login": login, "password": password})
            auth_data = r_auth.json()
            
            token = auth_data.get("response", {}).get("token") or auth_data.get("token")
            if not token: 
                raise HTTPException(status_code=400, detail=f"Помилка авторизації: {auth_data}")
            
            # 2. Експорт товарів строго за документацією (POST-запит, токен у тілі)
            payload = {
                "token": token,
                "limit": 500  # Беремо до 500 товарів за один раз
            }
            
            r_export = await client.post(f"https://{domain}/api/catalog/export/", json=payload)
            export_data = r_export.json()
            
            if export_data.get("status") != "OK":
                raise HTTPException(status_code=400, detail=f"Хорошоп повернув помилку: {export_data}")
            
            products_list = export_data.get("response", {}).get("products", [])
            
            if not products_list:
                raise HTTPException(status_code=400, detail="API повернув пустий список товарів")
            
            count = 0
            for item in products_list:
                # Артикул
                sku = str(item.get("article") or item.get("parent_article") or "")
                if not sku: 
                    continue
                
                # Вариации
                parent_sku = str(item.get("parent_article") or "")
                mod_title_obj = item.get("mod_title") or {}
                variant_name = str(mod_title_obj.get("ua") or mod_title_obj.get("ru") or "")
                
                # Назва (пріоритет українській мові)
                title_obj = item.get("title") or {}
                title = title_obj.get("ua") or title_obj.get("ru") or "Без назви"
                
                # Опис
                desc_obj = item.get("description") or {}
                description = desc_obj.get("ua") or desc_obj.get("ru") or ""
                
                # Категорія
                parent_obj = item.get("parent") or {}
                category = parent_obj.get("value") or "Загальне"
                
                # Ціни
                try:
                    price = float(item.get("price") or 0)
                except:
                    price = 0.0

                try:
                    old_price = float(item.get("old_price") or 0)
                except:
                    old_price = 0.0
                    
                # Наявність
                status = "available"
                presence_obj = item.get("presence") or {}
                if presence_obj.get("id") == 2:  # 2 - "Немає в наявності" згідно з документацією
                    status = "out_of_stock"
                    
                # Картинки (забираємо першу для image, і всі для images)
                img_list = item.get("images") or []
                img = img_list[0] if img_list else ""
                images_str = ",".join(img_list) if img_list else ""

                # --- НОВАЯ ЛОГИКА ПАРСИНГА ИКОНОК ХОРОШОПА ---
                
                # 1. Извлекаем все тексты из массива icons (там лежат Хит, Новинка и т.д.)
                icons_data = item.get("icons", [])
                icon_texts = []
                for icon in icons_data:
                    val_obj = icon.get("value", {})
                    # Собираем значения (ua, ru, en) в один список для поиска
                    if isinstance(val_obj, dict):
                        icon_texts.extend([str(v).lower() for v in val_obj.values()])

                # 2. Определяем статусы (системные флаги + поиск по ключевым словам в иконках)
                is_hit = bool(
                    item.get("hit") == 1 or 
                    any("хит" in t or "хіт" in t for t in icon_texts)
                )

                is_new = bool(
                    item.get("new") == 1 or 
                    any("новинка" in t or "new" in t for t in icon_texts)
                )

                is_promotion = bool(
                    item.get("action") == 1 or 
                    (old_price > 0 and old_price > price) or
                    any("акці" in t or "распродажа" in t or "скидка" in t for t in icon_texts)
                )
                # ---------------------------------------------
                
                # Запис або оновлення у БД (за артикулом)
                cur.execute("SELECT id FROM products WHERE sku = ?", (sku,))
                exists = cur.fetchone()
                if exists:
                    p_id = exists['id'] if isinstance(exists, dict) else exists[0]
                    cur.execute("""
                        UPDATE products SET 
                            name = ?, price = ?, category = ?, status = ?, 
                            description = ?, image = ?, images = ?,
                            parent_sku = ?, variant_name = ?,
                            is_hit = ?, is_promotion = ?, is_new = ?, old_price = ?
                        WHERE id = ?
                    """, (title, price, category, status, description, img, images_str, parent_sku, variant_name, is_hit, is_promotion, is_new, old_price, p_id))
                else:
                    cur.execute("""
                        INSERT INTO products (sku, name, price, category, status, description, image, images, parent_sku, variant_name, is_hit, is_promotion, is_new, old_price)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (sku, title, price, category, status, description, img, images_str, parent_sku, variant_name, is_hit, is_promotion, is_new, old_price))
                count += 1
                
        conn.commit()
        conn.close()
        return {"success": True, "count": count, "message": f"Синхронізовано товарів: {count}"}
        
    except HTTPException as he:
        raise he
    except Exception as e:
        logger.error(f"❌ Horoshop Sync API Error: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Внутрішня помилка API: {str(e)}")
