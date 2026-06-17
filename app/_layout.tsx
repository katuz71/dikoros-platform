import { FloatingChatButton } from '@/components/FloatingChatButton';
import { WelcomeBonusModal } from '@/components/WelcomeBonusModal';
import { API_URL } from '@/config/api';
import { logFirebaseScreen } from '@/utils/firebaseAnalytics';
import { tryRestoreBiometricSession } from '@/utils/biometricAuth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Stack, usePathname, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect } from 'react';
import { Linking, Platform, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { CartProvider } from '../context/CartContext';
import { OrdersProvider } from '../context/OrdersContext';

WebBrowser.maybeCompleteAuthSession();

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
  const router = useRouter();
  const showFloatingChat = !pathname?.endsWith('/chat');

  useEffect(() => {
    logFirebaseScreen(pathname || 'Root');
  }, [pathname]);

  useEffect(() => {
    registerForPushNotificationsAsync();
  }, []);

  useEffect(() => {
    let mounted = true;

    const restoreBiometric = async () => {
      const restored = await tryRestoreBiometricSession();
      if (mounted && restored) {
        router.replace('/(tabs)/profile' as any);
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
          <View style={{ flex: 1 }}>
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="product/[id]" options={{ headerShown: false }} />
              <Stack.Screen name="checkout" options={{ headerShown: false }} />
              <Stack.Screen name="news" options={{ headerShown: false }} />
              <Stack.Screen name="news-detail" options={{ headerShown: false }} />
              <Stack.Screen name="profile-info" options={{ headerShown: false }} />
              <Stack.Screen name="oauthredirect" options={{ headerShown: false }} />
            </Stack>
            {showFloatingChat && <FloatingChatButton bottomOffset={132} />}
            <WelcomeBonusModal />
          </View>
        </CartProvider>
      </OrdersProvider>
    </SafeAreaProvider>
  );
}
