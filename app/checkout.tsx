import { AppHeader } from '@/components/AppHeader';
import { logFirebaseEvent } from '@/utils/firebaseAnalytics';
import { trackEvent } from '@/utils/analytics';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Linking,
  KeyboardAvoidingView,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { API_URL } from '../config/api';
import { useCart } from '../context/CartContext';

const POPULAR_CITIES = ['Київ', 'Львів', 'Одеса', 'Дніпро', 'Харків', 'Івано-Франківськ'];
const MIN_ORDER_AMOUNT = 200;
const UA_PHONE_MASK_MAX_LENGTH = 17;

type DeliveryMethod = 'ukrposhta_branch' | 'nova_poshta' | 'nova_poshta_international';
type PaymentMethod = 'postpaid' | 'bank_transfer' | 'paypal_request';
type EditSection = 'contact' | 'recipient' | 'delivery' | 'payment' | 'comment' | 'order' | null;

type SelectValue = { ref: string; name: string };

const DELIVERY_OPTIONS: { id: DeliveryMethod; label: string; hint?: string }[] = [
  { id: 'ukrposhta_branch', label: 'Укрпошта до відділення (Безкоштовно від 1000 грн)' },
  { id: 'nova_poshta', label: 'Новою поштою (Безкоштовно від 1500грн)' },
  { id: 'nova_poshta_international', label: 'Нова пошта, закордонна доставка' },
];

const PAYMENT_OPTIONS: { id: PaymentMethod; label: string }[] = [
  { id: 'postpaid', label: 'Післяплата на пошті' },
  { id: 'bank_transfer', label: 'Оплата на карту/рахунок' },
  { id: 'paypal_request', label: 'PayPal по запиту' },
];

const DELIVERY_PAYMENT_MAP: Record<DeliveryMethod, PaymentMethod[]> = {
  ukrposhta_branch: ['postpaid', 'bank_transfer', 'paypal_request'],
  nova_poshta: ['postpaid', 'bank_transfer', 'paypal_request'],
  nova_poshta_international: ['bank_transfer', 'paypal_request'],
};

const getAllowedPaymentOptions = (deliveryMethod: DeliveryMethod) =>
  PAYMENT_OPTIONS.filter(option => DELIVERY_PAYMENT_MAP[deliveryMethod].includes(option.id));

const getPaymentOptionLabel = (option: { id: PaymentMethod; label: string }, deliveryMethod: DeliveryMethod) => {
  if (option.id === 'postpaid' && deliveryMethod === 'ukrposhta_branch') {
    return 'Післяплата на пошті (Наложений платіж)';
  }
  if (option.id === 'postpaid' && deliveryMethod === 'nova_poshta') {
    return 'Післяплата на пошті (Контроль оплати)';
  }
  return option.label;
};

const getUaSubscriberDigits = (value: string) => {
  let digits = (value || '').replace(/\D/g, '');
  if (digits.startsWith('380')) digits = digits.slice(3);
  if (digits.startsWith('0')) digits = digits.slice(1);
  return digits.slice(0, 9);
};

const formatUaPhoneInput = (value: string) => {
  const digits = getUaSubscriberDigits(value);
  if (!digits && !(value || '').includes('380') && !(value || '').includes('+')) return '';

  const parts = ['+380'];
  if (digits.length > 0) parts.push(digits.slice(0, 2));
  if (digits.length > 2) parts.push(digits.slice(2, 5));
  if (digits.length > 5) parts.push(digits.slice(5, 7));
  if (digits.length > 7) parts.push(digits.slice(7, 9));

  return parts.filter(Boolean).join(' ');
};

