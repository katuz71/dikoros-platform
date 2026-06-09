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
    View
} from 'react-native';
import { API_URL } from '../config/api';
import { useCart } from '../context/CartContext';

const POPULAR_CITIES = ['Київ', 'Львів', 'Одеса', 'Дніпро', 'Харків', 'Івано-Франківськ'];

type DeliveryMethod =
  | 'ukrposhta_branch'
  | 'nova_poshta'
  | 'nova_poshta_international';

type PaymentMethod =
  | 'postpaid'
  | 'bank_transfer'
  | 'paypal_request';

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
    return 'Післяплата на пошті (Контроль оплати )';
  }
  return option.label;
};


export default function CheckoutScreen() {
  const router = useRouter();
  const { items, totalPrice, finalPrice, clearCart, appliedPromoCode, discount, discountAmount } = useCart() as any;

  const canonicalizePhone = (value: string) => {
    const digits = (value || '').replace(/\D/g, '');
    if (digits.length === 12 && digits.startsWith('380')) {
      return `0${digits.slice(3)}`;
    }
    if (digits.length === 9) {
      return `0${digits}`;
    }
    return digits;
  };

  const formatPrice = (value: number) => {
    const safeValue = Math.round(Number(value) || 0);
    return `${safeValue.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ₴`;
  };

  // Поля формы
  const [name, setName] = useState('');
  const [lastName, setLastName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');
  const [isDifferentPayer, setIsDifferentPayer] = useState(false);
  const [payerName, setPayerName] = useState('');
  const [payerPhone, setPayerPhone] = useState('');
  const [doNotCall, setDoNotCall] = useState(false);
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState(''); // ✅ NEW: Optional Email
  const [, setAccountPhone] = useState('');
  const [contactMethod, setContactMethod] = useState<'call' | 'telegram' | 'viber'>('call'); // ✅ NEW: Contact Method

  const [city, setCity] = useState({ ref: '', name: '' });
  const [warehouse, setWarehouse] = useState({ ref: '', name: '' });
  const [modalVisible, setModalVisible] = useState<'city' | 'warehouse' | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [loading, setLoading] = useState(false);
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>('nova_poshta');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('postpaid');
  const [orderComment, setOrderComment] = useState('');
  const [bonusBalance, setBonusBalance] = useState(0);
  const [useBonuses, setUseBonuses] = useState(false);
  const [saveUserData, setSaveUserData] = useState(false);

  const saveUserDataRef = useRef(false);

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
  }, []);

  useEffect(() => {
    console.log('💰 Checkout prices:', { totalPrice, finalPrice, difference: totalPrice - finalPrice });
  }, [totalPrice, finalPrice]);

  const loadUserData = async () => {
    try {
      const storedPhone = await AsyncStorage.getItem('userPhone');
      if (storedPhone) {
        const canon = canonicalizePhone(storedPhone);
        setPhone(canon);
        setAccountPhone(canon);
        fetchUserData(canon);
      }

      const savedInfo = await AsyncStorage.getItem('savedCheckoutInfo');
      if (savedInfo) {
        const parsed = JSON.parse(savedInfo);
        if (parsed.name) setName(parsed.name);
        if (parsed.lastName) setLastName(parsed.lastName);
        if (parsed.middleName) setMiddleName(parsed.middleName);
        if (parsed.recipientName) setRecipientName(parsed.recipientName);
        if (parsed.recipientPhone) setRecipientPhone(parsed.recipientPhone);
        if (parsed.isDifferentPayer) setIsDifferentPayer(Boolean(parsed.isDifferentPayer));
        if (parsed.payerName) setPayerName(parsed.payerName);
        if (parsed.payerPhone) setPayerPhone(parsed.payerPhone);
        if (parsed.doNotCall) setDoNotCall(Boolean(parsed.doNotCall));
        if (parsed.email) setEmail(parsed.email); // Load saved email
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
    } catch (e) { console.log(e); }
  };

  const fetchUserData = async (phoneNumber: string) => {
    try {
      const accessToken = await AsyncStorage.getItem('accessToken');
      if (!accessToken) return;

      const res = await fetch(`${API_URL}/api/user/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setBonusBalance(data.bonus_balance || 0);
        
        // Автозаповнення email якщо він є на сервері і локальний стейт пустий
        if (data.email && !email) {
          setEmail(data.email);
        }
        
        // Автозаповнення імені якщо воно є на сервері і локальний стейт пустий
        if (data.name && !name) {
          setName(data.name);
        }
        
        // Автозаповнення міста якщо воно є на сервері і локальний стейт пустий
        if (data.city && !city.name) {
          setCity({ ref: '', name: data.city });
        }
        
        // Автозаповнення відділення якщо воно є на сервері і локальний стейт пустий
        if (data.warehouse && !warehouse.name) {
          setWarehouse({ ref: '', name: data.warehouse });
        }
        
        // Автозаповнення способу зв’язку якщо він є на сервері
        if (data.contact_preference && ['call', 'telegram', 'viber'].includes(data.contact_preference)) {
          setContactMethod(data.contact_preference as 'call' | 'telegram' | 'viber');
        }
      }
    } catch (e) { console.log(e); }
  };

  // --- НОВАЯ ПОЧТА ---
  const searchCity = async (text: string) => {
    setSearchQuery(text);
    if (text.length < 2) return;

    setLoadingSearch(true);

    try {
      const endpoint = deliveryMethod === 'ukrposhta_branch'
        ? '/api/delivery/ukrposhta/cities'
        : '/api/delivery/cities';

      const response = await fetch(`${API_URL}${endpoint}?q=${encodeURIComponent(text)}`);
      const data = await response.json();

      if (Array.isArray(data)) {
        setSearchResults(data.map((item: any) => ({
          ref: item.ref,
          name: item.name
        })));
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
        setSearchResults(data.map((item: any) => ({
          ref: item.ref,
          name: item.name
        })));
      } else {
        setSearchResults([]);
      }
    } catch (e) {
      console.log(e);
      setSearchResults([]);
    } finally {
      setLoadingSearch(false);
    }
  };

  const openModal = (type: 'city' | 'warehouse') => {
    setModalVisible(type);
    setSearchQuery('');
    setSearchResults([]);
    if (type === 'warehouse') {
      if (!city.ref) {
        Alert.alert("Увага", "Спочатку оберіть місто!");
        return;
      }
      loadWarehouses();
    }
  };

  const handleSelect = (item: any) => {
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

  const handleSubmit = async () => {
    const shouldSaveUserData = saveUserDataRef.current;
    const needsDeliveryAddress = true;

    if (!lastName.trim() || !name.trim() || !phone.trim() || (needsDeliveryAddress && (!city.name || !warehouse.name))) {
      Alert.alert('Увага', `Будь ласка, заповніть всі поля:
• Прізвище
• Ім'я
• Телефон покупця
• Доставка`);
      return;
    }

    if (isDifferentPayer && (!payerName.trim() || !payerPhone.trim())) {
      Alert.alert('\u0423\u0432\u0430\u0433\u0430', '\u0417\u0430\u043f\u043e\u0432\u043d\u0456\u0442\u044c \u041f\u0406\u0411 \u0442\u0430 \u0442\u0435\u043b\u0435\u0444\u043e\u043d \u043f\u043b\u0430\u0442\u043d\u0438\u043a\u0430.');
      return;
    }

    const storedPhone = await AsyncStorage.getItem('userPhone');
    const accessToken = await AsyncStorage.getItem('accessToken');
    if (!storedPhone || !accessToken) {
      Alert.alert(
        'Потрібен SMS-вхід',
        'Перед оформленням замовлення увійдіть або зареєструйтесь за номером телефону через SMS.',
        [{ text: 'Увійти', onPress: () => router.replace('/(tabs)/profile') }]
      );
      return;
    }

    setLoading(true);

    const phoneForAccount = canonicalizePhone(storedPhone);

    if (shouldSaveUserData) {
      await AsyncStorage.setItem('savedCheckoutInfo', JSON.stringify({
        name,
        lastName,
        middleName,
        recipientName,
        recipientPhone,
        isDifferentPayer,
        payerName,
        payerPhone,
        doNotCall,
        email,
        city,
        warehouse,
        deliveryMethod,
        paymentMethod,
        orderComment
      }));
    } else {
      await AsyncStorage.removeItem('savedCheckoutInfo');
    }

    try {
      const cleanItems = (items || []).map((item: any) => ({
        id: Number(item.id),
        name: item.name,
        price: Number(item.price),
        quantity: item.quantity,
        packSize: item.packSize || null,
        unit: item.unit || 'шт',
        variant_info: item?.variantSize || item?.packSize || item?.unit || null
      }));

      // Використовуємо finalPrice з контексту (вже з урахуванням промокоду)
      const bonusesToUse = useBonuses ? Math.min(bonusBalance, finalPrice) : 0;
      const finalPriceWithBonuses = Math.max(0, finalPrice - bonusesToUse);

      const clientFullName = [lastName, name, middleName].map(v => v.trim()).filter(Boolean).join(' ');
      const finalRecipientName = recipientName.trim() || clientFullName || name;
      const finalRecipientPhone = canonicalizePhone(recipientPhone || phone);
      const finalPayerName = isDifferentPayer ? payerName.trim() : clientFullName;
      const finalPayerPhone = isDifferentPayer ? canonicalizePhone(payerPhone) : canonicalizePhone(phone);
      const finalCityName = city.name;
      const finalWarehouseName = warehouse.name;
      const finalCityRef = ['nova_poshta', 'ukrposhta_branch'].includes(deliveryMethod) ? (city.ref || "") : "";
      const finalWarehouseRef = ['nova_poshta', 'ukrposhta_branch'].includes(deliveryMethod) ? (warehouse.ref || "") : "";

      const orderData = {
        name,
        last_name: lastName.trim(),
        middle_name: middleName.trim(),
        client_full_name: clientFullName || name,
        recipient_name: finalRecipientName,
        recipient_phone: finalRecipientPhone,
        payer_name: finalPayerName,
        payer_phone: finalPayerPhone,
        is_different_payer: isDifferentPayer,
        do_not_call: doNotCall,
        user_phone: phoneForAccount,
        phone: canonicalizePhone(phone),
        email: email || '', // ✅ Include Email
        contact_preference: contactMethod, // ✅ Include Contact Preference
        city: finalCityName,
        cityRef: finalCityRef,
        city_ref: finalCityRef,
        warehouse: finalWarehouseName,
        warehouseRef: finalWarehouseRef,
        warehouse_ref: finalWarehouseRef,
        delivery_method: deliveryMethod,
        items: cleanItems,
        totalPrice: Math.floor(finalPriceWithBonuses),
        payment_method: paymentMethod,
        comment: orderComment.trim(),
        comments: orderComment.trim(),
        bonus_used: bonusesToUse,
        bonus_balance: bonusBalance,
        use_bonuses: useBonuses,
        promo_code: appliedPromoCode || null,
        promo_discount_percent: discount ? Math.round(Number(discount) * 100) : 0,
        promo_discount_amount: discountAmount ? Number(discountAmount) : 0,
        save_user_data: shouldSaveUserData
      };

      console.log('🚀 Отправка заказа:', orderData);

      const response = await fetch(`${API_URL}/create_order`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(orderData),
      });

      const contentType = response.headers.get('content-type');
      let result;

      if (contentType && contentType.includes('application/json')) {
        result = await response.json();
      } else {
        const textResponse = await response.text();
        console.error('Сервер вернул не JSON:', textResponse);
        throw new Error(`Сервер повернув некоректну відповідь: ${textResponse.substring(0, 100)}`);
      }

      if (response.ok) {
        try {
          const expoPushToken = await AsyncStorage.getItem('expoPushToken');
          if (expoPushToken) {
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
          console.warn('Save push token after checkout failed:', e);
        }

        if (shouldSaveUserData) {
          if (name) {
            await AsyncStorage.setItem('userName', name);
          }

          // Ensure server-side profile is saved too (so "Інформація" fills immediately)
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
                city: city?.name || '',
                warehouse: warehouse?.name || '',
                contact_preference: contactMethod
              })
            });
          } catch {
            // ignore - order is already created
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
          item_variant: i?.variantSize || i?.packSize || i?.unit || 'шт'
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
          discount_value: Math.round(Number(totalPrice || 0) - Number(finalPriceWithBonuses || 0)),
          payment_method: paymentMethod
        });

        clearCart();
        logFirebaseEvent('purchase', {
          currency: 'UAH',
          value: Math.floor(finalPriceWithBonuses),
          transaction_id: String(result.order_id),
          items: purchaseItems
        });

        Alert.alert(
          `Замовлення #${result.order_id} прийнято! 🎉`,
          `Дякуємо!\nМи зв'яжемося з Вами для підтвердження.`,
          [{ text: 'Чудово!', onPress: () => router.replace('/(tabs)/profile') }]
        );
      } else if (response.status === 401) {
        Alert.alert(
          'Потрібен SMS-вхід',
          result?.detail || 'Перед оформленням замовлення увійдіть через SMS.',
          [{ text: 'Увійти', onPress: () => router.replace('/(tabs)/profile') }]
        );
      } else {
        Alert.alert('Помилка сервера', result.detail || result.error || 'Щось пішло не так');
      }
    } catch (error) {
      console.error('Ошибка оформления:', error);
      Alert.alert('Помилка', error instanceof Error ? error.message : 'Не вдалося створити замовлення.');
    } finally {
      setLoading(false);
    }
  };

  // Використовуємо finalPrice з контексту для відображення
  const bonusesToUse = useBonuses ? Math.min(bonusBalance, finalPrice) : 0;
  const finalPriceWithBonuses = Math.max(0, finalPrice - bonusesToUse);
  const allowedPaymentOptions = getAllowedPaymentOptions(deliveryMethod);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#F5F5F5' }}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <Text style={styles.headerTitle}>Оформлення замовлення</Text>

          {/* ✅ 1. СПИСОК ТОВАРОВ (ORDER SUMMARY) */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Ваше замовлення</Text>
            {items.map((item: any, index: number) => (
              <View key={`${item.id}_${index}`} style={styles.orderItemRow}>
                {!!item.image && (
                  <Image
                    source={{ uri: item.image }}
                    style={{ width: 54, height: 54, borderRadius: 10, marginRight: 10, backgroundColor: '#F0F0F0' }}
                    resizeMode="cover"
                  />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemName} numberOfLines={1}>{item.name}</Text>
                  <Text style={styles.itemVariant}>
                    {item?.variantSize || item?.packSize || item?.label || item?.weight || item?.unit || 'Стандарт'}
                    {item.quantity > 1 ? ` x ${item.quantity} шт` : ''}
                  </Text>
                </View>
                <Text style={styles.itemPrice}>
                  {formatPrice(item.price * item.quantity)}
                </Text>
              </View>
            ))}
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Контакти покупця</Text>
            <TextInput style={styles.input} placeholder="Прізвище" value={lastName} onChangeText={setLastName} />
            <TextInput style={styles.input} placeholder="Ім’я" value={name} onChangeText={setName} />
            <TextInput style={styles.input} placeholder="По батькові (не обов’язково)" value={middleName} onChangeText={setMiddleName} />
            <TextInput style={styles.input} placeholder="Телефон покупця" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
            
            {/* ✅ 2. EMAIL (OPTIONAL) */}
            <TextInput
                style={styles.input}
                placeholder="Email покупця (не обов’язково)"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
            />

            {/* ✅ 3. СПОСОБ СВЯЗИ (CONTACT PREFERENCE) */}
            <Text style={styles.subLabel}>Зручний спосіб зв’язку:</Text>
            <View style={styles.methodContainer}>
                <TouchableOpacity 
                    style={[styles.methodChip, contactMethod === 'call' && styles.methodChipActive]}
                    onPress={() => setContactMethod('call')}
                >
                    <Text style={[styles.methodText, contactMethod === 'call' && styles.methodTextActive]}>📞 Дзвінок</Text>
                </TouchableOpacity>

                <TouchableOpacity 
                    style={[styles.methodChip, contactMethod === 'telegram' && styles.methodChipActive]}
                    onPress={() => setContactMethod('telegram')}
                >
                    <Text style={[styles.methodText, contactMethod === 'telegram' && styles.methodTextActive]}>✈️ Telegram</Text>
                </TouchableOpacity>

                <TouchableOpacity 
                    style={[styles.methodChip, contactMethod === 'viber' && styles.methodChipActive]}
                    onPress={() => setContactMethod('viber')}
                >
                    <Text style={[styles.methodText, contactMethod === 'viber' && styles.methodTextActive]}>💬 Viber</Text>
                </TouchableOpacity>
            </View>

            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <Text style={{ fontSize: 15, color: "#333", flex: 1 }}>Не перезванивати, тільки повідомлення</Text>
              <Switch value={doNotCall} onValueChange={setDoNotCall} />
            </View>

            <Text style={styles.subLabel}>Отримувач</Text>
            <TextInput style={styles.input} placeholder="ПІБ отримувача (якщо інша людина)" value={recipientName} onChangeText={setRecipientName} />
            <TextInput style={styles.input} placeholder="Телефон отримувача (якщо інший)" value={recipientPhone} onChangeText={setRecipientPhone} keyboardType="phone-pad" />
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Доставка</Text>
            <View style={styles.paymentRow}>
              {DELIVERY_OPTIONS.map(option => {
                const isActive = deliveryMethod === option.id;

                return (
                  <View key={option.id} style={styles.deliveryOptionBlock}>
                    <TouchableOpacity
                      style={[styles.paymentOption, isActive && styles.paymentOptionActive]}
                      onPress={() => handleDeliveryMethodChange(option.id)}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.paymentText, isActive && { color: '#FFF' }]}>{option.label}</Text>
                        {!!option.hint && (
                          <Text style={[styles.optionHint, isActive && { color: '#FFF' }]}>{option.hint}</Text>
                        )}
                      </View>
                    </TouchableOpacity>

                    {isActive && (
                      <View style={styles.deliveryDetails}>
                        {(option.id === 'nova_poshta' || option.id === 'ukrposhta_branch') ? (
                          <>
                            <TouchableOpacity style={styles.selectBtn} onPress={() => openModal('city')}>
                              <Text style={city.name ? styles.selectBtnTextActive : styles.selectBtnText}>
                                {city.name || "Оберіть місто..."}
                              </Text>
                              <Ionicons name="chevron-forward" size={20} color="#666" />
                            </TouchableOpacity>

                            <TouchableOpacity style={styles.selectBtn} onPress={() => openModal('warehouse')}>
                              <Text style={warehouse.name ? styles.selectBtnTextActive : styles.selectBtnText}>
                                {warehouse.name || "Оберіть відділення..."}
                              </Text>
                              <Ionicons name="chevron-forward" size={20} color="#666" />
                            </TouchableOpacity>
                          </>) : (
                          <>
                            <TextInput
                              style={styles.input}
                              placeholder={option.id === 'nova_poshta_international' ? "Країна та місто" : "Місто"}
                              value={city.name}
                              onChangeText={(text) => setCity({ ref: '', name: text })}
                            />
                            <TextInput
                              style={styles.input}
                              placeholder={option.id === 'nova_poshta_international' ? "Адреса доставки" : "Відділення / адреса"}
                              value={warehouse.name}
                              onChangeText={(text) => setWarehouse({ ref: '', name: text })}
                            />
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
                <TouchableOpacity
                  key={option.id}
                  style={[styles.paymentOption, paymentMethod === option.id && styles.paymentOptionActive]}
                  onPress={() => setPaymentMethod(option.id)}
                >
                  <Text style={[styles.paymentText, paymentMethod === option.id && { color: '#FFF' }]}>{getPaymentOptionLabel(option, deliveryMethod)}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              style={[styles.saveDataRow, { marginTop: 14, marginBottom: 10, paddingHorizontal: 0 }]}
              onPress={() => setIsDifferentPayer(!isDifferentPayer)}
            >
              <View style={[styles.checkbox, isDifferentPayer && styles.checkboxActive]}>
                {isDifferentPayer && <Ionicons name="checkmark" size={16} color="#FFF" />}
              </View>
              <Text style={styles.saveDataText}>{'\u0406\u043d\u0448\u0438\u0439 \u043f\u043b\u0430\u0442\u043d\u0438\u043a'}</Text>
            </TouchableOpacity>

            {isDifferentPayer && (
              <>
                <TextInput
                  style={styles.input}
                  placeholder={'\u041f\u0406\u0411 \u043f\u043b\u0430\u0442\u043d\u0438\u043a\u0430'}
                  value={payerName}
                  onChangeText={setPayerName}
                />
                <TextInput
                  style={styles.input}
                  placeholder={'\u0422\u0435\u043b\u0435\u0444\u043e\u043d \u043f\u043b\u0430\u0442\u043d\u0438\u043a\u0430'}
                  value={payerPhone}
                  onChangeText={setPayerPhone}
                  keyboardType="phone-pad"
                />
              </>
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Коментар до замовлення</Text>
            <TextInput
              style={[styles.input, styles.commentInput]}
              placeholder="Напишіть коментар для менеджера (не обов’язково)"
              value={orderComment}
              onChangeText={setOrderComment}
              multiline
            />
          </View>

          {bonusBalance > 0 && (
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
              <Switch
                value={useBonuses} onValueChange={setUseBonuses}
                trackColor={{ false: "#767577", true: "#4CAF50" }}
              />
            </View>
          )}

          <TouchableOpacity
            style={styles.saveDataRow}
            onPress={() => {
              const next = !saveUserDataRef.current;
              saveUserDataRef.current = next;
              setSaveUserData(next);
            }}
          >
            <View style={[styles.checkbox, saveUserData && styles.checkboxActive]}>
              {saveUserData && <Ionicons name="checkmark" size={16} color="#FFF" />}
            </View>
            <Text style={styles.saveDataText}>Зберегти дані для наступних замовлень</Text>
          </TouchableOpacity>

          <View style={styles.summaryContainer}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Вартість товарів:</Text>
              <Text style={styles.summaryValue}>{totalPrice} ₴</Text>
            </View>
            {finalPrice < totalPrice && (
              <View style={styles.summaryRow}>
                <Text style={[styles.summaryLabel, { color: '#FF6B35' }]}>Знижка промокодом:</Text>
                <Text style={[styles.summaryValue, { color: '#FF6B35' }]}>-{Math.round(totalPrice - finalPrice)} ₴</Text>
              </View>
            )}
            {useBonuses && bonusesToUse > 0 && (
              <View style={styles.summaryRow}>
                <Text style={[styles.summaryLabel, { color: '#4CAF50' }]}>Знижка бонусами:</Text>
                <Text style={[styles.summaryValue, { color: '#4CAF50' }]}>-{bonusesToUse} ₴</Text>
              </View>
            )}
            <View style={styles.divider} />
            <View style={styles.summaryRow}>
              <Text style={styles.totalLabel}>До сплати:</Text>
              <Text style={styles.totalValue}>{Math.round(finalPriceWithBonuses)} ₴</Text>
            </View>
          </View>

          <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit} disabled={loading}>
            {loading ? <ActivityIndicator color="#FFF" /> : <Text style={styles.submitBtnText}>ПІДТВЕРДИТИ ЗАМОВЛЕННЯ</Text>}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal visible={modalVisible !== null} animationType="slide">
        <SafeAreaView style={{ flex: 1 }}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{modalVisible === 'city' ? "Пошук міста" : "Оберіть відділення"}</Text>
            <TouchableOpacity onPress={() => setModalVisible(null)}>
              <Ionicons name="close" size={28} color="#333" />
            </TouchableOpacity>
          </View>

          {modalVisible === 'city' && (
            <>
              <TextInput
                style={styles.modalInput}
                placeholder="Введіть назву міста (напр. Київ)"
                value={searchQuery}
                onChangeText={searchCity}
                autoFocus
              />

              <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 15, marginBottom: 10, gap: 8 }}>
                {POPULAR_CITIES.map((cityName) => (
                  <TouchableOpacity
                    key={cityName}
                    style={{ backgroundColor: '#E8F5E9', borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12 }}
                    onPress={() => searchCity(cityName)}
                  >
                    <Text style={{ color: '#2E7D32', fontWeight: '600' }}>{cityName}</Text>
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
  optionHint: { marginTop: 4, color: '#777', fontSize: 13 },
  deliveryNote: { color: '#555', fontSize: 14, lineHeight: 20, marginTop: 4 },
  deliveryOptionBlock: { marginBottom: 10 },
  deliveryDetails: { marginTop: 10 },
  commentInput: { minHeight: 90, textAlignVertical: 'top' },
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
  submitBtnText: { color: '#FFF', fontSize: 16, fontWeight: 'bold', letterSpacing: 1 },
  modalHeader: { padding: 20, borderBottomWidth: 1, borderBottomColor: '#EEE', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { fontSize: 20, fontWeight: 'bold' },
  modalInput: { margin: 15, padding: 15, borderWidth: 1, borderColor: '#DDD', borderRadius: 10, fontSize: 16, backgroundColor: '#F9F9F9' },
  resultItem: { padding: 20, borderBottomWidth: 1, borderBottomColor: '#F0F0F0' },
  resultText: { fontSize: 16, color: '#333' },

  // ✅ New Styles Added below
  orderItemRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, borderBottomWidth: 1, borderBottomColor: '#F5F5F5', paddingBottom: 8 },
  itemName: { fontSize: 15, fontWeight: '600', color: '#333', marginBottom: 2 },
  itemVariant: { fontSize: 13, color: '#888' },
  itemPrice: { fontSize: 15, fontWeight: 'bold', color: '#333' },
  subLabel: { fontSize: 14, color: '#666', marginBottom: 8, marginTop: 10 },
  methodContainer: { flexDirection: 'row', gap: 8 },
  methodChip: { flex: 1, paddingVertical: 10, borderRadius: 8, backgroundColor: '#F0F0F0', alignItems: 'center', borderWidth: 1, borderColor: '#E0E0E0' },
  methodChipActive: { backgroundColor: '#E8F5E9', borderColor: '#4CAF50' },
  methodText: { fontSize: 12, color: '#333', fontWeight: '500' },
  methodTextActive: { color: '#2E7D32', fontWeight: 'bold' },
});
