import { AppFooter } from '@/components/AppFooter';
import { FloatingChatButton } from '@/components/FloatingChatButton';
import { GlobalSearchModal } from '@/components/GlobalSearchModal';
import { WelcomeBonusModal } from '@/components/WelcomeBonusModal';
import { API_URL } from '@/config/api';
import { logFirebaseScreen } from '@/utils/firebaseAnalytics';
import { GlobalSearchProvider } from '@/context/GlobalSearchContext';
import { AppFooterVisibilityProvider } from '@/context/AppFooterVisibilityContext';
import { tryRestoreBiometricSession } from '@/utils/biometricAuth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Stack, usePathname, useRouter, useSegments } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Linking, Platform, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { CartProvider } from '../context/CartContext';
import { OrdersProvider } from '../context/OrdersContext';

WebBrowser.maybeCompleteAuthSession();

const APP_FOOTER_ROUTES = new Set([
  '(tabs)',
  '(tabs)/index',
  '(tabs)/favorites',
  '(tabs)/cart',
  '(tabs)/profile',
  '(tabs)/orders',
  'product/[id]',
]);

const FLOATING_CHAT_HIDDEN_ROUTES = new Set([
  '(tabs)/chat',
  'checkout',
  'product/[id]',
  'news-detail',
  'blog-detail',
  'policies',
  'login',
  'oauthredirect',
]);

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

async function registerForPushNotificationsAsync() {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#458B00',
      });
    }

    if (!Device.isDevice) {
      console.log('Push notifications require a physical device');
      return null;
    }

    const existingStatus = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus.status;

    if (existingStatus.status !== 'granted') {
      const requestedStatus = await Notifications.requestPermissionsAsync();
      finalStatus = requestedStatus.status;
    }

    if (finalStatus !== 'granted') {
      console.log('Push notification permission not granted');
      return null;
    }

    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId: '66618f31-dc39-46f1-ba09-55c52d037f4a',
    });

    const token = tokenData.data;
    await AsyncStorage.setItem('expoPushToken', token);

    const accessToken = await AsyncStorage.getItem('accessToken');
    if (accessToken) {
      await fetch(`${API_URL}/api/user/push-token/me`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ token }),
      });
    }

    return token;
  } catch (error) {
    console.warn('Push registration failed:', error);
    return null;
  }
}

export default function Layout() {
  const pathname = usePathname();
  const segments = useSegments();
  const router = useRouter();
  const routeKey = segments.join('/');
  const navigationHistoryRef = useRef<string[]>([]);
  const isHistoryBackRef = useRef(false);
  const [productFooterVisible, setProductFooterVisible] = useState(true);
  const showAppFooter = APP_FOOTER_ROUTES.has(routeKey) && productFooterVisible;
  const showFloatingChat = !FLOATING_CHAT_HIDDEN_ROUTES.has(routeKey);
  const footerVisibilityValue = useMemo(() => ({
    productFooterVisible,
    setProductFooterVisible,
  }), [productFooterVisible]);

  useEffect(() => {
    setProductFooterVisible(true);
  }, [routeKey]);

  useEffect(() => {
    logFirebaseScreen(pathname || 'Root');
  }, [pathname]);

  // Track in-app pathname history for Android back.
  useEffect(() => {
    const currentPath = pathname || '/';

    if (isHistoryBackRef.current) {
      isHistoryBackRef.current = false;
      return;
    }

    const history = navigationHistoryRef.current;
    if (history[history.length - 1] !== currentPath) {
      history.push(currentPath);
      if (history.length > 25) {
        history.splice(0, history.length - 25);
      }
    }
  }, [pathname]);

  useEffect(() => {
    registerForPushNotificationsAsync();
  }, []);

  // Android system back: go to previous app screen, or stay if there is no history.
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      const history = navigationHistoryRef.current;
      const currentPath = pathname || '/';

      while (history.length > 0 && history[history.length - 1] === currentPath) {
        history.pop();
      }

      const previousPath = history.pop();

      if (previousPath) {
        isHistoryBackRef.current = true;
        router.replace(previousPath as any);
        return true;
      }

      if (history.length === 0) {
        navigationHistoryRef.current = [currentPath];
      }

      return true;
    });

    return () => subscription.remove();
  }, [pathname, router, routeKey]);

  useEffect(() => {
    let mounted = true;

    const restoreBiometric = async () => {
      const restored = await tryRestoreBiometricSession();
      if (mounted && restored) {
        router.replace('/(tabs)' as any);
      }
    };

    restoreBiometric();

    return () => {
      mounted = false;
    };
  }, [router]);

  useEffect(() => {
    const handleOAuthRedirect = (url?: string | null) => {
      if (!url || !url.toLowerCase().includes('oauthredirect')) return false;

      WebBrowser.maybeCompleteAuthSession();
      setTimeout(() => {
        router.replace('/(tabs)/profile' as any);
      }, 150);
      return true;
    };

    Linking.getInitialURL()
      .then(handleOAuthRedirect)
      .catch(() => {});

    const subscription = Linking.addEventListener('url', ({ url }) => {
      handleOAuthRedirect(url);
    });

    return () => subscription.remove();
  }, [router]);

  return (
    <SafeAreaProvider>
      <OrdersProvider>
        <CartProvider>
          <GlobalSearchProvider>
          <AppFooterVisibilityProvider value={footerVisibilityValue}>
          <View style={{ flex: 1 }}>
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="product/[id]" options={{ headerShown: false }} />
              <Stack.Screen name="checkout" options={{ headerShown: false }} />
              <Stack.Screen name="news" options={{ headerShown: false }} />
              <Stack.Screen name="news-detail" options={{ headerShown: false }} />
              <Stack.Screen name="blog" options={{ headerShown: false }} />
              <Stack.Screen name="blog-detail" options={{ headerShown: false }} />
              <Stack.Screen name="profile-info" options={{ headerShown: false }} />
              <Stack.Screen name="login" options={{ headerShown: false }} />
              <Stack.Screen name="profile-cashback" options={{ headerShown: false }} />
              <Stack.Screen name="profile-reviews" options={{ headerShown: false }} />
              <Stack.Screen name="policies" options={{ headerShown: false }} />
              <Stack.Screen name="about" options={{ headerShown: false }} />
              <Stack.Screen name="oauthredirect" options={{ headerShown: false }} />
            </Stack>
            {showFloatingChat && <FloatingChatButton bottomOffset={142} />}
            {showAppFooter && <AppFooter />}
            <GlobalSearchModal />
            <WelcomeBonusModal />
          </View>
          </AppFooterVisibilityProvider>
          </GlobalSearchProvider>
        </CartProvider>
      </OrdersProvider>
    </SafeAreaProvider>
  );
}

