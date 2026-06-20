// Определяем API URL в зависимости от окружения
const getApiUrl = (): string => {
  // 0. Явный override (удобно для Expo Go/dev)
  const ENV_API_URL = (process.env.EXPO_PUBLIC_API_URL || '').trim();
  if (ENV_API_URL) {
    const normalized = ENV_API_URL.endsWith('/') ? ENV_API_URL.slice(0, -1) : ENV_API_URL;
    console.log('🔧 Using API URL (env override):', normalized);
    return normalized;
  }

  // 1. IP вашего компьютера (тот, который сработал в браузере!)
  const LOCAL_API_URL = 'http://192.168.0.102:8001';
  
  // 2. Домен для продакшена
  const PROD_API_URL = 'https://app.dikoros.ua';

  // 2.5. Явный флаг для локального API (по умолчанию используем прод,
  // потому что в Expo Go часто нет локального бекенда).
  const useLocal = ['1', 'true', 'yes', 'on'].includes(
    String(process.env.EXPO_PUBLIC_USE_LOCAL || '').trim().toLowerCase()
  );

  // 3. Проверка окружения
  const isProduction = process.env.NODE_ENV === 'production' || 
                       process.env.EXPO_PUBLIC_ENVIRONMENT === 'production';
  
  const apiUrl = isProduction ? PROD_API_URL : (useLocal ? LOCAL_API_URL : PROD_API_URL);
  const normalized = apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl;
  
  console.log('🔧 Using API URL:', normalized); // Посмотрите в консоль, что здесь выводится
  return normalized;
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
  newsPage: '/api/pages/news',
  blogPage: '/api/pages/blog',
  blogDetail: '/api/pages/blog/detail',
  admin: '/admin',                // Было верно
};
