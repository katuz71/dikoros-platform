import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { API_URL } from '@/config/api';
import { trackEvent } from '@/utils/analytics';
import { logFirebaseEvent } from '@/utils/firebaseAnalytics';
import { hasBiometricLoginEnabled, promptEnableBiometricLogin } from '@/utils/biometricAuth';

const WELCOME_BONUS_MODAL_SEEN_KEY = 'welcomeBonusModalSeenV1';

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

export function WelcomeBonusModal() {
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const [inputPhone, setInputPhone] = useState('');
  const [smsCode, setSmsCode] = useState('');
  const [smsSent, setSmsSent] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let mounted = true;

    const maybeShowModal = async () => {
      try {
        const [seen, accessToken, biometricEnabled] = await Promise.all([
          AsyncStorage.getItem(WELCOME_BONUS_MODAL_SEEN_KEY),
          AsyncStorage.getItem('accessToken'),
          hasBiometricLoginEnabled(),
        ]);

        if (!mounted) return;
        if (!seen && !accessToken && !biometricEnabled) {
          setVisible(true);
        }
      } catch (error) {
        console.warn('Welcome bonus modal check failed:', error);
      }
    };

    maybeShowModal();

    return () => {
      mounted = false;
    };
  }, []);

  const closeModal = async () => {
    await AsyncStorage.setItem(WELCOME_BONUS_MODAL_SEEN_KEY, '1');
    setVisible(false);
  };

  const attachPushToken = async (accessToken: string) => {
    try {
      const expoPushToken = await AsyncStorage.getItem('expoPushToken');
      if (!expoPushToken) return;

      await fetch(`${API_URL}/api/user/push-token/me`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ token: expoPushToken }),
      });
    } catch (error) {
      console.warn('Save push token after welcome login failed:', error);
    }
  };

  const sendSmsCode = async () => {
    const canon = canonicalizePhone(inputPhone);

    if (canon.length !== 12 || !canon.startsWith('380')) {
      Alert.alert('Помилка', 'Введіть номер у форматі +380 XX XXX XX XX');
      return;
    }

    setLoading(true);
    setInputPhone(formatPhoneInput(canon));

    try {
      const res = await fetch(`${API_URL}/api/auth/sms/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: canon }),
      });

      if (!res.ok) {
        Alert.alert('Помилка', 'Не вдалося відправити SMS-код');
        return;
      }

      setSmsSent(true);
      setSmsCode('');
    } catch (error) {
      console.error(error);
      Alert.alert('Помилка', 'Немає з’єднання');
    } finally {
      setLoading(false);
    }
  };

  const verifySmsCode = async () => {
    const canon = canonicalizePhone(inputPhone);
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
        body: JSON.stringify({
          phone: canon,
          code: cleanSmsCode,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        Alert.alert('Помилка', err?.detail || 'Невірний SMS-код');
        return;
      }

      const user = await res.json();

      await AsyncStorage.setItem('userPhone', canon);
      if (user.access_token) {
        await AsyncStorage.setItem('accessToken', user.access_token);
        await attachPushToken(user.access_token);
      }
      if (user.name) {
        await AsyncStorage.setItem('userName', user.name);
      }
      await AsyncStorage.setItem(WELCOME_BONUS_MODAL_SEEN_KEY, '1');

      if (user.is_new_user) {
        trackEvent('CompleteRegistration', {
          method: 'sms_welcome_modal',
          value: 150,
          currency: 'UAH',
        });

        logFirebaseEvent('sign_up', {
          method: 'sms_welcome_modal',
        });
      }

      setVisible(false);
      setSmsSent(false);
      setSmsCode('');
      router.replace('/(tabs)/profile' as any);

      if (user.is_new_user && user.access_token) {
        await promptEnableBiometricLogin(user.access_token, canon);
      }
    } catch (error) {
      console.error(error);
      Alert.alert('Помилка', 'Немає з’єднання');
    } finally {
      setLoading(false);
    }
  };

  const handlePrimaryPress = () => {
    if (loading) return;
    if (smsSent) verifySmsCode();
    else sendSmsCode();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={closeModal}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <TouchableOpacity style={styles.closeButton} onPress={closeModal} activeOpacity={0.8}>
            <Ionicons name="close" size={22} color="#6B7280" />
          </TouchableOpacity>

          <View style={styles.iconWrap}>
            <Ionicons name="gift" size={34} color="#FFFFFF" />
          </View>

          <Text style={styles.kicker}>Бонус для нових клієнтів</Text>
          <Text style={styles.title}>Зареєструйся та отримай 150 грн</Text>
          <Text style={styles.subtitle}>
            Використай бонус на покупку товарів Dikoros після створення акаунта.
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

          <TouchableOpacity style={styles.primaryButton} onPress={handlePrimaryPress} activeOpacity={0.9} disabled={loading}>
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryButtonText}>{smsSent ? 'Підтвердити код' : 'Зареєструватися'}</Text>
            )}
          </TouchableOpacity>

          {smsSent && (
            <TouchableOpacity style={styles.resendButton} onPress={sendSmsCode} activeOpacity={0.8} disabled={loading}>
              <Text style={styles.resendButtonText}>Надіслати код ще раз</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.secondaryButton} onPress={closeModal} activeOpacity={0.8} disabled={loading}>
            <Text style={styles.secondaryButtonText}>Пізніше</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    paddingHorizontal: 24,
    paddingTop: 34,
    paddingBottom: 22,
    alignItems: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.22,
    shadowRadius: 28,
    elevation: 12,
  },
  closeButton: {
    position: 'absolute',
    top: 14,
    right: 14,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F3F4F6',
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#458B00',
    marginBottom: 16,
  },
  kicker: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.4,
    color: '#458B00',
    textTransform: 'uppercase',
    marginBottom: 8,
    textAlign: 'center',
  },
  title: {
    fontSize: 27,
    lineHeight: 32,
    fontWeight: '900',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 23,
    color: '#4B5563',
    textAlign: 'center',
    marginBottom: 18,
  },
  input: {
    width: '100%',
    height: 52,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 16,
    paddingHorizontal: 16,
    fontSize: 17,
    color: '#111827',
    backgroundColor: '#FFFFFF',
    marginBottom: 12,
  },
  primaryButton: {
    width: '100%',
    height: 54,
    borderRadius: 18,
    backgroundColor: '#458B00',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '900',
  },
  resendButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginBottom: 2,
  },
  resendButtonText: {
    color: '#458B00',
    fontSize: 15,
    fontWeight: '800',
  },
  secondaryButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  secondaryButtonText: {
    color: '#6B7280',
    fontSize: 15,
    fontWeight: '700',
  },
});
