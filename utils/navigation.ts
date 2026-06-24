export const HOME_ROUTE = '/(tabs)';
export const FAVORITES_ROUTE = '/(tabs)/favorites';
export const CART_ROUTE = '/(tabs)/cart';
export const PROFILE_ROUTE = '/(tabs)/profile';
export const ORDERS_ROUTE = '/(tabs)/orders';

export const normalizeNavigationPath = (pathname?: string | null) => {
  const raw = String(pathname || '/').split('?')[0].split('#')[0].trim();
  const withoutTrailingSlash = raw.length > 1 ? raw.replace(/\/+$/g, '') : raw;
  return withoutTrailingSlash || '/';
};

export const isHomeNavigationPath = (pathname?: string | null) => {
  const path = normalizeNavigationPath(pathname);
  return path === '/' || path === '/index' || path === '/(tabs)' || path === '/(tabs)/index';
};

export const isRootTabNavigationPath = (pathname?: string | null) => {
  const path = normalizeNavigationPath(pathname);
  return (
    isHomeNavigationPath(path) ||
    path === '/favorites' ||
    path === '/cart' ||
    path === '/profile' ||
    path === '/(tabs)/favorites' ||
    path === '/(tabs)/cart' ||
    path === '/(tabs)/profile'
  );
};

export const getNavigationFallbackRoute = (pathname?: string | null) => {
  const path = normalizeNavigationPath(pathname);

  if (isHomeNavigationPath(path)) return HOME_ROUTE;
  if (path === '/favorites' || path === '/(tabs)/favorites') return HOME_ROUTE;
  if (path === '/cart' || path === '/(tabs)/cart') return HOME_ROUTE;
  if (path === '/profile' || path === '/(tabs)/profile') return HOME_ROUTE;

  if (path.startsWith('/checkout')) return CART_ROUTE;
  if (path.startsWith('/product/')) return HOME_ROUTE;

  if (path === '/orders' || path === '/(tabs)/orders') return PROFILE_ROUTE;
  if (path.startsWith('/profile-')) return PROFILE_ROUTE;
  if (path.startsWith('/login')) return PROFILE_ROUTE;
  if (path.startsWith('/oauthredirect')) return PROFILE_ROUTE;

  if (path.startsWith('/news-detail')) return '/news';
  if (path.startsWith('/blog-detail')) return '/blog';
  if (path.startsWith('/news')) return HOME_ROUTE;
  if (path.startsWith('/blog')) return HOME_ROUTE;

  if (path.startsWith('/policies')) return PROFILE_ROUTE;
  if (path.startsWith('/about')) return PROFILE_ROUTE;

  return HOME_ROUTE;
};

export const safeBack = (router: any, pathname?: string | null, fallbackRoute?: any) => {
  const canGoBack = typeof router?.canGoBack === 'function' ? router.canGoBack() : false;

  if (canGoBack && typeof router?.back === 'function') {
    router.back();
    return;
  }

  const fallback = fallbackRoute || getNavigationFallbackRoute(pathname);
  if (typeof router?.replace === 'function') {
    router.replace(fallback as any);
  }
};

export const replaceRootTab = (router: any, route: any) => {
  if (typeof router?.replace === 'function') {
    router.replace(route as any);
  }
};
