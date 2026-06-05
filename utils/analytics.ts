import { API_URL } from '@/config/api';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppEventsLogger } from 'react-native-fbsdk-next';

const META_EVENT_MAP: Record<string, string> = {
  CompleteRegistration: 'fb_mobile_complete_registration',
  complete_registration: 'fb_mobile_complete_registration',
  AddToCart: 'fb_mobile_add_to_cart',
  add_to_cart: 'fb_mobile_add_to_cart',
  InitiateCheckout: 'fb_mobile_initiated_checkout',
  initiate_checkout: 'fb_mobile_initiated_checkout',
  ViewContent: 'fb_mobile_content_view',
  view_content: 'fb_mobile_content_view',
  Search: 'fb_mobile_search',
  search: 'fb_mobile_search',
};

const logMetaEvent = (eventName: string, properties: any = {}) => {
  try {
    const normalizedEventName = String(eventName || '').trim();
    const lowerEventName = normalizedEventName.toLowerCase();
    const metaEventName = META_EVENT_MAP[normalizedEventName] || META_EVENT_MAP[lowerEventName] || normalizedEventName;

    const params: Record<string, string | number> = {};
    Object.entries(properties || {}).forEach(([key, value]) => {
      if (typeof value === 'string' || typeof value === 'number') {
        params[key] = value;
      } else if (typeof value === 'boolean') {
        params[key] = value ? 1 : 0;
      }
    });

    if (lowerEventName === 'purchase') {
      const value = typeof properties?.value === 'number' ? properties.value : 0;
      const currency = typeof properties?.currency === 'string' ? properties.currency : 'UAH';
      AppEventsLogger.logPurchase(value, currency, params);
      return;
    }

    AppEventsLogger.logEvent(metaEventName, params);
  } catch (e) {
    console.log('[Meta Analytics Error]', e);
  }
};

export const trackEvent = async (eventName: string, properties: any = {}) => {
  try {
    const phone = await AsyncStorage.getItem('userPhone');
    const user_data = {
      phone: phone || undefined,
      user_agent: 'Mobile App',
    };

    logMetaEvent(eventName, properties);
    
    // Fire and forget
    fetch(`${API_URL}/api/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_name: eventName,
        properties,
        user_data,
      }),
    }).catch(err => console.log('[Analytics Error]', err));
    
    console.log(`[Analytics] ${eventName}`, properties);
  } catch (e) {
    console.log('[Analytics] Error:', e);
  }
};