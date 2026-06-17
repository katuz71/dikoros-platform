import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { Alert } from 'react-native';

const BIOMETRIC_ENABLED_KEY = 'dikoros_biometric_enabled_v1';
const BIOMETRIC_ACCESS_TOKEN_KEY = 'dikoros_biometric_access_token_v1';
const BIOMETRIC_USER_PHONE_KEY = 'dikoros_biometric_user_phone_v1';

const canUseBiometrics = async () => {
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  const isEnrolled = await LocalAuthentication.isEnrolledAsync();
  return hasHardware && isEnrolled;
};

const askUser = (title: string, message: string) =>
  new Promise<boolean>((resolve) => {
    Alert.alert(title, message, [
      { text: 'Скасувати', style: 'cancel', onPress: () => resolve(false) },
      { text: 'OK', onPress: () => resolve(true) },
    ]);
  });

export const hasBiometricLoginEnabled = async () => {
  return (await SecureStore.getItemAsync(BIOMETRIC_ENABLED_KEY)) === '1';
};

export const promptEnableBiometricLogin = async (accessToken: string, phone: string) => {
  try {
    if (!accessToken || !phone) return false;

    const available = await canUseBiometrics();
    if (!available) return false;

    const alreadyEnabled = await hasBiometricLoginEnabled();
    if (alreadyEnabled) return false;

    const approved = await askUser(
      'Хочете входити за допомогою відбитка пальця?',
      'У додатку DikorosUA можна використовувати відбиток пальця для швидкого входу.'
    );

    if (!approved) return false;

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Підтвердіть відбитком пальця',
      cancelLabel: 'Скасувати',
      fallbackLabel: 'Код пристрою',
      disableDeviceFallback: false,
    });

    if (!result.success) return false;

    await SecureStore.setItemAsync(BIOMETRIC_ENABLED_KEY, '1');
    await SecureStore.setItemAsync(BIOMETRIC_ACCESS_TOKEN_KEY, accessToken);
    await SecureStore.setItemAsync(BIOMETRIC_USER_PHONE_KEY, phone);

    Alert.alert('Готово', 'Швидкий вхід за відбитком пальця увімкнено.');
    return true;
  } catch (error) {
    console.warn('Enable biometric login failed:', error);
    return false;
  }
};

export const tryRestoreBiometricSession = async () => {
  try {
    const existingToken = await AsyncStorage.getItem('accessToken');
    if (existingToken) return false;

    const enabled = await hasBiometricLoginEnabled();
    if (!enabled) return false;

    const [storedToken, storedPhone] = await Promise.all([
      SecureStore.getItemAsync(BIOMETRIC_ACCESS_TOKEN_KEY),
      SecureStore.getItemAsync(BIOMETRIC_USER_PHONE_KEY),
    ]);

    if (!storedToken || !storedPhone) return false;

    const available = await canUseBiometrics();
    if (!available) return false;

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Увійти в DikorosUA',
      cancelLabel: 'Скасувати',
      fallbackLabel: 'Код пристрою',
      disableDeviceFallback: false,
    });

    if (!result.success) return false;

    await AsyncStorage.setItem('accessToken', storedToken);
    await AsyncStorage.setItem('userPhone', storedPhone);

    return true;
  } catch (error) {
    console.warn('Restore biometric session failed:', error);
    return false;
  }
};
