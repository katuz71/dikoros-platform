import { FloatingChatButton } from '@/components/FloatingChatButton';
import { ProductDetailsView } from '@/components/ProductDetailsView';
import { API_URL } from '@/config/api';
import { useCart } from '@/context/CartContext';
import { useOrders } from '@/context/OrdersContext';
import { trackEvent } from '@/utils/analytics';
import { logFirebaseEvent } from '@/utils/firebaseAnalytics';
import { getImageUrl } from '@/utils/image';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Animated,
    KeyboardAvoidingView,
    Modal,
    Platform,
    SafeAreaView,
    ScrollView,
    Share,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    Vibration,
    View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFavoritesStore } from '../../store/favoritesStore';

export default function ProductScreen() {
  const { id } = useLocalSearchParams();
  const productId = Number(Array.isArray(id) ? id[0] : id);
  console.warn("PDP id raw=", id);
  console.warn("PDP productId=", productId);
  
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { addItem, items: cartItems } = useCart();
  const { favorites, toggleFavorite } = useFavoritesStore();
  const { products: allProducts } = useOrders(); // Get all products for similar suggestions

  const [product, setProduct] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Similar products logic
  const similarProducts = useMemo(() => {
    if (!product || !allProducts.length) return [];
    return allProducts
      .filter(p => p.category === product.category && p.id !== product.id)
      .slice(0, 10); // Limit to 10 products
  }, [product, allProducts]);
  
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>({});
  const [reviews, setReviews] = useState<any[]>([]);
  const [reviewModalVisible, setReviewModalVisible] = useState(false);
  const [newReview, setNewReview] = useState({ rating: 5, user_name: '', comment: '', user_phone: '' });
  
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const cartCount = cartItems.reduce((total: number, item: any) => total + (item.quantity || 1), 0);

  // --- Helpers ---
  const clean = (v: unknown) => String(v ?? "").trim().replace(/^"+|"+$/g, "").replace(/\s+/g, " ");
  
  const formatPrice = (price: number) => {
    return `${(price || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ")} ₴`;
  };

  const showToast = (message: string) => {
    setToastMessage(message);
    setToastVisible(true);
    Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start();
    setTimeout(() => {
      Animated.timing(fadeAnim, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => setToastVisible(false));
    }, 2000);
  };

  // --- Normalization ---
  const { optionKeys, internalKeys, variantRows, matrix } = useMemo(() => {
    if (!product) return { optionKeys: [], internalKeys: [], variantRows: [], matrix: {} };
    
    // 1. Parse variants
    let rawVariants: any[] = [];
    try {
      if (typeof product.variants === 'string') {
        const parsed = JSON.parse(product.variants);
        rawVariants = Array.isArray(parsed) ? parsed : [];
      } else if (Array.isArray(product.variants)) {
        rawVariants = product.variants;
      }
    } catch (e) { console.warn("Parse variants error", e); }

    // 2. Get option headers or infer them from variant names
    let oKeys = clean(product.option_names).split('|').map(clean).filter(Boolean);
    const hasExplicitOptions = oKeys.length > 0;

    const variantLabels = rawVariants
      .map(v => clean(v?.name || v?.variant || v?.title || v?.size || v?.pack_size || v?.packSize))
      .filter(Boolean);

    const labelHas = (label: string, words: string[]) => {
      const lower = clean(label).toLowerCase();
      return words.some(word => lower.includes(word.toLowerCase()));
    };

    const extractSize = (label: string) => {
      const normalized = clean(label).toLowerCase();

      const matches = Array.from(normalized.matchAll(/\d+(?:[,.]\d+)?/g));

      const gramWords = ['\u0433\u0440\u0430\u043c', '\u0433\u0440', '\u0433'];
      const capsuleWords = ['\u043a\u0430\u043f\u0441\u0443\u043b'];
      const mlWords = ['\u043c\u043b'];
      const literWords = ['\u043b'];
      const mgWords = ['\u043c\u0433'];
      const pcsWords = ['\u0448\u0442'];

      const pickUnit = (tail: string) => {
        const cleanTail = tail.trim().replace(/^\s+/, '');

        // ????? ?????? ????????? ????? ????? ?????, ????? "2 ???? - 1 ????"
        // ?? ???????????? ? "2 ????".
        const firstWord = cleanTail
          .replace(/^[\s.,;:()\-]+/, '')
          .split(/[\s.,;:()\-]+/)[0]
          ?.replace('.', '')
          ?.trim();

        if (!firstWord) return '';

        if (firstWord.includes('\u0441\u043e\u0440\u0442')) return '';

        if (capsuleWords.some(w => firstWord.includes(w))) return '\u043a\u0430\u043f\u0441\u0443\u043b';
        if (gramWords.some(w => firstWord === w || firstWord.startsWith(w))) return '\u0433\u0440\u0430\u043c';
        if (mgWords.some(w => firstWord === w || firstWord.startsWith(w))) return '\u043c\u0433';
        if (mlWords.some(w => firstWord === w || firstWord.startsWith(w))) return '\u043c\u043b';
        if (literWords.some(w => firstWord === w)) return '\u043b';
        if (pcsWords.some(w => firstWord === w || firstWord.startsWith(w))) return '\u0448\u0442';

        return '';
      };

      for (const match of matches) {
        const value = String(match[0] || '').trim();
        const index = typeof match.index === 'number' ? match.index : -1;
        if (index < 0 || !value) continue;

        const tail = normalized.slice(index + value.length, index + value.length + 24);
        const unit = pickUnit(tail);

        if (unit) {
          return `${value} ${unit}`;
        }
      }

      return '';
    };

    const extractForm = (label: string) => {
      if (labelHas(label, ['\u043f\u043e\u0440\u043e\u0448', 'porosh', 'powder'])) return '\u041f\u043e\u0440\u043e\u0448\u043e\u043a';
      if (labelHas(label, ['\u043c\u0435\u043b\u0435\u043d', 'melen', 'ground'])) return '\u041c\u0435\u043b\u0435\u043d\u0438\u0439';
      return '\u0426\u0456\u043b\u0438\u0439';
    };

    const extractSort = (label: string) => {
      const lower = clean(label).toLowerCase();
      const sortWord = '\u0441\u043e\u0440\u0442';

      if (labelHas(lower, ['\u043b\u043e\u043c'])) return '\u041b\u043e\u043c';
      if (labelHas(lower, ['\u0435\u043b\u0456\u0442', '\u044d\u043b\u0438\u0442', 'elit', 'elite'])) return '\u0415\u043b\u0456\u0442';

      if (lower.includes(`2 ${sortWord}`) || lower.includes(`2${sortWord}`)) return `2 ${sortWord}`;
      if (lower.includes(`1 ${sortWord}`) || lower.includes(`1${sortWord}`)) return `1 ${sortWord}`;

      return '\u0421\u0442\u0430\u043d\u0434\u0430\u0440\u0442';
    };

    const hasForm = variantLabels.some(label =>
      labelHas(label, ['\u043f\u043e\u0440\u043e\u0448', '\u043c\u0435\u043b\u0435\u043d', 'powder', 'ground'])
    );

    const hasSort = variantLabels.some(label =>
      labelHas(label, ['\u0441\u043e\u0440\u0442', '\u0435\u043b\u0456\u0442', '\u043b\u043e\u043c', 'elite'])
    );

    const hasSize = variantLabels.some(label => !!extractSize(label));

    if (!oKeys.length && rawVariants.length > 1) {
      oKeys = [];

      if (hasForm) oKeys.push('\u0424\u043e\u0440\u043c\u0430');
      if (hasSort) oKeys.push('\u0421\u043e\u0440\u0442');
      if (hasSize) oKeys.push('\u0424\u0430\u0441\u0443\u0432\u0430\u043d\u043d\u044f');

      if (!oKeys.length) {
        oKeys = ['\u0412\u0430\u0440\u0456\u0430\u043d\u0442'];
      }
    }

    const iKeys = oKeys.map((_, i) => `opt_${i}`);

    const inferVariantParts = (label: string) => {
      if (hasExplicitOptions) return label.split('|').map(clean);

      if (oKeys.length === 1 && oKeys[0] === '\u0412\u0430\u0440\u0456\u0430\u043d\u0442') {
        return [label];
      }

      const parts: string[] = [];

      oKeys.forEach((key) => {
        if (key === '\u0424\u043e\u0440\u043c\u0430') parts.push(extractForm(label));
        else if (key === '\u0421\u043e\u0440\u0442') parts.push(extractSort(label));
        else if (key === '\u0424\u0430\u0441\u0443\u0432\u0430\u043d\u043d\u044f') parts.push(extractSize(label) || label);
        else parts.push(label);
      });

      return parts;
    };

    // 3. Build rows
    const rows: any[] = [];
    rawVariants.forEach((v) => {
      const label = clean(v?.name || v?.variant || v?.title || v?.size || v?.pack_size || v?.packSize);
      if (!label) return;

      const parts = inferVariantParts(label);
      while (parts.length < oKeys.length) parts.push("");

      const options: Record<string, string> = {};
      iKeys.forEach((ik, idx) => { options[ik] = parts[idx] || ""; });

      rows.push({
        raw: v,
        options,
        price: Number(v?.price ?? 0) || product.price || 0,
        old_price: Number(v?.old_price ?? 0) || undefined
      });
    });

    // 4. Matrix for selection UI
    const m: Record<string, string[]> = {};
    iKeys.forEach((ik) => {
      const values = new Set<string>();
      rows.forEach(r => { if (r.options[ik]) values.add(r.options[ik]); });
      m[ik] = Array.from(values);
    });

    return { optionKeys: oKeys, internalKeys: iKeys, variantRows: rows, matrix: m };
  }, [product]);

  // Current match
  const { activeRow, currentPrice, oldPrice } = useMemo(() => {
    const exact = variantRows.find(row =>
      internalKeys.every(ik => clean(row.options[ik]) === clean(selectedOptions[ik]))
    );

    const best = exact || [...variantRows]
      .map(row => {
        const score = internalKeys.reduce((sum, ik) => {
          return sum + (clean(row.options[ik]) === clean(selectedOptions[ik]) ? 1 : 0);
        }, 0);

        return { row, score };
      })
      .sort((a, b) => b.score - a.score)[0]?.row;

    const found = best || variantRows[0];

    return {
      activeRow: found,
      currentPrice: found ? found.price : (product?.price || 0),
      oldPrice: found ? found.old_price : (product?.old_price || 0)
    };
  }, [variantRows, selectedOptions, product, internalKeys]);

  // Normalize option selection to always match existing variant
  // Normalize option selection to always match existing variant
  // Change only the selected option. Impossible combinations are disabled in ProductDetailsView.
  const applyOptionChange = useCallback((key: string, value: string) => {
    setSelectedOptions(prev => ({ ...prev, [key]: value }));
  }, []);

  // Data Loading
  useEffect(() => {
    const fetchData = async () => {
      if (isNaN(productId)) {
        setError("Invalid Product ID");
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      setSelectedOptions({});
      
      let url = `${API_URL}/products/${productId}`;
      try {
        let res = await fetch(url);
        console.warn(`PDP fetch url=${url} status=${res.status}`);
        
        // If 405 or 404, try alternative (some servers prefer query params or have prefix issues)
        if (res.status === 405 || res.status === 404) {
          const altUrl = `${API_URL}/products?id=${productId}`;
          console.warn(`PDP trying altUrl=${altUrl}`);
          const altRes = await fetch(altUrl);
          if (altRes.ok) {
             const allProducts = await altRes.json();
             const found = Array.isArray(allProducts) ? allProducts.find((p: any) => p.id === productId) : null;
             if (found) {
                setProduct(found);

                try {
                  const rawRecent = await AsyncStorage.getItem('recentProducts');
                  const parsedRecent = rawRecent ? JSON.parse(rawRecent) : [];
                  const recentArray = Array.isArray(parsedRecent) ? parsedRecent : [];
                  const nextRecent = [
                    found,
                    ...recentArray.filter((item: any) => item?.id !== found?.id)
                  ].slice(0, 12);
                  await AsyncStorage.setItem('recentProducts', JSON.stringify(nextRecent));
                } catch (e) {
                  console.warn('Save recent product error:', e);
                }

                setLoading(false);
                return;
             }
          }
        }

        if (res.ok) {
          const data = await res.json();

          const fromList = allProducts.find((p: any) => Number(p?.id) === Number(productId));
          const dataVariants = Array.isArray(data?.variants) ? data.variants : [];
          const listVariants = Array.isArray(fromList?.variants) ? fromList.variants : [];

          const enrichedProduct = fromList && listVariants.length > dataVariants.length
            ? {
                ...data,
                ...fromList,
                description: data.description || fromList.description,
                composition: data.composition || fromList.composition,
                usage: data.usage || fromList.usage,
                variants: listVariants,
                option_names: data.option_names || fromList.option_names,
              }
            : data;

          setProduct(enrichedProduct);

          try {
            const rawRecent = await AsyncStorage.getItem('recentProducts');
            const parsedRecent = rawRecent ? JSON.parse(rawRecent) : [];
            const recentArray = Array.isArray(parsedRecent) ? parsedRecent : [];
            const nextRecent = [
              enrichedProduct,
              ...recentArray.filter((item: any) => item?.id !== enrichedProduct?.id)
            ].slice(0, 12);
            await AsyncStorage.setItem('recentProducts', JSON.stringify(nextRecent));
          } catch (e) {
            console.warn('Save recent product error:', e);
          }
          
          // Initial selection logic (default to first available options)
          if (data.option_names) {
             // selection will be handled by next useEffect when internalKeys/matrix are updated
          }

          // Fetch reviews in parallel
          fetch(`${API_URL}/api/reviews/${productId}`)
            .then(r => r.ok ? r.json() : [])
            .then(setReviews)
            .catch(() => {});

        } else {
          setError(`Error loading product: ${res.status}`);
        }
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [productId, allProducts]);

  const openReviewModal = useCallback(async () => {
    try {
      const storedName = await AsyncStorage.getItem('userName');
      const storedPhone = await AsyncStorage.getItem('userPhone');
      const cleanPhone = (storedPhone || '').replace(/\D/g, '');

      setNewReview(prev => ({
        ...prev,
        user_name: prev.user_name || (storedName || ''),
        user_phone: cleanPhone || prev.user_phone || ''
      }));
    } catch (e) {
      // ignore
    } finally {
      setReviewModalVisible(true);
    }
  }, []);

  // Set default selection when product/matrix loads
  useEffect(() => {
    if (variantRows.length && !Object.keys(selectedOptions).length) {
      setSelectedOptions({ ...variantRows[0].options });
    }
  }, [variantRows]);

  const onShare = async () => {
    try {
      if (!product) return;
      await Share.share({
        message: `Дізнайтеся більше про ${product.name}: ${getImageUrl(product.image)}`,
        title: product.name
      });
    } catch (e) {}
  };

  const submitReview = async () => {
    if (!newReview.user_name || !newReview.comment) {
      Vibration.vibrate(50);
      showToast('Заповніть імʼя та відгук');
      return;
    }

    try {
      const payload = {
        product_id: productId,
        rating: newReview.rating || 5,
        user_name: newReview.user_name,
        user_phone: (newReview.user_phone || '').replace(/\D/g, ''),
        comment: newReview.comment,
      };

      const res = await fetch(`${API_URL}/api/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const submitData = await res.json().catch(() => null);

      if (!res.ok) {
        console.warn('Submit review error:', res.status, submitData);
        showToast(submitData?.detail || submitData?.message || 'Не вдалося додати відгук');
        return;
      }

      const returnedReview = submitData?.review || submitData;

      const reviewToShow = {
        id: returnedReview?.id || `local-${Date.now()}`,
        product_id: Number(returnedReview?.product_id || productId),
        rating: Number(returnedReview?.rating || payload.rating || 5),
        user_name: returnedReview?.user_name || payload.user_name,
        user_phone: returnedReview?.user_phone || payload.user_phone,
        comment: returnedReview?.comment || payload.comment,
      };

      const mergeReviews = (serverReviews: any[] = []) => {
        const map = new Map<string, any>();

        [reviewToShow, ...serverReviews].forEach((review: any) => {
          const key = String(review?.id || `${review?.user_name}-${review?.comment}`);
          if (!map.has(key)) map.set(key, review);
        });

        return Array.from(map.values());
      };

      setReviews(prev => mergeReviews(Array.isArray(prev) ? prev : []));
      setReviewModalVisible(false);
      setNewReview({ rating: 5, user_name: '', comment: '', user_phone: newReview.user_phone || '' });
      showToast('Дякуємо за відгук!');

      const refreshRes = await fetch(`${API_URL}/api/reviews/${productId}`);
      if (refreshRes.ok) {
        const refreshData = await refreshRes.json();
        const serverReviews = Array.isArray(refreshData) ? refreshData : (refreshData.reviews || []);
        setReviews(mergeReviews(serverReviews));
      }
    } catch (e) {
      console.warn('Submit review exception:', e);
      showToast('Помилка відправки відгуку');
    }
  };

  if (loading) return (
    <SafeAreaView style={styles.center}>
      <ActivityIndicator size="large" color="#000" />
      <Text style={{ marginTop: 10 }}>Завантаження товару...</Text>
    </SafeAreaView>
  );

  if (error || !product) return (
    <SafeAreaView style={styles.center}>
      <Text style={styles.errorText}>{error || "Товар не знайдено"} (ID: {productId})</Text>
      <TouchableOpacity onPress={() => router.back()} style={styles.mainBtn}>
        <Text style={styles.whiteText}>Назад</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );

  const isFavorite = favorites.some(f => f.id === product.id);

  return (
    <SafeAreaView style={styles.container}>
       {/* Floating Header */}
       <View style={[styles.header, { paddingTop: insets.top + 5 }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
            <Ionicons name="chevron-back" size={24} color="#000" />
          </TouchableOpacity>
          <View style={styles.headerRight}>
            <TouchableOpacity onPress={() => router.push('/(tabs)/cart')} style={styles.iconBtn}>
              <Ionicons name="cart-outline" size={22} color="#000" />
              {cartCount > 0 ? <View style={styles.badge}><Text style={styles.badgeText}>{cartCount}</Text></View> : null}
            </TouchableOpacity>
            <TouchableOpacity onPress={onShare} style={styles.iconBtn}>
                <Ionicons name="share-outline" size={20} color="#000" />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { toggleFavorite(product); showToast(isFavorite ? 'Видалено' : 'Додано'); }} style={styles.iconBtn}>
              <Ionicons name={isFavorite ? "heart" : "heart-outline"} size={22} color={isFavorite ? "#ef4444" : "#000"} />
            </TouchableOpacity>
          </View>
       </View>

       <ProductDetailsView 
          product={product}
          variantRows={variantRows}
          optionKeys={optionKeys}
          internalKeys={internalKeys}
          matrix={matrix}
          selectedOptions={selectedOptions}
          applyOptionChange={applyOptionChange}
          currentPrice={currentPrice}
          oldPrice={oldPrice}
          activeRow={activeRow}
          formatPrice={formatPrice}
          clean={clean}
          onAddToCart={() => {
            Vibration.vibrate(10);

            const selectedVariantProduct = activeRow?.raw
              ? {
                  ...product,
                  id: activeRow.raw.id || product.id,
                  sku: activeRow.raw.sku || product.sku,
                  name: activeRow.raw.name || product.name,
                  price: currentPrice,
                  old_price: activeRow.raw.old_price || product.old_price,
                  status: activeRow.raw.status || product.status,
                  stock: activeRow.raw.stock ?? product.stock,
                }
              : product;

            const selections = internalKeys.map(k => selectedOptions[k]).filter(Boolean).join(' | ');
            addItem(selectedVariantProduct, 1, selections || (product.unit || '??'), product.unit || '??', currentPrice);
            showToast('\u0414\u043e\u0434\u0430\u043d\u043e \u0432 \u043a\u043e\u0448\u0438\u043a');
            trackEvent('AddToCart', { content_ids: [selectedVariantProduct.id], value: currentPrice, currency: 'UAH' });
            logFirebaseEvent('add_to_cart', { item_id: selectedVariantProduct.id, item_name: selectedVariantProduct.name, value: currentPrice });
          }}
          onToggleFavorite={() => toggleFavorite(product)}
          isFavorite={isFavorite}
          onShare={onShare}
          reviews={reviews}
          totalReviews={reviews.length}
          averageRating={reviews.length > 0 ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) : 0}
          onWriteReview={openReviewModal}
          
          similarProducts={similarProducts}
          onSimilarProductPress={(id: number) => router.push(`/product/${id}`)}
          onSimilarProductAddToCart={(p: any) => {
             // Simple add to cart for similar list (default variant)
             Vibration.vibrate(10);
             let variantLabel = '';
             let variantPrice = Number(p?.price ?? 0) || 0;
             try {
              const raw = typeof p?.variants === 'string' ? JSON.parse(p.variants) : p?.variants;
              const arr = Array.isArray(raw) ? raw : [];
              const first = arr[0];
              variantLabel = clean(first?.name || first?.variant || first?.title || first?.size || first?.pack_size || first?.packSize);
              variantPrice = Number(first?.price ?? 0) || variantPrice;
             } catch {}

             const pack = variantLabel || p.pack_sizes?.[0] || (p.unit || 'шт');
             addItem(p, 1, pack, p.unit || 'шт', variantPrice);
             showToast('Додано в кошик');
             trackEvent('AddToCart', { content_ids: [p.id], value: p.price, currency: 'UAH' });
             logFirebaseEvent('add_to_cart', { item_id: p.id, item_name: p.name, value: p.price });
          }}
          onSimilarProductToggleFavorite={(p: any) => {
             toggleFavorite(p);
             // We don't show toast here to avoid clutter or maybe we should?
             // showToast(favorites.some(f => f.id === p.id) ? 'Видалено' : 'Додано'); // State not updated yet
          }}
          favorites={favorites}
       />

       <Modal visible={reviewModalVisible} animationType="slide" transparent>
          <View style={styles.modalBackdrop}>
           <KeyboardAvoidingView
            style={{ flex: 1, justifyContent: 'flex-end' }}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
           >
            <View style={[styles.modalContent, { paddingBottom: Math.max(16, insets.bottom + 16) }]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Написати відгук</Text>
                <TouchableOpacity onPress={() => setReviewModalVisible(false)}>
                  <Ionicons name="close" size={24} color="#000" />
                </TouchableOpacity>
              </View>

              <ScrollView
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: Math.max(120, insets.bottom + 120) }}
              >
                <TextInput
                 placeholder="Ваше ім'я"
                 style={styles.input}
                 value={newReview.user_name}
                 onChangeText={t => setNewReview({ ...newReview, user_name: t })}
                />
                                <View style={styles.ratingPicker}>
                  <Text style={styles.ratingPickerTitle}>Оцінка</Text>
                  <View style={styles.ratingStarsRow}>
                    {[1, 2, 3, 4, 5].map((star) => (
                      <TouchableOpacity
                        key={star}
                        onPress={() => setNewReview({ ...newReview, rating: star })}
                        style={styles.ratingStarBtn}
                      >
                        <Ionicons
                          name={star <= newReview.rating ? "star" : "star-outline"}
                          size={34}
                          color="#FACC15"
                        />
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

<TextInput
                 placeholder="Ваш відгук"
                 multiline
                 numberOfLines={4}
                 style={[styles.input, { height: 100 }]}
                 value={newReview.comment}
                 onChangeText={t => setNewReview({ ...newReview, comment: t })}
                />
              </ScrollView>

              <TouchableOpacity onPress={submitReview} style={[styles.submitBtn, { marginTop: 8 }]}>
                <Text style={styles.whiteText}>Відправити</Text>
              </TouchableOpacity>
            </View>
           </KeyboardAvoidingView>
          </View>
       </Modal>

       {toastVisible && (
         <Animated.View style={[styles.toast, { opacity: fadeAnim }]}>
           <Text style={styles.whiteText}>{toastMessage}</Text>
         </Animated.View>
       )}
       
       <FloatingChatButton bottomOffset={90} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100, paddingHorizontal: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.85)' },
  headerRight: { flexDirection: 'row', gap: 10 },
  iconBtn: { width: 40, height: 40, backgroundColor: '#fff', borderRadius: 20, justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3 },
  badge: { position: 'absolute', top: -4, right: -4, backgroundColor: '#DC2626', borderRadius: 9, minWidth: 18, height: 18, justifyContent: 'center', alignItems: 'center' },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: 'bold' },
  mainBtn: { backgroundColor: '#2E7D32', padding: 15, borderRadius: 12, marginTop: 20 },
  whiteText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  errorText: { fontSize: 16, color: '#666', textAlign: 'center', paddingHorizontal: 20 },
  toast: { position: 'absolute', bottom: 100, alignSelf: 'center', backgroundColor: 'rgba(30,30,30,0.9)', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 25, zIndex: 1000 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#fff', padding: 25, borderTopLeftRadius: 25, borderTopRightRadius: 25 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 20, fontWeight: 'bold' },
  ratingPicker: { marginBottom: 15 },
  ratingPickerTitle: { fontSize: 15, fontWeight: '700', color: '#111827', marginBottom: 8 },
  ratingStarsRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ratingStarBtn: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  input: { backgroundColor: '#f9fafb', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, padding: 12, marginBottom: 15, fontSize: 15 },
  submitBtn: { backgroundColor: '#2E7D32', height: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }
});
