/* eslint-disable react-hooks/exhaustive-deps */
import { AppHeader } from '@/components/AppHeader';
import { API_URL } from '@/config/api';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useState , useEffect } from 'react';

import {
  ActivityIndicator,
  Alert,
  Linking,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text, TouchableOpacity,
  View
} from 'react-native';

import { useLocalSearchParams, useRouter } from 'expo-router';


// --- ТИПЫ ---
interface UserProfile {
  phone: string;
  bonus_balance: number;
  total_spent: number;
  cashback_percent: number;
  cumulative_discount_percent: number;
  global_cashback_percent: number;
  name?: string;
  city?: string;
  warehouse?: string;
  email?: string;
  contact_preference?: 'call' | 'telegram' | 'viber';
  phone_verified?: boolean;
  google_connected?: boolean;
  facebook_connected?: boolean;
}


export default function ProfileScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  // Состояния
  const [phone, setPhone] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  
  useEffect(() => {
    GoogleSignin.configure({
      webClientId: '451079322222-j59emqplkjkecod099fh759t2mmlr5jo.apps.googleusercontent.com',
      offlineAccess: false,
    } as any);
  }, []);

  const promptGoogleLogin = async () => {
    try {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

      const signInResult: any = await GoogleSignin.signIn();
      let idToken =
        signInResult?.data?.idToken ||
        signInResult?.idToken ||
        null;

      if (!idToken) {
        const tokens = await GoogleSignin.getTokens();
        idToken = tokens.idToken;
      }

      if (!idToken) {
        Alert.alert('Помилка Google входу', 'Google не повернув ID token.');
        return;
      }

      await handleGoogleSocialLink(idToken);
    } catch (error: any) {
      if (error?.code === statusCodes.SIGN_IN_CANCELLED) return;

      console.warn('Google native sign-in failed:', error);
      Alert.alert('Помилка Google входу', error?.message || 'Не вдалося увійти через Google.');
    }
  };


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
    if (params.openLogin === 'true' && !phone) {
      router.push('/login' as any);
    }
  }, [params.openLogin, phone]);


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

  const clearAuthSession = async () => {
    await AsyncStorage.multiRemove([
      'accessToken',
      'userPhone',
      'userName',
    ]);
    setPhone('');
    setProfile(null);
  };

  const checkLogin = async () => {
    try {
      const accessToken = await AsyncStorage.getItem('accessToken');
      const storedPhone = await AsyncStorage.getItem('userPhone');

      if (!accessToken) {
        await clearAuthSession();
        return;
      }

      const res = await fetch(`${API_URL}/api/user/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!res.ok) {
        if (res.status === 401 || res.status === 403 || res.status === 404) {
          await clearAuthSession();
        }
        return;
      }

      const user: UserProfile = await res.json();
      const profilePhone = canonicalizePhone(user.phone || storedPhone || '');

      if (profilePhone) {
        await AsyncStorage.setItem('userPhone', profilePhone);
      }

      setPhone(profilePhone);
      setProfile(user);
    } catch (e) {
      console.error(e);
    } finally {
      setRefreshing(false);
      setAuthReady(true);
    }
  };

  // 2. Загрузка данных
  const fetchData = async (_phoneNumber?: string) => {
    try {
      const accessToken = await AsyncStorage.getItem('accessToken');

      if (!accessToken) {
        await clearAuthSession();
        return;
      }

      const resUser = await fetch(`${API_URL}/api/user/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!resUser.ok) {
        if (resUser.status === 401 || resUser.status === 403 || resUser.status === 404) {
          await clearAuthSession();
        }
        return;
      }

      const user: UserProfile = await resUser.json();
      const profilePhone = canonicalizePhone(user.phone || _phoneNumber || '');

      if (profilePhone) {
        await AsyncStorage.setItem('userPhone', profilePhone);
      }

      setPhone(profilePhone);
      setProfile(user);
    } catch (e) {
      console.error(e);
    } finally {
      setRefreshing(false);
      setAuthReady(true);
    }
  };

  // 3. Логика входа / выхода
  const handleGoogleLinkStart = async () => {
    const accessToken = await AsyncStorage.getItem('accessToken');

    if (!accessToken || !profile?.phone_verified) {
      Alert.alert(
        'Потрібен SMS-вхід',
        'Спочатку увійдіть за номером телефону через SMS, потім прив’яжіть Google.'
      );
      router.push('/login' as any);
      return;
    }

    promptGoogleLogin();
  };

  const handleGoogleSocialLink = async (idToken: string) => {
    try {
      const accessToken = await AsyncStorage.getItem('accessToken');

      if (!accessToken) {
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

      if (result.access_token) {
        await AsyncStorage.setItem('accessToken', result.access_token);
      }

      const authId = canonicalizePhone(result.phone || phone || '');

      if (authId) {
        await AsyncStorage.setItem('userPhone', authId);
        setPhone(authId);
      }

      setProfile(result);
      fetchData(authId);
      Alert.alert('Готово', 'Google успішно прив’язано до вашого акаунта.');
    } catch (error) {
      console.error(error);
      Alert.alert('Помилка', 'Немає з’єднання');
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
          await AsyncStorage.multiRemove([
            'accessToken',
            'userPhone',
            'userName',
          ]);
          setPhone('');
          setProfile(null);
          setAuthReady(true);
        },
      },
    ]);
  };

  /* 🔥 UPDATE USER INFO */
  const openInfoPage = () => {
    if (!profile) {
      Alert.alert('Увага', 'Спочатку увійдіть в акаунт');
      return;
    }
    router.push('/profile-info' as any);
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
        router.push('/login' as any);
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
    } catch (error: any) {
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
      <View style={styles.gridContainer}>
        <GridBtn icon="receipt-outline" label="Замовлення" onPress={() => router.push({ pathname: '/(tabs)/orders', params: { from: 'profile' } } as any)} />
        <GridBtn icon="heart-outline" label="Обране" onPress={() => router.push('/(tabs)/favorites')} />
        <GridBtn icon="person-outline" label="Особиста інформація" onPress={openInfoPage} />
        <GridBtn icon="chatbubble-ellipses-outline" label="Підтримка" onPress={() => router.push({ pathname: '/(tabs)/chat', params: { from: 'profile' } } as any)} />
      </View>

      <MenuSection title="Бонуси та знижка">
        <MenuItem label="Бонуси та накопичувальна знижка" isLast onPress={() => router.push('/profile-cashback' as any)} />
      </MenuSection>

      <MenuSection title="Моя активність">
        <MenuItem label="Мої відгуки" isLast onPress={() => router.push('/profile-reviews' as any)} />
      </MenuSection>

      <MenuSection title="Налаштування">
        <MenuItem
          label={profile?.google_connected ? 'Google підключено' : 'Прив’язати Google'}
          onPress={profile?.google_connected
            ? () => Alert.alert('Google', 'Google вже підключено до вашого акаунта.')
            : handleGoogleLinkStart
          }
        />
        <MenuItem label="Видалити акаунт" color="#D32F2F" isLast onPress={handleDeleteAccount} />
      </MenuSection>

      <MenuSection title="Інформація">
        <MenuItem label="Про нас" onPress={() => router.push('/about' as any)} />
        <MenuItem label="Блог" onPress={() => router.push('/blog' as any)} />
        <MenuItem label="Оплата і доставка" onPress={() => openPolicy("delivery")} />
        <MenuItem label="Обмін та повернення" onPress={() => openPolicy("returns")} />
        <MenuItem label="Міжнародні відправки" onPress={() => openPolicy("international")} />
        <MenuItem label="Контактна інформація" onPress={() => openPolicy("contacts")} />
        <MenuItem label="Договір оферти" onPress={() => openPolicy("offer")} />
        <MenuItem label="Політика конфіденційності" onPress={() => openPolicy("privacy")} />
        <MenuItem label="Часті питання" isLast onPress={() => openPolicy("faq")} />
      </MenuSection>

      <View style={{height: 50}} />
    </>
  );

  const renderLoadingView = () => (
    <View style={styles.container}>
      <AppHeader showLogo showSearch showFavorites />

      <View style={styles.unifiedTitleRow}>
        <View style={styles.unifiedTitleButton} />
        <Text style={styles.unifiedTitle} numberOfLines={1}>Профіль</Text>
        <View style={styles.unifiedTitleButton} />
      </View>

      <View style={styles.loadingBox}>
        <ActivityIndicator size="large" color="#458B00" />
      </View>
    </View>
  );

  // === ЭКРАН ГОСТЯ ===
  const renderGuestView = () => (
    <View style={styles.container}>
      <AppHeader showLogo showSearch showFavorites />

      <View style={styles.unifiedTitleRow}>
        <View style={styles.unifiedTitleButton} />
        <Text style={styles.unifiedTitle} numberOfLines={1}>Профіль</Text>
        <View style={styles.unifiedTitleButton} />
      </View>

      <ScrollView 
        contentContainerStyle={{ paddingBottom: 130 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
      <View style={styles.welcomeBlock}>
        <Text style={styles.welcomeTitle}>Вітаємо в Dikoros!</Text>
        <Text style={styles.welcomeSubtitle}>
          Авторизуйтесь, щоб керувати замовленнями, отримувати кешбек та персональні знижки.
        </Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={() => router.push('/login' as any)}>
          <Text style={styles.primaryBtnText}>Увійти / Створити акаунт</Text>
        </TouchableOpacity>
      </View>
      <MenuSection title="Інформація">
        <MenuItem label="Про нас" onPress={() => router.push('/about' as any)} />
        <MenuItem label="Блог" onPress={() => router.push('/blog' as any)} />
        <MenuItem label="Оплата і доставка" onPress={() => openPolicy("delivery")} />
        <MenuItem label="Обмін та повернення" onPress={() => openPolicy("returns")} />
        <MenuItem label="Міжнародні відправки" onPress={() => openPolicy("international")} />
        <MenuItem label="Контактна інформація" onPress={() => openPolicy("contacts")} />
        <MenuItem label="Договір оферти" onPress={() => openPolicy("offer")} />
        <MenuItem label="Політика конфіденційності" onPress={() => openPolicy("privacy")} />
        <MenuItem label="Часті питання" isLast onPress={() => openPolicy("faq")} />
      </MenuSection>
      </ScrollView>
    </View>
  );

  // === ЭКРАН КЛИЕНТА ===
  const renderUserView = () => {
    // 🔥 РАСЧЕТ УРОВНЕЙ ЛОЯЛЬНОСТИ
    const totalSpent = profile?.total_spent || 0;
    
    // Накопичувальна знижка залежить тільки від підтверджених витрат.
    let currentPercent = 0;
    let nextLevel = 1999;
    let nextPercent = 5;
    let prevLevel = 0;

    if (totalSpent < 1999) {
      currentPercent = 0;
      nextLevel = 1999;
      nextPercent = 5;
      prevLevel = 0;
    } else if (totalSpent < 5000) {
      currentPercent = 5;
      nextLevel = 5000;
      nextPercent = 10;
      prevLevel = 1999;
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
    currentPercent = profile?.cumulative_discount_percent ?? profile?.cashback_percent ?? currentPercent;
    const globalCashbackPercent = profile?.global_cashback_percent ?? 5;

    // Считаем % заполнения шкалы (относительно текущего диапазона)
    const progressPercent = nextLevel > 0 
        ? Math.min(((totalSpent - prevLevel) / (nextLevel - prevLevel)) * 100, 100) 
        : 100;

    return (

        <View style={styles.container}>
          <AppHeader showLogo showSearch showFavorites />

          <View style={styles.unifiedTitleRow}>
            <View style={styles.unifiedTitleButton} />
            <Text style={styles.unifiedTitle} numberOfLines={1}>Профіль</Text>
            <TouchableOpacity
              onPress={handleLogout}
              style={styles.unifiedTitleButton}
              activeOpacity={0.75}
            >
              <Ionicons name="log-out-outline" size={24} color="#EF4444" />
            </TouchableOpacity>
          </View>

          <ScrollView 
            contentContainerStyle={{ paddingBottom: 130 }}
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
                    {/* Глобальний кешбек не залежить від накопичувальної знижки. */}
                    <View style={styles.cashbackBadge}>
                    <Text style={styles.cashbackText}>{globalCashbackPercent}% Кешбек</Text>
                    </View>
                </View>

                {/* ПРОГРЕСС БАР */}
                <View style={styles.progressSection}>
                    <View style={{flexDirection:'row', justifyContent:'space-between', marginBottom: 5, alignItems: 'center'}}>
                        <Text style={styles.progressText}>
                            Всього витрачено: <Text style={{fontWeight: 'bold', color: '#FFF'}}>{totalSpent} ₴</Text>
                        </Text>
                        {/* 🔥 КНОПКА УМОВИ */}
                        <TouchableOpacity onPress={() => router.push('/profile-cashback' as any)} activeOpacity={0.8}>
                            <Text style={{color: '#4CAF50', fontSize: 12, fontWeight: 'bold'}}>ⓘ Умови</Text>
                        </TouchableOpacity>
                    </View>
                    
                    <View style={styles.progressBarBg}>
                    <View style={[styles.progressBarFill, {width: `${progressPercent}%`}]} />
                    </View>
                    
                    {/* 🔥 ТЕКСТ О СЛЕДУЮЩЕМ УРОВНЕ */}
                    <Text style={styles.progressSubtext}>
                    {nextLevel > 0 
                        ? `Накопичувальна знижка: ${currentPercent}%. Ще ${Math.max(0, nextLevel - totalSpent)} ₴ до ${nextPercent}%`
                        : `Ви досягли максимальної накопичувальної знижки! 🎉`}
                    </Text>
                </View>
            </View>

            {/* Кнопка Рефералки */}
            <TouchableOpacity style={styles.inviteBanner} onPress={handleShare}>
                <Ionicons name="gift" size={24} color="#FFF" />
                <Text style={styles.inviteText}>Запросити друга (+50 грн)</Text>
                <Ionicons name="chevron-forward" size={20} color="#FFF" />
            </TouchableOpacity>

            <View style={styles.authStatusCard}>
                <Ionicons
                  name={profile?.google_connected ? 'logo-google' : 'link-outline'}
                  size={22}
                  color="#333"
                />
                <View style={{flex: 1}}>
                  <Text style={styles.authStatusTitle}>Google авторизація</Text>
                  <Text style={styles.authStatusText}>
                    {profile?.google_connected
                      ? `Підключено${profile?.email ? `: ${profile.email}` : ''}`
                      : 'Не підключено. Можна прив’язати після SMS-входу.'}
                  </Text>
                </View>
                {!profile?.google_connected && (
                  <TouchableOpacity style={styles.authStatusButton} onPress={handleGoogleLinkStart}>
                    <Text style={styles.authStatusButtonText}>Підключити</Text>
                  </TouchableOpacity>
                )}
            </View>

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
      {authReady ? (profile ? renderUserView() : renderGuestView()) : renderLoadingView()}
    </View>
  );
}

const styles = StyleSheet.create({
  unifiedTitleRow: {
    height: 58,
    paddingHorizontal: 14,
    backgroundColor: '#F8FAF8',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  unifiedTitleButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unifiedTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 22,
    fontWeight: '900',
    color: '#111827',
  },
  container: { flex: 1 },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  
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
  authStatusCard: { marginHorizontal: 15, marginBottom: 8, backgroundColor: '#FFF', borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: '#EEE' },
  authStatusTitle: { fontSize: 15, fontWeight: '700', color: '#333', marginBottom: 3 },
  authStatusText: { fontSize: 13, color: '#666' },
  authStatusButton: { backgroundColor: '#458B00', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10 },
  authStatusButtonText: { color: '#FFF', fontSize: 12, fontWeight: '700' },

  sectionTitle: { fontSize: 18, fontWeight: 'bold', marginLeft: 15, marginBottom: 10 },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginRight: 15 },
  
  orderItem: { backgroundColor: '#FFF', marginHorizontal: 15, marginBottom: 10, padding: 15, borderRadius: 12 },
  orderHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 },
  orderId: { fontWeight: 'bold' },
  orderDate: { color: '#888', fontSize: 12 },
  orderTotal: { fontWeight: 'bold', fontSize: 16 },
  statusText: { fontSize: 14, fontWeight: '500' },
  emptyText: { textAlign: 'center', color: '#999', marginVertical: 10 },
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



