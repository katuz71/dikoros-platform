import { AppHeader } from '@/components/AppHeader';
import { API_URL } from '@/config/api';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
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

type ContactPreference = 'call' | 'telegram' | 'viber';

type UserProfile = {
  phone?: string;
  name?: string;
  city?: string;
  warehouse?: string;
  ukrposhta?: string;
  email?: string;
  contact_preference?: ContactPreference;
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

const splitFullName = (value: string) => {
  const parts = String(value || '').trim().split(/\s+/).filter(Boolean);
  return {
    lastName: parts[0] || '',
    firstName: parts[1] || '',
    middleName: parts.slice(2).join(' '),
  };
};

export default function ProfileInfoScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [phone, setPhone] = useState('');
  const [lastName, setLastName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [infoCity, setInfoCity] = useState('');
  const [infoWarehouse, setInfoWarehouse] = useState('');
  const [infoUkrposhta, setInfoUkrposhta] = useState('');
  const [infoEmail, setInfoEmail] = useState('');
  const [infoContactPreference, setInfoContactPreference] = useState<ContactPreference>('call');

  const buildFullName = () => [lastName, firstName, middleName].map(v => v.trim()).filter(Boolean).join(' ');

  const loadUserInfo = useCallback(async () => {
    setLoading(true);
    try {
      const accessToken = await AsyncStorage.getItem('accessToken');
      const storedPhone = await AsyncStorage.getItem('userPhone');

      if (!accessToken) {
        Alert.alert('Потрібен вхід', 'Увійдіть у профіль, щоб редагувати дані.');
        router.back();
        return;
      }

      const res = await fetch(`${API_URL}/api/user/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!res.ok) {
        Alert.alert('Помилка', 'Не вдалося завантажити дані профілю.');
        router.back();
        return;
      }

      const user: UserProfile = await res.json();
      const parsedName = splitFullName(user.name || '');

      setPhone(user.phone || storedPhone || '');
      setLastName(parsedName.lastName);
      setFirstName(parsedName.firstName);
      setMiddleName(parsedName.middleName);
      setInfoCity(user.city || '');
      setInfoWarehouse(user.warehouse || '');
      setInfoUkrposhta(user.ukrposhta || '');
      setInfoEmail(user.email || '');
      setInfoContactPreference(user.contact_preference || 'call');
    } catch (e) {
      console.error(e);
      Alert.alert('Помилка', 'Немає зʼєднання');
      router.back();
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    loadUserInfo();
  }, [loadUserInfo]);

  const saveUserInfo = async () => {
    if (saving) return;
    setSaving(true);

    try {
      const accessToken = await AsyncStorage.getItem('accessToken');

      if (!accessToken) {
        Alert.alert('Потрібен вхід', 'Увійдіть у профіль, щоб зберегти дані.');
        return;
      }

      const fullName = buildFullName();

      const res = await fetch(`${API_URL}/api/user/info/me`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          name: fullName,
          city: infoCity,
          warehouse: infoWarehouse,
          user_ukrposhta: infoUkrposhta,
          email: infoEmail,
          contact_preference: infoContactPreference,
        }),
      });

      if (!res.ok) {
        Alert.alert('Помилка', 'Не вдалося зберегти дані');
        return;
      }

      await AsyncStorage.setItem('userName', fullName);
      await AsyncStorage.setItem(
        'savedCheckoutInfo',
        JSON.stringify({
          name: firstName.trim(),
          lastName: lastName.trim(),
          middleName: middleName.trim(),
          email: infoEmail,
          city: infoCity ? { ref: '', name: infoCity } : { ref: '', name: '' },
          warehouse: infoWarehouse ? { ref: '', name: infoWarehouse } : { ref: '', name: '' },
          ukrposhtaWarehouse: infoUkrposhta ? { ref: '', name: infoUkrposhta } : { ref: '', name: '' },
          contact_preference: infoContactPreference,
        })
      );

      Alert.alert('Успіх', 'Дані оновлено', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (e) {
      console.error(e);
      Alert.alert('Помилка', 'Немає зʼєднання');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <AppHeader showLogo showSearch showFavorites />

      <View style={styles.unifiedTitleRow}>
        <TouchableOpacity style={styles.unifiedTitleButton} onPress={() => router.back()} activeOpacity={0.75}>
          <Ionicons name="arrow-back" size={24} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.unifiedTitle} numberOfLines={1}>Особиста інформація</Text>
        <View style={styles.unifiedTitleButton} />
      </View>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#458B00" />
        </View>
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.label}>Телефон</Text>
            <TextInput
              style={[styles.input, styles.disabledInput]}
              value={formatPhoneInput(phone)}
              editable={false}
            />

            <Text style={styles.label}>Прізвище</Text>
            <TextInput
              style={styles.input}
              value={lastName}
              onChangeText={setLastName}
              placeholder="Іванов"
            />

            <Text style={styles.label}>Ім’я</Text>
            <TextInput
              style={styles.input}
              value={firstName}
              onChangeText={setFirstName}
              placeholder="Іван"
            />

            <Text style={styles.label}>По батькові (не обов’язково)</Text>
            <TextInput
              style={styles.input}
              value={middleName}
              onChangeText={setMiddleName}
              placeholder="Іванович"
            />

            <Text style={styles.label}>Місто</Text>
            <TextInput
              style={styles.input}
              value={infoCity}
              onChangeText={setInfoCity}
              placeholder="Київ"
            />

            <Text style={styles.label}>Відділення Нової Пошти</Text>
            <TextInput
              style={styles.input}
              value={infoWarehouse}
              onChangeText={setInfoWarehouse}
              placeholder="Відділення №1"
            />

            <Text style={styles.label}>Відділення Укрпошти</Text>
            <TextInput
              style={styles.input}
              value={infoUkrposhta}
              onChangeText={setInfoUkrposhta}
              placeholder="Відділення / індекс"
            />

            <Text style={styles.label}>Email (не обов’язково)</Text>
            <TextInput
              style={styles.input}
              value={infoEmail}
              onChangeText={setInfoEmail}
              placeholder="example@email.com"
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <Text style={styles.label}>Зручний спосіб зв’язку</Text>
            <View style={styles.contactRow}>
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

            <TouchableOpacity
              style={[styles.saveButton, saving && styles.saveButtonDisabled]}
              onPress={saveUserInfo}
              disabled={saving}
            >
              <Text style={styles.saveButtonText}>{saving ? 'Зберігаємо...' : 'Зберегти'}</Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F4F4F4' },
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
  header: {
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
  },
  headerButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1F2937',
  },
  loadingBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    padding: 20,
    paddingBottom: 130,
  },
  label: {
    marginBottom: 6,
    color: '#666',
    fontSize: 14,
    fontWeight: '600',
  },
  input: {
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#DDD',
    borderRadius: 10,
    padding: 15,
    fontSize: 18,
    marginBottom: 18,
  },
  disabledInput: {
    backgroundColor: '#F5F5F5',
    color: '#888',
  },
  contactRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 24,
  },
  contactChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#F0F0F0',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  contactChipActive: {
    backgroundColor: '#E8F5E9',
    borderColor: '#4CAF50',
  },
  contactChipText: {
    fontSize: 12,
    color: '#333',
    fontWeight: '500',
  },
  contactChipTextActive: {
    color: '#2E7D32',
    fontWeight: 'bold',
  },
  saveButton: {
    backgroundColor: '#458B00',
    padding: 16,
    borderRadius: 10,
    alignItems: 'center',
  },
  saveButtonDisabled: {
    opacity: 0.7,
  },
  saveButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
});