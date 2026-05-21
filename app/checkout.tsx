import { logFirebaseEvent } from '@/utils/firebaseAnalytics';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
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

const NP_API_KEY = String(process.env.EXPO_PUBLIC_NP_API_KEY || '').trim();

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
    return `${safeValue.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ?`;
  };

  // Поля формы
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState(''); // ✅ NEW: Optional Email
  const [accountPhone, setAccountPhone] = useState('');
  const [contactMethod, setContactMethod] = useState<'call' | 'telegram' | 'viber'>('call'); // ✅ NEW: Contact Method

  const [city, setCity] = useState({ ref: '', name: '' });
  const [warehouse, setWarehouse] = useState({ ref: '', name: '' });
  const [modalVisible, setModalVisible] = useState<'city' | 'warehouse' | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [loading, setLoading] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'card' | 'cash'>('card');
  const [bonusBalance, setBonusBalance] = useState(0);
  const [useBonuses, setUseBonuses] = useState(false);
  const [saveUserData, setSaveUserData] = useState(false);

  const saveUserDataRef = useRef(false);

  useEffect(() => {
    saveUserDataRef.current = saveUserData;
  }, [saveUserData]);

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
        if (parsed.email) setEmail(parsed.email); // Load saved email
        if (parsed.city) setCity(parsed.city);
        if (parsed.warehouse) setWarehouse(parsed.warehouse);
        setSaveUserData(true);
      }
    } catch (e) { console.log(e); }
  };

  const fetchUserData = async (phoneNumber: string) => {
    try {
      const canon = canonicalizePhone(phoneNumber);
      const res = await fetch(`${API_URL}/user/${canon}`);
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
    if (!NP_API_KEY) {
      Alert.alert('Налаштування', 'Не налаштований ключ Нової Пошти (EXPO_PUBLIC_NP_API_KEY).');
      return;
    }
    setLoadingSearch(true);

    try {
      const response = await fetch('https://api.novaposhta.ua/v2.0/json/', {
        method: 'POST',
        body: JSON.stringify({
          apiKey: NP_API_KEY,
          modelName: "Address",
          calledMethod: "searchSettlements",
          methodProperties: { CityName: text, Limit: "50" }
        })
      });
      const data = await response.json();

      if (data.success && data.data && data.data[0] && data.data[0].Addresses) {
        const cities = data.data[0].Addresses.map((item: any) => ({
          ref: item.DeliveryCity,
          name: item.Present
        }));
        setSearchResults(cities);
      } else {
        setSearchResults([]);
      }
    } catch (e) { setSearchResults([]); } finally { setLoadingSearch(false); }
  };

  const loadWarehouses = async () => {
    if (!city.ref) return;
    if (!NP_API_KEY) {
      Alert.alert('Налаштування', 'Не налаштований ключ Нової Пошти (EXPO_PUBLIC_NP_API_KEY).');
      return;
    }
    setLoadingSearch(true);
    setSearchResults([]);

    try {
      const response = await fetch('https://api.novaposhta.ua/v2.0/json/', {
        method: 'POST',
        body: JSON.stringify({
          apiKey: NP_API_KEY,
          modelName: "Address",
          calledMethod: "getWarehouses",
          methodProperties: { CityRef: city.ref }
        })
      });
      const data = await response.json();

      if (data.success && data.data && Array.isArray(data.data)) {
        const warehouses = data.data.map((item: any) => ({
          ref: item.Ref,
          name: item.Description
        }));
        setSearchResults(warehouses);
      }
    } catch (e) { console.log(e); } finally { setLoadingSearch(false); }
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

  const handleSubmit = async () => {
    const shouldSaveUserData = saveUserDataRef.current;
    if (!name || !phone || !city.name || !warehouse.name) {
      Alert.alert('Увага', 'Будь ласка, заповніть всі поля:\n• Ім\'я\n• Телефон\n• Місто та Відділення');
      return;
    }

    setLoading(true);

    const phoneForAccount = canonicalizePhone(accountPhone || phone);

    if (shouldSaveUserData) {
      await AsyncStorage.setItem('savedCheckoutInfo', JSON.stringify({ name, email, city, warehouse }));
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

      const orderData = {
        name,
        user_phone: phoneForAccount,
        phone: canonicalizePhone(phone),
        email: email || '', // ✅ Include Email
        contact_preference: contactMethod, // ✅ Include Contact Preference
        city: city.name, cityRef: city.ref || "",
        warehouse: warehouse.name, warehouseRef: warehouse.ref || "",
        items: cleanItems,
        totalPrice: Math.floor(finalPriceWithBonuses),
        payment_method: paymentMethod,
        bonus_used: bonusesToUse,
        use_bonuses: useBonuses,
        promo_code: appliedPromoCode || null,
        promo_discount_percent: discount ? Math.round(Number(discount) * 100) : 0,
        promo_discount_amount: discountAmount ? Number(discountAmount) : 0,
        save_user_data: shouldSaveUserData
      };

      console.log('🚀 Отправка заказа:', orderData);

      const response = await fetch(`${API_URL}/create_order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
        // Always persist account phone so user can see orders in profile
        if (phoneForAccount) {
          await AsyncStorage.setItem('userPhone', phoneForAccount);
        }

        if (shouldSaveUserData) {
          if (name) {
            await AsyncStorage.setItem('userName', name);
          }

          // Ensure server-side profile is saved too (so "Інформація" fills immediately)
          try {
            await fetch(`${API_URL}/api/user/info/${phoneForAccount}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name,
                email,
                city: city?.name || '',
                warehouse: warehouse?.name || '',
                contact_preference: contactMethod
              })
            });
          } catch (e) {
            // ignore - order is already created
          }
        }

        if (result.pageUrl) {
          await Linking.openURL(result.pageUrl);
          clearCart();
          return;
        }

        clearCart();
        logFirebaseEvent('purchase', {
          currency: 'UAH',
          value: Math.floor(finalPriceWithBonuses),
          transaction_id: String(result.order_id),
          items: items.map((i: any) => ({
            item_id: String(i.id),
            item_name: i.name,
            price: i.price,
            quantity: i.quantity
          }))
        });

        Alert.alert(
          `Замовлення #${result.order_id} прийнято! 🎉`,
          `Дякуємо!\nМи зв'яжемося з Вами для підтвердження.`,
          [{ text: 'Чудово!', onPress: () => router.replace('/(tabs)/profile') }]
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
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemName} numberOfLines={1}>{item.name}</Text>
                  <Text style={styles.itemVariant}>
                    {item?.variantSize || item?.packSize || item?.label || item?.weight || item?.unit || '????????'}
                    {item.quantity > 1 ? ` x ${item.quantity} шт` : ''}
                  </Text>
                </View>
                <Text style={styles.itemPrice}>
                  {item.price * item.quantity} ₴
                </Text>
              </View>
            ))}
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Контакти</Text>
            <TextInput style={styles.input} placeholder="Ваше Ім’я" value={name} onChangeText={setName} />
            <TextInput style={styles.input} placeholder="Телефон (для доставки)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
            
            {/* ✅ 2. EMAIL (OPTIONAL) */}
            <TextInput
                style={styles.input}
                placeholder="Email (не обов’язково)"
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
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Доставка (Нова Пошта)</Text>
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
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Оплата</Text>
            <View style={styles.paymentRow}>
              <TouchableOpacity
                style={[styles.paymentOption, paymentMethod === 'card' && styles.paymentOptionActive]}
                onPress={() => setPaymentMethod('card')}
              >
                <Ionicons name="card-outline" size={24} color={paymentMethod === 'card' ? '#FFF' : '#333'} />
                <Text style={[styles.paymentText, paymentMethod === 'card' && { color: '#FFF' }]}>Картою</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.paymentOption, paymentMethod === 'cash' && styles.paymentOptionActive]}
                onPress={() => setPaymentMethod('cash')}
              >
                <Ionicons name="cash-outline" size={24} color={paymentMethod === 'cash' ? '#FFF' : '#333'} />
                <Text style={[styles.paymentText, paymentMethod === 'cash' && { color: '#FFF' }]}>При отриманні</Text>
              </TouchableOpacity>
            </View>
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
            <TextInput
              style={styles.modalInput}
              placeholder="Введіть назву міста (напр. Київ)"
              value={searchQuery}
              onChangeText={searchCity}
              autoFocus
            />
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
  paymentRow: { flexDirection: 'row', gap: 10 },
  paymentOption: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 15, borderRadius: 8, borderWidth: 1, borderColor: '#EEE', gap: 8 },
  paymentOptionActive: { backgroundColor: '#333', borderColor: '#333' },
  paymentText: { fontWeight: '600', color: '#333' },
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
