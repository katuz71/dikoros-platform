import { API_URL } from '@/config/api';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
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
import { SafeAreaView } from 'react-native-safe-area-context';

const normalizePhone = (value: string) => {
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

export default function ReferralRegistrationScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ referrer?: string; ref?: string }>();
  const referrer = useMemo(
    () => normalizePhone(String(params.referrer || params.ref || '')),
    [params.referrer, params.ref]
  );

  const [phone, setPhone] = useState('');
  const [smsCode, setSmsCode] = useState('');
  const [smsSent, setSmsSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const sendSms = async () => {
    const cleanPhone = normalizePhone(phone);

    if (cleanPhone.length !== 12 || !cleanPhone.startsWith('380')) {
      Alert.alert('Помилка', 'Введіть номер у форматі +380 XX XXX XX XX');
      return;
    }
    if (!referrer || referrer.length !== 12 || referrer === cleanPhone) {
      Alert.alert('Помилка', 'Реферальне посилання некоректне. Попросіть друга надіслати посилання ще раз.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/sms/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: cleanPhone, referrer }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        Alert.alert('Помилка', err?.detail || 'Не вдалося відправити SMS-код');
        return;
      }

      setPhone(formatPhoneInput(cleanPhone));
      setSmsSent(true);
      setSmsCode('');
      Alert.alert('Код відправлено', 'Введіть SMS-код для завершення реєстрації.');
    } catch (error) {
      console.error(error);
      Alert.alert('Помилка', 'Немає з’єднання');
    } finally {
      setLoading(false);
    }
  };

  const verifySms = async () => {
    const cleanPhone = normalizePhone(phone);
    const cleanCode = smsCode.replace(/\D/g, '');

    if (cleanPhone.length !== 12 || !cleanPhone.startsWith('380')) {
      Alert.alert('Помилка', 'Введіть номер у форматі +380 XX XXX XX XX');
      return;
    }
    if (cleanCode.length !== 6) {
      Alert.alert('Помилка', 'Введіть SMS-код');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/sms/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: cleanPhone, code: cleanCode, referrer }),
      });

      const user = await res.json().catch(() => null);
      if (!res.ok) {
        Alert.alert('Помилка', user?.detail || 'Невірний SMS-код');
        return;
      }

      await AsyncStorage.setItem('userPhone', cleanPhone);
      if (user?.access_token) {
        await AsyncStorage.setItem('accessToken', user.access_token);
      }
      if (user?.name) {
        await AsyncStorage.setItem('userName', user.name);
      }

      Alert.alert(
        'Готово',
        user?.is_new_user
          ? 'Ви отримали 150 грн бонусами за реєстрацію.'
          : 'Вхід виконано. Якщо акаунт вже існував, реферальний бонус повторно не нараховується.',
        [{ text: 'До профілю', onPress: () => router.replace('/(tabs)/profile' as any) }]
      );
    } catch (error) {
      console.error(error);
      Alert.alert('Помилка', 'Немає з’єднання');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardAvoidingView}
      >
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            <Text style={styles.emoji}>🍄</Text>
            <Text style={styles.title}>Запрошення в DikorosUA</Text>
            <Text style={styles.subtitle}>
              Зареєструйтесь через SMS та отримайте 150 грн бонусами. Ваш друг отримає 50 грн після вашої реєстрації.
            </Text>

            <View style={styles.refBox}>
              <Text style={styles.refLabel}>Код друга</Text>
              <Text style={styles.refValue}>{referrer || 'не вказано'}</Text>
            </View>

            <Text style={styles.inputLabel}>Ваш телефон</Text>
            <TextInput
              style={styles.input}
              placeholder="+380 XX XXX XX XX"
              keyboardType="phone-pad"
              value={phone}
              onChangeText={(value) => setPhone(formatPhoneInput(value))}
            />

            {smsSent && (
              <>
                <Text style={styles.inputLabel}>SMS-код</Text>
                <TextInput
                  style={styles.input}
                  placeholder="6 цифр"
                  keyboardType="number-pad"
                  value={smsCode}
                  maxLength={6}
                  onChangeText={(value) => setSmsCode(value.replace(/\D/g, '').slice(0, 6))}
                />
              </>
            )}

            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={smsSent ? verifySms : sendSms}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>{smsSent ? 'Завершити реєстрацію' : 'Отримати SMS-код'}</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity style={styles.secondaryButton} onPress={() => router.replace('/(tabs)/profile' as any)}>
              <Text style={styles.secondaryButtonText}>У мене вже є акаунт</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F5F7F1' },
  keyboardAvoidingView: { flex: 1 },
  container: { flexGrow: 1, justifyContent: 'center', padding: 20 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 24,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
  },
  emoji: { fontSize: 42, textAlign: 'center', marginBottom: 8 },
  title: { fontSize: 26, fontWeight: '800', textAlign: 'center', color: '#172018', marginBottom: 10 },
  subtitle: { fontSize: 15, color: '#5A6658', textAlign: 'center', lineHeight: 22, marginBottom: 20 },
  refBox: { backgroundColor: '#EEF7E8', borderRadius: 14, padding: 14, marginBottom: 18 },
  refLabel: { fontSize: 12, color: '#6B7668', marginBottom: 4 },
  refValue: { fontSize: 17, fontWeight: '700', color: '#2F7D32' },
  inputLabel: { fontSize: 14, fontWeight: '700', color: '#172018', marginBottom: 8 },
  input: {
    height: 52,
    borderWidth: 1,
    borderColor: '#D8E0D4',
    borderRadius: 14,
    paddingHorizontal: 14,
    fontSize: 17,
    marginBottom: 16,
    backgroundColor: '#FAFBF8',
  },
  button: {
    height: 52,
    borderRadius: 14,
    backgroundColor: '#2F7D32',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 4,
  },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  secondaryButton: { paddingVertical: 16, alignItems: 'center' },
  secondaryButtonText: { color: '#2F7D32', fontSize: 15, fontWeight: '700' },
});
