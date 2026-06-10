import { API_URL } from '../config/api';

export const isLikelyCertificateImage = (path: string | null | undefined): boolean => {
  const u = String(path ?? '').trim().toLowerCase();
  if (!u) return false;
  const badTokens = [
    'sertifikat',
    'sertifik',
    'sertif',
    'сертифик',
    'сертиф',
    'certificate',
    'certificat',
    '/cert/',
    '_cert',
    '-cert',
    'deklar',
    'декларац',
    // более спорные токены оставляем в конце; но они часто встречаются в файлах сертификатов
    'gmp',
    'haccp',
    'iso',
  ];
  return badTokens.some(t => u.includes(t));
};

/**
 * Получает URL изображения
 * @param path - путь к изображению (может быть относительным или полным URL)
 * @param options - опции оптимизации для серверного /api/image
 */
export const getImageUrl = (
  path: string | null | undefined,
  options?: {
    width?: number;
    height?: number;
    quality?: number;
    format?: 'webp' | 'jpg' | 'png';
  }
): string => {
  // Если путь пустой, возвращаем заглушку
  const placeholder = 'https://via.placeholder.com/300';

  if (!path) return placeholder;

  let safePath = path.trim();
  if (!safePath) return placeholder;
  
  // Если это JSON массив в виде строки, парсим и берем первый элемент
  if (safePath.startsWith('[') && safePath.endsWith(']')) {
    try {
      const parsed = JSON.parse(safePath);
      if (Array.isArray(parsed) && parsed.length > 0) {
        safePath = String(parsed[0] ?? '').trim();
      }
    } catch {
      return placeholder;
    }
  }
  
  // Если это data URL (base64), возвращаем как есть
  if (!safePath) return placeholder;

  if (safePath.startsWith('data:')) {
    return safePath;
  }
  
  // Если это внешний URL, возвращаем как есть
  if (safePath.startsWith('http://') || safePath.startsWith('https://')) {
    return safePath;
  }
  
  // Для относительных путей: используем серверный оптимизатор /api/image
  // Это снижает размер и предотвращает OOM на Android при декодировании больших изображений.
  const cleanPath = safePath.startsWith('/') ? safePath.slice(1) : safePath;
  const baseUrl = API_URL.endsWith('/') ? API_URL.slice(0, -1) : API_URL;

  const w = options?.width ? Math.max(1, Math.round(options.width)) : undefined;
  const h = options?.height ? Math.max(1, Math.round(options.height)) : undefined;
  const q = options?.quality ? Math.max(30, Math.min(95, Math.round(options.quality))) : undefined;
  const fmt = (options?.format || '').toLowerCase();

  // Cache-bust version: bump when backend image pipeline changes.
  const v = String(process.env.EXPO_PUBLIC_IMAGE_URL_VERSION || '2').trim() || '2';

  const params = new URLSearchParams();
  params.set('src', `/${cleanPath}`);
  if (w) params.set('w', String(w));
  if (h) params.set('h', String(h));
  if (q) params.set('q', String(q));
  if (fmt) params.set('format', fmt);
  params.set('v', v);

  return `${baseUrl}/api/image?${params.toString()}`;
};
