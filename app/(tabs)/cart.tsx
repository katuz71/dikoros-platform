/* eslint-disable @typescript-eslint/no-unused-vars */
import { AppHeader } from '@/components/AppHeader';
import { API_URL } from '@/config/api';
import { useCart } from '@/context/CartContext';
import { trackEvent } from '@/utils/analytics';
import { logFirebaseEvent } from '@/utils/firebaseAnalytics';
import { getImageUrl } from '@/utils/image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, Vibration, View } from 'react-native';


type Variant = {
  size: string;
  price: number;
};

type Product = {
  id: number;
  name: string;
  price: number;
  image?: string;
  image_url?: string;
  picture?: string;
  category?: string;
  rating?: number;
  size?: string;
  description?: string;
  badge?: string;
  quantity?: number;
  composition?: string;
  usage?: string;
  weight?: string;
  pack_sizes?: string[];
  old_price?: number;
  unit?: string;
  variants?: Variant[];
};

export default function CartScreen() {
  const router = useRouter();
  const { items: cartItems, removeItem, clearCart, addOne, removeOne, setPromoDiscount, discount, discountAmount, appliedPromoCode, totalPrice, finalPrice } = useCart();
  
  const formatPrice = (price: number) => {
    const safePrice = price || 0;
    return `${safePrice.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ")} ₴`;
  };

  const [promoCode, setPromoCode] = useState('');

  useEffect(() => {
    console.log('🛒 Cart state:', { discount, discountAmount, appliedPromoCode, totalPrice, finalPrice });
  }, [discount, discountAmount, appliedPromoCode, totalPrice, finalPrice]);

  const applyPromo = async () => {
    const normalizedPromoCode = promoCode.trim().toUpperCase();

    if (!normalizedPromoCode) {
      Alert.alert('Помилка', 'Введіть промокод');
      return;
    }

    try {
      const response = await fetch(`${API_URL}/api/promo-codes/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: normalizedPromoCode })
      });

      if (response.ok) {
        const data = await response.json();
        console.log('??? Promo code validated:', data);

        if (data.discount_percent > 0) {
          setPromoDiscount(data.discount_percent / 100, 0, data.code);
        } else if (data.discount_amount > 0) {
          setPromoDiscount(0, data.discount_amount, data.code);
        }

        setPromoCode('');
        Alert.alert('?????!', `???????? ${data.code} ???????????!`);
      } else {
        const error = await response.json();
        setPromoDiscount(0, 0, '');
        Alert.alert('Помилка', error.detail || 'Невірний промокод');
      }
    } catch (error) {
      console.error('Error validating promo code:', error);
      Alert.alert('Помилка', 'Не вдалося перевірити промокод');
    }
  };

  const subtotal = cartItems.reduce((sum: number, item: Product) => {
    return sum + (item.price * (item.quantity || 1));
  }, 0);

  // Расчет итоговой суммы с учетом процентной или фиксированной скидки
  const totalAmount = finalPrice;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
    >
      <AppHeader showLogo showSearch showFavorites showCart />

      <View style={styles.unifiedTitleRow}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.unifiedTitleButton}
          activeOpacity={0.75}
        >
          <Ionicons name="close" size={26} color="#111827" />
        </TouchableOpacity>

        <Text style={styles.unifiedTitle} numberOfLines={1}>Кошик</Text>

        {cartItems.length > 0 ? (
          <TouchableOpacity
            onPress={() => {
              Alert.alert("Очистити кошик?", "Всі товари будуть видалені з кошика.", [
                { text: "Скасувати", style: "cancel" },
                {
                  text: "Очистити",
                  style: "destructive",
                  onPress: () => {
                    clearCart();
                    Vibration.vibrate(100);
                  }
                }
              ]);
            }}
            style={styles.unifiedTitleButton}
            activeOpacity={0.75}
          >
            <Ionicons name="trash-outline" size={23} color="#EF4444" />
          </TouchableOpacity>
        ) : (
          <View style={styles.unifiedTitleButton} />
        )}
      </View>

      <ScrollView
        contentContainerStyle={cartItems.length === 0 ? styles.emptyContainer : styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {cartItems.length === 0 ? (
          <View style={styles.emptyView}>
            <View style={styles.emptyIconContainer}>
              <Ionicons name="cart-outline" size={60} color="#D1D5DB" />
            </View>

            <Text style={styles.emptyTitle}>Кошик порожній</Text>

            <Text style={styles.emptyText}>
              Ви ще нічого не додали. Загляньте в каталог, там багато цікавого!
            </Text>

            <TouchableOpacity
              onPress={() => router.replace('/(tabs)')}
              style={styles.emptyButton}
            >
              <Text style={styles.emptyButtonText}>Перейти до каталогу</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {cartItems.map((item: any) => {
              const sizeKey = item.variantSize || item.packSize || item.unit || 'шт';
              const compositeId = `${item.id}-${String(sizeKey)}`;

              return (
                <View key={compositeId} style={styles.itemContainer}>
                  <TouchableOpacity
                    onPress={() => router.push(`/product/${item.id}`)}
                    style={styles.itemImageContainer}
                  >
                    <Image
                      source={{ uri: getImageUrl(item.image) }}
                      style={styles.itemImage}
                    />
                  </TouchableOpacity>

                  <View style={styles.itemInfo}>
                    <Text numberOfLines={1} style={styles.itemName}>
                      {item.name}
                      <Text style={styles.itemUnit}>
                        {' '}({sizeKey})
                      </Text>
                    </Text>

                    <Text style={styles.itemPrice}>
                      {formatPrice(item.price * (item.quantity || 1))}
                    </Text>
                  </View>

                  <View style={styles.itemControls}>
                    <View style={styles.quantityControls}>
                      <TouchableOpacity
                        onPress={() => {
                          const itemUnit = item.variantSize || item.unit || item.packSize || 'шт';
                          removeOne(item.id, itemUnit);
                        }}
                        style={styles.quantityButton}
                      >
                        <Ionicons name="remove" size={16} color="black" />
                      </TouchableOpacity>

                      <Text style={styles.quantityText}>{item.quantity || 1}</Text>

                      <TouchableOpacity
                        onPress={() => {
                          const itemUnit = item.variantSize || item.unit || item.packSize || 'шт';
                          addOne(item.id, itemUnit);
                        }}
                        style={styles.quantityButton}
                      >
                        <Ionicons name="add" size={16} color="black" />
                      </TouchableOpacity>
                    </View>

                    <TouchableOpacity
                      onPress={() => {
                        Vibration.vibrate(100);
                        removeItem(compositeId);
                      }}
                      style={styles.deleteButton}
                    >
                      <Ionicons name="trash-outline" size={18} color="#999" />
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}

            <View style={styles.footer}>
              <Text style={styles.promoLabel}>Промокод</Text>
              <View style={styles.promoContainer}>
                <TextInput
                  placeholder="Введіть код"
                  value={promoCode}
                  onChangeText={setPromoCode}
                  autoCapitalize="characters"
                  placeholderTextColor="#9CA3AF"
                  style={styles.promoInput}
                />

                <TouchableOpacity onPress={applyPromo} style={styles.promoButton}>
                  <Text style={styles.promoButtonText}>Застосувати</Text>
                </TouchableOpacity>
              </View>

              {(discount > 0 || discountAmount > 0) && (
                <Text style={styles.discountText}>
                  Промокод {appliedPromoCode} застосовано!
                  {discount > 0 ? ` Знижка ${discount * 100}%` : ` Знижка ${Math.round(discountAmount)} ₴`} 🎉
                </Text>
              )}

              <Text style={styles.totalText}>
                <Text>Разом: </Text>
                <Text>{formatPrice(totalAmount)}</Text>
              </Text>

              <TouchableOpacity
                disabled={cartItems.length === 0}
                onPress={async () => {
                  try {
                    trackEvent('InitiateCheckout', {
                      value: totalAmount,
                      currency: 'UAH',
                      num_items: cartItems.length,
                      content_ids: cartItems.map((i: any) => i.id),
                      content_type: 'product',
                      items: cartItems.map((i: any) => ({
                        item_id: i.id,
                        item_name: i.name,
                        price: i.price,
                        quantity: i.quantity || 1
                      }))
                    });

                    logFirebaseEvent('begin_checkout', {
                      currency: 'UAH',
                      value: totalAmount,
                      items: cartItems.map((i: any) => ({
                        item_id: String(i.id),
                        item_name: i.name,
                        price: i.price,
                        quantity: i.quantity || 1
                      }))
                    });
                  } catch (error) {
                    console.error('Error logging begin checkout:', error);
                  }

                  router.push('/checkout');
                }}
                style={[
                  styles.checkoutButton,
                  cartItems.length === 0 && styles.checkoutButtonDisabled
                ]}
              >
                <Text style={styles.checkoutButtonText}>Оформити замовлення</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
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
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    // paddingTop: 50, // Удалено, теперь динамически
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  closeButton: {
    width: 40,
    alignItems: 'flex-start',
    justifyContent: 'center',
    padding: 5,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    flex: 1,
  },
  headerRight: {
    width: 40,
    alignItems: 'flex-end',
  },
  trashButton: {
    padding: 5,
  },
  emptyContainer: {
    flexGrow: 1,
    padding: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyView: {
    alignItems: 'center',
    justifyContent: 'center',
    // marginTop: 100, // Убираем marginTop, используем flex контейнера
    width: '100%',
  },
  emptyIconContainer: {
    width: 120,
    height: 120,
    backgroundColor: '#F5F5F5',
    borderRadius: 60,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 8,
    color: '#1F2937',
  },
  emptyText: {
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 32,
    width: '80%',
    lineHeight: 24,
    fontSize: 16,
  },
  emptyButton: {
    backgroundColor: '#458B00', // Брендовый цвет из профиля
    paddingVertical: 15,
    paddingHorizontal: 40,
    borderRadius: 12, // Как в профиле (inviteBanner)
    shadowColor: '#458B00',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  emptyButtonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 16,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 190,
  },
  itemContainer: {
    flexDirection: 'row',
    marginBottom: 20,
    backgroundColor: 'white',
    borderRadius: 15,
    padding: 10,
    alignItems: 'center',
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  itemImageContainer: {
    marginRight: 15,
  },
  itemImage: {
    width: 70,
    height: 70,
    borderRadius: 10,
    backgroundColor: '#f5f5f5',
  },
  itemInfo: {
    flex: 1,
    marginLeft: 0,
  },
  itemName: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  itemUnit: {
    fontWeight: 'normal',
    color: '#666',
  },
  itemPrice: {
    fontSize: 15,
    fontWeight: '600',
    marginTop: 5,
  },
  itemControls: {
    alignItems: 'flex-end',
  },
  quantityControls: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    padding: 2,
    marginBottom: 8,
  },
  quantityButton: {
    padding: 6,
  },
  quantityText: {
    marginHorizontal: 8,
    fontWeight: 'bold',
    fontSize: 14,
  },
  deleteButton: {
    padding: 5,
  },
  separator: {
    height: 1,
    backgroundColor: '#f0f0f0',
    marginVertical: 5,
  },
  footer: {
    padding: 20,
    paddingBottom: Platform.OS === 'ios' ? 42 : 72,
    marginTop: 4,
    marginBottom: Platform.OS === 'ios' ? 54 : 74,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    backgroundColor: '#fff',
    borderRadius: 16,
  },
  promoLabel: {
    color: '#374151',
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 2,
  },
  promoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    marginTop: 8,
    gap: 10,
  },
  promoInput: {
    flex: 1,
    height: 48,
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingHorizontal: 14,
    borderRadius: 12,
    fontSize: 15,
    color: '#111827',
  },
  promoButton: {
    height: 48,
    minWidth: 112,
    backgroundColor: '#2E7D32',
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  promoButtonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 14,
  },
  discountText: {
    color: '#4CAF50',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 10,
    textAlign: 'center',
  },
  totalText: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 15,
    color: '#000',
  },
  checkoutButton: {
    backgroundColor: '#2E7D32',
    padding: 18,
    borderRadius: 12,
    alignItems: 'center',
  },
  checkoutButtonDisabled: {
    backgroundColor: '#ccc',
  },
  checkoutButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
});





