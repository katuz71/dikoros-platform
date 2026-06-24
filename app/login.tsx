 
import { AppHeader } from '@/components/AppHeader';
import { API_URL } from '@/config/api';
import { trackEvent } from '@/utils/analytics';
import { promptEnableBiometricLogin } from '@/utils/biometricAuth';
import { logFirebaseEvent } from '@/utils/firebaseAnalytics';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

const canonicalizePhone = (value: string) => {
  const digits = (value || '').replace(/\D/g, '');
  if (digits.length >= 12 && digits.startsWith('380')) return digits.slice(0, 12);
  if (digits.length >= 11 && digits.startsWith('80')) return `3${digits.slice(0, 11)}`;
  if (digits.length >= 10 && digits.startsWith('0')) return `38${digits.slice(0, 10)}`;
  if (digits.length >= 9) return `380${digits.slice(0, 9)}`;
  return digits;
};

const formatPhoneInput = (value: string) => {
  const digits = (value || '').replace(/\D/g, '');
  let local = digits;

  if (digits.startsWith('380')) local = digits.slice(3);
  else if (digits.startsWith('80')) local = digits.slice(2);
  else if (digits.startsWith('0')) local = digits.slice(1);

  local = local.slice(0, 9);
  const parts = ['+380'];
  if (local.length > 0) parts.push(local.slice(0, 2));
  if (local.length > 2) parts.push(local.slice(2, 5));
  if (local.length > 5) parts.push(local.slice(5, 7));
  if (local.length > 7) parts.push(local.slice(7, 9));

  return parts.join(' ');
};

