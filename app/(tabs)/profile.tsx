import { FloatingChatButton } from '@/components/FloatingChatButton';
import { API_URL } from '@/config/api';
import { trackEvent } from '@/utils/analytics';
import { logFirebaseEvent } from '@/utils/firebaseAnalytics';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useState , useEffect } from 'react';

import {
  Alert,
  Linking,
  Modal,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text, TextInput, TouchableOpacity,
  View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useRouter } from 'expo-router';

WebBrowser.maybeCompleteAuthSession();

// --- ТИПЫ ---
interface UserProfile {
  phone: string;
  bonus_balance: number;
  total_spent: number;
  cashback_percent: number;
  name?: string;
  city?: string;
  warehouse?: string;
  email?: string;
  contact_preference?: 'call' | 'telegram' | 'viber';
}

interface Order {
  id: number;
  totalPrice: number;
  status: string;
  date: string;
  items: any[];
}

export default function ProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Состояния
  const [phone, setPhone] = useState('');
  const [inputPhone, setInputPhone] = useState('');
  const [smsCode, setSmsCode] = useState('');
  const [smsSent, setSmsSent] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  // Info Modal States
  const [infoModalVisible, setInfoModalVisible] = useState(false);
  const [infoName, setInfoName] = useState('');
  const [infoCity, setInfoCity] = useState('');
  const [infoWarehouse, setInfoWarehouse] = useState(''); // 🔥 Модалка для таблицы
  const [infoEmail, setInfoEmail] = useState('');
  const [infoContactPreference, setInfoContactPreference] = useState<'call' | 'telegram' | 'viber'>('call');
  
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  
  // Reviews State
  const [userReviews, setUserReviews] = useState<any[]>([]);
  const [reviewsModalVisible, setReviewsModalVisible] = useState(false);
  const [googleAuthMode, setGoogleAuthMode] = useState<'login' | 'link'>('login');

  const [, googleResponse, promptGoogleLogin] = Google.useIdTokenAuthRequest({
    clientId: '451079322222-j59emqplkjkecod099fh759t2mmlr5jo.apps.googleusercontent.com',
    webClientId: '451079322222-j59emqplkjkecod099fh759t2mmlr5jo.apps.googleusercontent.com',
    androidClientId: '451079322222-49sf5d8pc3kb2fr10022b5im58s21ao6.apps.googleusercontent.com',
  });


  // 1. Проверка авторизации и обновление данных при фокусе
  useFocusEffect(
    useCallback(() => {
      checkLogin();
    }, [])
  );

  useEffect(() => {
    checkLogin();
  }, []);

  useEffect(() => {
    const idToken = googleResponse?.type === 'success'
      ? (googleResponse.params?.id_token || googleResponse.authentication?.idToken)
      : null;

    if (idToken) {
      if (googleAuthMode === 'link') {
        handleGoogleSocialLink(idToken);
      } else {
        handleGoogleSocialLogin(idToken);
      }
    }
  }, [googleResponse, googleAuthMode]);

  const canonicalizePhone = (value: string) => {
    const digits = (value || '').replace(/\D/g, '');
    if (digits.length >= 12 && digits.startsWith('380')) {
      return digits.slice(0, 12);
    }
    if (digits.length >= 11 && digits.startsWith('80')) {
      return `3${digits.slice(0, 11)}`;
    }
    if (digits.length >= 10 && digits.startsWith('0')) {
      return `38${digits.slice(0, 10)}`;
    }
    if (digits.length >= 9) {
      return `380${digits.slice(0, 9)}`;
    }
    return digits;
  };

  const formatPhoneInput = (value: string) => {
    const digits = (value || '').replace(/\D/g, '');
    let local = digits;

    if (digits.startsWith('380')) {
      local = digits.slice(3);
    } else if (digits.startsWith('80')) {
      local = digits.slice(2);
    } else if (digits.startsWith('0')) {
      local = digits.slice(1);
    }

    local = local.slice(0, 9);
    const parts = ['+380'];
    if (local.length > 0) parts.push(local.slice(0, 2));
    if (local.length > 2) parts.push(local.slice(2, 5));
    if (local.length > 5) parts.push(local.slice(5, 7));
    if (local.length > 7) parts.push(local.slice(7, 9));

    return parts.join(' ');
  };

  const checkLogin = async () => {
    const storedPhone = await AsyncStorage.getItem('userPhone');
    if (storedPhone) {
      const canon = canonicalizePhone(storedPhone);
      if (canon && canon !== storedPhone) {
        await AsyncStorage.setItem('userPhone', canon);
      }
      setPhone(canon);
      fetchData(canon);
    }
  };

  const fetchUserReviews = async () => {
    try {
        const accessToken = await AsyncStorage.getItem('accessToken');
        if (!accessToken) return;

        const res = await fetch(`${API_URL}/api/user/reviews/me`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (res.ok) {
            setUserReviews(await res.json());
        }
    } catch (e) { console.log(e); }
  };

  const deleteUserReview = async (id: number) => {
      Alert.alert('Видалити відгук?', 'Цю дію неможливо скасувати', [
          { text: 'Ні', style: 'cancel' },
          { text: 'Так', style: 'destructive', onPress: async () => {
              try {
                  const accessToken = await AsyncStorage.getItem('accessToken');
                  if (!accessToken) {
                    Alert.alert('Потрібен вхід', 'Увійдіть у профіль, щоб видалити відгук.');
                    return;
                  }

                  const res = await fetch(`${API_URL}/api/reviews/${id}`, {
                    method: 'DELETE',
                    headers: { Authorization: `Bearer ${accessToken}` },
                  });
                  if (res.ok) {
                      setUserReviews(prev => prev.filter(r => r.id !== id));
                      Alert.alert('Успіх', 'Відгук видалено');
                  }
              } catch (e) {
                  Alert.alert('Помилка', 'Не вдалося видалити відгук');
              }
          }}
      ]);
  };

  // 2. Загрузка данных
  const fetchData = async (phoneNumber: string) => {
    setLoading(true);
    try {
      const accessToken = await AsyncStorage.getItem('accessToken');

      if (!accessToken) {
        setProfile(null);
        setOrders([]);
        return;
      }

      const resUser = await fetch(`${API_URL}/api/user/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (resUser.ok) setProfile(await resUser.json());

      const resOrders = await fetch(`${API_URL}/api/client/orders/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (resOrders.ok) setOrders(await resOrders.json());

      fetchUserReviews();
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // 3. Логика входа / выхода
  const attachPushToken = async () => {
    try {
      const accessToken = await AsyncStorage.getItem('accessToken');
      const expoPushToken = await AsyncStorage.getItem('expoPushToken');

      if (accessToken && expoPushToken) {
        await fetch(`${API_URL}/api/user/push-token/me`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            token: expoPushToken,
          }),
        });
      }
    } catch (e) {
      console.warn('Save push token after login failed:', e);
    }
  };

  const handleSendSmsCode = async () => {
    const canon = canonicalizePhone(inputPhone);

    if (canon.length !== 12 || !canon.startsWith('380')) {
      Alert.alert('\u041f\u043e\u043c\u0438\u043b\u043a\u0430', '\u0412\u0432\u0435\u0434\u0456\u0442\u044c \u043d\u043e\u043c\u0435\u0440 \u0443 \u0444\u043e\u0440\u043c\u0430\u0442\u0456 +380 XX XXX XX XX');
      return;
    }
    setInputPhone(formatPhoneInput(canon));

    try {
      const res = await fetch(`${API_URL}/api/auth/sms/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: canon })
      });

      if (res.ok) {
        setSmsSent(true);
        setSmsCode('');
        Alert.alert('\u041a\u043e\u0434 \u0432\u0456\u0434\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u043e', '\u0412\u0432\u0435\u0434\u0456\u0442\u044c SMS-\u043a\u043e\u0434 \u0434\u043b\u044f \u0432\u0445\u043e\u0434\u0443\u002e');
      } else {
        Alert.alert('\u041f\u043e\u043c\u0438\u043b\u043a\u0430', '\u041d\u0435 \u0432\u0434\u0430\u043b\u043e\u0441\u044f \u0432\u0456\u0434\u043f\u0440\u0430\u0432\u0438\u0442\u0438 SMS-\u043a\u043e\u0434');
      }
    } catch (error) {
      console.error(error);
      Alert.alert('\u041f\u043e\u043c\u0438\u043b\u043a\u0430', '\u041d\u0435\u043c\u0430\u0454 \u0437\u0027\u0454\u0434\u043d\u0430\u043d\u043d\u044f');
    }
  };

  const handleLogin = async () => {
    const canon = canonicalizePhone(inputPhone);

    if (canon.length !== 12 || !canon.startsWith('380')) {
      Alert.alert('\u041f\u043e\u043c\u0438\u043b\u043a\u0430', '\u0412\u0432\u0435\u0434\u0456\u0442\u044c \u043d\u043e\u043c\u0435\u0440 \u0443 \u0444\u043e\u0440\u043c\u0430\u0442\u0456 +380 XX XXX XX XX');
      return;
    }

    if (!smsSent) {
      await handleSendSmsCode();
      return;
    }

    const cleanSmsCode = smsCode.replace(/\D/g, '');

    if (cleanSmsCode.length !== 6) {
      Alert.alert('\u041f\u043e\u043c\u0438\u043b\u043a\u0430', '\u0412\u0432\u0435\u0434\u0456\u0442\u044c SMS-\u043a\u043e\u0434');
      return;
    }

    try {
      const res = await fetch(`${API_URL}/api/auth/sms/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: canon,
          code: cleanSmsCode
        })
      });

      if (res.ok) {
        const user = await res.json();

        await AsyncStorage.setItem('userPhone', canon);
        if (user.access_token) {
          await AsyncStorage.setItem('accessToken', user.access_token);
        }

        await attachPushToken();

        if (user.is_new_user) {
          trackEvent('CompleteRegistration', {
            method: 'sms',
            value: 150,
            currency: 'UAH',
          });

          logFirebaseEvent('sign_up', {
            method: 'sms',
          });
        }

        if (user.name) {
          await AsyncStorage.setItem('userName', user.name);
        }

        setPhone(canon);
        setProfile(user);
        setShowLoginModal(false);
        setSmsSent(false);
        setSmsCode('');
        fetchData(canon);
      } else {
        const err = await res.json().catch(() => null);
        Alert.alert('\u041f\u043e\u043c\u0438\u043b\u043a\u0430', err?.detail || '\u041d\u0435\u0432\u0456\u0440\u043d\u0438\u0439 SMS-\u043a\u043e\u0434');
      }
    } catch (error) {
      console.error(error);
      Alert.alert('\u041f\u043e\u043c\u0438\u043b\u043a\u0430', '\u041d\u0435\u043c\u0430\u0454 \u0437\u0027\u0454\u0434\u043d\u0430\u043d\u043d\u044f');
    }
  };

  const handleGoogleSocialLogin = async (idToken: string) => {
    try {
      const res = await fetch(`${API_URL}/api/auth/social-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'google',
          token: idToken,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);

        if (res.status === 409) {
          setSmsSent(false);
          setSmsCode('');
          Alert.alert(
            '\u041f\u043e\u0442\u0440\u0456\u0431\u0435\u043d SMS-\u0432\u0445\u0456\u0434',
            '\u0421\u043f\u043e\u0447\u0430\u0442\u043a\u0443 \u0443\u0432\u0456\u0439\u0434\u0456\u0442\u044c \u0430\u0431\u043e \u0437\u0430\u0440\u0435\u0454\u0441\u0442\u0440\u0443\u0439\u0442\u0435\u0441\u044c \u0437\u0430 \u043d\u043e\u043c\u0435\u0440\u043e\u043c \u0442\u0435\u043b\u0435\u0444\u043e\u043d\u0443 \u0447\u0435\u0440\u0435\u0437 SMS. \u041f\u0456\u0441\u043b\u044f \u0446\u044c\u043e\u0433\u043e Google-\u0432\u0445\u0456\u0434 \u043c\u043e\u0436\u043d\u0430 \u0431\u0443\u0434\u0435 \u043f\u0440\u0438\u0432\u2019\u044f\u0437\u0430\u0442\u0438 \u0434\u043e \u0430\u043a\u0430\u0443\u043d\u0442\u0430.',
            [{ text: '\u0423\u0432\u0456\u0439\u0442\u0438 \u0447\u0435\u0440\u0435\u0437 SMS' }]
          );
          return;
        }

        Alert.alert('\u041f\u043e\u043c\u0438\u043b\u043a\u0430', err?.detail || '\u041d\u0435 \u0432\u0434\u0430\u043b\u043e\u0441\u044f \u0443\u0432\u0456\u0439\u0442\u0438 \u0447\u0435\u0440\u0435\u0437 Google');
        return;
      }

      const user = await res.json();
      const authId = user.auth_id || user.phone;

      if (authId) {
        await AsyncStorage.setItem('userPhone', authId);
        setPhone(authId);
      }

      if (user.access_token) {
        await AsyncStorage.setItem('accessToken', user.access_token);
      }

      await attachPushToken();

      if (user.name) {
        await AsyncStorage.setItem('userName', user.name);
      }

      if (user.is_new_user) {
        trackEvent('CompleteRegistration', {
          method: 'google',
          value: 150,
          currency: 'UAH',
        });

        logFirebaseEvent('sign_up', {
          method: 'google',
        });
      }

      setProfile(user);
      setGoogleAuthMode('login');
      setShowLoginModal(false);
      setSmsSent(false);
      setSmsCode('');

      if (authId) {
        fetchData(authId);
      }
    } catch (error) {
      console.error(error);
      Alert.alert('\u041f\u043e\u043c\u0438\u043b\u043a\u0430', '\u041d\u0435\u043c\u0430\u0454 \u0437\u0027\u0454\u0434\u043d\u0430\u043d\u043d\u044f');
    }
  };


  const handleGoogleLinkStart = async () => {
    const accessToken = await AsyncStorage.getItem('accessToken');
    const storedPhone = await AsyncStorage.getItem('userPhone');

    if (!accessToken || !storedPhone) {
      Alert.alert(
        'Потрібен SMS-вхід',
        'Спочатку увійдіть за номером телефону через SMS, потім прив’яжіть Google.'
      );
      setShowLoginModal(true);
      return;
    }

    setGoogleAuthMode('link');
    promptGoogleLogin();
  };

  const handleGoogleSocialLink = async (idToken: string) => {
    try {
      const accessToken = await AsyncStorage.getItem('accessToken');

      if (!accessToken) {
        setGoogleAuthMode('login');
        Alert.alert('Потрібен SMS-вхід', 'Увійдіть через SMS перед прив’язкою Google.');
        return;
      }

      const res = await fetch(`${API_URL}/api/auth/social-link`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          provider: 'google',
          token: idToken,
        }),
      });

      const result = await res.json().catch(() => null);

      if (!res.ok) {
        Alert.alert('Помилка', result?.detail || 'Не вдалося прив’язати Google');
        return;
      }

      const authId = result.auth_id || result.phone || phone;
      if (authId) {
        await AsyncStorage.setItem('userPhone', authId);
        setPhone(authId);
        fetchData(authId);
      }

      if (result.access_token) {
        await AsyncStorage.setItem('accessToken', result.access_token);
      }

      setProfile(result);
      Alert.alert('Готово', 'Google успішно прив’язано до вашого акаунта.');
    } catch (error) {
      console.error(error);
      Alert.alert('Помилка', 'Немає з’єднання');
    } finally {
      setGoogleAuthMode('login');
    }
  };


  const handleDeleteAccount = async () => {
    Alert.alert(
      'Видалити акаунт?',
      'Профіль, бонуси, прив’язки входу та ваші відгуки буде видалено. Історія замовлень буде знеособлена.',
      [
        { text: 'Скасувати', style: 'cancel' },
        {
          text: 'Видалити',
          style: 'destructive',
          onPress: async () => {
            try {
              const accessToken = await AsyncStorage.getItem('accessToken');

              if (!accessToken) {
                Alert.alert('Потрібен вхід', 'Увійдіть у профіль, щоб видалити акаунт.');
                return;
              }

              const res = await fetch(`${API_URL}/api/user/me`, {
                method: 'DELETE',
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                },
              });

              const result = await res.json().catch(() => null);

              if (!res.ok) {
                Alert.alert('Помилка', result?.detail || 'Не вдалося видалити акаунт');
                return;
              }

              await AsyncStorage.multiRemove([
                'accessToken',
                'userPhone',
                'userName',
                'savedCheckoutInfo',
              ]);

              setProfile(null);
              setPhone('');
              setInputPhone('');
              setSmsCode('');
              setSmsSent(false);
              setGoogleAuthMode('login');
              setShowLoginModal(false);

              Alert.alert('Акаунт видалено', 'Ваш акаунт успішно видалено.');
            } catch (error) {
              console.error(error);
              Alert.alert('Помилка', 'Немає з’єднання');
            }
          },
        },
      ]
    );
  };

  const handleLogout = async () => {
    Alert.alert('Вихід', 'Ви впевнені?', [
      { text: 'Ні', style: 'cancel' },
      { 
        text: 'Так', 
        style: 'destructive', 
        onPress: async () => {
          await AsyncStorage.removeItem('userPhone');
          await AsyncStorage.removeItem('userName');
          await AsyncStorage.removeItem('accessToken');
          setPhone('');
          setProfile(null);
          setOrders([]);
          setInputPhone('');
        } 
      }
    ]);
  };

  /* 🔥 UPDATE USER INFO */
  const openInfoModal = () => {
    if (!profile) {
      Alert.alert('Увага', 'Спочатку увійдіть в акаунт');
      return;
    }
    setInfoName(profile.name || '');
    setInfoCity(profile.city || '');
    setInfoWarehouse(profile.warehouse || '');
    setInfoEmail(profile.email || '');
    setInfoContactPreference(profile.contact_preference || 'call');
    setInfoModalVisible(true);
  };

  const saveUserInfo = async () => {
    try {
      const accessToken = await AsyncStorage.getItem('accessToken');

      if (!accessToken) {
        Alert.alert('Потрібен вхід', 'Увійдіть у профіль, щоб зберегти дані.');
        return;
      }

      const res = await fetch(`${API_URL}/api/user/info/me`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
            name: infoName,
            city: infoCity,
            warehouse: infoWarehouse,
            email: infoEmail,
            contact_preference: infoContactPreference
        })
      });

      if (res.ok && profile) {
        setProfile({ ...profile, name: infoName, city: infoCity, warehouse: infoWarehouse, email: infoEmail, contact_preference: infoContactPreference });
        await AsyncStorage.setItem('userName', infoName);
        
        // Зберігаємо дані для автозаповнення при оформленні замовлення
        await AsyncStorage.setItem('savedCheckoutInfo', JSON.stringify({ 
          name: infoName, 
          email: infoEmail,
          city: infoCity ? { ref: '', name: infoCity } : { ref: '', name: '' },
          warehouse: infoWarehouse ? { ref: '', name: infoWarehouse } : { ref: '', name: '' },
          contact_preference: infoContactPreference
        }));
        
        setInfoModalVisible(false);
        Alert.alert('Успіх', 'Дані оновлено');
      } else {
        Alert.alert('Помилка', 'Не вдалося зберегти дані');
      }
    } catch (e) {
      console.error(e);
      Alert.alert('Помилка', 'Немає з\'єднання');
    }
  };

  const onRefresh = React.useCallback(() => {
    setRefreshing(true);
    if (phone) fetchData(phone);
    else setTimeout(() => setRefreshing(false), 1000);
  }, [phone]);

  // 4. Реферальная ссылка
  const handleShare = async () => {
    try {
      const accessToken = await AsyncStorage.getItem('accessToken');

      if (!accessToken) {
        Alert.alert('Потрібен вхід', 'Увійдіть у профіль, щоб запросити друга.');
        setShowLoginModal(true);
        return;
      }

      const res = await fetch(`${API_URL}/api/referral/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const referral = await res.json().catch(() => null);

      if (!res.ok || !referral?.web_link) {
        throw new Error(referral?.detail || 'Referral link unavailable');
      }

      await Share.share({
        message: referral.message || `Запрошую тебе в DikorosUA 🍄\nЗа реєстрацію отримаєш 150 грн бонусами.\nМоє реферальне посилання: ${referral.web_link}`,
        url: referral.web_link,
        title: 'Запрошення в DikorosUA',
      });
    } catch (error) {
      console.log(error?.message || error);
      Alert.alert('Помилка', 'Не вдалося створити реферальне посилання. Спробуйте ще раз.');
    }
  };

  const openLink = (url: string) => Linking.openURL(url).catch(() => {});
  const openPolicy = (page: string) => router.push({ pathname: '/policies', params: { page } } as any);

  // === Вспомогательные компоненты ===
  
  const GridBtn = ({ icon, label, onPress, color = "#4CAF50" }: any) => (
    <TouchableOpacity style={styles.gridItem} onPress={onPress}>
      <Ionicons name={icon} size={28} color={color} />
      <Text style={styles.gridText}>{label}</Text>
    </TouchableOpacity>
  );

  const MenuItem = ({ label, isLast = false, onPress, color = '#333' }: any) => (
    <View>
      <TouchableOpacity style={styles.menuItem} onPress={onPress}>
        <Text style={[styles.menuItemText, { color }]}>{label}</Text>
        <Ionicons name="chevron-forward" size={20} color="#CCC" />
      </TouchableOpacity>
      {!isLast && <View style={styles.divider} />}
    </View>
  );

  const MenuSection = ({ title, children }: any) => (
    <View style={styles.menuSection}>
      {title && <Text style={styles.sectionHeader}>{title}</Text>}
      <View style={styles.menuList}>
        {children}
      </View>
    </View>
  );

  // === ОБЩИЙ КОНТЕНТ ===
  const renderCommonMenu = () => (
    <>
      {/* СЕТКА БЫСТРЫХ ДЕЙСТВИЙ */}
      <View style={styles.gridContainer}>
        <GridBtn icon="receipt-outline" label="Замовлення" onPress={() => router.push('/(tabs)/orders')} />
        <GridBtn icon="chatbubble-ellipses-outline" label="Підтримка" onPress={() => openLink('https://t.me/dikoros_support')} />
        <GridBtn icon="heart-outline" label="Мої списки" onPress={() => router.push('/(tabs)/favorites')} />
        <GridBtn icon="mail-outline" label="Повідомлення" onPress={() => Alert.alert('Повідомлення', 'Поки немає нових повідомлень')} />
        <GridBtn icon="person-outline" label="Інформація" onPress={openInfoModal} />
        <GridBtn icon="globe-outline" label="UA | UAH" onPress={() => Alert.alert('Мова та валюта', 'Зараз доступно: UA / UAH')} />
      </View>

      {/* СПИСКИ МЕНЮ */}
      <MenuSection title="Бонуси та знижки">
        <MenuItem label="Мої винагороди" onPress={() => Alert.alert('Мої винагороди', `Доступні бонуси: ${profile?.bonus_balance || 0} ₴`)} />
        <MenuItem label="Бонуси на покупки" onPress={() => setModalVisible(true)} />
        <MenuItem label="Знижки та акції" isLast onPress={() => Alert.alert('Знижки та акції', 'Акційні товари доступні на головній сторінці')} />
      </MenuSection>

      <MenuSection title="Моя активність">
        <MenuItem label="Моя сторінка" onPress={openInfoModal} />
        <MenuItem label="Мої відгуки" isLast onPress={() => setReviewsModalVisible(true)} />
      </MenuSection>

      <MenuSection title="Налаштування">
        <MenuItem label="Налаштування сповіщень" onPress={() => Alert.alert('Налаштування сповіщень', 'Поки немає додаткових налаштувань')} />
        <MenuItem label="Прив’язати Google" onPress={handleGoogleLinkStart} />
        <MenuItem label="Керування пристроями" onPress={() => Alert.alert('Керування пристроями', 'Поточний пристрій активний')} />
        <MenuItem label="Видалити акаунт" color="#D32F2F" isLast onPress={handleDeleteAccount} />
      </MenuSection>

            <MenuSection title="Інформація">
        <MenuItem label="Оплата і доставка" onPress={() => openPolicy("delivery")} />
        <MenuItem label="Міжнародні відправки" onPress={() => openPolicy("international")} />
        <MenuItem label="Блогери" onPress={() => Alert.alert('Блогери', 'Для співпраці напишіть у підтримку')} />
        <MenuItem label="Партнерська програма" onPress={() => Alert.alert('Партнерська програма', 'Партнерська програма скоро буде доступна')} />
        <MenuItem label="Рейтинг та відгуки" isLast onPress={() => setReviewsModalVisible(true)} />
      </MenuSection>

      <MenuSection title="Детальніше">
        <MenuItem label="Контактна інформація" onPress={() => openPolicy("contacts")} />
        <MenuItem label="Політика конфіденційності" onPress={() => openPolicy("privacy")} />
        <MenuItem label="Обмін та повернення" onPress={() => openPolicy("returns")} />
        <MenuItem label="Договір оферти" onPress={() => openPolicy("offer")} />
        <MenuItem label="Часті питання" isLast onPress={() => openPolicy("faq")} />
      </MenuSection>

      {/* 🔥 ВЕРСИЯ УДАЛЕНА ПО ЗАПРОСУ */}
      <View style={{height: 50}} />
    </>
  );

  // === ЭКРАН ГОСТЯ ===
  const renderGuestView = () => (
    <View style={styles.container}>
      {/* HEADER FIXED */}
      <View style={{ 
          height: 60 + insets.top, 
          backgroundColor: 'white', 
          borderBottomWidth: 1, 
          borderBottomColor: '#f0f0f0',
          paddingTop: insets.top 
      }}>
         <View style={{ position: 'absolute', top: insets.top, left: 0, right: 0, height: 60, justifyContent: 'center', alignItems: 'center', zIndex: 1 }}>
            <Text style={{ fontSize: 24, fontWeight: 'bold', color: '#1F2937' }}>Профіль</Text>
         </View>
      </View>

      <ScrollView 
        contentContainerStyle={{ paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
      <View style={styles.welcomeBlock}>
        <Text style={styles.welcomeTitle}>Вітаємо в Dikoros!</Text>
        <Text style={styles.welcomeSubtitle}>
          Авторизуйтесь, щоб керувати замовленнями, отримувати кешбек та персональні знижки.
        </Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={() => setShowLoginModal(true)}>
          <Text style={styles.primaryBtnText}>Увійти / Створити акаунт</Text>
        </TouchableOpacity>
      </View>

      {renderCommonMenu()}
      </ScrollView>
    </View>
  );

  // === ЭКРАН КЛИЕНТА ===
  const renderUserView = () => {
    // 🔥 РАСЧЕТ УРОВНЕЙ ЛОЯЛЬНОСТИ
    const totalSpent = profile?.total_spent || 0;
    
    // Визначаємо поточний рівень кешбеку згідно з таблицею умов
    let currentPercent = 5;
    let nextLevel = 5000;
    let nextPercent = 10;
    let prevLevel = 0;

    if (totalSpent < 5000) {
      currentPercent = 5;
      nextLevel = 5000;
      nextPercent = 10;
      prevLevel = 0;
    } else if (totalSpent < 10000) {
      currentPercent = 10;
      nextLevel = 10000;
      nextPercent = 15;
      prevLevel = 5000;
    } else if (totalSpent < 25000) {
      currentPercent = 15;
      nextLevel = 25000;
      nextPercent = 20;
      prevLevel = 10000;
    } else {
      currentPercent = 20;
      nextLevel = 0;
      nextPercent = 20;
      prevLevel = 25000;
    }

    // Считаем % заполнения шкалы (относительно текущего диапазона)
    const progressPercent = nextLevel > 0 
        ? Math.min(((totalSpent - prevLevel) / (nextLevel - prevLevel)) * 100, 100) 
        : 100;

    return (

        <View style={styles.container}>
          {/* HEADER FIXED */}
          <View style={{ 
              height: 60 + insets.top, 
              backgroundColor: 'white', 
              borderBottomWidth: 1, 
              borderBottomColor: '#f0f0f0',
              paddingTop: insets.top 
          }}>
             {/* Center Title */}
             <View style={{ position: 'absolute', top: insets.top, left: 0, right: 0, height: 60, justifyContent: 'center', alignItems: 'center', zIndex: 1 }}>
                <Text style={{ fontSize: 24, fontWeight: 'bold', color: '#1F2937' }}>Профіль</Text>
             </View>

             {/* Right Button */}
             <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', paddingHorizontal: 20, zIndex: 2 }}>
                <TouchableOpacity onPress={handleLogout} style={styles.logoutBtn}>
                  <Ionicons name="log-out-outline" size={24} color="#FF3B30" />
                </TouchableOpacity>
             </View>
          </View>

          <ScrollView 
            contentContainerStyle={{ paddingBottom: 100 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          >


            {/* ЧЕРНАЯ КАРТОЧКА */}
            <View style={styles.bonusCard}>
                {/* ВЕРХНЯЯ ЧАСТЬ: БАЛАНС + БЕЙДЖ */}
                <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start'}}>
                    <View>
                    <Text style={styles.bonusLabel}>Доступні бонуси</Text>
                    <Text style={styles.bonusValue}>{profile?.bonus_balance || 0} ₴</Text>
                    </View>
                    {/* Бейдж кешбэка */}
                    <View style={styles.cashbackBadge}>
                    <Text style={styles.cashbackText}>{currentPercent}% Кешбек</Text>
                    </View>
                </View>

                {/* ПРОГРЕСС БАР */}
                <View style={styles.progressSection}>
                    <View style={{flexDirection:'row', justifyContent:'space-between', marginBottom: 5, alignItems: 'center'}}>
                        <Text style={styles.progressText}>
                            Всього витрачено: <Text style={{fontWeight: 'bold', color: '#FFF'}}>{totalSpent} ₴</Text>
                        </Text>
                        {/* 🔥 КНОПКА УМОВИ */}
                        <TouchableOpacity onPress={() => setModalVisible(true)}>
                            <Text style={{color: '#4CAF50', fontSize: 12, fontWeight: 'bold'}}>ⓘ Умови</Text>
                        </TouchableOpacity>
                    </View>
                    
                    <View style={styles.progressBarBg}>
                    <View style={[styles.progressBarFill, {width: `${progressPercent}%`}]} />
                    </View>
                    
                    {/* 🔥 ТЕКСТ О СЛЕДУЮЩЕМ УРОВНЕ */}
                    <Text style={styles.progressSubtext}>
                    {nextLevel > 0 
                        ? `Поточний рівень: ${currentPercent}%. Ще ${nextLevel - totalSpent} ₴ до ${nextPercent}%` 
                        : `Ви досягли максимального рівня кешбеку! 🎉`}
                    </Text>
                </View>
            </View>

            {/* Кнопка Рефералки */}
            <TouchableOpacity style={styles.inviteBanner} onPress={handleShare}>
                <Ionicons name="gift" size={24} color="#FFF" />
                <Text style={styles.inviteText}>Запросити друга (+50 грн)</Text>
                <Ionicons name="chevron-forward" size={20} color="#FFF" />
            </TouchableOpacity>

            {/* ОСНОВНОЕ МЕНЮ */}
            <View style={{marginTop: 20}}>
                {renderCommonMenu()}
            </View>
          </ScrollView>
        </View>
    );
  };

  return (
    <View style={{flex: 1, backgroundColor: '#F4F4F4'}}>
      {phone ? renderUserView() : renderGuestView()}
      
      <FloatingChatButton bottomOffset={30} />

      {/* МОДАЛКА ВХОДА */}
      <Modal visible={showLoginModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{'\u0412\u0445\u0456\u0434 \u002f \u0420\u0435\u0454\u0441\u0442\u0440\u0430\u0446\u0456\u044f'}</Text>
              <TouchableOpacity onPress={() => { setShowLoginModal(false); setSmsSent(false); setSmsCode(''); }}>
                <Ionicons name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalSubtitle}>
              {smsSent
                ? '\u0412\u0432\u0435\u0434\u0456\u0442\u044c SMS-\u043a\u043e\u0434, \u044f\u043a\u0438\u0439 \u043c\u0438 \u043d\u0430\u0434\u0456\u0441\u043b\u0430\u043b\u0438 \u043d\u0430 \u0432\u0430\u0448 \u043d\u043e\u043c\u0435\u0440'
                : '\u0412\u0445\u0456\u0434 \u0456 \u0440\u0435\u0454\u0441\u0442\u0440\u0430\u0446\u0456\u044f \u0437\u0430 \u043d\u043e\u043c\u0435\u0440\u043e\u043c \u0442\u0435\u043b\u0435\u0444\u043e\u043d\u0443'}
            </Text>

            <TextInput
              style={styles.input}
              placeholder="+380 99 123 45 67"
              value={inputPhone}
              onChangeText={(value) => {
                setInputPhone(formatPhoneInput(value));
                if (smsSent) {
                  setSmsSent(false);
                  setSmsCode('');
                }
              }}
              keyboardType="phone-pad"
              maxLength={17}
              editable={!smsSent}
              autoFocus
            />

            {smsSent && (
              <TextInput
                style={styles.input}
                placeholder={'SMS-\u043a\u043e\u0434'}
                value={smsCode}
                onChangeText={setSmsCode}
                keyboardType="number-pad"
                maxLength={6}
              />
            )}

            <TouchableOpacity style={styles.loginButton} onPress={handleLogin}>
              <Text style={styles.loginButtonText}>
                {smsSent ? '\u0423\u0432\u0456\u0439\u0442\u0438' : '\u041e\u0442\u0440\u0438\u043c\u0430\u0442\u0438 SMS-\u043a\u043e\u0434'}
              </Text>
            </TouchableOpacity>

            {smsSent && (
              <TouchableOpacity style={{marginTop: 12, alignItems: 'center'}} onPress={handleSendSmsCode}>
                <Text style={{color: '#458B00', fontWeight: '700'}}>
                  {'\u041d\u0430\u0434\u0456\u0441\u043b\u0430\u0442\u0438 \u043a\u043e\u0434 \u0449\u0435 \u0440\u0430\u0437'}
                </Text>
              </TouchableOpacity>
            )}

            {!smsSent && (
              <>
                <View style={{alignItems: 'center', marginVertical: 12}}>
                  <Text style={{color: '#999'}}>{'\u0430\u0431\u043e'}</Text>
                </View>

                <TouchableOpacity
                  style={[styles.loginButton, {backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#DDD', marginBottom: 10}]}
                  onPress={() => {
                    setGoogleAuthMode('login');
                    promptGoogleLogin();
                  }}
                >
                  <Text style={[styles.loginButtonText, {color: '#333'}]}>
                    {'\u0423\u0432\u0456\u0439\u0442\u0438 \u0447\u0435\u0440\u0435\u0437 Google'}
                  </Text>
                </TouchableOpacity>
              </>
            )}

          </View>
        </View>
      </Modal>

      <Modal visible={modalVisible} animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Рівні кешбеку</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <Ionicons name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>
            
            <View style={styles.table}>
                <View style={[styles.tr, {backgroundColor: '#F5F5F5'}]}>
                    <Text style={[styles.th, {flex: 1}]}>Сума покупок</Text>
                    <Text style={[styles.th, {width: 60, textAlign: 'right'}]}>%</Text>
                </View>
                <View style={styles.tr}><Text style={styles.td}>0 - 4 999 ₴</Text><Text style={styles.tdR}>5%</Text></View>
                <View style={styles.tr}><Text style={styles.td}>5 000 - 9 999 ₴</Text><Text style={styles.tdR}>10%</Text></View>
                <View style={styles.tr}><Text style={styles.td}>10 000 - 24 999 ₴</Text><Text style={styles.tdR}>15%</Text></View>
                <View style={[styles.tr, {borderBottomWidth:0}]}><Text style={styles.td}>від 25 000 ₴</Text><Text style={styles.tdR}>20%</Text></View>
            </View>
          </View>
        </View>
      </Modal>

      {/* 🔥 INFO MODAL */}
      <Modal visible={infoModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Особиста інформація</Text>
              <TouchableOpacity onPress={() => setInfoModalVisible(false)}>
                <Ionicons name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>
            
            <Text style={{marginBottom: 5, color: '#666'}}>Телефон</Text>
            <TextInput style={[styles.input, {backgroundColor: '#f5f5f5', color: '#888'}]} value={formatPhoneInput(phone)} editable={false} />

            <Text style={{marginBottom: 5, color: '#666'}}>Ім’я та Прізвище</Text>
            <TextInput style={styles.input} value={infoName} onChangeText={setInfoName} placeholder="Іван Іванов" />
            
            <Text style={{marginBottom: 5, color: '#666'}}>Місто</Text>
            <TextInput style={styles.input} value={infoCity} onChangeText={setInfoCity} placeholder="Київ" />

            <Text style={{marginBottom: 5, color: '#666'}}>Відділення Нової Пошти</Text>
            <TextInput style={styles.input} value={infoWarehouse} onChangeText={setInfoWarehouse} placeholder="Відділення №1" />

            <Text style={{marginBottom: 5, color: '#666'}}>Email (не обов’язково)</Text>
            <TextInput style={styles.input} value={infoEmail} onChangeText={setInfoEmail} placeholder="example@email.com" keyboardType="email-address" autoCapitalize="none" />

            <Text style={{marginBottom: 5, color: '#666'}}>Зручний спосіб зв’язку</Text>
            <View style={{flexDirection: 'row', gap: 8, marginBottom: 15}}>
              <TouchableOpacity 
                style={[styles.contactChip, infoContactPreference === 'call' && styles.contactChipActive]}
                onPress={() => setInfoContactPreference('call')}
              >
                <Text style={[styles.contactChipText, infoContactPreference === 'call' && styles.contactChipTextActive]}>📞 Дзвінок</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.contactChip, infoContactPreference === 'telegram' && styles.contactChipActive]}
                onPress={() => setInfoContactPreference('telegram')}
              >
                <Text style={[styles.contactChipText, infoContactPreference === 'telegram' && styles.contactChipTextActive]}>✈️ Telegram</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.contactChip, infoContactPreference === 'viber' && styles.contactChipActive]}
                onPress={() => setInfoContactPreference('viber')}
              >
                <Text style={[styles.contactChipText, infoContactPreference === 'viber' && styles.contactChipTextActive]}>💬 Viber</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.loginButton} onPress={saveUserInfo}>
              <Text style={styles.loginButtonText}>Зберегти</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 🔥 REVIEWS MODAL */}
      <Modal visible={reviewsModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, {height: '80%'}]}>
                <View style={styles.modalHeader}>
                    <Text style={styles.modalTitle}>Мої відгуки</Text>
                    <TouchableOpacity onPress={() => setReviewsModalVisible(false)}>
                        <Ionicons name="close" size={24} color="#333" />
                    </TouchableOpacity>
                </View>

                {userReviews.length === 0 ? (
                    <View style={{flex: 1, justifyContent: 'center', alignItems: 'center'}}>
                        <Ionicons name="chatbubbles-outline" size={64} color="#CCC" />
                        <Text style={{color: '#999', marginTop: 10}}>У вас поки немає відгуків</Text>
                    </View>
                ) : (
                    <ScrollView showsVerticalScrollIndicator={false}>
                        {userReviews.map((review, index) => (
                            <View key={review.id || index} style={{
                                backgroundColor: '#F9F9F9',
                                padding: 15,
                                borderRadius: 12,
                                marginBottom: 15
                            }}>
                                <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10}}>
                                    <View style={{flex: 1}}>
                                        <Text style={{fontWeight: 'bold', fontSize: 16, marginBottom: 4}}>
                                            {review.product_name || 'Товар'}
                                        </Text>
                                        <View style={{flexDirection: 'row', marginBottom: 5}}>
                                            {[1,2,3,4,5].map(star => (
                                                <Ionicons 
                                                    key={star} 
                                                    name={star <= review.rating ? "star" : "star-outline"} 
                                                    size={16} 
                                                    color="#FFD700" 
                                                />
                                            ))}
                                        </View>
                                    </View>
                                    <TouchableOpacity 
                                        onPress={() => deleteUserReview(review.id)}
                                        style={{padding: 5}}
                                    >
                                        <Ionicons name="trash-outline" size={20} color="#FF3B30" />
                                    </TouchableOpacity>
                                </View>

                                {review.comment && (
                                    <Text style={{color: '#444', fontSize: 14, lineHeight: 20, marginBottom: 8}}>
                                        {review.comment}
                                    </Text>
                                )}
                                
                                <Text style={{color: '#999', fontSize: 12}}>
                                    {new Date(review.created_at).toLocaleDateString('uk-UA')}
                                </Text>
                            </View>
                        ))}
                    </ScrollView>
                )}
            </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  
  // GUEST
  guestHeader: { backgroundColor: '#458B00', padding: 20, paddingTop: 60, alignItems: 'center' },
  guestTitle: { color: '#FFF', fontSize: 18, fontWeight: 'bold' },
  
  welcomeBlock: { backgroundColor: '#FFF', padding: 20, marginBottom: 10 },
  welcomeTitle: { fontSize: 22, fontWeight: 'bold', marginBottom: 8, color: '#333' },
  welcomeSubtitle: { fontSize: 14, color: '#666', lineHeight: 20, marginBottom: 20 },
  primaryBtn: { backgroundColor: '#458B00', borderRadius: 8, paddingVertical: 14, alignItems: 'center' },
  primaryBtnText: { color: '#FFF', fontSize: 16, fontWeight: 'bold' },

  // GRID
  gridContainer: { flexDirection: 'row', flexWrap: 'wrap', padding: 10, gap: 10, justifyContent: 'space-between' },
  gridItem: { 
    width: '48%', backgroundColor: '#FFF', paddingVertical: 15, paddingHorizontal: 10, borderRadius: 30,
    alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8,
    borderWidth: 1, borderColor: '#E0E0E0'
  },
  gridText: { fontSize: 13, fontWeight: '600', color: '#333' },

  // LIST SECTIONS
  menuSection: { marginTop: 15 },
  sectionHeader: { fontSize: 18, fontWeight: 'bold', marginLeft: 15, marginBottom: 10, color: '#333' },
  menuList: { backgroundColor: '#FFF', borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#EEE' },
  menuItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 20 },
  menuItemText: { fontSize: 16, color: '#333' },
  divider: { height: 1, backgroundColor: '#F0F0F0', marginLeft: 20 },
  
  // USER DASHBOARD
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 60, backgroundColor: '#FFF' },
  headerTitle: { fontSize: 24, fontWeight: 'bold' },
  headerPhone: { color: '#666', fontSize: 14 },
  logoutBtn: { padding: 5 },

  // BLACK CARD
  bonusCard: { margin: 15, padding: 20, backgroundColor: '#222', borderRadius: 16 },
  bonusLabel: { color: '#AAA', fontSize: 14, marginBottom: 5 },
  bonusValue: { color: '#FFF', fontSize: 32, fontWeight: 'bold', marginBottom: 10 },
  cashbackBadge: { backgroundColor: '#444', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8 },
  cashbackText: { color: '#FFD700', fontWeight: 'bold', fontSize: 14 },

  progressSection: { marginTop: 10, paddingTop: 15, borderTopWidth: 1, borderTopColor: '#444' },
  progressText: { fontSize: 14, color: '#CCC' },
  progressBarBg: { height: 6, backgroundColor: '#555', borderRadius: 3, marginVertical: 8 },
  progressBarFill: { height: 6, backgroundColor: '#458B00', borderRadius: 3 },
  progressSubtext: { fontSize: 12, color: '#AAA' },

  inviteBanner: { marginHorizontal: 15, backgroundColor: '#FF9800', borderRadius: 12, padding: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  inviteText: { color: '#FFF', fontWeight: 'bold', fontSize: 16 },

  sectionTitle: { fontSize: 18, fontWeight: 'bold', marginLeft: 15, marginBottom: 10 },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginRight: 15 },
  
  orderItem: { backgroundColor: '#FFF', marginHorizontal: 15, marginBottom: 10, padding: 15, borderRadius: 12 },
  orderHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 },
  orderId: { fontWeight: 'bold' },
  orderDate: { color: '#888', fontSize: 12 },
  orderTotal: { fontWeight: 'bold', fontSize: 16 },
  statusText: { fontSize: 14, fontWeight: '500' },
  emptyText: { textAlign: 'center', color: '#999', marginVertical: 10 },

  // MODAL
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center' },
  modalContent: { backgroundColor: '#FFF', borderRadius: 20, padding: 20, paddingBottom: 40, minHeight: 300, maxHeight: '80%', marginHorizontal: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 20, fontWeight: 'bold' },
  modalSubtitle: { color: '#666', marginBottom: 20 },
  input: { borderWidth: 1, borderColor: '#DDD', borderRadius: 10, padding: 15, fontSize: 18, marginBottom: 20 },
  loginButton: { backgroundColor: '#458B00', padding: 16, borderRadius: 10, alignItems: 'center' },
  loginButtonText: { color: '#FFF', fontSize: 16, fontWeight: 'bold' },

  // TABLE STYLES
  table: { borderWidth: 1, borderColor: '#EEE', borderRadius: 8, overflow: 'hidden' },
  tr: { flexDirection: 'row', justifyContent: 'space-between', padding: 12, borderBottomWidth: 1, borderBottomColor: '#EEE' },
  th: { fontWeight: 'bold', color: '#333', fontSize: 14 },
  td: { fontSize: 14, color: '#555', flex: 1 },
  tdR: { fontSize: 14, fontWeight: 'bold', width: 60, textAlign: 'right' },

  // CONTACT PREFERENCE CHIPS
  contactChip: { flex: 1, paddingVertical: 10, borderRadius: 8, backgroundColor: '#F0F0F0', alignItems: 'center', borderWidth: 1, borderColor: '#E0E0E0' },
  contactChipActive: { backgroundColor: '#E8F5E9', borderColor: '#4CAF50' },
  contactChipText: { fontSize: 12, color: '#333', fontWeight: '500' },
  contactChipTextActive: { color: '#2E7D32', fontWeight: 'bold' }
});
