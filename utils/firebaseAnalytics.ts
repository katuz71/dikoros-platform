import { getApps } from '@react-native-firebase/app';
import analytics from '@react-native-firebase/analytics';

/**
 * Helper to safely check if Firebase is initialized
 * Uses getApps() to match modular SDK and avoid deprecation warnings
 */
const isFirebaseReady = () => {
  try {
    const apps = getApps();
    return apps && apps.length > 0;
  } catch (e) {
    return false;
  }
};

const normalizeFirebaseParams = (params: any = {}) => {
  const normalized: Record<string, any> = {};

  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null) return;

    if (key === 'content_ids' && Array.isArray(value)) {
      normalized[key] = JSON.stringify(value.map((item) => String(item)).filter(Boolean));
      return;
    }

    normalized[key] = typeof value === 'boolean' ? (value ? 1 : 0) : value;
  });

  return normalized;
};

export const logFirebaseEvent = async (name: string, params: any = {}) => {
  try {
    if (!isFirebaseReady()) return;

    const normalizedParams = normalizeFirebaseParams(params);
    await analytics().logEvent(name, normalizedParams);
    console.log(`🔥 [Firebase] Event: ${name}`, normalizedParams);
  } catch (e) {
    console.log('[Firebase Log Error] (Are you using Dev Client?)', e);
  }
};

export const logFirebaseScreen = async (screenName: string) => {
  try {
    if (!isFirebaseReady()) return;

    await analytics().logScreenView({
      screen_name: screenName,
      screen_class: screenName,
    });
    console.log(`🔥 [Firebase] Screen: ${screenName}`);
  } catch (e) {
     console.log('[Firebase Screen Error]', e);
  }
};
