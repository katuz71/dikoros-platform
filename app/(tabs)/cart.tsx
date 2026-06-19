import { AppHeader } from '@/components/AppHeader';
import { API_URL } from '@/config/api';
import { useCart } from '@/context/CartContext';
import { trackEvent } from '@/utils/analytics';
import { logFirebaseEvent } from '@/utils/firebaseAnalytics';
import { getImageUrl } from '@/utils/image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  Vibration,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFavoritesStore } from '../../store/favoritesStore';

type Product = {
  id: number;
  name: string;
  price: number;
  image?: string;
  image_url?: string;
  picture?: string;
  category?: string;
  quantity?: number;
  old_price?: number;
  unit?: string;
  packSize?: string;
  variantSize?: string;
};

const quantityOptions = Array.from({ length: 11 }, (_, index) => index);

const getSizeKey = (item: any) => item?.variantSize || item?.packSize || item?.unit || 'шт';
const getCompositeId = (item: any) => `${item.id}-${String(getSizeKey(item))}`;

export default function CartScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    items: cartItems,
    removeItem,
    updateQuantity,
    setPromoDiscount,
    discount,
    discountAmount,
    appliedPromoCode,
    finalPrice,
  } = useCart();
  const { favorites, toggleFavorite, isFavorite } = useFavoritesStore();

  const [promoCode, setPromoCode] = useState('');
  const [quantityPickerItem, setQuantityPickerItem] = useState<Product | null>(null);
  const [activeListTab, setActiveListTab] = useState<'saved' | 'lists'>('lists');

  const cartCount = cartItems.reduce((sum: number, item: any) => sum + Number(item?.quantity || 1), 0);
  const hasPromo = discount > 0 || discountAmount > 0;
  const totalAmount = finalPrice;

  const formatPrice = (price: number) => `${Math.round(price || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ₴`;

  const savedProducts = useMemo(() => {
    return favorites.filter((fav: any) => !cartItems.some((item: any) => Number(item.id) === Number(fav.id)));
  }, [favorites, cartItems]);

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
        body: JSON.stringify({ code: normalizedPromoCode }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.discount_percent > 0) {
          setPromoDiscount(data.discount_percent / 100, 0, data.code);
        } else if (data.discount_amount > 0) {
          setPromoDiscount(0, data.discount_amount, data.code);
        }
        setPromoCode('');
        Alert.alert('Готово', `Промокод ${data.code} застосовано`);
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

  const goCheckout = async () => {
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
          quantity: i.quantity || 1,
        })),
      });

      logFirebaseEvent('begin_checkout', {
        currency: 'UAH',
        value: totalAmount,
        items: cartItems.map((i: any) => ({
          item_id: String(i.id),
          item_name: i.name,
          price: i.price,
          quantity: i.quantity || 1,
        })),
      });
    } catch (error) {
      console.error('Error logging begin checkout:', error);
    }

    router.push('/checkout');
  };

  const closeQuantityPicker = () => setQuantityPickerItem(null);

  const selectQuantity = (quantity: number) => {
    if (!quantityPickerItem) return;

    const compositeId = getCompositeId(quantityPickerItem);

    if (quantity <= 0) {
      removeItem(compositeId);
      Vibration.vibrate(70);
    } else {
      updateQuantity(compositeId, quantity);
      Vibration.vibrate(20);
    }

    closeQuantityPicker();
  };

  const postponeItem = (item: Product) => {
    const compositeId = getCompositeId(item);
    if (!isFavorite(item.id)) {
      toggleFavorite({
        id: item.id,
        name: item.name,
        price: item.price,
        image: item.image || item.image_url || item.picture || '',
        category: item.category,
        old_price: item.old_price || null,
        unit: item.unit || item.packSize || item.variantSize || 'шт',
      });
    }
    removeItem(compositeId);
    Vibration.vibrate(60);
  };

  const renderQuantitySelector = (item: any) => {
    const quantity = Number(item.quantity || 1);

    return (
      <TouchableOpacity
        style={styles.quantitySelector}
        onPress={() => setQuantityPickerItem(item)}
        activeOpacity={0.85}
      >
        <Text style={styles.quantityText}>{quantity}</Text>
        <Ionicons name="chevron-down" size={19} color="#374151" />
      </TouchableOpacity>
    );
  };

  const pickerQuantity = Number(quantityPickerItem?.quantity || 1);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
    >
      <AppHeader showLogo showSearch showFavorites />

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
            <Text style={styles.emptyText}>Ви ще нічого не додали. Перейдіть до каталогу та оберіть потрібні товари.</Text>
            <TouchableOpacity onPress={() => router.replace('/(tabs)')} style={styles.emptyButton} activeOpacity={0.88}>
              <Text style={styles.emptyButtonText}>Перейти до каталогу</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={styles.cartTopRow}>
              <Text style={styles.cartTitle}>Кошик ({cartItems.length})</Text>
              <TouchableOpacity onPress={() => setPromoCode(appliedPromoCode || promoCode)} activeOpacity={0.75}>
                <Text style={styles.editPromoText}>Редагувати промокод</Text>
              </TouchableOpacity>
            </View>

            {cartItems.map((item: any) => {
              const sizeKey = getSizeKey(item);
              const compositeId = getCompositeId(item);
              const itemTotal = Number(item.price || 0) * Number(item.quantity || 1);

              return (
                <View key={compositeId} style={styles.cartCard}>
                  <TouchableOpacity onPress={() => router.push(`/product/${item.id}`)} style={styles.cartImageWrap} activeOpacity={0.82}>
                    <Image source={{ uri: getImageUrl(item.image || item.image_url || item.picture) }} style={styles.cartImage} />
                  </TouchableOpacity>

                  <View style={styles.cartItemBody}>
                    <Text numberOfLines={1} style={styles.brandText}>{item.category || 'DIKOROS'}</Text>
                    <Text numberOfLines={2} style={styles.cartItemName}>{item.name}</Text>
                    <TouchableOpacity onPress={() => router.push(`/product/${item.id}`)} style={styles.variantRow} activeOpacity={0.75}>
                      <Text numberOfLines={1} style={styles.variantText}>{sizeKey}</Text>
                      <Ionicons name="chevron-forward" size={15} color="#6B7280" />
                    </TouchableOpacity>

                    <View style={styles.itemActionsRow}>
                      {renderQuantitySelector(item)}

                      <TouchableOpacity
                        onPress={() => {
                          Vibration.vibrate(70);
                          removeItem(compositeId);
                        }}
                        style={styles.trashRoundButton}
                        activeOpacity={0.78}
                      >
                        <Ionicons name="trash-outline" size={21} color="#374151" />
                      </TouchableOpacity>

                      <TouchableOpacity onPress={() => postponeItem(item)} style={styles.postponeButton} activeOpacity={0.82}>
                        <Text style={styles.postponeText}>Відкласти</Text>
                      </TouchableOpacity>
                    </View>

                    <View style={styles.itemBottomRow}>
                      <Text style={styles.promoMismatchText}>Промокод застосовується за умовами акції</Text>
                      <View style={styles.itemPriceBlock}>
                        <Text style={styles.itemTotalPrice}>{formatPrice(itemTotal)}</Text>
                        <Text style={styles.moreText}>Детальніше</Text>
                      </View>
                    </View>
                  </View>
                </View>
              );
            })}

            {(savedProducts.length > 0 || favorites.length > 0) && (
              <View style={styles.savedSection}>
                <View style={styles.savedTabsRow}>
                  <TouchableOpacity
                    onPress={() => setActiveListTab('saved')}
                    style={[styles.savedTab, activeListTab === 'saved' && styles.savedTabActive]}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.savedTabText, activeListTab === 'saved' && styles.savedTabTextActive]}>Відкладено</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setActiveListTab('lists')}
                    style={[styles.savedTab, activeListTab === 'lists' && styles.savedTabActive]}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.savedTabText, activeListTab === 'lists' && styles.savedTabTextActive]}>Мої списки</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.savedPreviewCard}>
                  <Text style={styles.savedHintTitle}>{activeListTab === 'saved' ? 'Відкладені товари' : 'Мої списки'}</Text>
                  <Text style={styles.savedHintText}>
                    {favorites.length > 0 ? `Збережено товарів: ${favorites.length}` : 'Тут будуть товари, які ви відкладете з кошика.'}
                  </Text>
                  <TouchableOpacity onPress={() => router.replace('/(tabs)/favorites' as any)} activeOpacity={0.78}>
                    <Text style={styles.savedOpenText}>Відкрити обране</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            <View style={styles.promoSection}>
              <Text style={styles.promoLabel}>Промокод</Text>
              <View style={styles.promoContainer}>
                <TextInput
                  value={promoCode}
                  onChangeText={setPromoCode}
                  autoCapitalize="characters"
                  placeholder=""
                  placeholderTextColor="#9CA3AF"
                  style={styles.promoInput}
                />
                <TouchableOpacity onPress={applyPromo} style={styles.promoButton} activeOpacity={0.88}>
                  <Text style={styles.promoButtonText}>Застосувати</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.promoHint}>Один код в замовленні</Text>
              {hasPromo && (
                <View style={styles.discountBox}>
                  <Ionicons name="checkmark-circle" size={17} color="#2E7D32" />
                  <Text style={styles.discountText}>
                    {appliedPromoCode} застосовано · {discount > 0 ? `знижка ${Math.round(discount * 100)}%` : `знижка ${formatPrice(discountAmount)}`}
                  </Text>
                </View>
              )}
            </View>
          </>
        )}
      </ScrollView>

      {cartItems.length > 0 && (
        <View style={[styles.stickyCheckout, { bottom: 58 + Math.max(insets.bottom, 4) }]}> 
          <TouchableOpacity style={styles.totalToggle} activeOpacity={0.8}>
            <Text style={styles.stickyTotal}>{formatPrice(totalAmount)}</Text>
            <Ionicons name="chevron-up" size={18} color="#111827" />
          </TouchableOpacity>
          <TouchableOpacity onPress={goCheckout} style={styles.checkoutButton} activeOpacity={0.9}>
            <Text style={styles.checkoutButtonText}>Оформити замовлення ({cartCount})</Text>
          </TouchableOpacity>
        </View>
      )}

      <Modal
        visible={!!quantityPickerItem}
        transparent
        animationType="fade"
        onRequestClose={closeQuantityPicker}
      >
        <View style={styles.quantityModalRoot}>
          <Pressable style={styles.quantityBackdrop} onPress={closeQuantityPicker} />

          <View style={[styles.quantitySheet, { paddingBottom: Math.max(insets.bottom + 18, 28) }]}> 
            <View style={styles.quantitySheetHeader}>
              <Text style={styles.quantitySheetTitle}>Оберіть кількість товару</Text>
              <TouchableOpacity onPress={closeQuantityPicker} style={styles.quantityCloseButton} activeOpacity={0.75}>
                <Ionicons name="close" size={34} color="#222222" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.quantitySheetScroll} showsVerticalScrollIndicator={false}>
              {quantityOptions.map((quantity) => {
                const active = quantity === pickerQuantity;
                return (
                  <TouchableOpacity
                    key={quantity}
                    style={[styles.quantitySheetOption, active && styles.quantitySheetOptionActive]}
                    onPress={() => selectQuantity(quantity)}
                    activeOpacity={0.82}
                  >
                    <Text style={styles.quantitySheetOptionText}>
                      {quantity === 0 ? '0 (видалити)' : quantity}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F7F7F7',
  },
  emptyContainer: {
    flexGrow: 1,
    padding: 20,
    paddingBottom: 150,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyView: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  emptyIconContainer: {
    width: 120,
    height: 120,
    backgroundColor: '#FFFFFF',
    borderRadius: 60,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '900',
    marginBottom: 8,
    color: '#1F2937',
  },
  emptyText: {
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 32,
    width: '86%',
    lineHeight: 24,
    fontSize: 16,
  },
  emptyButton: {
    backgroundColor: '#2E7D32',
    paddingVertical: 15,
    paddingHorizontal: 34,
    borderRadius: 12,
  },
  emptyButtonText: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 16,
  },
  scrollContent: {
    paddingHorizontal: 12,
    paddingTop: 22,
    paddingBottom: 182,
  },
  cartTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
    paddingHorizontal: 10,
  },
  cartTitle: {
    fontSize: 25,
    fontWeight: '900',
    color: '#222222',
  },
  editPromoText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1976A3',
  },
  cartCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    flexDirection: 'row',
  },
  cartImageWrap: {
    width: 96,
    paddingTop: 6,
    alignItems: 'center',
  },
  cartImage: {
    width: 76,
    height: 92,
    resizeMode: 'contain',
    backgroundColor: '#FFFFFF',
  },
  cartItemBody: {
    flex: 1,
    paddingLeft: 12,
  },
  brandText: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 5,
  },
  cartItemName: {
    fontSize: 18,
    lineHeight: 25,
    fontWeight: '500',
    color: '#2C2C2C',
  },
  variantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 5,
    marginBottom: 14,
  },
  variantText: {
    fontSize: 15,
    color: '#6B7280',
    marginRight: 4,
  },
  itemActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 10,
    marginBottom: 16,
  },
  quantitySelector: {
    height: 44,
    minWidth: 92,
    paddingHorizontal: 18,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  quantityText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
  },
  trashRoundButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  postponeButton: {
    height: 44,
    paddingHorizontal: 18,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  postponeText: {
    fontSize: 15,
    fontWeight: '900',
    color: '#374151',
  },
  itemBottomRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 10,
  },
  promoMismatchText: {
    flex: 1,
    fontSize: 12.5,
    lineHeight: 17,
    color: '#6B7280',
  },
  itemPriceBlock: {
    alignItems: 'flex-end',
  },
  itemTotalPrice: {
    fontSize: 20,
    fontWeight: '900',
    color: '#111827',
  },
  moreText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1976A3',
  },
  savedSection: {
    marginTop: 8,
    marginBottom: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    overflow: 'hidden',
  },
  savedTabsRow: {
    flexDirection: 'row',
    minHeight: 56,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  savedTab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 4,
    borderBottomColor: 'transparent',
  },
  savedTabActive: {
    borderBottomColor: '#2E7D32',
  },
  savedTabText: {
    fontSize: 17,
    fontWeight: '800',
    color: '#374151',
  },
  savedTabTextActive: {
    color: '#2E7D32',
    fontWeight: '900',
  },
  savedPreviewCard: {
    padding: 16,
  },
  savedHintTitle: {
    fontSize: 17,
    fontWeight: '900',
    color: '#111827',
    marginBottom: 4,
  },
  savedHintText: {
    fontSize: 14,
    lineHeight: 19,
    color: '#6B7280',
    marginBottom: 8,
  },
  savedOpenText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#1976A3',
  },
  promoSection: {
    marginTop: 18,
    marginBottom: 20,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingTop: 18,
    paddingBottom: 22,
    borderRadius: 12,
  },
  promoLabel: {
    fontSize: 23,
    fontWeight: '900',
    color: '#2C2C2C',
    marginBottom: 18,
  },
  promoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  promoInput: {
    flex: 1,
    height: 70,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.2,
    borderColor: '#D1D5DB',
    paddingHorizontal: 16,
    borderRadius: 10,
    fontSize: 18,
    color: '#111827',
  },
  promoButton: {
    height: 70,
    minWidth: 150,
    backgroundColor: '#2E7D32',
    paddingHorizontal: 16,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  promoButtonText: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 19,
  },
  promoHint: {
    marginTop: 8,
    fontSize: 13.5,
    color: '#6B7280',
  },
  discountBox: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  discountText: {
    flex: 1,
    color: '#2E7D32',
    fontSize: 14,
    fontWeight: '800',
  },
  stickyCheckout: {
    position: 'absolute',
    left: 0,
    right: 0,
    minHeight: 88,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    paddingHorizontal: 18,
    paddingTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    zIndex: 850,
    elevation: 850,
  },
  totalToggle: {
    minWidth: 105,
    height: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  stickyTotal: {
    fontSize: 22,
    fontWeight: '900',
    color: '#111827',
  },
  checkoutButton: {
    flex: 1,
    height: 58,
    borderRadius: 10,
    backgroundColor: '#2E7D32',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  checkoutButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '900',
    textAlign: 'center',
  },
  quantityModalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  quantityBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.58)',
  },
  quantitySheet: {
    maxHeight: '56%',
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingTop: 24,
    paddingHorizontal: 30,
  },
  quantitySheetHeader: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  quantitySheetTitle: {
    flex: 1,
    paddingRight: 12,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '900',
    color: '#2A2A2A',
  },
  quantityCloseButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quantitySheetScroll: {
    maxHeight: 380,
  },
  quantitySheetOption: {
    minHeight: 58,
    justifyContent: 'center',
    paddingHorizontal: 24,
    borderRadius: 9,
    marginBottom: 6,
  },
  quantitySheetOptionActive: {
    backgroundColor: '#E2F4E2',
  },
  quantitySheetOptionText: {
    fontSize: 22,
    fontWeight: '500',
    color: '#2B2B2B',
  },
});