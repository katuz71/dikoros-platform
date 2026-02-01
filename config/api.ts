// Определяем API URL в зависимости от окружения
const getApiUrl = (): string => {
  // 1. Use environment override if set
  if (process.env.EXPO_PUBLIC_API_URL) {
    console.log('🔧 Using API URL from env:', process.env.EXPO_PUBLIC_API_URL);
    return process.env.EXPO_PUBLIC_API_URL;
  }

  // 2. Default to production URL
  const PROD_API_URL = 'https://app.dikoros.ua';
  console.log('🔧 Using production API URL:', PROD_API_URL);
  return PROD_API_URL;
};

export const API_URL = getApiUrl();

// 🔥 ВАЖНО: Эндпоинты исправлены под ваш main.py
export const API_ENDPOINTS = {
  products: '/products',          // Было верно
  categories: '/all-categories',  // ИСПРАВЛЕНО (в сервере /all-categories, а было /categories)
  createOrder: '/create_order',   // ИСПРАВЛЕНО (в сервере /create_order)
  userOrders: '/orders/user',     // ИСПРАВЛЕНО (для истории заказов)
  upload: '/upload',              // Было верно
  health: '/health',              // ИСПРАВЛЕНО (было /)
  admin: '/admin',                // Было верно
};