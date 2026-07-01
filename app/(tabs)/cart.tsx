import { AppHeader } from '@/components/AppHeader';
import { API_URL } from '@/config/api';
import { useCart } from '@/context/CartContext';
import { useOrders } from '@/context/OrdersContext';
import { useAppFooterAutoHide } from '@/hooks/use-app-footer-auto-hide';
import { trackEvent } from '@/utils/analytics';
import { logFirebaseEvent } from '@/utils/firebaseAnalytics';
import { getImageUrl } from '@/utils/image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  BackHandler,
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
  rating?: number;
  averageRating?: number;
  average_rating?: number;
  totalReviews?: number;
  total_reviews?: number;
  review_count?: number;
  reviews_count?: number;
};

const quantityOptions = Array.from({ length: 11 }, (_, index) => index);

const getSizeKey = (item: any) => item?.variantSize || item?.packSize || item?.unit || 'шт';
const getCompositeId = (item: any) => `${item.id}-${String(getSizeKey(item))}`;

export default function CartScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { handleFooterScroll } = useAppFooterAutoHide();
  const {
    items: cartItems,
    addItem,
    removeItem,
    updateQuantity,
    setPromoDiscount,
    discount,
    discountAmount,
    appliedPromoCode,
    finalPrice,
  } = useCart();
  const { products, fetchProducts } = useOrders();
  const { favorites } = useFavoritesStore();

  const [promoCode, setPromoCode] = useState('');
  const [quantityPickerItem, setQuantityPickerItem] = useState<Product | null>(null);
  const [activeListTab, setActiveListTab] = useState<'saved' | 'lists'>('saved');
  const [postponedItems, setPostponedItems] = useState<Product[]>([]);

  const cartCount = cartItems.reduce((sum: number, item: any) => sum + Number(item?.quantity || 1), 0);
  const hasCartItems = cartItems.length > 0;
  const hasPostponedItems = postponedItems.length > 0;
  const hasFavoriteItems = favorites.length > 0;
  const hasAnyContent = hasCartItems || hasPostponedItems || hasFavoriteItems;
  const hasProducts = Array.isArray(products) && products.length > 0;
  const hasPromo = discount > 0 || discountAmount > 0;
  const totalAmount = finalPrice;

  useEffect(() => {
    if (!hasProducts) {
      fetchProducts().catch(() => {});
    }
  }, [fetchProducts, hasProducts]);

  // Android back in cart: close modal first, then let global history handler work.
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (quantityPickerItem) {
        setQuantityPickerItem(null);
        return true;
      }

      return false;
    });

    return () => subscription.remove();
  }, [quantityPickerItem]);

  const normalizeText = useCallback((value: any) => String(value || '')
    .toLowerCase()
    .replace(/&[a-z]+;/g, ' ')
    .replace(/[’'`ʼ]/g, '')
    .replace(/[^a-zа-яіїєґ0-9\s-]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim(), []);

  const getCategoryParts = useCallback((item: any) => normalizeText(item?.category)
    .split(/[>»/|,]/)
    .map(part => part.trim())
    .filter(Boolean), [normalizeText]);

  const getSearchText = useCallback((item: any) => normalizeText([
    item?.name,
    item?.category,
    item?.unit,
    item?.packSize,
    item?.variantSize,
  ].filter(Boolean).join(' ')), [normalizeText]);

  const getTokens = useCallback((item: any) => {
    const stopWords = new Set([
      'для', 'та', 'і', 'й', 'з', 'із', 'на', 'у', 'в', 'по', 'до', 'від', 'або', 'без', 'при',
      'грн', 'шт', 'мл', 'г', 'кг', 'капсул', 'капсули', 'капсула', 'упаковка', 'товар', 'dikoros',
      'the', 'and', 'with', 'for', 'of', 'in', 'new', 'best',
    ]);

    return Array.from(new Set(
      getSearchText(item)
        .split(/\s+/)
        .map(token => token.trim())
        .filter(token => token.length >= 3 && !stopWords.has(token) && !/^\d+$/.test(token))
    ));
  }, [getSearchText]);

  const getReviewStats = useCallback((item: any) => {
    const rating = Number(
      item?.averageRating ??
      item?.average_rating ??
      item?.rating ??
      0
    );
    const count = Number(
      item?.totalReviews ??
      item?.total_reviews ??
      item?.reviews_count ??
      item?.review_count ??
      0
    );

    if (!Number.isFinite(rating) || !Number.isFinite(count) || rating <= 0 || count <= 0) {
      return null;
    }

    const filled = Math.max(0, Math.min(5, Math.round(rating)));
    return {
      rating,
      count,
      stars: `${'★'.repeat(filled)}${'☆'.repeat(5 - filled)}`,
    };
  }, []);

  const recommendationProducts = useMemo(() => {
    const blockedIds = new Set<number>();

    cartItems.forEach((item: any) => blockedIds.add(Number(item?.id)));
    postponedItems.forEach((item: any) => blockedIds.add(Number(item?.id)));
    favorites.forEach((item: any) => blockedIds.add(Number(item?.id)));

    const signals = [
      ...cartItems.map((item: any) => ({ item, weight: 10 })),
      ...postponedItems.map((item: any) => ({ item, weight: 8 })),
      ...favorites.map((item: any) => ({ item, weight: 6 })),
    ].filter(signal => Number(signal.item?.id));

    const categoryWeights = new Map<string, number>();
    const tokenWeights = new Map<string, number>();
    const selectedPrices: number[] = [];

    signals.forEach(({ item, weight }) => {
      getCategoryParts(item).forEach(category => {
        categoryWeights.set(category, (categoryWeights.get(category) || 0) + weight);
      });

      getTokens(item).forEach(token => {
        tokenWeights.set(token, (tokenWeights.get(token) || 0) + weight);
      });

      const price = Number(item?.price || 0);
      if (Number.isFinite(price) && price > 0) selectedPrices.push(price);
    });

    const averageSelectedPrice = selectedPrices.length
      ? selectedPrices.reduce((sum, price) => sum + price, 0) / selectedPrices.length
      : 0;

    const hasPersonalSignals = signals.length > 0;

    return (Array.isArray(products) ? products : [])
      .filter((item: any) => Number(item?.id) && !blockedIds.has(Number(item.id)) && Number(item?.price || 0) > 0)
      .map((item: any, index: number) => {
        let score = 0;

        getCategoryParts(item).forEach(category => {
          score += (categoryWeights.get(category) || 0) * 9;
        });

        getTokens(item).forEach(token => {
          score += (tokenWeights.get(token) || 0) * 2.4;
        });

        const price = Number(item?.price || 0);
        if (averageSelectedPrice > 0 && price > 0) {
          const priceDistance = Math.abs(price - averageSelectedPrice) / averageSelectedPrice;
          score += Math.max(0, 26 - priceDistance * 34);
        }

        const oldPrice = Number(item?.old_price || 0);
        if (oldPrice > price && price > 0) {
          score += Math.min(18, ((oldPrice - price) / oldPrice) * 100);
        }

        const reviews = getReviewStats(item);
        if (reviews) {
          score += Math.min(12, reviews.count / 12);
          score += Math.max(0, reviews.rating - 4) * 4;
        }

        if (!hasPersonalSignals) {
          score += Math.max(0, 1000 - index) / 1000;
        }

        return { item, score, index };
      })
      .filter(({ score }) => !hasPersonalSignals || score > 0)
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, 8)
      .map(({ item }) => item) as Product[];
  }, [products, cartItems, postponedItems, favorites, getCategoryParts, getTokens, getReviewStats]);

  const formatPrice = (price: number) => `${Math.round(price || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ₴`;
  const formatItemCount = (count: number) => `${count} товарів`;

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
      const checkoutItems = cartItems.map((i: any) => ({
        item_id: String(i.id),
        item_name: i.name,
        price: Number(i.price || 0),
        quantity: Number(i.quantity || 1),
        item_variant: i?.variantSize || i?.packSize || i?.unit || 'шт',
      }));
      const checkoutPayload = {
        value: totalAmount,
        currency: 'UAH',
        num_items: cartItems.reduce((sum: number, i: any) => sum + Number(i.quantity || 1), 0),
        content_ids: cartItems.map((i: any) => String(i.id)),
        content_type: 'product',
        items: checkoutItems,
      };

      await Promise.all([
        trackEvent('InitiateCheckout', checkoutPayload),
        logFirebaseEvent('begin_checkout', checkoutPayload),
      ]);
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
    const normalizedItem = {
      ...item,
      image: item.image || item.image_url || item.picture || '',
      quantity: Number(item.quantity || 1),
      packSize: item.packSize || item.variantSize || item.unit || 'шт',
      unit: item.unit || item.packSize || item.variantSize || 'шт',
      variantSize: item.variantSize || item.packSize || item.unit || 'шт',
    };

    setPostponedItems((prev) => {
      const existingIndex = prev.findIndex((saved) => getCompositeId(saved) === compositeId);
      if (existingIndex === -1) return [normalizedItem, ...prev];

      const next = [...prev];
      next[existingIndex] = {
        ...next[existingIndex],
        quantity: Number(next[existingIndex].quantity || 1) + Number(normalizedItem.quantity || 1),
      };
      return next;
    });

    setActiveListTab('saved');
    removeItem(compositeId);
    Vibration.vibrate(60);
  };

  const restorePostponedItem = (item: Product) => {
    const compositeId = getCompositeId(item);
    const sizeKey = getSizeKey(item);
    const unit = item.unit || sizeKey || 'шт';

    addItem(item, Number(item.quantity || 1), sizeKey, unit, item.price);
    setPostponedItems((prev) => prev.filter((saved) => getCompositeId(saved) !== compositeId));
    Vibration.vibrate(60);
  };

  const restoreAllPostponedItems = () => {
    if (!postponedItems.length) return;

    postponedItems.forEach((item) => {
      const sizeKey = getSizeKey(item);
      const unit = item.unit || sizeKey || 'шт';
      addItem(item, Number(item.quantity || 1), sizeKey, unit, item.price);
    });

    setPostponedItems([]);
    setActiveListTab('saved');
    Vibration.vibrate(60);
  };

  const addFavoriteToCart = (item: Product) => {
    const unit = item.unit || item.packSize || item.variantSize || 'шт';
    addItem(
      {
        ...item,
        image: item.image || item.image_url || item.picture || '',
        image_url: item.image || item.image_url || item.picture || '',
        unit,
      },
      1,
      unit,
      unit,
      Number(item.price || 0)
    );
    Vibration.vibrate(50);
  };

  const removePostponedItem = (item: Product) => {
    const compositeId = getCompositeId(item);
    setPostponedItems((prev) => prev.filter((saved) => getCompositeId(saved) !== compositeId));
    Vibration.vibrate(50);
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

  const renderProductTile = (item: Product, options?: { postponed?: boolean; index?: number }) => {
    const sizeKey = getSizeKey(item);
    const key = options?.postponed ? getCompositeId(item) : `favorite-${item.id}-${options?.index || 0}`;
    const reviewStats = getReviewStats(item);

    return (
      <View key={key} style={styles.postponedCard}>
        <View style={styles.postponedImageWrap}>
          <Image source={{ uri: getImageUrl(item.image || item.image_url || item.picture) }} style={styles.postponedImage} />
          <TouchableOpacity
            onPress={() => options?.postponed ? restorePostponedItem(item) : addFavoriteToCart(item)}
            style={styles.postponedFloatingCart}
            activeOpacity={0.84}
          >
            <Ionicons name="cart-outline" size={22} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        <Text numberOfLines={3} style={styles.postponedName}>{item.name}</Text>
        <Text style={styles.postponedMeta}>{sizeKey}{options?.postponed ? ` · ${Number(item.quantity || 1)} шт.` : ''}</Text>
        {reviewStats && (
          <Text style={styles.reviewSummary}>{reviewStats.stars} {reviewStats.count}</Text>
        )}
        <Text style={styles.postponedPrice}>{formatPrice(Number(item.price || 0))}</Text>

        {options?.postponed && (
          <TouchableOpacity onPress={() => removePostponedItem(item)} activeOpacity={0.78}>
            <Text style={styles.postponedRemoveText}>Видалити</Text>
          </TouchableOpacity>
        )}
      </View>
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
        contentContainerStyle={!hasAnyContent ? styles.emptyContainer : styles.scrollContent}
        onScroll={handleFooterScroll}
        scrollEventThrottle={16}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {!hasAnyContent ? (
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
            {!hasCartItems && (hasPostponedItems || hasFavoriteItems) && (
              <View style={styles.emptyCartNotice}>
                <View style={styles.emptyNoticeIcon}>
                  <Ionicons name="cart-outline" size={52} color="#7A7A7A" />
                </View>
                <View style={styles.emptyNoticeTextBox}>
                  <Text style={styles.emptyNoticeTitle}>Ваш кошик порожній</Text>
                  <Text style={styles.emptyNoticeText}>Відкладені товари та мої списки залишаються нижче на цій самій сторінці.</Text>
                </View>
              </View>
            )}

            {hasCartItems && (
              <View style={styles.cartTopRow}>
                <Text style={styles.cartTitle}>Кошик ({cartItems.length})</Text>
              </View>
            )}

            {hasCartItems && cartItems.map((item: any) => {
              const sizeKey = getSizeKey(item);
              const compositeId = getCompositeId(item);
              const itemTotal = Number(item.price || 0) * Number(item.quantity || 1);

              return (
                <View key={compositeId} style={styles.cartCard}>
                  <View style={styles.cartImageWrap}>
                    <Image source={{ uri: getImageUrl(item.image || item.image_url || item.picture) }} style={styles.cartImage} />
                  </View>

                  <View style={styles.cartItemBody}>
                    <Text numberOfLines={2} style={styles.cartItemName}>{item.name}</Text>
                    <View style={styles.variantRow}>
                      <Text numberOfLines={1} style={styles.variantText}>{sizeKey}</Text>
                    </View>

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
                        <Ionicons name="trash-outline" size={20} color="#374151" />
                      </TouchableOpacity>

                      <TouchableOpacity onPress={() => postponeItem(item)} style={styles.postponeButton} activeOpacity={0.82}>
                        <Text style={styles.postponeText}>Відкласти</Text>
                      </TouchableOpacity>
                    </View>

                    <View style={styles.itemBottomRow}>
                      <Text style={styles.itemTotalPrice}>{formatPrice(itemTotal)}</Text>
                    </View>
                  </View>
                </View>
              );
            })}

            {hasCartItems && (
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
            )}

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

              {activeListTab === 'saved' ? (
                <View style={styles.postponedList}>
                  {hasPostponedItems ? (
                    <>
                      <Text style={styles.postponedCount}>{formatItemCount(postponedItems.length)}</Text>
                      <View style={styles.productTilesWrap}>
                        {postponedItems.map(item => renderProductTile(item, { postponed: true }))}
                      </View>
                    </>
                  ) : (
                    <View style={styles.savedPreviewCard}>
                      <Text style={styles.savedHintTitle}>Відкладених товарів немає</Text>
                      <Text style={styles.savedHintText}>Натисніть «Відкласти» в кошику, щоб товар з’явився тут без переходу на іншу сторінку.</Text>
                    </View>
                  )}
                </View>
              ) : (
                <View style={styles.postponedList}>
                  {hasFavoriteItems ? (
                    <>
                      <Text style={styles.postponedCount}>{formatItemCount(favorites.length)}</Text>
                      <View style={styles.productTilesWrap}>
                        {favorites.map((item: any, index: number) => renderProductTile(item, { index }))}
                      </View>
                    </>
                  ) : (
                    <View style={styles.savedPreviewCard}>
                      <Text style={styles.savedHintTitle}>Мої списки порожні</Text>
                      <Text style={styles.savedHintText}>Тут будуть товари, які ви додали в обране. Переходу на сторінку обраного немає.</Text>
                    </View>
                  )}
                </View>
              )}
            </View>

            {recommendationProducts.length > 0 && (
              <View style={styles.recommendSection}>
                <View style={styles.recommendHeader}>
                  <View style={styles.recommendLine} />
                  <Text style={styles.recommendTitle}>Це може вас зацікавити</Text>
                  <View style={styles.recommendLine} />
                </View>

                <View style={styles.productTilesWrap}>
                  {recommendationProducts.map((item, index) => renderProductTile(item, { index }))}
                </View>
              </View>
            )}
          </>
        )}
      </ScrollView>

      {hasCartItems && (
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

      {!hasCartItems && hasPostponedItems && (
        <View style={[styles.stickyCheckout, { bottom: 58 + Math.max(insets.bottom, 4) }]}> 
          <TouchableOpacity onPress={restoreAllPostponedItems} style={styles.addPostponedButton} activeOpacity={0.9}>
            <Text style={styles.addPostponedButtonText}>Додати товари в кошик</Text>
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
  container: { flex: 1, backgroundColor: '#F7F7F7' },
  emptyContainer: { flexGrow: 1, padding: 20, paddingBottom: 150, justifyContent: 'center', alignItems: 'center' },
  emptyView: { alignItems: 'center', justifyContent: 'center', width: '100%' },
  emptyIconContainer: { width: 120, height: 120, backgroundColor: '#FFFFFF', borderRadius: 60, alignItems: 'center', justifyContent: 'center', marginBottom: 24, borderWidth: 1, borderColor: '#E5E7EB' },
  emptyTitle: { fontSize: 20, fontWeight: '900', marginBottom: 8, color: '#1F2937' },
  emptyText: { color: '#6B7280', textAlign: 'center', marginBottom: 32, width: '86%', lineHeight: 24, fontSize: 16 },
  emptyButton: { backgroundColor: '#2E7D32', paddingVertical: 15, paddingHorizontal: 34, borderRadius: 12 },
  emptyButtonText: { color: '#FFFFFF', fontWeight: '900', fontSize: 16 },
  scrollContent: { paddingTop: 0, paddingBottom: 182 },
  emptyCartNotice: { minHeight: 130, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 22, paddingVertical: 17, marginBottom: 0 },
  emptyNoticeIcon: { width: 82, height: 82, borderRadius: 41, backgroundColor: '#F2F2F2', alignItems: 'center', justifyContent: 'center', marginRight: 16 },
  emptyNoticeTextBox: { flex: 1 },
  emptyNoticeTitle: { fontSize: 19, fontWeight: '900', color: '#222222', marginBottom: 6 },
  emptyNoticeText: { fontSize: 14.5, lineHeight: 21, color: '#374151' },
  cartTopRow: { alignItems: 'center', justifyContent: 'center', marginBottom: 10, paddingHorizontal: 24, paddingTop: 14 },
  cartTitle: { fontSize: 21, lineHeight: 26, fontWeight: '900', color: '#222222', textAlign: 'center' },
  cartCard: { backgroundColor: '#FFFFFF', borderRadius: 12, padding: 14, marginHorizontal: 12, marginBottom: 12, flexDirection: 'row' },
  cartImageWrap: { width: 96, paddingTop: 2, alignItems: 'center' },
  cartImage: { width: 76, height: 92, resizeMode: 'contain', backgroundColor: '#FFFFFF' },
  cartItemBody: { flex: 1, paddingLeft: 12 },
  cartItemName: { fontSize: 17, lineHeight: 24, fontWeight: '500', color: '#2C2C2C' },
  variantRow: { flexDirection: 'row', alignItems: 'center', marginTop: 5, marginBottom: 14 },
  variantText: { fontSize: 15, color: '#6B7280', marginRight: 4 },
  itemActionsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 10, marginBottom: 14 },
  quantitySelector: { height: 42, minWidth: 90, paddingHorizontal: 17, borderRadius: 999, borderWidth: 1, borderColor: '#D1D5DB', backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  quantityText: { fontSize: 18, fontWeight: '600', color: '#111827' },
  trashRoundButton: { width: 42, height: 42, borderRadius: 21, borderWidth: 1, borderColor: '#D1D5DB', alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  postponeButton: { height: 42, paddingHorizontal: 17, borderRadius: 999, borderWidth: 1, borderColor: '#D1D5DB', alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  postponeText: { fontSize: 15, fontWeight: '900', color: '#374151' },
  itemBottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' },
  itemPriceBlock: { alignItems: 'flex-end' },
  itemTotalPrice: { fontSize: 20, fontWeight: '900', color: '#111827' },
  savedSection: { marginTop: 0, marginBottom: 10, backgroundColor: '#FFFFFF', overflow: 'hidden' },
  savedTabsRow: { flexDirection: 'row', minHeight: 56, borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  savedTab: { flex: 1, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 3, borderBottomColor: 'transparent' },
  savedTabActive: { borderBottomColor: '#2E7D32' },
  savedTabText: { fontSize: 17, fontWeight: '900', color: '#222222' },
  savedTabTextActive: { color: '#2E7D32' },
  postponedList: { paddingHorizontal: 22, paddingTop: 18, paddingBottom: 20 },
  productTilesWrap: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 18 },
  postponedCount: { fontSize: 18, lineHeight: 23, fontWeight: '900', color: '#222222', marginBottom: 16 },
  postponedCard: { width: 154, marginBottom: 4 },
  postponedImageWrap: { width: 148, height: 122, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  postponedImage: { width: 78, height: 102, resizeMode: 'contain', backgroundColor: '#FFFFFF' },
  postponedFloatingCart: { position: 'absolute', right: 14, bottom: 10, width: 48, height: 48, borderRadius: 24, backgroundColor: '#FF9500', alignItems: 'center', justifyContent: 'center' },
  postponedName: { fontSize: 16, lineHeight: 21, fontWeight: '400', color: '#2C2C2C', marginBottom: 8 },
  postponedMeta: { fontSize: 12.5, lineHeight: 16, color: '#6B7280', marginBottom: 6 },
  reviewSummary: { fontSize: 12.5, color: '#EAB308', marginBottom: 8 },
  postponedPrice: { fontSize: 19, lineHeight: 24, fontWeight: '900', color: '#111827', marginBottom: 12 },
  postponedRemoveText: { fontSize: 14, lineHeight: 19, fontWeight: '900', color: '#2C2C2C', textDecorationLine: 'underline' },
  savedPreviewCard: { padding: 22 },
  savedHintTitle: { fontSize: 18, fontWeight: '900', color: '#111827', marginBottom: 5 },
  savedHintText: { fontSize: 14, lineHeight: 20, color: '#6B7280', marginBottom: 8 },
  promoSection: { backgroundColor: '#F7F7F7', paddingHorizontal: 24, paddingTop: 8, paddingBottom: 14, marginTop: 0, marginBottom: 0, borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  promoLabel: { fontSize: 20, lineHeight: 24, fontWeight: '900', color: '#2C2C2C', marginBottom: 10 },
  promoContainer: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  promoInput: { flex: 1, height: 58, backgroundColor: '#FFFFFF', borderWidth: 1.1, borderColor: '#D1D5DB', paddingHorizontal: 14, borderRadius: 9, fontSize: 16, color: '#111827' },
  promoButton: { height: 58, minWidth: 132, backgroundColor: '#2E7D32', paddingHorizontal: 14, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  promoButtonText: { color: '#FFFFFF', fontWeight: '900', fontSize: 17 },
  promoHint: { marginTop: 6, fontSize: 13, color: '#6B7280' },
  discountBox: { marginTop: 9, flexDirection: 'row', alignItems: 'center', gap: 6 },
  discountText: { flex: 1, color: '#2E7D32', fontSize: 13.5, fontWeight: '800' },
  recommendSection: { backgroundColor: '#F7F7F7', paddingHorizontal: 22, paddingTop: 18, paddingBottom: 24 },
  recommendHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 18 },
  recommendLine: { flex: 1, height: 1, backgroundColor: '#D1D5DB' },
  recommendTitle: { paddingHorizontal: 12, fontSize: 15, lineHeight: 19, fontWeight: '900', color: '#222222' },
  stickyCheckout: { position: 'absolute', left: 0, right: 0, minHeight: 88, backgroundColor: '#FFFFFF', borderTopWidth: 1, borderTopColor: '#E5E7EB', paddingHorizontal: 18, paddingTop: 14, flexDirection: 'row', alignItems: 'center', gap: 16, zIndex: 850, elevation: 850 },
  totalToggle: { minWidth: 105, height: 58, flexDirection: 'row', alignItems: 'center', gap: 5 },
  stickyTotal: { fontSize: 22, fontWeight: '900', color: '#111827' },
  checkoutButton: { flex: 1, height: 58, borderRadius: 10, backgroundColor: '#2E7D32', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  checkoutButtonText: { color: '#FFFFFF', fontSize: 18, fontWeight: '900', textAlign: 'center' },
  addPostponedButton: { flex: 1, height: 58, borderRadius: 10, backgroundColor: '#2E7D32', alignItems: 'center', justifyContent: 'center' },
  addPostponedButtonText: { color: '#FFFFFF', fontSize: 19, fontWeight: '900', textAlign: 'center' },
  quantityModalRoot: { flex: 1, justifyContent: 'flex-end' },
  quantityBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0, 0, 0, 0.58)' },
  quantitySheet: { maxHeight: '56%', backgroundColor: '#FFFFFF', borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingTop: 24, paddingHorizontal: 30 },
  quantitySheetHeader: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },
  quantitySheetTitle: { flex: 1, paddingRight: 12, fontSize: 24, lineHeight: 30, fontWeight: '900', color: '#2A2A2A' },
  quantityCloseButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  quantitySheetScroll: { maxHeight: 380 },
  quantitySheetOption: { minHeight: 58, justifyContent: 'center', paddingHorizontal: 24, borderRadius: 9, marginBottom: 6 },
  quantitySheetOptionActive: { backgroundColor: '#E2F4E2' },
  quantitySheetOptionText: { fontSize: 22, fontWeight: '500', color: '#2B2B2B' },
});