export default function LoginScreen() {
  const router = useRouter();

  const [inputPhone, setInputPhone] = useState('');
  const [smsCode, setSmsCode] = useState('');
  const [smsSent, setSmsSent] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    GoogleSignin.configure({
      webClientId: '579083559503-e578et6kgqf9k4aqb0b9265jkq0te264.apps.googleusercontent.com',
      offlineAccess: false,
    } as any);
  }, []);

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
          body: JSON.stringify({ token: expoPushToken }),
        });
      }
    } catch (e) {
      console.warn('Save push token after login failed:', e);
    }
  };

  const finishLogin = async (user: any, canonPhone?: string) => {
    const phone = canonicalizePhone(user?.phone || canonPhone || user?.auth_id || '');

    if (user?.access_token) {
      await AsyncStorage.setItem('accessToken', user.access_token);
    }

    if (phone) {
      await AsyncStorage.setItem('userPhone', phone);
    }

    if (user?.name) {
      await AsyncStorage.setItem('userName', user.name);
    }

    await attachPushToken();

    if (user?.is_new_user) {
      trackEvent('CompleteRegistration', {
        method: user?.provider || 'sms',
        value: 150,
        currency: 'UAH',
      });

      logFirebaseEvent('sign_up', {
        method: user?.provider || 'sms',
      });
    }

    if (user?.is_new_user && user?.access_token && phone) {
      await AsyncStorage.setItem('welcomeBonusModalSeenV1', '1');
      await promptEnableBiometricLogin(user.access_token, phone);
    }

    router.replace('/(tabs)/profile' as any);
  };

  const handleSendSmsCode = async () => {
    const canon = canonicalizePhone(inputPhone);

    if (canon.length !== 12 || !canon.startsWith('380')) {
      Alert.alert('Помилка', 'Введіть номер у форматі +380 XX XXX XX XX');
      return;
    }

    setInputPhone(formatPhoneInput(canon));
    setLoading(true);

    try {
      const res = await fetch(`${API_URL}/api/auth/sms/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: canon }),
      });

      if (res.ok) {
        setSmsSent(true);
        setSmsCode('');
        Alert.alert('Код відправлено', 'Введіть SMS-код для входу.');
      } else {
        const err = await res.json().catch(() => null);
        Alert.alert('Помилка', err?.detail || 'Не вдалося відправити SMS-код');
      }
    } catch (error) {
      console.error(error);
      Alert.alert('Помилка', 'Немає з’єднання');
    } finally {
      setLoading(false);
    }
  };

  const handleSmsLogin = async () => {
    const canon = canonicalizePhone(inputPhone);

    if (!smsSent) {
      await handleSendSmsCode();
      return;
    }

    const cleanSmsCode = smsCode.replace(/\D/g, '');

    if (cleanSmsCode.length !== 6) {
      Alert.alert('Помилка', 'Введіть SMS-код');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch(`${API_URL}/api/auth/sms/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: canon, code: cleanSmsCode }),
      });

      const user = await res.json().catch(() => null);

      if (!res.ok) {
        Alert.alert('Помилка', user?.detail || 'Невірний SMS-код');
        return;
      }

      await finishLogin({ ...user, provider: 'sms' }, canon);
    } catch (error) {
      console.error(error);
      Alert.alert('Помилка', 'Немає з’єднання');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setLoading(true);

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

      const res = await fetch(`${API_URL}/api/auth/social-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'google', token: idToken }),
      });

      const user = await res.json().catch(() => null);

      if (!res.ok) {
        if (res.status === 409) {
          Alert.alert(
            'Потрібен SMS-вхід',
            'Спочатку увійдіть або зареєструйтесь за номером телефону через SMS. Після цього Google-вхід можна буде прив’язати до акаунта.'
          );
          return;
        }

        Alert.alert('Помилка', user?.detail || 'Не вдалося увійти через Google');
        return;
      }

      await finishLogin({ ...user, provider: 'google' }, user?.phone || user?.auth_id);
    } catch (error: any) {
      if (error?.code === statusCodes.SIGN_IN_CANCELLED) return;
      console.warn('Google native sign-in failed:', error);
      Alert.alert('Помилка Google входу', error?.message || 'Не вдалося увійти через Google.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <AppHeader title="Вхід / Реєстрація" showBack />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            <Text style={styles.title}>Увійдіть за номером телефону</Text>
            <Text style={styles.subtitle}>
              SMS-вхід є основним способом авторизації. Google можна прив’язати після SMS-входу.
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
              editable={!smsSent && !loading}
            />

            {smsSent && (
              <TextInput
                style={styles.input}
                placeholder="SMS-код"
                value={smsCode}
                onChangeText={setSmsCode}
                keyboardType="number-pad"
                maxLength={6}
                editable={!loading}
              />
            )}

            <TouchableOpacity
              style={[styles.primaryButton, loading && styles.disabledButton]}
              onPress={handleSmsLogin}
              disabled={loading}
              activeOpacity={0.8}
            >
              {loading ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={styles.primaryButtonText}>
                  {smsSent ? 'Увійти' : 'Отримати SMS-код'}
                </Text>
              )}
            </TouchableOpacity>

            {smsSent && (
              <TouchableOpacity style={styles.secondaryPlain} onPress={handleSendSmsCode} disabled={loading}>
                <Text style={styles.secondaryPlainText}>Надіслати код ще раз</Text>
              </TouchableOpacity>
            )}

            {!smsSent && (
              <>
                <View style={styles.orRow}>
                  <View style={styles.orLine} />
                  <Text style={styles.orText}>або</Text>
                  <View style={styles.orLine} />
                </View>

                <TouchableOpacity
                  style={styles.googleButton}
                  onPress={handleGoogleLogin}
                  disabled={loading}
                  activeOpacity={0.8}
                >
                  <Ionicons name="logo-google" size={20} color="#111827" />
                  <Text style={styles.googleButtonText}>Увійти через Google</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F4F4F4' },
  content: { padding: 16, paddingBottom: 150 },
  card: {
    backgroundColor: '#FFF',
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: '#EEE',
  },
  title: { fontSize: 22, fontWeight: '900', color: '#111827', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#6B7280', lineHeight: 20, marginBottom: 18 },
  input: {
    borderWidth: 1,
    borderColor: '#DDD',
    borderRadius: 12,
    padding: 15,
    fontSize: 18,
    marginBottom: 14,
    backgroundColor: '#FFF',
  },
  primaryButton: {
    backgroundColor: '#458B00',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  disabledButton: { opacity: 0.7 },
  primaryButtonText: { color: '#FFF', fontSize: 16, fontWeight: '800' },
  secondaryPlain: { marginTop: 14, alignItems: 'center' },
  secondaryPlainText: { color: '#458B00', fontWeight: '800' },
  orRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 18 },
  orLine: { flex: 1, height: 1, backgroundColor: '#E5E7EB' },
  orText: { marginHorizontal: 10, color: '#9CA3AF', fontWeight: '700' },
  googleButton: {
    borderWidth: 1,
    borderColor: '#DDD',
    backgroundColor: '#FFF',
    padding: 15,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  googleButtonText: { color: '#111827', fontSize: 16, fontWeight: '800' },
});