const canonicalizePhone = (value: string) => {
  const digits = (value || '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('380')) return `0${digits.slice(3)}`;
  if (digits.length === 9) return `0${digits}`;
  if (digits.length === 10 && digits.startsWith('0')) return digits;
  return digits;
};

const formatPrice = (value: number) => {
  const safeValue = Math.round(Number(value) || 0);
  return `${safeValue.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ₴`;
};

export default function CheckoutScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { items, totalPrice, finalPrice, clearCart, appliedPromoCode, discount, discountAmount } = useCart() as any;

  const cartTotal = Number(totalPrice || 0);
  const cartFinal = Number(finalPrice ?? totalPrice ?? 0);
  const itemsSubtotal = (items || []).reduce(
    (sum: number, item: any) => sum + Number(item.price || 0) * Number(item.quantity || 1),
    0
  );
  const minOrderMissing = Math.max(0, MIN_ORDER_AMOUNT - itemsSubtotal);
  const isBelowMinOrder = minOrderMissing > 0;

  const [name, setName] = useState('');
  const [lastName, setLastName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [contactMethod, setContactMethod] = useState<'call' | 'telegram' | 'viber'>('call');
  const [isDifferentRecipient, setIsDifferentRecipient] = useState(false);
  const [recipientName, setRecipientName] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');
  const [doNotCall, setDoNotCall] = useState(false);

  const [city, setCity] = useState<SelectValue>({ ref: '', name: '' });
  const [warehouse, setWarehouse] = useState<SelectValue>({ ref: '', name: '' });
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>('nova_poshta');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('postpaid');
  const [orderComment, setOrderComment] = useState('');

  const [bonusBalance, setBonusBalance] = useState(0);
  const [useBonuses, setUseBonuses] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [saveUserData, setSaveUserData] = useState(true);
  const saveUserDataRef = useRef(true);

  const [editSection, setEditSection] = useState<EditSection>(null);
  const [modalVisible, setModalVisible] = useState<'city' | 'warehouse' | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SelectValue[]>([]);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    saveUserDataRef.current = saveUserData;
  }, [saveUserData]);

  useEffect(() => {
    const allowedPayments = getAllowedPaymentOptions(deliveryMethod);
    if (!allowedPayments.some(option => option.id === paymentMethod)) {
      setPaymentMethod(allowedPayments[0]?.id || 'bank_transfer');
    }
  }, [deliveryMethod, paymentMethod]);

  useEffect(() => {
    loadUserData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadUserData = async () => {
    try {
      const [storedPhone, accessToken, savedInfo] = await Promise.all([
        AsyncStorage.getItem('userPhone'),
        AsyncStorage.getItem('accessToken'),
        AsyncStorage.getItem('savedCheckoutInfo'),
      ]);

      const loggedIn = Boolean(storedPhone && accessToken);
      setIsLoggedIn(loggedIn);

      if (storedPhone) {
        const canon = canonicalizePhone(storedPhone);
        setPhone(formatUaPhoneInput(canon));
      }

      if (savedInfo) {
        const parsed = JSON.parse(savedInfo);
        if (parsed.name) setName(parsed.name);
        if (parsed.lastName) setLastName(parsed.lastName);
        if (parsed.middleName) setMiddleName(parsed.middleName);
        if (parsed.phone && !storedPhone) setPhone(formatUaPhoneInput(parsed.phone));
        if (parsed.recipientName) setRecipientName(parsed.recipientName);
        if (parsed.recipientPhone) setRecipientPhone(formatUaPhoneInput(parsed.recipientPhone));
        if (parsed.isDifferentRecipient) setIsDifferentRecipient(Boolean(parsed.isDifferentRecipient));
        if (parsed.doNotCall) setDoNotCall(Boolean(parsed.doNotCall));
        if (parsed.email) setEmail(parsed.email);
        if (parsed.city) setCity(parsed.city);
        if (parsed.warehouse) setWarehouse(parsed.warehouse);
        if (parsed.deliveryMethod && DELIVERY_OPTIONS.some(option => option.id === parsed.deliveryMethod)) {
          setDeliveryMethod(parsed.deliveryMethod);
        }
        if (parsed.paymentMethod && PAYMENT_OPTIONS.some(option => option.id === parsed.paymentMethod)) {
          setPaymentMethod(parsed.paymentMethod);
        }
        if (parsed.orderComment) setOrderComment(parsed.orderComment);
        setSaveUserData(true);
      }

      if (loggedIn && accessToken) {
        await fetchUserData(accessToken);
      }
    } catch (e) {
      console.log(e);
    }
  };

  const fetchUserData = async (accessToken: string) => {
    try {
      const res = await fetch(`${API_URL}/api/user/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!res.ok) return;

      const data = await res.json();
      setBonusBalance(data.bonus_balance || 0);
      if (data.email && !email) setEmail(data.email);
      if (data.name && !name) setName(data.name);
      if (data.city && !city.name) setCity({ ref: '', name: data.city });
      if (data.warehouse && !warehouse.name) setWarehouse({ ref: '', name: data.warehouse });
      if (data.contact_preference && ['call', 'telegram', 'viber'].includes(data.contact_preference)) {
        setContactMethod(data.contact_preference as 'call' | 'telegram' | 'viber');
      }
    } catch (e) {
      console.log(e);
    }
  };

  const searchCity = async (text: string) => {
    setSearchQuery(text);
    if (text.length < 2) {
      setSearchResults([]);
      return;
    }

    setLoadingSearch(true);

    try {
      const endpoint = deliveryMethod === 'ukrposhta_branch'
        ? '/api/delivery/ukrposhta/cities'
        : '/api/delivery/cities';

      const response = await fetch(`${API_URL}${endpoint}?q=${encodeURIComponent(text)}`);
      const data = await response.json();

      if (Array.isArray(data)) {
        setSearchResults(data.map((item: any) => ({ ref: item.ref, name: item.name })));
      } else {
        setSearchResults([]);
      }
    } catch {
      setSearchResults([]);
    } finally {
      setLoadingSearch(false);
    }
  };

  const loadWarehouses = async () => {
    if (!city.ref) return;

    setLoadingSearch(true);
    setSearchResults([]);

    try {
      const endpoint = deliveryMethod === 'ukrposhta_branch'
        ? '/api/delivery/ukrposhta/warehouses'
        : '/api/delivery/warehouses';

      const response = await fetch(`${API_URL}${endpoint}?city_ref=${encodeURIComponent(city.ref)}`);
      const data = await response.json();

      if (Array.isArray(data)) {
        setSearchResults(data.map((item: any) => ({ ref: item.ref, name: item.name })));
      } else {
        setSearchResults([]);
      }
    } catch {
      setSearchResults([]);
    } finally {
      setLoadingSearch(false);
    }
  };

  const openModal = (type: 'city' | 'warehouse') => {
    if (type === 'warehouse' && !city.ref) {
      Alert.alert('Увага', 'Спочатку оберіть місто!');
      return;
    }

    setModalVisible(type);
    setSearchQuery('');
    setSearchResults([]);

    if (type === 'warehouse') {
      loadWarehouses();
    }
  };

  const handleSelect = (item: SelectValue) => {
    if (modalVisible === 'city') {
      setCity(item);
      setWarehouse({ ref: '', name: '' });
    } else {
      setWarehouse(item);
    }
    setModalVisible(null);
  };

  const handleDeliveryMethodChange = (method: DeliveryMethod) => {
    if (method !== deliveryMethod) {
      setCity({ ref: '', name: '' });
      setWarehouse({ ref: '', name: '' });
    }
    setDeliveryMethod(method);
  };

  const saveCheckoutInfoLocally = async () => {
    if (!saveUserDataRef.current) {
      await AsyncStorage.removeItem('savedCheckoutInfo');
      return;
    }

    await AsyncStorage.setItem('savedCheckoutInfo', JSON.stringify({
      name,
      lastName,
      middleName,
      phone,
      recipientName,
      recipientPhone,
      isDifferentRecipient,
      doNotCall,
      email,
      city,
      warehouse,
      deliveryMethod,
      paymentMethod,
      orderComment,
    }));
  };

  const handleSubmit = async () => {
    if (!items || items.length === 0) {
      Alert.alert('Кошик порожній', 'Додайте товар у кошик перед оформленням замовлення.');
      return;
    }

    if (isBelowMinOrder) {
      router.push('/(tabs)' as any);
      return;
    }

    if (!lastName.trim() || !name.trim() || !phone.trim() || !city.name || !warehouse.name) {
      Alert.alert('Увага', `Будь ласка, заповніть всі поля:\n• Прізвище\n• Ім'я\n• Телефон покупця\n• Доставка`);
      return;
    }

    const cleanBuyerPhone = canonicalizePhone(phone);
    if (cleanBuyerPhone.length !== 10 || !cleanBuyerPhone.startsWith('0')) {
      Alert.alert('Увага', 'Введіть коректний телефон покупця у форматі +380 XX XXX XX XX.');
      return;
    }

    if (isDifferentRecipient && (!recipientName.trim() || !recipientPhone.trim())) {
      Alert.alert('Увага', 'Заповніть ПІБ та телефон отримувача.');
      return;
    }

    if (isDifferentRecipient) {
      const cleanRecipientPhone = canonicalizePhone(recipientPhone);
      if (cleanRecipientPhone.length !== 10 || !cleanRecipientPhone.startsWith('0')) {
        Alert.alert('Увага', 'Введіть коректний телефон отримувача у форматі +380 XX XXX XX XX.');
        return;
      }
    }

    const accessToken = await AsyncStorage.getItem('accessToken');
    const storedPhone = await AsyncStorage.getItem('userPhone');
    const authenticatedCheckout = Boolean(accessToken && storedPhone);

    setLoading(true);

    try {
      await saveCheckoutInfoLocally();

      const cleanItems = (items || []).map((item: any) => ({
        id: Number(item.id),
        name: item.name,
        price: Number(item.price),
        quantity: Number(item.quantity || 1),
        packSize: item.packSize || null,
        unit: item.unit || 'шт',
        variant_info: item?.variantSize || item?.packSize || item?.unit || null,
      }));

      const canUseBonuses = authenticatedCheckout && useBonuses;
      const bonusesToUse = canUseBonuses ? Math.min(bonusBalance, cartFinal) : 0;
      const finalPriceWithBonuses = Math.max(0, cartFinal - bonusesToUse);
      const clientFullName = [lastName, name, middleName].map(v => v.trim()).filter(Boolean).join(' ');
      const finalRecipientName = isDifferentRecipient ? recipientName.trim() : clientFullName;
      const finalRecipientPhone = isDifferentRecipient ? canonicalizePhone(recipientPhone) : cleanBuyerPhone;
      const finalCityRef = ['nova_poshta', 'ukrposhta_branch'].includes(deliveryMethod) ? (city.ref || '') : '';
      const finalWarehouseRef = ['nova_poshta', 'ukrposhta_branch'].includes(deliveryMethod) ? (warehouse.ref || '') : '';
      const phoneForAccount = authenticatedCheckout ? canonicalizePhone(storedPhone || cleanBuyerPhone) : cleanBuyerPhone;

      const orderData = {
        name,
        last_name: lastName.trim(),
        middle_name: middleName.trim(),
        client_full_name: clientFullName || name,
        recipient_name: finalRecipientName,
        recipient_phone: finalRecipientPhone,
        do_not_call: doNotCall,
        user_phone: phoneForAccount,
        phone: cleanBuyerPhone,
        email: email || '',
        contact_preference: contactMethod,
        city: city.name,
        cityRef: finalCityRef,
        city_ref: finalCityRef,
        warehouse: warehouse.name,
        warehouseRef: finalWarehouseRef,
        warehouse_ref: finalWarehouseRef,
        delivery_method: deliveryMethod,
        items: cleanItems,
        totalPrice: Math.floor(finalPriceWithBonuses),
        payment_method: paymentMethod,
        comment: orderComment.trim(),
        comments: orderComment.trim(),
        bonus_used: bonusesToUse,
        bonus_balance: authenticatedCheckout ? bonusBalance : 0,
        use_bonuses: canUseBonuses,
        promo_code: appliedPromoCode || null,
        promo_discount_percent: discount ? Math.round(Number(discount) * 100) : 0,
        promo_discount_amount: discountAmount ? Number(discountAmount) : 0,
        save_user_data: saveUserDataRef.current && authenticatedCheckout,
        guest_checkout: !authenticatedCheckout,
      };

      console.log('🚀 Отправка заказа:', orderData);

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authenticatedCheckout && accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
      }

      const response = await fetch(`${API_URL}/create_order`, {
        method: 'POST',
        headers,
        body: JSON.stringify(orderData),
      });

      const contentType = response.headers.get('content-type');
      const result = contentType && contentType.includes('application/json')
        ? await response.json()
        : { detail: await response.text() };

      if (!response.ok) {
        Alert.alert('Помилка сервера', result?.detail || result?.error || 'Щось пішло не так');
        return;
      }

      if (authenticatedCheckout && saveUserDataRef.current && accessToken) {
        if (name) await AsyncStorage.setItem('userName', name);

        try {
          await fetch(`${API_URL}/api/user/info/me`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
              name,
              email,
              city: city.name || '',
              warehouse: warehouse.name || '',
              contact_preference: contactMethod,
            }),
          });
        } catch {
          // Order is already created; profile save is optional.
        }
      }

      if (result.pageUrl) {
        await Linking.openURL(result.pageUrl);
        clearCart();
        return;
      }

      const purchaseItems = items.map((i: any) => ({
        item_id: String(i.id),
        item_name: i.name,
        price: Number(i.price || 0),
        quantity: Number(i.quantity || 1),
        item_variant: i?.variantSize || i?.packSize || i?.unit || 'шт',
      }));

      const purchaseEventId = `purchase_${result.order_id}`;
      trackEvent('purchase', {
        event_id: purchaseEventId,
        transaction_id: String(result.order_id),
        value: Math.floor(finalPriceWithBonuses),
        currency: 'UAH',
        content_type: 'product',
        content_ids: items.map((i: any) => i.id),
        num_items: items.reduce((sum: number, i: any) => sum + Number(i.quantity || 1), 0),
        items: purchaseItems,
        promo_code: appliedPromoCode || undefined,
        discount_value: Math.round(Number(cartTotal || 0) - Number(finalPriceWithBonuses || 0)),
        payment_method: paymentMethod,
        guest_checkout: !authenticatedCheckout,
      });

      logFirebaseEvent('purchase', {
        currency: 'UAH',
        value: Math.floor(finalPriceWithBonuses),
        transaction_id: String(result.order_id),
        items: purchaseItems,
        guest_checkout: !authenticatedCheckout,
      });

      clearCart();
      Alert.alert(
        `Замовлення #${result.order_id} прийнято! 🎉`,
        `Дякуємо!\nМи зв'яжемося з Вами для підтвердження.`,
        [{ text: 'Чудово!', onPress: () => router.replace(authenticatedCheckout ? '/(tabs)/profile' : '/(tabs)') }]
      );
    } catch (error) {
      console.error('Ошибка оформления:', error);
      Alert.alert('Помилка', error instanceof Error ? error.message : 'Не вдалося створити замовлення.');
    } finally {
      setLoading(false);
    }
  };

  const canUseBonuses = isLoggedIn && bonusBalance > 0;
  const bonusesToUse = canUseBonuses && useBonuses ? Math.min(bonusBalance, cartFinal) : 0;
  const finalPriceWithBonuses = Math.max(0, cartFinal - bonusesToUse);
  const allowedPaymentOptions = getAllowedPaymentOptions(deliveryMethod);
  const submitDisabled = loading;

  const buyerFullName = [lastName, name, middleName].map(v => v.trim()).filter(Boolean).join(' ');
  const contactComplete = Boolean(lastName.trim() && name.trim() && canonicalizePhone(phone).length === 10);
  const deliveryComplete = Boolean(city.name && warehouse.name);
  const recipientComplete = !isDifferentRecipient || Boolean(recipientName.trim() && canonicalizePhone(recipientPhone).length === 10);
  const currentDeliveryLabel = DELIVERY_OPTIONS.find(option => option.id === deliveryMethod)?.label || 'Оберіть доставку';
  const currentPaymentOption = PAYMENT_OPTIONS.find(option => option.id === paymentMethod);
  const currentPaymentLabel = currentPaymentOption ? getPaymentOptionLabel(currentPaymentOption, deliveryMethod) : 'Оберіть оплату';
  const orderItemsCount = (items || []).reduce((sum: number, item: any) => sum + Number(item.quantity || 1), 0);

  const renderSectionRow = ({
    title,
    value,
    detail,
    icon,
    complete = true,
    onPress,
  }: {
    title: string;
    value: string;
    detail?: string;
    icon: keyof typeof Ionicons.glyphMap;
    complete?: boolean;
    onPress: () => void;
  }) => (
    <TouchableOpacity style={styles.checkoutRow} onPress={onPress} activeOpacity={0.84}>
      <View style={[styles.rowIconWrap, !complete && styles.rowIconWarn]}>
        <Ionicons name={complete ? icon : 'alert-circle-outline'} size={22} color={complete ? '#2E7D32' : '#B45309'} />
      </View>
      <View style={styles.checkoutRowBody}>
        <Text style={styles.checkoutRowTitle}>{title}</Text>
        <Text style={[styles.checkoutRowValue, !complete && styles.checkoutRowValueWarn]} numberOfLines={2}>{value}</Text>
        {!!detail && <Text style={styles.checkoutRowDetail} numberOfLines={2}>{detail}</Text>}
      </View>
      <Text style={styles.editText}>Змінити</Text>
    </TouchableOpacity>
  );

  const renderMethodChip = (
    label: string,
    active: boolean,
    onPress: () => void,
  ) => (
    <TouchableOpacity style={[styles.sheetChip, active && styles.sheetChipActive]} onPress={onPress} activeOpacity={0.84}>
      <Text style={[styles.sheetChipText, active && styles.sheetChipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );

  const renderEditContent = () => {
    if (editSection === 'contact') {
      return (
        <>
          <Text style={styles.sheetTitle}>Контакти покупця</Text>
          <TextInput style={styles.input} placeholder="Прізвище" value={lastName} onChangeText={setLastName} />
          <TextInput style={styles.input} placeholder="Ім’я" value={name} onChangeText={setName} />
          <TextInput style={styles.input} placeholder="По батькові (не обов’язково)" value={middleName} onChangeText={setMiddleName} />
          <TextInput
            style={styles.input}
            placeholder="+380 XX XXX XX XX"
            value={phone}
            onChangeText={(text) => setPhone(formatUaPhoneInput(text))}
            onFocus={() => !phone && setPhone('+380 ')}
            keyboardType="phone-pad"
            textContentType="telephoneNumber"
            maxLength={UA_PHONE_MASK_MAX_LENGTH}
          />
          <TextInput style={styles.input} placeholder="Email (не обов’язково)" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />

          <Text style={styles.sheetSubTitle}>Зручний спосіб зв’язку</Text>
          <View style={styles.chipsRow}>
            {renderMethodChip('Дзвінок', contactMethod === 'call', () => setContactMethod('call'))}
            {renderMethodChip('Telegram', contactMethod === 'telegram', () => setContactMethod('telegram'))}
            {renderMethodChip('Viber', contactMethod === 'viber', () => setContactMethod('viber'))}
          </View>

          <TouchableOpacity style={styles.sheetSwitchRow} onPress={() => setDoNotCall(!doNotCall)} activeOpacity={0.84}>
            <Text style={styles.sheetSwitchText}>Не звонити, тільки повідомлення</Text>
            <Switch value={doNotCall} onValueChange={setDoNotCall} />
          </TouchableOpacity>
        </>
      );
    }

    if (editSection === 'recipient') {
      return (
        <>
          <Text style={styles.sheetTitle}>Отримувач</Text>
          <TouchableOpacity style={styles.sheetSwitchRow} onPress={() => setIsDifferentRecipient(!isDifferentRecipient)} activeOpacity={0.84}>
            <Text style={styles.sheetSwitchText}>Отримує інша людина</Text>
            <Switch value={isDifferentRecipient} onValueChange={setIsDifferentRecipient} />
          </TouchableOpacity>

          {isDifferentRecipient ? (
            <>
              <TextInput style={styles.input} placeholder="ПІБ отримувача" value={recipientName} onChangeText={setRecipientName} />
              <TextInput
                style={styles.input}
                placeholder="+380 XX XXX XX XX"
                value={recipientPhone}
                onChangeText={(text) => setRecipientPhone(formatUaPhoneInput(text))}
                onFocus={() => !recipientPhone && setRecipientPhone('+380 ')}
                keyboardType="phone-pad"
                textContentType="telephoneNumber"
                maxLength={UA_PHONE_MASK_MAX_LENGTH}
              />
            </>
          ) : (
            <Text style={styles.sheetInfoText}>Отримувачем буде покупець: {buyerFullName || 'заповніть контакти покупця'}.</Text>
          )}
        </>
      );
    }

    if (editSection === 'delivery') {
      return (
        <>
          <Text style={styles.sheetTitle}>Доставка</Text>
          <View style={styles.sheetOptionsList}>
            {DELIVERY_OPTIONS.map(option => {
              const active = deliveryMethod === option.id;
              return (
                <TouchableOpacity
                  key={option.id}
                  style={[styles.sheetOption, active && styles.sheetOptionActive]}
                  onPress={() => handleDeliveryMethodChange(option.id)}
                  activeOpacity={0.84}
                >
                  <View style={[styles.radioCircle, active && styles.radioCircleActive]}>
                    {active && <View style={styles.radioDot} />}
                  </View>
                  <Text style={[styles.sheetOptionText, active && styles.sheetOptionTextActive]}>{option.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {(deliveryMethod === 'nova_poshta' || deliveryMethod === 'ukrposhta_branch') ? (
            <>
              <TouchableOpacity style={styles.selectBtn} onPress={() => openModal('city')} activeOpacity={0.84}>
                <Text style={city.name ? styles.selectBtnTextActive : styles.selectBtnText}>{city.name || 'Оберіть місто'}</Text>
                <Ionicons name="chevron-forward" size={20} color="#666" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.selectBtn} onPress={() => openModal('warehouse')} activeOpacity={0.84}>
                <Text style={warehouse.name ? styles.selectBtnTextActive : styles.selectBtnText}>{warehouse.name || 'Оберіть відділення'}</Text>
                <Ionicons name="chevron-forward" size={20} color="#666" />
              </TouchableOpacity>
            </>
          ) : (
            <>
              <TextInput style={styles.input} placeholder="Країна та місто" value={city.name} onChangeText={(text) => setCity({ ref: '', name: text })} />
              <TextInput style={styles.input} placeholder="Адреса доставки" value={warehouse.name} onChangeText={(text) => setWarehouse({ ref: '', name: text })} />
            </>
          )}
        </>
      );
    }

    if (editSection === 'payment') {
      return (
        <>
          <Text style={styles.sheetTitle}>Оплата</Text>
          <View style={styles.sheetOptionsList}>
            {allowedPaymentOptions.map(option => {
              const active = paymentMethod === option.id;
              return (
                <TouchableOpacity
                  key={option.id}
                  style={[styles.sheetOption, active && styles.sheetOptionActive]}
                  onPress={() => setPaymentMethod(option.id)}
                  activeOpacity={0.84}
                >
                  <View style={[styles.radioCircle, active && styles.radioCircleActive]}>
                    {active && <View style={styles.radioDot} />}
                  </View>
                  <Text style={[styles.sheetOptionText, active && styles.sheetOptionTextActive]}>{getPaymentOptionLabel(option, deliveryMethod)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </>
      );
    }

    if (editSection === 'comment') {
      return (
        <>
          <Text style={styles.sheetTitle}>Коментар до замовлення</Text>
          <TextInput
            style={[styles.input, styles.commentInput]}
            placeholder="Напишіть коментар для менеджера (не обов’язково)"
            value={orderComment}
            onChangeText={setOrderComment}
            multiline
          />
        </>
      );
    }

    if (editSection === 'order') {
      return (
        <>
          <Text style={styles.sheetTitle}>Ваше замовлення</Text>
          {(items || []).map((item: any, index: number) => (
            <View key={`${item.id}_${index}`} style={styles.orderItemRow}>
              {!!item.image && <Image source={{ uri: item.image }} style={styles.itemImage} resizeMode="contain" />}
              <View style={{ flex: 1 }}>
                <Text style={styles.itemName} numberOfLines={2}>{item.name}</Text>
                <Text style={styles.itemVariant}>
                  {item?.variantSize || item?.packSize || item?.label || item?.weight || item?.unit || 'Стандарт'}
                  {item.quantity > 1 ? ` x ${item.quantity} шт` : ''}
                </Text>
              </View>
              <Text style={styles.itemPrice}>{formatPrice(Number(item.price || 0) * Number(item.quantity || 1))}</Text>
            </View>
          ))}
        </>
      );
    }

    return null;
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <AppHeader showLogo showSearch showFavorites />

      <View style={styles.checkoutTitleRow}>
        <TouchableOpacity onPress={() => router.back()} style={styles.titleIconButton} activeOpacity={0.75}>
          <Ionicons name="arrow-back" size={23} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.checkoutTitle} numberOfLines={1}>Оформлення</Text>
        <View style={styles.titleIconButton} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {!isLoggedIn && (
          <View style={styles.guestNotice}>
            <Ionicons name="flash-outline" size={19} color="#2E7D32" />
            <Text style={styles.guestNoticeText}>Можна оформити без реєстрації. Для бонусів увійдіть у профіль.</Text>
          </View>
        )}

        {isBelowMinOrder && !!items?.length && (
          <View style={styles.minOrderNotice}>
            <View style={styles.minOrderIconWrap}>
              <Ionicons name="basket" size={21} color="#B45309" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.minOrderTitle}>Мінімальне замовлення — {formatPrice(MIN_ORDER_AMOUNT)}</Text>
              <Text style={styles.minOrderText}>Додайте товарів ще на {formatPrice(minOrderMissing)}, щоб оформити покупку.</Text>
            </View>
          </View>
        )}

        <View style={styles.checkoutCard}>
          {renderSectionRow({
            title: 'Контакт',
            value: contactComplete ? buyerFullName : 'Додайте ім’я, прізвище і телефон',
            detail: contactComplete ? [phone, email].filter(Boolean).join(' · ') : undefined,
            icon: 'person-outline',
            complete: contactComplete,
            onPress: () => setEditSection('contact'),
          })}

          <View style={styles.rowDivider} />

          {renderSectionRow({
            title: 'Доставка',
            value: deliveryComplete ? currentDeliveryLabel : 'Оберіть місто і відділення',
            detail: deliveryComplete ? `${city.name} · ${warehouse.name}` : undefined,
            icon: 'cube-outline',
            complete: deliveryComplete,
            onPress: () => setEditSection('delivery'),
          })}

          <View style={styles.rowDivider} />

          {renderSectionRow({
            title: 'Отримувач',
            value: recipientComplete
              ? (isDifferentRecipient ? recipientName : 'Покупець отримує сам')
              : 'Заповніть отримувача',
            detail: isDifferentRecipient ? recipientPhone : undefined,
            icon: 'people-outline',
            complete: recipientComplete,
            onPress: () => setEditSection('recipient'),
          })}

          <View style={styles.rowDivider} />

          {renderSectionRow({
            title: 'Оплата',
            value: currentPaymentLabel,
            icon: 'card-outline',
            complete: true,
            onPress: () => setEditSection('payment'),
          })}
        </View>

        <View style={styles.checkoutCard}>
          {renderSectionRow({
            title: 'Ваше замовлення',
            value: `${orderItemsCount} товарів`,
            detail: (items || []).slice(0, 2).map((item: any) => item.name).join(' · '),
            icon: 'bag-outline',
            complete: Boolean(items?.length),
            onPress: () => setEditSection('order'),
          })}
        </View>

        <View style={styles.checkoutCard}>
          {renderSectionRow({
            title: 'Коментар',
            value: orderComment.trim() || 'Додати коментар для менеджера',
            icon: 'chatbox-ellipses-outline',
            complete: true,
            onPress: () => setEditSection('comment'),
          })}
        </View>

        {canUseBonuses && (
          <View style={styles.bonusCard}>
            <View style={styles.bonusLeft}>
              <View style={styles.bonusIconBg}>
                <Ionicons name="gift" size={20} color="#FFD700" />
              </View>
              <View>
                <Text style={styles.bonusTitle}>Використати бонуси</Text>
                <Text style={styles.bonusSubtitle}>На рахунку: {bonusBalance} ₴</Text>
              </View>
            </View>
            <Switch value={useBonuses} onValueChange={setUseBonuses} trackColor={{ false: '#767577', true: '#4CAF50' }} />
          </View>
        )}

        <TouchableOpacity style={styles.saveDataRow} onPress={() => setSaveUserData(prev => !prev)} activeOpacity={0.84}>
          <View style={[styles.checkbox, saveUserData && styles.checkboxActive]}>
            {saveUserData && <Ionicons name="checkmark" size={16} color="#FFF" />}
          </View>
          <Text style={styles.saveDataText}>Зберегти дані для наступних замовлень</Text>
        </TouchableOpacity>

        <View style={styles.summaryContainer}>
          <Text style={styles.summaryTitle}>Підсумок</Text>
          <View style={styles.summaryProductsBox}>
            {(items || []).map((item: any, index: number) => (
              <View key={`summary_${item.id}_${index}`} style={styles.summaryProductRow}>
                {!!(item.image || item.image_url || item.picture) && (
                  <Image source={{ uri: item.image || item.image_url || item.picture }} style={styles.summaryProductImage} resizeMode="contain" />
                )}
                <View style={styles.summaryProductBody}>
                  <Text style={styles.summaryProductName} numberOfLines={2}>{item.name}</Text>
                  <Text style={styles.summaryProductMeta} numberOfLines={1}>
                    {item?.variantSize || item?.packSize || item?.label || item?.weight || item?.unit || 'Стандарт'} · {Number(item.quantity || 1)} шт.
                  </Text>
                </View>
                <Text style={styles.summaryProductPrice}>{formatPrice(Number(item.price || 0) * Number(item.quantity || 1))}</Text>
              </View>
            ))}
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Товари</Text>
            <Text style={styles.summaryValue}>{formatPrice(cartTotal)}</Text>
          </View>
          {cartFinal < cartTotal && (
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryLabel, { color: '#FF6B35' }]}>Знижка промокодом</Text>
              <Text style={[styles.summaryValue, { color: '#FF6B35' }]}>-{formatPrice(cartTotal - cartFinal)}</Text>
            </View>
          )}
          {bonusesToUse > 0 && (
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryLabel, { color: '#4CAF50' }]}>Знижка бонусами</Text>
              <Text style={[styles.summaryValue, { color: '#4CAF50' }]}>-{formatPrice(bonusesToUse)}</Text>
            </View>
          )}
          <View style={styles.divider} />
          <View style={styles.summaryRow}>
            <Text style={styles.totalLabel}>До сплати</Text>
            <Text style={styles.totalValue}>{formatPrice(finalPriceWithBonuses)}</Text>
          </View>
        </View>
      </ScrollView>

      <View style={[styles.stickySubmitWrap, { bottom: 58 + Math.max(insets.bottom, 4) }]}>
        <View style={styles.stickyTotalBlock}>
          <Text style={styles.stickyTotalLabel}>До сплати</Text>
          <Text style={styles.stickyTotalValue}>{formatPrice(finalPriceWithBonuses)}</Text>
        </View>
        <TouchableOpacity style={[styles.submitBtn, loading && styles.submitBtnDisabled]} onPress={handleSubmit} disabled={submitDisabled} activeOpacity={0.9}>
          {loading ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <Text style={styles.submitBtnText}>{isBelowMinOrder ? 'Додати товари' : 'Підтвердити'}</Text>
          )}
        </TouchableOpacity>
      </View>

      <Modal visible={editSection !== null} animationType="slide" transparent onRequestClose={() => setEditSection(null)}>
        <View style={styles.sheetRoot}>
          <TouchableOpacity style={styles.sheetBackdrop} activeOpacity={1} onPress={() => setEditSection(null)} />
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheetKeyboardWrap}>
            <View style={styles.sheetContainer}>
              <View style={styles.sheetHandle} />
              <TouchableOpacity style={styles.sheetCloseButton} onPress={() => setEditSection(null)} activeOpacity={0.75}>
                <Ionicons name="close" size={28} color="#222" />
              </TouchableOpacity>
              <ScrollView contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                {renderEditContent()}
                <TouchableOpacity style={styles.sheetDoneButton} onPress={() => setEditSection(null)} activeOpacity={0.9}>
                  <Text style={styles.sheetDoneText}>Готово</Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      <Modal visible={modalVisible !== null} animationType="slide">
        <SafeAreaView style={styles.locationModalSafeArea}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{modalVisible === 'city' ? 'Пошук міста' : 'Оберіть відділення'}</Text>
            <TouchableOpacity onPress={() => setModalVisible(null)}>
              <Ionicons name="close" size={28} color="#333" />
            </TouchableOpacity>
          </View>

          {modalVisible === 'city' && (
            <>
              <TextInput style={styles.modalInput} placeholder="Введіть назву міста (напр. Київ)" value={searchQuery} onChangeText={searchCity} autoFocus />
              <View style={styles.popularCitiesWrap}>
                {POPULAR_CITIES.map(cityName => (
                  <TouchableOpacity key={cityName} style={styles.popularCityChip} onPress={() => searchCity(cityName)}>
                    <Text style={styles.popularCityText}>{cityName}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          {loadingSearch ? (
            <ActivityIndicator style={{ marginTop: 20 }} size="large" />
          ) : (
            <FlatList
              data={searchResults}
              contentContainerStyle={styles.locationResultsContent}
              keyExtractor={(item, index) => `${item.ref}-${index}`}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.resultItem} onPress={() => handleSelect(item)}>
                  <Text style={styles.resultText}>{item.name}</Text>
                </TouchableOpacity>
              )}
            />
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F5F5F5' },
  checkoutTitleRow: {
    height: 52,
    paddingHorizontal: 12,
    backgroundColor: '#F8FAF8',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  titleIconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  checkoutTitle: { flex: 1, textAlign: 'center', fontSize: 20, lineHeight: 25, fontWeight: '900', color: '#111827' },
  scrollContent: { padding: 12, paddingBottom: 230 },
  guestNotice: { backgroundColor: '#E8F5E9', borderRadius: 10, padding: 11, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  guestNoticeText: { color: '#2E7D32', fontSize: 13.5, fontWeight: '700', flex: 1, lineHeight: 18 },
  minOrderNotice: { backgroundColor: '#FFF7ED', borderColor: '#FDBA74', borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 11 },
  minOrderIconWrap: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFEDD5', alignItems: 'center', justifyContent: 'center' },
  minOrderTitle: { color: '#92400E', fontSize: 14.5, fontWeight: '900', marginBottom: 2 },
  minOrderText: { color: '#9A3412', fontSize: 13, lineHeight: 18, fontWeight: '600' },
  checkoutCard: { backgroundColor: '#FFFFFF', borderRadius: 12, marginBottom: 10, overflow: 'hidden', borderWidth: 1, borderColor: '#E5E7EB' },
  checkoutRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 13, paddingVertical: 14, minHeight: 76 },
  rowIconWrap: { width: 39, height: 39, borderRadius: 20, backgroundColor: '#EAF6E7', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  rowIconWarn: { backgroundColor: '#FFF7ED' },
  checkoutRowBody: { flex: 1, paddingRight: 10 },
  checkoutRowTitle: { fontSize: 13, lineHeight: 17, color: '#6B7280', fontWeight: '800', marginBottom: 3 },
  checkoutRowValue: { fontSize: 16, lineHeight: 21, color: '#222222', fontWeight: '900' },
  checkoutRowValueWarn: { color: '#B45309' },
  checkoutRowDetail: { marginTop: 3, fontSize: 13, lineHeight: 18, color: '#6B7280', fontWeight: '500' },
  editText: { fontSize: 13, lineHeight: 17, color: '#1976A3', fontWeight: '900' },
  rowDivider: { height: 1, backgroundColor: '#EEF0F2', marginLeft: 64 },
  bonusCard: { backgroundColor: '#333333', borderRadius: 12, padding: 14, marginBottom: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  bonusLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  bonusIconBg: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  bonusTitle: { color: '#FFF', fontWeight: '900', fontSize: 15.5 },
  bonusSubtitle: { color: '#FFD700', fontSize: 13, marginTop: 2 },
  saveDataRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, paddingHorizontal: 4, paddingVertical: 6 },
  checkbox: { width: 23, height: 23, borderRadius: 6, borderWidth: 2, borderColor: '#2E7D32', marginRight: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF' },
  checkboxActive: { backgroundColor: '#2E7D32' },
  saveDataText: { fontSize: 14, lineHeight: 19, color: '#555', fontWeight: '600', flex: 1 },
  summaryContainer: { backgroundColor: '#FFFFFF', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#E5E7EB' },
  summaryTitle: { fontSize: 18, lineHeight: 23, fontWeight: '900', color: '#111827', marginBottom: 12 },
  summaryProductsBox: { borderBottomWidth: 1, borderBottomColor: '#EEF0F2', marginBottom: 12, paddingBottom: 8 },
  summaryProductRow: { flexDirection: 'row', alignItems: 'center', paddingBottom: 10, marginBottom: 10 },
  summaryProductImage: { width: 48, height: 48, borderRadius: 8, marginRight: 10, backgroundColor: '#F3F4F6' },
  summaryProductBody: { flex: 1, paddingRight: 8 },
  summaryProductName: { fontSize: 14, lineHeight: 18, color: '#222222', fontWeight: '800' },
  summaryProductMeta: { fontSize: 12.5, lineHeight: 17, color: '#6B7280', marginTop: 2, fontWeight: '600' },
  summaryProductPrice: { fontSize: 14.5, lineHeight: 19, color: '#111827', fontWeight: '900' },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  summaryLabel: { fontSize: 15, color: '#666', fontWeight: '600' },
  summaryValue: { fontSize: 15, fontWeight: '800', color: '#222222' },
  divider: { height: 1, backgroundColor: '#DDD', marginVertical: 10 },
  totalLabel: { fontSize: 18, fontWeight: '900', color: '#111827' },
  totalValue: { fontSize: 22, fontWeight: '900', color: '#2E7D32' },
  stickySubmitWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    minHeight: 88,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    zIndex: 900,
    elevation: 900,
  },
  stickyTotalBlock: { minWidth: 110 },
  stickyTotalLabel: { fontSize: 12.5, lineHeight: 16, color: '#6B7280', fontWeight: '700' },
  stickyTotalValue: { fontSize: 20, lineHeight: 25, color: '#111827', fontWeight: '900' },
  submitBtn: { flex: 1, height: 56, backgroundColor: '#2E7D32', borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  submitBtnDisabled: { backgroundColor: '#A3A3A3' },
  submitBtnText: { color: '#FFF', fontSize: 17, fontWeight: '900' },
  input: { borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 9, paddingHorizontal: 13, paddingVertical: 12, fontSize: 16, marginBottom: 10, backgroundColor: '#FFFFFF', color: '#111827' },
  selectBtn: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 9, padding: 14, marginBottom: 10, backgroundColor: '#FFFFFF' },
  selectBtnText: { color: '#999', fontSize: 16 },
  selectBtnTextActive: { color: '#333', fontSize: 16, flex: 1, paddingRight: 8 },
  commentInput: { minHeight: 132, textAlignVertical: 'top' },
  orderItemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F1F1F1' },
  itemImage: { width: 54, height: 54, borderRadius: 10, marginRight: 10, backgroundColor: '#F0F0F0' },
  itemName: { fontSize: 14.5, fontWeight: '800', color: '#333', lineHeight: 19 },
  itemVariant: { fontSize: 13, color: '#777', marginTop: 3 },
  itemPrice: { fontSize: 15, fontWeight: '900', color: '#333', marginLeft: 8 },
  sheetRoot: { flex: 1, justifyContent: 'flex-end', paddingBottom: 68 },
  sheetBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheetKeyboardWrap: { justifyContent: 'flex-end' },
  sheetContainer: { maxHeight: '94%', backgroundColor: '#F7F7F7', borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingTop: 8, overflow: 'hidden' },
  sheetHandle: { width: 44, height: 5, borderRadius: 3, backgroundColor: '#D1D5DB', alignSelf: 'center', marginTop: 6, marginBottom: 4 },
  sheetCloseButton: { position: 'absolute', top: 12, right: 14, width: 42, height: 42, alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  sheetContent: { paddingHorizontal: 16, paddingTop: 18, paddingBottom: Platform.OS === 'ios' ? 112 : 96 },
  sheetTitle: { fontSize: 23, lineHeight: 29, fontWeight: '900', color: '#111827', marginBottom: 16, paddingRight: 48 },
  sheetSubTitle: { fontSize: 15, lineHeight: 20, fontWeight: '900', color: '#374151', marginTop: 4, marginBottom: 8 },
  sheetInfoText: { fontSize: 15, lineHeight: 22, color: '#374151', backgroundColor: '#FFFFFF', padding: 13, borderRadius: 10, borderWidth: 1, borderColor: '#E5E7EB' },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  sheetChip: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: '#D1D5DB', backgroundColor: '#FFFFFF' },
  sheetChipActive: { backgroundColor: '#2E7D32', borderColor: '#2E7D32' },
  sheetChipText: { color: '#333', fontWeight: '800', fontSize: 14 },
  sheetChipTextActive: { color: '#FFF' },
  sheetSwitchRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#FFFFFF', borderRadius: 10, paddingHorizontal: 13, marginBottom: 10, borderWidth: 1, borderColor: '#E5E7EB' },
  sheetSwitchText: { fontSize: 15, color: '#333', flex: 1, fontWeight: '700', paddingRight: 10 },
  sheetOptionsList: { gap: 9, marginBottom: 12 },
  sheetOption: { flexDirection: 'row', alignItems: 'center', minHeight: 58, borderRadius: 10, borderWidth: 1, borderColor: '#D1D5DB', backgroundColor: '#FFFFFF', paddingHorizontal: 12, paddingVertical: 10 },
  sheetOptionActive: { borderColor: '#2E7D32', backgroundColor: '#F0F8EF' },
  radioCircle: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#BDBDBD', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  radioCircleActive: { borderColor: '#2E7D32' },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#2E7D32' },
  sheetOptionText: { flex: 1, fontSize: 15, lineHeight: 20, color: '#333', fontWeight: '700' },
  sheetOptionTextActive: { color: '#111827', fontWeight: '900' },
  sheetDoneButton: { height: 54, borderRadius: 10, backgroundColor: '#2E7D32', alignItems: 'center', justifyContent: 'center', marginTop: 12, marginBottom: 18 },
  sheetDoneText: { color: '#FFFFFF', fontSize: 17, fontWeight: '900' },
  locationModalSafeArea: { flex: 1, backgroundColor: '#FFFFFF', paddingBottom: 68 },
  locationResultsContent: { paddingBottom: 88 },
  modalHeader: { padding: 18, borderBottomWidth: 1, borderBottomColor: '#EEE', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { fontSize: 20, fontWeight: '900', color: '#111827' },
  modalInput: { margin: 15, borderWidth: 1, borderColor: '#DDD', borderRadius: 10, padding: 15, fontSize: 16 },
  popularCitiesWrap: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 15, marginBottom: 10, gap: 8 },
  popularCityChip: { backgroundColor: '#E8F5E9', borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12 },
  popularCityText: { color: '#2E7D32', fontWeight: '700' },
  resultItem: { padding: 15, borderBottomWidth: 1, borderBottomColor: '#EEE' },
  resultText: { fontSize: 16, color: '#333' },
});