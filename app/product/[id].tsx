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

const clean = (v: unknown) => String(v ?? "").trim().replace(/^"+|"+$/g, "").replace(/\s+/g, " ");
const variantIdentity = (variant: any) => clean(variant?.id ?? variant?.sku ?? variant?.article);
const isVariantAvailable = (row: any) => {
  const status = clean(row?.raw?.status ?? row?.status).toLowerCase();
  return !['out_of_stock', 'not_available', 'unavailable', 'disabled', 'відсутній', 'немає в наявності', 'нет в наличии']
    .some(value => status.includes(value));
};


export default function ProductScreen() {
  const { id } = useLocalSearchParams();
  const productId = Number(Array.isArray(id) ? id[0] : id);
  
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
  const [selectedVariantRowId, setSelectedVariantRowId] = useState<string | null>(null);
  const [reviews, setReviews] = useState<any[]>([]);
  const [reviewModalVisible, setReviewModalVisible] = useState(false);
  const [newReview, setNewReview] = useState({ rating: 5, user_name: '', comment: '', user_phone: '' });
  
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const cartCount = cartItems.reduce((total: number, item: any) => total + (item.quantity || 1), 0);

  // --- Helpers ---
  
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

    // 2. Get option headers from backend structured options first.
    // Hide technical disambiguation keys from UI: users should choose real
    // product parameters, not SKU codes.
    const isHiddenOptionName = (key: string) => {
      const normalized = clean(key).toLowerCase();
      return normalized === '\u0430\u0440\u0442\u0438\u043a\u0443\u043b' || normalized === 'article' || normalized === 'sku';
    };

    let oKeys = clean(product.option_names)
      .split('|')
      .map(clean)
      .filter(Boolean)
      .filter(key => !isHiddenOptionName(key));

    const hasOnlyGenericVariantOption = oKeys.length === 1 && clean(oKeys[0]).toLowerCase() === '\u0432\u0430\u0440\u0456\u0430\u043d\u0442';
    if (hasOnlyGenericVariantOption) oKeys = [];

    const getRawStructuredOptions = (variant: any): Record<string, string> => {
      const raw = variant?.options;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};

      const out: Record<string, string> = {};
      Object.entries(raw).forEach(([key, value]) => {
        const k = clean(key);
        const v = clean(value);
        if (!k || !v) return;
        out[k] = v;
      });

      return out;
    };

    const getStructuredOptions = (variant: any): Record<string, string> | null => {
      const raw = getRawStructuredOptions(variant);
      const out: Record<string, string> = {};

      Object.entries(raw).forEach(([key, value]) => {
        if (isHiddenOptionName(key)) return;
        out[key] = value;
      });

      return Object.keys(out).length ? out : null;
    };

    const structuredOptionKeys: string[] = [];
    rawVariants.forEach((variant) => {
      const structured = getStructuredOptions(variant);
      if (!structured) return;

      Object.keys(structured).forEach((key) => {
        if (!structuredOptionKeys.includes(key)) structuredOptionKeys.push(key);
      });
    });

    if (!oKeys.length && structuredOptionKeys.length > 0) {
      oKeys = structuredOptionKeys;
    }

    const hasExplicitOptions = oKeys.length > 0 && !hasOnlyGenericVariantOption;

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

        // Keep full variant names, for example "2 jars - 1 month".
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
      const structuredOptions = getStructuredOptions(v);
      if (!label && !structuredOptions) return;

      const parts = structuredOptions
        ? oKeys.map((key) => clean(structuredOptions[key]))
        : inferVariantParts(label);

      while (parts.length < oKeys.length) parts.push("");

      const options: Record<string, string> = {};
      iKeys.forEach((ik, idx) => { options[ik] = parts[idx] || ""; });

      rows.push({
        raw: v,
        rowId: variantIdentity(v),
        sku: clean(v?.sku),
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

  // Resolve only a real row matching every selected option.
  const { activeRow, currentPrice, oldPrice } = useMemo(() => {
    const hasCompleteSelection = internalKeys.every(ik => !!clean(selectedOptions[ik]));
    const matches = hasCompleteSelection
      ? variantRows.filter(row =>
          internalKeys.every(ik => clean(row.options[ik]) === clean(selectedOptions[ik]))
        )
      : [];

    const selectedStillMatches = selectedVariantRowId
      ? matches.find(row => clean(row.rowId) === clean(selectedVariantRowId))
      : null;

    const found = selectedStillMatches
      || matches.find(isVariantAvailable)
      || matches[0]
      || null;

    return {
      activeRow: found,
      currentPrice: found ? found.price : (product?.price || 0),
      oldPrice: found ? found.old_price : (product?.old_price || 0)
    };
  }, [variantRows, selectedOptions, product, internalKeys, selectedVariantRowId]);

  const findExactVariantRow = useCallback((selection: Record<string, string>) => {
    if (!internalKeys.every(optionKey => !!clean(selection[optionKey]))) return null;

    const matches = variantRows.filter(row =>
      internalKeys.every(optionKey =>
        clean(row.options[optionKey]) === clean(selection[optionKey])
      )
    );

    const selectedStillMatches = selectedVariantRowId
      ? matches.find(row => clean(row.rowId) === clean(selectedVariantRowId))
      : null;

    return selectedStillMatches
      || matches.find(isVariantAvailable)
      || matches[0]
      || null;
  }, [internalKeys, selectedVariantRowId, variantRows]);

  // Change only the requested option when the full combination exists.
  const applyOptionChange = useCallback((key: string, value: string) => {
    const nextSelection = { ...selectedOptions, [key]: value };
    const exactRow = findExactVariantRow(nextSelection);
    if (!exactRow) return;

    setSelectedOptions(nextSelection);
    setSelectedVariantRowId(clean(exactRow.rowId) || null);
  }, [findExactVariantRow, selectedOptions]);

  const isOptionAvailable = useCallback((key: string, value: string) => {
    const nextSelection = { ...selectedOptions, [key]: value };
    return !!findExactVariantRow(nextSelection);
  }, [findExactVariantRow, selectedOptions]);

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
      setSelectedVariantRowId(null);
      
      let url = `${API_URL}/products/${productId}`;
      try {
        let res = await fetch(url);
        
        // If 405 or 404, try alternative (some servers prefer query params or have prefix issues)
        if (res.status === 405 || res.status === 404) {
          const altUrl = `${API_URL}/products?id=${productId}`;
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
                product_note: data.product_note || data.productNote || fromList.product_note || fromList.productNote,
                productNote: data.productNote || data.product_note || fromList.productNote || fromList.product_note,
                composition: data.composition || fromList.composition,
                usage: data.usage || fromList.usage,
                delivery_info: data.delivery_info || fromList.delivery_info,
                return_info: data.return_info || fromList.return_info,
                old_price: data.old_price ?? fromList.old_price,
                discount: data.discount ?? fromList.discount,
                variants: listVariants,
                option_names: data.option_names || fromList.option_names,
              }
            : data;

          setProduct(enrichedProduct);

          trackEvent('ViewContent', {
            content_ids: [enrichedProduct.id],
            content_type: 'product',
            content_name: enrichedProduct.name,
            value: Number(enrichedProduct.price || 0),
            currency: 'UAH',
            items: [{
              item_id: enrichedProduct.id,
              item_name: enrichedProduct.name,
              price: Number(enrichedProduct.price || 0),
              quantity: 1
            }]
          });

          logFirebaseEvent('view_item', {
            currency: 'UAH',
            value: Number(enrichedProduct.price || 0),
            items: [{
              item_id: String(enrichedProduct.id),
              item_name: enrichedProduct.name,
              price: Number(enrichedProduct.price || 0),
              quantity: 1
            }]
          });

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
    } catch {
      // ignore
    } finally {
      setReviewModalVisible(true);
    }
  }, []);

  // Set default selection when product/matrix loads
  useEffect(() => {
    if (!variantRows.length) {
      setSelectedVariantRowId(null);
      return;
    }

    setSelectedOptions(prev => {
      const exactRow = variantRows.find(row =>
        internalKeys.every(key => {
          const current = clean(prev[key]);
          return !!current && clean(row.options[key]) === current;
        })
      );
      const firstRow = exactRow || variantRows.find(isVariantAvailable) || variantRows[0];
      const next: Record<string, string> = {};
      let changed = false;

      internalKeys.forEach((key) => {
        const value = clean(firstRow.options[key]);

        if (value) next[key] = value;
        if (clean(prev[key]) !== clean(next[key])) changed = true;
      });

      Object.keys(prev).forEach((key) => {
        if (!internalKeys.includes(key)) changed = true;
      });

      return changed ? next : prev;
    });
  }, [variantRows, internalKeys, matrix]);

  useEffect(() => {
    const rowId = clean(activeRow?.rowId);

    if (rowId && rowId !== selectedVariantRowId) {
      setSelectedVariantRowId(rowId);
    } else if (!rowId && selectedVariantRowId) {
      setSelectedVariantRowId(null);
    }
  }, [activeRow, selectedVariantRowId]);

  const onShare = async (item = product) => {
    try {
      if (!item) return;
      await Share.share({
        message: `Дізнайтеся більше про ${item.name}: ${getImageUrl(item.image)}`,
        title: item.name
      });
    } catch {}
  };

  const submitReview = async () => {
    if (!newReview.user_name || !newReview.comment) {
      Vibration.vibrate(50);
      showToast('Заповніть імʼя та відгук');
      return;
    }

    try {
      const accessToken = await AsyncStorage.getItem('accessToken');
      if (!accessToken) {
        showToast('Увійдіть у профіль, щоб залишити відгук');
        return;
      }

      const storedPhone = await AsyncStorage.getItem('userPhone');

      const payload = {
        product_id: productId,
        rating: newReview.rating || 5,
        user_name: newReview.user_name,
        user_phone: storedPhone || '',
        comment: newReview.comment,
      };

      const res = await fetch(`${API_URL}/api/reviews`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
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

  const activeVariantRaw = activeRow?.raw || null;
  const displayProduct = activeVariantRaw
    ? {
        ...product,
        id: activeVariantRaw.id || product.id,
        sku: activeVariantRaw.sku || product.sku,
        name: activeVariantRaw.name || activeVariantRaw.variant_name || activeVariantRaw.title || product.name,
        variant_name: activeVariantRaw.variant_name || activeVariantRaw.name || product.variant_name,
        price: currentPrice,
        old_price: activeVariantRaw.old_price ?? oldPrice ?? product.old_price,
        status: activeVariantRaw.status || product.status,
        stock: activeVariantRaw.stock ?? product.stock,
        image: activeVariantRaw.image || product.image,
        images: activeVariantRaw.images || product.images,
        cashback_percent: activeVariantRaw.cashback_percent ?? product.cashback_percent ?? 5,
      }
    : product;

  const isFavorite = favorites.some(f => f.id === displayProduct.id);

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
            <TouchableOpacity onPress={() => onShare(displayProduct)} style={styles.iconBtn}>
                <Ionicons name="share-outline" size={20} color="#000" />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { toggleFavorite(displayProduct); showToast(isFavorite ? 'Видалено' : 'Додано'); }} style={styles.iconBtn}>
              <Ionicons name={isFavorite ? "heart" : "heart-outline"} size={22} color={isFavorite ? "#ef4444" : "#000"} />
            </TouchableOpacity>
          </View>
       </View>

       <ProductDetailsView 
          product={displayProduct}
          variantRows={variantRows}
          optionKeys={optionKeys}
          internalKeys={internalKeys}
          matrix={matrix}
          selectedOptions={selectedOptions}
          applyOptionChange={applyOptionChange}
          isOptionAvailable={isOptionAvailable}
          currentPrice={currentPrice}
          oldPrice={oldPrice}
          activeRow={activeRow}
          formatPrice={formatPrice}
          clean={clean}
          onAddToCart={() => {
            Vibration.vibrate(10);

            const selectedVariantProduct = displayProduct;

            const selections = internalKeys.map(k => selectedOptions[k]).filter(Boolean).join(' | ');
            const selectedUnit = selectedVariantProduct.unit || product.unit || 'шт';
            addItem(selectedVariantProduct, 1, selections || selectedUnit, selectedUnit, currentPrice);
            showToast('\u0414\u043e\u0434\u0430\u043d\u043e \u0432 \u043a\u043e\u0448\u0438\u043a');
            trackEvent('AddToCart', {
              content_ids: [selectedVariantProduct.id],
              content_type: 'product',
              content_name: selectedVariantProduct.name,
              value: currentPrice,
              currency: 'UAH',
              items: [{
                item_id: selectedVariantProduct.id,
                item_name: selectedVariantProduct.name,
                price: currentPrice,
                quantity: 1,
                item_variant: selections || selectedUnit
              }]
            });

            logFirebaseEvent('add_to_cart', {
              currency: 'UAH',
              value: currentPrice,
              items: [{
                item_id: String(selectedVariantProduct.id),
                item_name: selectedVariantProduct.name,
                price: currentPrice,
                quantity: 1,
                item_variant: selections || selectedUnit
              }]
            });
          }}
          onToggleFavorite={() => toggleFavorite(displayProduct)}
          isFavorite={isFavorite}
          onShare={() => onShare(displayProduct)}
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
             const similarCartItem = {
               item_id: String(p.id),
               item_name: p.name,
               price: variantPrice,
               quantity: 1,
               item_variant: pack,
             };

             trackEvent('AddToCart', {
               content_ids: [p.id],
               content_type: 'product',
               content_name: p.name,
               value: variantPrice,
               currency: 'UAH',
               quantity: 1,
               items: [similarCartItem],
             });

             logFirebaseEvent('add_to_cart', {
               currency: 'UAH',
               value: variantPrice,
               items: [similarCartItem],
             });
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
         <Animated.View style={[styles.toast, { opacity: fadeAnim, top: Math.max(insets.top + 74, 88) }]}>
           <Text style={styles.whiteText}>{toastMessage}</Text>
         </Animated.View>
       )}
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
  toast: { position: 'absolute', alignSelf: 'center', backgroundColor: 'rgba(30,30,30,0.92)', paddingHorizontal: 20, paddingVertical: 11, borderRadius: 25, zIndex: 1000, elevation: 30 },
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

