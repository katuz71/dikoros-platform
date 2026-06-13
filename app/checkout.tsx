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
import { API_URL } from '../config/api';
import { useCart } from '../context/CartContext';

const POPULAR_CITIES = ['Київ', 'Львів', 'Одеса', 'Дніпро', 'Харків', 'Івано-Франківськ'];
const MIN_ORDER_AMOUNT = 200;

type DeliveryMethod = 'ukrposhta_branch' | 'nova_poshta' | 'nova_poshta_international';
type PaymentMethod = 'postpaid' | 'bank_transfer' | 'paypal_request';

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
  const [saveUserData, setSaveUserData] = useState(false);
  const saveUserDataRef = useRef(false);

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
        setPhone(canon);
      }

      if (savedInfo) {
        const parsed = JSON.parse(savedInfo);
        if (parsed.name) setName(parsed.name);
        if (parsed.lastName) setLastName(parsed.lastName);
        if (parsed.middleName) setMiddleName(parsed.middleName);
        if (parsed.recipientName) setRecipientName(parsed.recipientName);
        if (parsed.recipientPhone) setRecipientPhone(parsed.recipientPhone);
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
      Alert.alert(
        'Мінімальна сума замовлення',
        `Мінімальне замовлення — ${formatPrice(MIN_ORDER_AMOUNT)}. Додайте товарів ще на ${formatPrice(minOrderMissing)}.`
      );
      return;
    }

    if (!lastName.trim() || !name.trim() || !phone.trim() || !city.name || !warehouse.name) {
      Alert.alert('Увага', `Будь ласка, заповніть всі поля:\n• Прізвище\n• Ім'я\n• Телефон покупця\n• Доставка`);
      return;
    }

    const cleanBuyerPhone = canonicalizePhone(phone);
    if (cleanBuyerPhone.length < 10) {
      Alert.alert('Увага', 'Введіть коректний телефон покупця.');
      return;
    }

    if (isDifferentRecipient && (!recipientName.trim() || !recipientPhone.trim())) {
      Alert.alert('Увага', 'Заповніть ПІБ та телефон отримувача.');
      return;
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
  const submitDisabled = loading || isBelowMinOrder;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#F5F5F5' }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <Text style={styles.headerTitle}>Оформлення замовлення</Text>

          {!isLoggedIn && (
            <View style={styles.guestNotice}>
              <Ionicons name="flash-outline" size={20} color="#2E7D32" />
              <Text style={styles.guestNoticeText}>Можна оформити замовлення без реєстрації. Для бонусів увійдіть у профіль.</Text>
            </View>
          )}

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Ваше замовлення</Text>
            {(items || []).map((item: any, index: number) => (
              <View key={`${item.id}_${index}`} style={styles.orderItemRow}>
                {!!item.image && (
                  <Image source={{ uri: item.image }} style={styles.itemImage} resizeMode="cover" />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemName} numberOfLines={1}>{item.name}</Text>
                  <Text style={styles.itemVariant}>
                    {item?.variantSize || item?.packSize || item?.label || item?.weight || item?.unit || 'Стандарт'}
                    {item.quantity > 1 ? ` x ${item.quantity} шт` : ''}
                  </Text>
                </View>
                <Text style={styles.itemPrice}>{formatPrice(Number(item.price || 0) * Number(item.quantity || 1))}</Text>
              </View>
            ))}
          </View>

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

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Контакти покупця</Text>
            <TextInput style={styles.input} placeholder="Прізвище" value={lastName} onChangeText={setLastName} />
            <TextInput style={styles.input} placeholder="Ім’я" value={name} onChangeText={setName} />
            <TextInput style={styles.input} placeholder="По батькові (не обов’язково)" value={middleName} onChangeText={setMiddleName} />
            <TextInput style={styles.input} placeholder="Телефон покупця" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
            <TextInput style={styles.input} placeholder="Email (не обов’язково)" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />

            <TouchableOpacity style={styles.switchRow} onPress={() => setIsDifferentRecipient(!isDifferentRecipient)}>
              <Text style={styles.switchText}>Інший отримувач</Text>
              <Switch value={isDifferentRecipient} onValueChange={setIsDifferentRecipient} />
            </TouchableOpacity>

            {isDifferentRecipient && (
              <>
                <TextInput style={styles.input} placeholder="ПІБ отримувача" value={recipientName} onChangeText={setRecipientName} />
                <TextInput style={styles.input} placeholder="Телефон отримувача" value={recipientPhone} onChangeText={setRecipientPhone} keyboardType="phone-pad" />
              </>
            )}

            <Text style={styles.subLabel}>Зручний спосіб зв’язку:</Text>
            <View style={styles.methodContainer}>
              <TouchableOpacity style={[styles.methodChip, contactMethod === 'call' && styles.methodChipActive]} onPress={() => setContactMethod('call')}>
                <Text style={[styles.methodText, contactMethod === 'call' && styles.methodTextActive]}>📞 Дзвінок</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.methodChip, contactMethod === 'telegram' && styles.methodChipActive]} onPress={() => setContactMethod('telegram')}>
                <Text style={[styles.methodText, contactMethod === 'telegram' && styles.methodTextActive]}>✈️ Telegram</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.methodChip, contactMethod === 'viber' && styles.methodChipActive]} onPress={() => setContactMethod('viber')}>
                <Text style={[styles.methodText, contactMethod === 'viber' && styles.methodTextActive]}>💬 Viber</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.switchRow} onPress={() => setDoNotCall(!doNotCall)}>
              <Text style={styles.switchText}>Не перезванивати, тільки повідомлення</Text>
              <Switch value={doNotCall} onValueChange={setDoNotCall} />
            </TouchableOpacity>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Доставка</Text>
            <View style={styles.paymentRow}>
              {DELIVERY_OPTIONS.map(option => {
                const isActive = deliveryMethod === option.id;
                return (
                  <View key={option.id} style={styles.deliveryOptionBlock}>
                    <TouchableOpacity style={[styles.paymentOption, isActive && styles.paymentOptionActive]} onPress={() => handleDeliveryMethodChange(option.id)}>
                      <Text style={[styles.paymentText, isActive && { color: '#FFF' }]}>{option.label}</Text>
                    </TouchableOpacity>

                    {isActive && (
                      <View style={styles.deliveryDetails}>
                        {(option.id === 'nova_poshta' || option.id === 'ukrposhta_branch') ? (
                          <>
                            <TouchableOpacity style={styles.selectBtn} onPress={() => openModal('city')}>
                              <Text style={city.name ? styles.selectBtnTextActive : styles.selectBtnText}>{city.name || 'Оберіть місто...'}</Text>
                              <Ionicons name="chevron-forward" size={20} color="#666" />
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.selectBtn} onPress={() => openModal('warehouse')}>
                              <Text style={warehouse.name ? styles.selectBtnTextActive : styles.selectBtnText}>{warehouse.name || 'Оберіть відділення...'}</Text>
                              <Ionicons name="chevron-forward" size={20} color="#666" />
                            </TouchableOpacity>
                          </>
                        ) : (
                          <>
                            <TextInput style={styles.input} placeholder="Країна та місто" value={city.name} onChangeText={(text) => setCity({ ref: '', name: text })} />
                            <TextInput style={styles.input} placeholder="Адреса доставки" value={warehouse.name} onChangeText={(text) => setWarehouse({ ref: '', name: text })} />
                          </>
                        )}
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Оплата</Text>
            <View style={styles.paymentRow}>
              {allowedPaymentOptions.map(option => (
                <TouchableOpacity key={option.id} style={[styles.paymentOption, paymentMethod === option.id && styles.paymentOptionActive]} onPress={() => setPaymentMethod(option.id)}>
                  <Text style={[styles.paymentText, paymentMethod === option.id && { color: '#FFF' }]}>{getPaymentOptionLabel(option, deliveryMethod)}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Коментар до замовлення</Text>
            <TextInput style={[styles.input, styles.commentInput]} placeholder="Напишіть коментар для менеджера (не обов’язково)" value={orderComment} onChangeText={setOrderComment} multiline />
          </View>

          {canUseBonuses && (
            <View style={styles.bonusCard}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={styles.bonusIconBg}>
                  <Ionicons name="gift" size={20} color="#FFD700" />
                </View>
                <View style={{ marginLeft: 10 }}>
                  <Text style={styles.bonusTitle}>Використати бонуси</Text>
                  <Text style={styles.bonusSubtitle}>На рахунку: {bonusBalance} ₴</Text>
                </View>
              </View>
              <Switch value={useBonuses} onValueChange={setUseBonuses} trackColor={{ false: '#767577', true: '#4CAF50' }} />
            </View>
          )}

          <TouchableOpacity style={styles.saveDataRow} onPress={() => setSaveUserData(prev => !prev)}>
            <View style={[styles.checkbox, saveUserData && styles.checkboxActive]}>
              {saveUserData && <Ionicons name="checkmark" size={16} color="#FFF" />}
            </View>
            <Text style={styles.saveDataText}>Зберегти дані для наступних замовлень</Text>
          </TouchableOpacity>

          <View style={styles.summaryContainer}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Вартість товарів:</Text>
              <Text style={styles.summaryValue}>{formatPrice(cartTotal)}</Text>
            </View>
            {cartFinal < cartTotal && (
              <View style={styles.summaryRow}>
                <Text style={[styles.summaryLabel, { color: '#FF6B35' }]}>Знижка промокодом:</Text>
                <Text style={[styles.summaryValue, { color: '#FF6B35' }]}>-{formatPrice(cartTotal - cartFinal)}</Text>
              </View>
            )}
            {bonusesToUse > 0 && (
              <View style={styles.summaryRow}>
                <Text style={[styles.summaryLabel, { color: '#4CAF50' }]}>Знижка бонусами:</Text>
                <Text style={[styles.summaryValue, { color: '#4CAF50' }]}>-{formatPrice(bonusesToUse)}</Text>
              </View>
            )}
            <View style={styles.divider} />
            <View style={styles.summaryRow}>
              <Text style={styles.totalLabel}>До сплати:</Text>
              <Text style={styles.totalValue}>{formatPrice(finalPriceWithBonuses)}</Text>
            </View>
          </View>

          <TouchableOpacity style={[styles.submitBtn, isBelowMinOrder && styles.submitBtnDisabled]} onPress={handleSubmit} disabled={submitDisabled}>
            {loading ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={styles.submitBtnText}>{isBelowMinOrder ? `ДОДАЙТЕ ЩЕ ${formatPrice(minOrderMissing)}` : 'ПІДТВЕРДИТИ ЗАМОВЛЕННЯ'}</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal visible={modalVisible !== null} animationType="slide">
        <SafeAreaView style={{ flex: 1 }}>
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
  scrollContent: { padding: 15, paddingBottom: 50 },
  headerTitle: { fontSize: 24, fontWeight: 'bold', marginBottom: 20, marginTop: 20, color: '#333', textAlign: 'center' },
  guestNotice: { backgroundColor: '#E8F5E9', borderRadius: 12, padding: 12, marginBottom: 15, flexDirection: 'row', alignItems: 'center', gap: 8 },
  guestNoticeText: { color: '#2E7D32', fontSize: 14, fontWeight: '600', flex: 1, lineHeight: 19 },
  minOrderNotice: { backgroundColor: '#FFF7ED', borderColor: '#FDBA74', borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 15, flexDirection: 'row', alignItems: 'center', gap: 12 },
  minOrderIconWrap: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#FFEDD5', alignItems: 'center', justifyContent: 'center' },
  minOrderTitle: { color: '#92400E', fontSize: 15, fontWeight: '900', marginBottom: 3 },
  minOrderText: { color: '#9A3412', fontSize: 13, lineHeight: 18, fontWeight: '600' },
  card: { backgroundColor: '#FFF', borderRadius: 12, padding: 15, marginBottom: 15 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', marginBottom: 15, color: '#333' },
  input: { borderWidth: 1, borderColor: '#EEE', borderRadius: 8, padding: 12, fontSize: 16, marginBottom: 10, backgroundColor: '#FAFAFA' },
  selectBtn: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1, borderColor: '#EEE', borderRadius: 8, padding: 15, marginBottom: 10, backgroundColor: '#FAFAFA' },
  selectBtnText: { color: '#999', fontSize: 16 },
  selectBtnTextActive: { color: '#333', fontSize: 16 },
  paymentRow: { flexDirection: 'column', gap: 10 },
  paymentOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', padding: 15, borderRadius: 8, borderWidth: 1, borderColor: '#EEE', gap: 8 },
  paymentOptionActive: { backgroundColor: '#333', borderColor: '#333' },
  paymentText: { fontWeight: '600', color: '#333' },
  deliveryOptionBlock: { marginBottom: 10 },
  deliveryDetails: { marginTop: 10 },
  commentInput: { minHeight: 90, textAlignVertical: 'top' },
  orderItemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F1F1F1' },
  itemImage: { width: 54, height: 54, borderRadius: 10, marginRight: 10, backgroundColor: '#F0F0F0' },
  itemName: { fontSize: 15, fontWeight: '700', color: '#333' },
  itemVariant: { fontSize: 13, color: '#777', marginTop: 3 },
  itemPrice: { fontSize: 15, fontWeight: '800', color: '#333', marginLeft: 8 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  switchText: { fontSize: 15, color: '#333', flex: 1 },
  subLabel: { fontSize: 14, fontWeight: '700', color: '#333', marginBottom: 8 },
  methodContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  methodChip: { paddingVertical: 9, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: '#DDD', backgroundColor: '#FFF' },
  methodChipActive: { backgroundColor: '#2E7D32', borderColor: '#2E7D32' },
  methodText: { color: '#333', fontWeight: '700' },
  methodTextActive: { color: '#FFF' },
  bonusCard: { backgroundColor: '#333', borderRadius: 12, padding: 15, marginBottom: 15, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  bonusIconBg: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  bonusTitle: { color: '#FFF', fontWeight: 'bold', fontSize: 16 },
  bonusSubtitle: { color: '#FFD700', fontSize: 13 },
  saveDataRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 20, paddingHorizontal: 5 },
  checkbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: '#4CAF50', marginRight: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF' },
  checkboxActive: { backgroundColor: '#4CAF50' },
  saveDataText: { fontSize: 14, color: '#555' },
  summaryContainer: { marginVertical: 10, paddingHorizontal: 5 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  summaryLabel: { fontSize: 16, color: '#666' },
  summaryValue: { fontSize: 16, fontWeight: '500' },
  divider: { height: 1, backgroundColor: '#DDD', marginVertical: 10 },
  totalLabel: { fontSize: 20, fontWeight: 'bold' },
  totalValue: { fontSize: 24, fontWeight: 'bold', color: '#4CAF50' },
  submitBtn: { backgroundColor: '#2E7D32', borderRadius: 12, paddingVertical: 18, alignItems: 'center', marginTop: 20, marginBottom: 40 },
  submitBtnDisabled: { backgroundColor: '#A3A3A3' },
  submitBtnText: { color: '#FFF', fontSize: 16, fontWeight: 'bold', letterSpacing: 1 },
  modalHeader: { padding: 20, borderBottomWidth: 1, borderBottomColor: '#EEE', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { fontSize: 20, fontWeight: 'bold' },
  modalInput: { margin: 15, borderWidth: 1, borderColor: '#DDD', borderRadius: 10, padding: 15, fontSize: 16 },
  popularCitiesWrap: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 15, marginBottom: 10, gap: 8 },
  popularCityChip: { backgroundColor: '#E8F5E9', borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12 },
  popularCityText: { color: '#2E7D32', fontWeight: '600' },
  resultItem: { padding: 15, borderBottomWidth: 1, borderBottomColor: '#EEE' },
  resultText: { fontSize: 16, color: '#333' },
});
