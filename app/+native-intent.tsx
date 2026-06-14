type RedirectSystemPathOptions = {
  path: string;
  initial: boolean;
};

export function redirectSystemPath({ path }: RedirectSystemPathOptions) {
  try {
    const rawPath = String(path || '');
    const parsedUrl = new URL(rawPath, 'dikoros://app');
    const lowerRawPath = rawPath.toLowerCase();
    const hostname = parsedUrl.hostname.toLowerCase();
    const pathname = parsedUrl.pathname.toLowerCase();

    if (
      lowerRawPath.includes('oauthredirect') ||
      hostname === 'oauthredirect' ||
      pathname.includes('oauthredirect')
    ) {
      const query = parsedUrl.search || (rawPath.includes('?') ? `?${rawPath.split('?').slice(1).join('?')}` : '');
      return `/oauthredirect${query}`;
    }

    return path;
  } catch {
    const rawPath = String(path || '');
    if (rawPath.toLowerCase().includes('oauthredirect')) {
      const query = rawPath.includes('?') ? `?${rawPath.split('?').slice(1).join('?')}` : '';
      return `/oauthredirect${query}`;
    }

    return path;
  }
}
