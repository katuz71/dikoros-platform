/* eslint-disable react-hooks/exhaustive-deps, @typescript-eslint/no-unused-vars */
import { API_URL } from '@/config/api';
import { useCart } from '@/context/CartContext';
import { useOrders } from '@/context/OrdersContext';
import { getImageUrl } from '@/utils/image';
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Animated, Dimensions, FlatList, Image, KeyboardAvoidingView, Linking, Modal, Platform, SafeAreaView, ScrollView, Share, StyleSheet, Text, TextInput, TouchableOpacity, Vibration, View } from "react-native";
import HomeProductCarousel from '../../components/HomeProductCarousel';
import { AppHeader } from '@/components/AppHeader';
import ProductCard from '../../components/ProductCard';
import { useFavoritesStore } from '../../store/favoritesStore';

// Анимированная кнопка избранного
const AnimatedFavoriteButton = ({ item, onPress }: { 
  item: any; 
  onPress: () => void; 
}) => {
  const { favorites } = useFavoritesStore();
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const isFavorite = favorites.some(fav => fav.id === item?.id);
  
  const handlePress = () => {
    // Анимация пульсации
    Animated.sequence([
      Animated.timing(scaleAnim, {
        toValue: 1.2,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 1,
        duration: 100,
        useNativeDriver: true,
      }),
    ]).start();
    
    onPress();
  };
  
  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity 
        onPress={handlePress}
        style={{
          position: 'absolute',
          top: 12,
          right: 12,
          backgroundColor: 'rgba(255, 255, 255, 0.7)',
          width: 36,
          height: 36,
          borderRadius: 18,
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.1,
          shadowRadius: 4,
          elevation: 3,
          borderWidth: 0.5,
          borderColor: 'rgba(255, 255, 255, 0.8)',
        }}
      >
        <Ionicons 
          name={isFavorite ? "heart" : "heart-outline"} 
          size={18} 
          color={isFavorite ? "#ef4444" : "#374151"} 
        />
      </TouchableOpacity>
    </Animated.View>
  );
};

// Move types to top
type Variant = {
  id?: number;
  size: string;
  price: number;
  label?: string; // New field for normalized label
};

type Product = {
  id: number;
  name: string;
  price: number;
  minPrice?: number; // New field from grouping
  image?: string;
  image_url?: string;  // For CSV imports
  picture?: string;     // For XML imports
  category?: string;
  rating?: number;
  size?: string;
  description?: string;
  badge?: string;
  quantity?: number | string | boolean;
  composition?: string; // Changed from ingredients to match OrdersContext
  usage?: string;
  weight?: string;
  pack_sizes?: string[] | string;  // Changed to array to match backend, but might be string from DB
  old_price?: number | null;  // For discount logic
  sort_order?: number | null;
  home_hit_order?: number | null;
  home_new_order?: number | null;
  home_promotion_order?: number | null;
  unit?: string;  // Measurement unit (e.g., "шт", "г", "мл")
  delivery_info?: string;
  return_info?: string;
  option_names?: string | null; // Variation dimension titles (e.g., "weight|form|sort")
  variants?: Variant[] | any[];  // Variants with different prices or JSON string from DB
  variationGroups?: any[]; // For multi-dimensional variations
};

type CategorySortType = 'popular' | 'asc' | 'desc' | 'new';

const CATEGORY_SORT_OPTIONS: { key: CategorySortType; label: string }[] = [
  { key: 'popular', label: 'Популярні' },
  { key: 'asc', label: 'Спочатку дешевші' },
  { key: 'desc', label: 'Спочатку дорожчі' },
  { key: 'new', label: 'Новинки' },
];

const asArray = (value: any) => (Array.isArray(value) ? value : []);

const parseMaybeJsonArray = (value: any) => {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

const getHomeSectionOrder = (product: any, key: 'home_hit_order' | 'home_new_order' | 'home_promotion_order') => {
  const value = Number(product?.[key]);
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
};

const sortByHomeSectionOrder = <T extends Product>(
  items: T[],
  key: 'home_hit_order' | 'home_new_order' | 'home_promotion_order'
) => {
  return [...items].sort((a, b) => getHomeSectionOrder(a, key) - getHomeSectionOrder(b, key));
};

const CATALOG_UNAVAILABLE_STATUSES = [
  'out_of_stock',
  'not_available',
  'unavailable',
  'disabled',
  'відсутній',
  'немає в наявності',
  'нет в наличии',
];

const isCatalogUnavailableStatus = (value: any) => {
  const status = String(value ?? '').trim().toLowerCase();
  if (!status) return false;
  return CATALOG_UNAVAILABLE_STATUSES.some(item => status.includes(item));
};

const getValidCatalogPrice = (value: any) => {
  const price = Number(value ?? 0);
  return Number.isFinite(price) && price > 0 ? price : 0;
};

const getCatalogProductPrice = (product: any) => {
  const minPrice = getValidCatalogPrice(product?.minPrice);
  if (minPrice > 0) return minPrice;

  const price = getValidCatalogPrice(product?.price);
  if (price > 0) return price;

  const variantPrices = parseMaybeJsonArray(product?.variants)
    .map((variant: any) => getValidCatalogPrice(variant?.price))
    .filter((variantPrice: number) => variantPrice > 0);

  return variantPrices.length ? Math.min(...variantPrices) : 0;
};

const getCatalogSourceOrder = (product: any) => {
  const orderKeys = [
    'category_sort_order',
    'horoshop_order',
    'position',
    'sort_order',
    'home_hit_order',
    'home_new_order',
    'home_promotion_order',
  ];

  for (const key of orderKeys) {
    const order = Number(product?.[key]);
    if (Number.isFinite(order)) return order;
  }

  return Number.MAX_SAFE_INTEGER;
};

const isCatalogProductAvailable = (product: any) => {
  if (!product) return false;
  if (isCatalogUnavailableStatus(product?.status)) return false;

  const variants = parseMaybeJsonArray(product?.variants);
  if (variants.length === 0) return true;

  return variants.some((variant: any) => {
    if (isCatalogUnavailableStatus(variant?.status ?? variant?.raw?.status)) return false;
    const price = Number(variant?.price ?? product?.price ?? 0);
    return Number.isFinite(price) && price > 0;
  });
};

const isCatalogPromoProduct = (product: any) => {
  const price = getCatalogProductPrice(product);
  const oldPrice = Number(product?.old_price ?? 0);
  const discount = Number(product?.discount ?? 0);

  if (Number.isFinite(oldPrice) && oldPrice > price && price > 0) return true;
  if (Number.isFinite(discount) && discount > 0) return true;
  if (product?.is_promotion || product?.promotion || product?.promo) return true;
  if (Number.isFinite(Number(product?.home_promotion_order))) return true;

  const variants = parseMaybeJsonArray(product?.variants);
  if (variants.some((variant: any) => {
    const variantPrice = getValidCatalogPrice(variant?.price);
    const variantOldPrice = getValidCatalogPrice(variant?.old_price);
    const variantDiscount = Number(variant?.discount ?? 0);

    return (
      (variantOldPrice > variantPrice && variantPrice > 0)
      || (Number.isFinite(variantDiscount) && variantDiscount > 0)
      || Boolean(variant?.is_promotion || variant?.promotion || variant?.promo)
    );
  })) {
    return true;
  }

  return false;
};

const normalizeCategory = (value: any) => {
  return String(value ?? '')
    .trim()
    .replace(/\s*(?:>|›|»|→)\s*/g, '/')
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ');
};

const getRootCategoryName = (value: any) => {
  const raw = normalizeCategory(value);
  if (!raw) return '';

  const separators = ['/', '>', '›', '»', '→'];
  let root = raw;

  separators.forEach((separator) => {
    if (root.includes(separator)) {
      root = root.split(separator)[0].trim();
    }
  });

  return root.replace(/\s+/g, ' ');
};

const categoryMatches = (productCategory: any, selectedCategory: any) => {
  const product = normalizeCategory(productCategory);
  const selected = normalizeCategory(selectedCategory);
  if (!selected) return true;
  if (!product) return false;
  if (product === selected) return true;
  if (selected.includes('/')) return false;
  return product.startsWith(`${selected}/`);
};

const categoryNameFromHome = (category: any) => {
  return normalizeCategory(category?.name ?? category?.title ?? category?.label ?? category);
};

const normalizeSelectOption = (option: any) => {
  if (option === undefined || option === null) return { label: '—', value: '—' };
  if (typeof option === 'string' || typeof option === 'number') {
    const s = String(option).trim();
    return { label: s || '—', value: s || '—' };
  }
  const labelCandidate = option?.name ?? option?.size ?? option?.value ?? String(option);
  const valueCandidate = option?.value ?? option?.id ?? labelCandidate;
  const label = String(labelCandidate ?? '—').trim() || '—';
  const value = String(valueCandidate ?? label).trim() || label;
  return { label, value };
};

const getVariantSelectionValue = (variant: any) => {
  if (variant === undefined || variant === null) return '';
  if (typeof variant === 'string' || typeof variant === 'number') return String(variant).trim();

  const candidate =
    variant?.label ??
    variant?.size ??
    variant?.name ??
    variant?.pack_size ??
    variant?.packSize ??
    variant?.weight ??
    variant?.value;

  return String(candidate ?? '').trim();
};

const hasNonEmptyText = (value: any) => typeof value === 'string' && value.trim().length > 0;

const toDisplayText = (value: any) => {
  const s = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
  return s.length > 0 ? s : '—';
};

const parseOptionNames = (value: any) => {
  if (typeof value !== 'string') return [];
  return value
    .split('|')
    .map((name: any) => String(name ?? '').trim())
    .filter((name: string) => name.length > 0);
};

const getVariantOptionParts = (variant: any) => {
  if (variant === undefined || variant === null) return [];

  // 1. Try specifically mapped attributes first if they exist
  if (variant.attrs && typeof variant.attrs === 'object') {
     // If we have attrs, we might still need to match them to indices if we use option_names
     // But usually we prefer to map them by key. 
     // For now, let's try to extract values in order if we are using indexed matching
  }

  const raw =
    (typeof variant?.name === 'string' && variant.name) ||
    (typeof variant?.size === 'string' && variant.size) ||
    (typeof variant?.label === 'string' && variant.label) ||
    (typeof variant === 'string' && variant) ||
    '';

  if (!raw || typeof raw !== 'string') return [];
  return raw.split('|').map((part: any) => String(part ?? '').trim());
};

const normalizeComparable = (value: any) => String(value ?? '').toLowerCase().trim();


const normalizeFilterLabel = (value: any) => {
  return String(value ?? '')
    .replace(/[«»"']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

const addFilterOption = (target: Set<string>, value: any) => {
  const label = normalizeFilterLabel(value);
  if (!label || label.length < 2 || label.length > 36) return;
  if (/^[-–—]$/.test(label)) return;
  target.add(label);
};

const toggleFilterValue = (value: string, setter: (updater: (prev: string[]) => string[]) => void) => {
  setter(prev => prev.includes(value) ? prev.filter(item => item !== value) : [...prev, value]);
};

const sortFilterOptions = (values: Set<string>) => {
  return Array.from(values).sort((a, b) => a.localeCompare(b, 'uk'));
};

const getStructuredVariantOptions = (product: any, wantedLabels: string[]) => {
  const values = new Set<string>();
  const wanted = wantedLabels.map(normalizeComparable);
  const variants = parseMaybeJsonArray(product?.variants);
  const optionNames = parseOptionNames(product?.option_names);

  variants.forEach((variant: any) => {
    const structured = variant?.options && typeof variant.options === 'object'
      ? variant.options
      : variant?.attrs && typeof variant.attrs === 'object'
        ? variant.attrs
        : null;

    if (structured) {
      Object.entries(structured).forEach(([key, value]) => {
        const normalizedKey = normalizeComparable(key);
        if (wanted.some(label => normalizedKey.includes(label))) {
          addFilterOption(values, value);
        }
      });
    }

    const parts = getVariantOptionParts(variant);
    optionNames.forEach((name, index) => {
      const normalizedName = normalizeComparable(name);
      if (wanted.some(label => normalizedName.includes(label))) {
        addFilterOption(values, parts[index]);
      }
    });
  });

  return sortFilterOptions(values);
};

const RAW_MATERIAL_STOP_WORDS = [
  'капсули', 'капсул', 'порошок', 'порошку', 'екстракт', 'настоянка', 'настойка',
  'сушені', 'сушений', 'сушена', 'сушене', 'цілі', 'цілий', 'мелені', 'мелений',
  'трава', 'трави', 'гриб', 'гриби', 'мазь', 'крем', 'чай', 'набір', 'набор',
  'мікродозинг', 'мікродозінг', 'шляпках', 'шапках', 'на', 'із', 'з', 'для'
];

const cleanupRawMaterialCandidate = (value: any) => {
  let text = normalizeFilterLabel(value)
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:г|гр|kg|кг|мг|ml|мл|л|шт|капсул|капсули)\b/gi, ' ')
    .replace(/\b\d{2,4}\b/g, ' ')
    .replace(/[|,:;\/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const words = text.split(' ').filter((word) => {
    const normalized = normalizeComparable(word);
    if (!normalized) return false;
    return !RAW_MATERIAL_STOP_WORDS.some(stop => normalized === stop || normalized.startsWith(`${stop}-`));
  });

  text = words.slice(0, 3).join(' ').trim();
  if (!text || text.length < 3) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
};

const getCatalogRawMaterials = (product: any) => {
  const values = new Set<string>();

  getStructuredVariantOptions(product, ['Сировина', 'Склад', 'Вид', 'Рослина']).forEach(value => addFilterOption(values, value));

  const categoryParts = normalizeCategory(product?.category).split('/').map(part => part.trim()).filter(Boolean);
  categoryParts.slice(1).forEach(part => addFilterOption(values, cleanupRawMaterialCandidate(part)));

  const name = String(product?.name ?? '');
  const nameLead = name.split(/[,:;()]/)[0];
  addFilterOption(values, cleanupRawMaterialCandidate(nameLead));

  return sortFilterOptions(values);
};

const PACKAGE_FORM_PATTERNS: { label: string; patterns: RegExp[] }[] = [
  { label: 'Капсули', patterns: [/капсул/i] },
  { label: 'Порошок', patterns: [/порош/i, /мелен/i] },
  { label: 'Цілі', patterns: [/\bціл/i, /\bцел/i] },
  { label: 'Настоянка', patterns: [/настоян/i, /настой/i] },
  { label: 'Мазь', patterns: [/\bмаз/i, /крем/i] },
  { label: 'Чай', patterns: [/\bчай\b/i] },
  { label: 'Набір', patterns: [/набір/i, /набор/i] },
  { label: 'Шоколад', patterns: [/шоколад/i] },
  { label: 'Мед', patterns: [/\bмед\b/i] },
  { label: 'Консервація', patterns: [/консервац/i] },
  { label: 'Приправа', patterns: [/приправа/i] },
];

const getCatalogPackageForms = (product: any) => {
  const values = new Set<string>();

  getStructuredVariantOptions(product, ['Форма', 'Формат', 'Упаковка']).forEach(value => addFilterOption(values, value));

  const searchableText = [product?.name, product?.category, product?.variant_name]
    .filter(Boolean)
    .join(' ');

  PACKAGE_FORM_PATTERNS.forEach(({ label, patterns }) => {
    if (patterns.some(pattern => pattern.test(searchableText))) {
      addFilterOption(values, label);
    }
  });

  return sortFilterOptions(values);
};

const productMatchesSelectedFilters = (
  product: any,
  selectedValues: string[],
  extractor: (product: any) => string[]
) => {
  if (!selectedValues.length) return true;
  const available = extractor(product).map(normalizeComparable);
  return selectedValues.some(value => available.includes(normalizeComparable(value)));
};

const selectedFilterLabel = (title: string, values: string[]) => {
  if (!values.length) return null;
  if (values.length === 1) return `${title}: ${values[0]}`;
  return `${title}: ${values.length}`;
};

const getOptIndexFromKey = (key: any) => {
  if (typeof key !== 'string') return null;
  if (!key.startsWith('opt_')) return null;

  const n = Number(key.slice(4));
  return Number.isFinite(n) ? n : null;
};

const buildVariationGroupsFromOptionNames = (optionNames: string[], variants: any[]) => {
  const safeOptionNames = Array.isArray(optionNames) ? optionNames.filter(Boolean) : [];
  const safeVariants = Array.isArray(variants) ? variants.filter((v) => v != null) : [];

  return safeOptionNames
    .map((title, index) => {
      const options: string[] = [];

      safeVariants.forEach((variant) => {
        const parts = getVariantOptionParts(variant);
        const value = parts[index];
        const trimmed = typeof value === 'string' ? value.trim() : '';
        if (trimmed && !options.includes(trimmed)) options.push(trimmed);
      });

      return {
        id: `opt_${index}`,
        title: String(title ?? '').trim() || 'Варіант',
        options,
        __source: 'option_names',
        __index: index,
      };
    })
    .filter((g: any) => Array.isArray(g?.options) && g.options.length > 0);
};

const findVariantByOptionNameSelections = (variants: any[], selections: any) => {
  const safeVariants = parseMaybeJsonArray(variants).filter((v: any) => v != null);
  if (safeVariants.length === 0) return null;

  const keys = Object.keys(selections || {}).filter((key) => getOptIndexFromKey(key) !== null);
  if (keys.length === 0) return safeVariants[0] ?? null;

  const targets = keys
    .map((key) => {
      const index = getOptIndexFromKey(key);
      if (index === null) return null;
      return { index, value: normalizeComparable(selections?.[key]) };
    })
    .filter(Boolean) as { index: number; value: string }[];

  const exact = safeVariants.find((variant: any) => {
    const parts = getVariantOptionParts(variant);
    return targets.every(({ index, value }) => normalizeComparable(parts[index]) === value);
  });
  if (exact) return exact;

  let best: any = safeVariants[0] ?? null;
  let bestScore = -1;

  safeVariants.forEach((variant: any) => {
    const parts = getVariantOptionParts(variant);
    let score = 0;

    targets.forEach(({ index, value }) => {
      if (normalizeComparable(parts[index]) === value) score += 1;
    });

    if (score > bestScore) {
      bestScore = score;
      best = variant;
    }
  });

  return best;
};

// ... BannerImage and ProductImage remain here ...

// ...

// IMPORTANT: Do not put component logic here.

// BannerImage component for handling banner images with error fallback
const BannerImage = ({ uri, width, height }: { uri: string; width: number; height: number }) => {
  const [error, setError] = useState(false);
  
  if (error) {
    // Fallback UI (Placeholder)
    return (
      <View style={{
        width,
        height,
        backgroundColor: '#f5f5f5',
        borderRadius: 12,
        marginRight: 0,
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <Ionicons name="image-outline" size={40} color="#ccc" />
      </View>
    );
  }
  
  return (
    <Image 
      source={{ uri }} 
      style={{ 
        width,
        height, 
        borderRadius: 12,
        marginRight: 0,
        backgroundColor: '#fff',
        overflow: 'hidden'
      }} 
      resizeMode="stretch"
      onError={() => {
        console.error("❌ Banner image failed to load:", uri);
        setError(true);
      }}
      onLoad={() => {
        // Image loaded successfully
      }}
    />
  );
};

// ProductImage component for handling images with error fallback
const ProductImage = ({ uri, style }: { uri: string; style?: any }) => {
  const [error, setError] = useState(false);
  const { width } = Dimensions.get('window');
  
  // Для вертикальных карточек используем полную ширину
  const cardImageWidth = width - 32; // Ширина экрана минус отступы
  
  // Clean the URI and get full URL with automatic optimization for local images
  const validUri = uri ? getImageUrl(uri.trim(), {
    width: cardImageWidth,
    quality: 85,
    format: 'webp' // WebP для лучшего сжатия
  }) : getImageUrl(null);

  if (error) {
    // Fallback UI (Placeholder) в органическом стиле
    return (
      <View style={{ 
        width: '100%', 
        height: 200, 
        backgroundColor: '#F5F5F5', 
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        justifyContent: 'center', 
        alignItems: 'center'
      }}>
        <Ionicons name="image-outline" size={40} color="#ccc" />
        <Text style={{ color: '#999', marginTop: 8, fontSize: 14 }}>Немає фото</Text>
      </View>
    );
  }

  return (
    <Image
      source={{ uri: validUri }}
      style={style || { width: '100%', height: 200, borderRadius: 8 }}
      resizeMode="cover"
      onError={() => setError(true)}
    />
  );
};

const SITE_CATEGORY_ORDER = [
  'Мікродозінг',
  'Сушені гриби',
  'CBD',
  'Адаптогени та суперфуди',
  'Мазі',
  'Настоянки',
  'Трави та ягоди',
  'Ваги',
  'Консервація та мед',
];

export default function Index() {
  const router = useRouter();
  const params = useLocalSearchParams();
  // Get cart context
  const { addItem, items: cartItems, removeItem, clearCart, totalPrice, updateQuantity, addOne, removeOne } = useCart();
  // Get favorites store
  const { favorites, toggleFavorite } = useFavoritesStore();

  // Get products from OrdersContext (fetched from server)
  const { products, isLoading, fetchProducts, orders, removeOrder, clearOrders } = useOrders();

  // Placeholder for useEffect removal

  // Функция форматирования цены
  const formatPrice = (price: number) => {
    const safePrice = price || 0;
    return `${safePrice.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ")} ₴`;
  };

  const _clean = (v: unknown) => String(v ?? '').trim().replace(/^"+|"+$/g, '').replace(/\s+/g, ' ');

  const _pickDefaultVariant = (item: any): { packSize: string; price: number } => {
    const unit = String(item?.unit || 'шт');
    let variants: any[] = [];
    try {
      if (typeof item?.variants === 'string') {
        const parsed = JSON.parse(item.variants);
        variants = Array.isArray(parsed) ? parsed : [];
      } else if (Array.isArray(item?.variants)) {
        variants = item.variants;
      }
    } catch {}

    const first = variants[0];
    const label = _clean(first?.name || first?.variant || first?.title || first?.size || first?.pack_size || first?.packSize);
    const price = Number(first?.price ?? 0) || Number(item?.price ?? 0) || 0;
    return { packSize: label || unit, price };
  };

  // Используем cartItems из контекста вместо локального cart
  const cart = cartItems; // Алиас для совместимости со старым кодом
  const [modalVisible, setModalVisible] = useState(false);
  const [successModalVisible, setSuccessModalVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [categoryViewOpen, setCategoryViewOpen] = useState(false);
  const [sortType, setSortType] = useState<CategorySortType>('popular');
  const [filterModalVisible, setFilterModalVisible] = useState(false);
  const [priceFrom, setPriceFrom] = useState('');
  const [priceTo, setPriceTo] = useState('');
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [onlyPromo, setOnlyPromo] = useState(false);
  const [selectedRawMaterials, setSelectedRawMaterials] = useState<string[]>([]);
  const [selectedPackageForms, setSelectedPackageForms] = useState<string[]>([]);
  const [expandedFilterSection, setExpandedFilterSection] = useState<string | null>('sort');
  const [successVisible, setSuccessVisible] = useState(false);
  const [currentBannerIndex, setCurrentBannerIndex] = useState(0);
  const [bannerIndex, setBannerIndex] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [promoCode, setPromoCode] = useState('');
  const [discount, setDiscount] = useState(0);
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [banners, setBanners] = useState<any[]>([]);
  const [homeCategories, setHomeCategories] = useState<any[]>([]);
  const [homeHits, setHomeHits] = useState<Product[]>([]);
  const [homePromotions, setHomePromotions] = useState<Product[]>([]);
  const [homeNewProducts, setHomeNewProducts] = useState<Product[]>([]);
  const [catalogHomeLoaded, setCatalogHomeLoaded] = useState(false);

  const handleBannerPress = useCallback((banner: any) => {
    const linkType = String(banner?.link_type || 'none').trim().toLowerCase();
    const linkValue = String(banner?.link_value || '').trim();

    if (linkType === 'product') {
      if (!/^\d+$/.test(linkValue)) return;
      router.push(`/product/${linkValue}` as any);
      return;
    }

    if (linkType === 'category') {
      if (!linkValue) return;
      const categoryById = homeCategories.find(category => String(category?.id ?? '') === linkValue);
      const category = categoryById ? categoryNameFromHome(categoryById) : linkValue;
      if (/^\d+$/.test(linkValue) && !categoryById) return;
      if (!category) return;

      router.replace({
        pathname: '/(tabs)',
        params: {
          category,
          categoryOpen: String(Date.now()),
        },
      } as any);
      return;
    }

    if (linkType === 'promotions') {
      router.push('/news' as any);
      return;
    }

    if (linkType === 'post') {
      if (/^\d+$/.test(linkValue)) {
        router.push({ pathname: '/blog-detail', params: { post_id: linkValue } } as any);
        return;
      }
      if (/^https?:\/\/[^\s]+$/i.test(linkValue)) {
        router.push({ pathname: '/blog-detail', params: { source_url: linkValue } } as any);
      }
      return;
    }

    if (linkType === 'external') {
      if (!linkValue) return;
      const normalizedUrl = /^https?:\/\//i.test(linkValue) ? linkValue : `https://${linkValue}`;
      if (!/^https?:\/\/[^\s]+$/i.test(normalizedUrl)) return;
      Linking.openURL(normalizedUrl).catch(() => {});
    }
  }, [homeCategories, router]);

  const selectedCategoryBanners = useMemo(() => {
    const selectedRoot = normalizeCategory(selectedCategory).split('/', 1)[0].toLocaleLowerCase('uk-UA');
    if (!selectedRoot) return [];
    const category = homeCategories.find(item => (
      categoryNameFromHome(item).split('/', 1)[0].toLocaleLowerCase('uk-UA') === selectedRoot
    ));
    return Array.isArray(category?.banner_items) ? category.banner_items : [];
  }, [homeCategories, selectedCategory]);

  const [connectionError, setConnectionError] = useState(false);
  const [recentProducts, setRecentProducts] = useState<Product[]>([]);
  const [quantity, setQuantity] = useState(1);

  // --- ADVANCED VARIATION LOGIC ---
  const [variationGroups, setVariationGroups] = useState<any[]>([]);
  const [selectedVariations, setSelectedVariations] = useState<{[key: string]: string}>({});
  const [currentPrice, setCurrentPrice] = useState(0);
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [tab, setTab] = useState<'desc' | 'ingr' | 'use'>('desc');
  const [selectedVariant, setSelectedVariant] = useState<any>(null);
  const hydrateProductRequestRef = useRef<number | null>(null);

  const hydrateProductDetails = useCallback(async (productId: number) => {
    if (!productId) return;
    hydrateProductRequestRef.current = productId;
    try {
      const response = await fetch(`${API_URL}/products/${productId}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      if (response.ok) {
        const full = await response.json();
        if (hydrateProductRequestRef.current !== productId) return;
        setSelectedProduct(prev => {
          if (!prev || prev.id !== productId) return prev;
          // Использовать данные из detail-ответа, но сохранять id и другие поля
          return {
            ...prev,
            description: full.description,
            composition: full.composition,
            usage: full.usage,
            variants: full.variants,
            option_names: full.option_names,
            delivery_info: full.delivery_info || prev.delivery_info,
            return_info: full.return_info || prev.return_info
          };
        });
      }
    } catch (e) {
      console.error('hydrateProductDetails error:', e);
    }
  }, []);

  // Helper to parse variations when product opens
  useEffect(() => {
    if (!selectedProduct?.id) {
       setVariationGroups([]);
       setSelectedVariations({});
       setSelectedVariant(null);
       setCurrentPrice(0);
       return;
    }
    loadReviews(selectedProduct.id);

    const variants = parseMaybeJsonArray(selectedProduct.variants);
    if (variants.length === 0) {
      setVariationGroups([]);
      setSelectedVariations({});
      setSelectedVariant(null);
      setCurrentPrice(selectedProduct.price || 0);
      return;
    }

    const optNames = parseOptionNames(selectedProduct.option_names);
    const groups = buildVariationGroupsFromOptionNames(optNames, variants);
    
    if (groups.length === 0) {
      const opts = Array.from(new Set(variants.map(v => getVariantSelectionValue(v)).filter(Boolean)));
      if (opts.length > 0) groups.push({ id: 'variant_selection', title: 'Варіант', options: opts } as any);
    }

    setVariationGroups(groups);

    // Initial selection - first match
    const firstMatch = variants[0];
    const initialSels: any = {};
    const parts = getVariantOptionParts(firstMatch);
    groups.forEach((g: any) => {
      const idx = getOptIndexFromKey(g.id);
      initialSels[g.id] = (idx !== null ? String(parts[idx] ?? '') : getVariantSelectionValue(firstMatch)) || g.options[0];
    });

    setSelectedVariations(initialSels);
    setSelectedVariant(firstMatch);
    setCurrentPrice(Number(firstMatch.price) || selectedProduct.price || 0);
  }, [selectedProduct]);

  // Helper to get available options for a group based on current selections
  const getAvailableOptions = (groupId: string, currentSelections: any, allVariants: any[]) => {
      if (!allVariants || allVariants.length === 0) return [];
      
      // Фильтруем варианты, которые совпадают с уже выбранными опциями (кроме текущей группы)
      const compatibleVariants = allVariants.filter((v: any) => {
          return Object.keys(currentSelections).every(key => {
              if (key === groupId) return true; // Пропускаем текущую группу
              
              const selectedVal = currentSelections[key];
              const variantVal = v.attrs ? v.attrs[key] : null;
              
              const normalizedSelected = String(selectedVal || '').toLowerCase().trim();
              const normalizedVariant = String(variantVal || '').toLowerCase().trim();
              
              return normalizedVariant === normalizedSelected;
          });
      });
      
      // Собираем уникальные значения для текущей группы из совместимых вариантов
      const availableValues = new Set<string>();
      compatibleVariants.forEach((v: any) => {
          const value = v.attrs ? v.attrs[groupId] : null;
          if (value) {
              availableValues.add(value);
          }
      });
      
      return Array.from(availableValues);
  };

  // Helper to check if option is available for current selections
  const isOptionAvailable = (groupId: string, optionValue: string, currentSelections: any, variants: any[]) => {
      const safeVariants = parseMaybeJsonArray(variants).filter((v: any) => v != null);
      if (safeVariants.length === 0) return false;

      const usesOptionNames =
        typeof groupId === 'string' &&
        (groupId.startsWith('opt_') ||
          Object.keys(currentSelections || {}).some(
            (k) => typeof k === 'string' && k.startsWith('opt_')
          ));

      if (usesOptionNames) {
        const testSelections = { ...(currentSelections || {}), [groupId]: optionValue };
        const keys = Object.keys(testSelections || {}).filter(
          (k) => typeof k === 'string' && k.startsWith('opt_')
        );

        return safeVariants.some((variant: any) => {
          const parts = getVariantOptionParts(variant);
          return keys.every((k) => {
            const idx = getOptIndexFromKey(k);
            if (idx === null) return true;
            return (
              normalizeComparable(parts[idx]) === normalizeComparable(testSelections[k])
            );
          });
        });
      }

      if (groupId !== 'variant_selection' && !safeVariants.some((v: any) => v?.attrs)) return true;

      const testSelections = { ...currentSelections, [groupId]: optionValue };

      return safeVariants.some((v: any) =>
        Object.keys(testSelections).every((key) => {
          const selectedVal = testSelections[key];
          const variantVal = v?.attrs ? v.attrs[key] : null;

          if (key === 'variant_selection') {
            return getVariantSelectionValue(v) === String(selectedVal ?? '');
          }

          return (
            String(variantVal ?? '').toLowerCase().trim() ===
            String(selectedVal ?? '').toLowerCase().trim()
          );
        })
      );
  };

  // Helper to find best matching variant
  const findBestVariant = (variants: any[], selections: any) => {
      const safeVariants = parseMaybeJsonArray(variants).filter((v: any) => v != null);
      if (safeVariants.length === 0) return null;

      console.log('🔍 findBestVariant - selections:', selections);
      console.log('🔍 findBestVariant - variants count:', safeVariants.length);

      // Логируем все варианты для диагностики
      console.log('📋 All variants attrs:', safeVariants.map((v: any) => ({ id: v?.id, attrs: v?.attrs, price: v?.price })));

      const found = safeVariants.find((v: any) => {
          const matches = Object.keys(selections || {}).every((key) => {
              const selectedVal = selections ? selections[key] : undefined;
              const variantVal = v?.attrs ? v.attrs[key] : null;

              // Special case: 'variant_selection' is a dummy key for flat lists
              if (key === 'variant_selection') return getVariantSelectionValue(v) === String(selectedVal ?? '');

              // Нормализуем для сравнения (регистр и пробелы)
              const normalizedSelected = String(selectedVal || '').toLowerCase().trim();
              const normalizedVariant = String(variantVal || '').toLowerCase().trim();

              const isMatch = normalizedVariant === normalizedSelected;

              if (!isMatch) {
                  console.log(`❌ Mismatch on ${key}: variant ID ${v?.id} - "${normalizedVariant}" !== "${normalizedSelected}"`);
              }

              return isMatch;
          });

          if (matches) {
              console.log('✅ Found matching variant:', v?.id, v?.attrs, 'Price:', v?.price);
          }

          return matches;
      });

      if (!found) {
          console.log('⚠️ No exact variant found for selections:', selections);

          // Пріоритетний пошук: сорт + вага (форма може відрізнятися)
          const priorityMatch = safeVariants.find((v: any) => {
              const sortMatch = !selections?.sort ||
                  String(v?.attrs?.sort || '').toLowerCase().trim() === String(selections?.sort || '').toLowerCase().trim();
              const sizeMatch = !selections?.size ||
                  String(v?.attrs?.size || '').toLowerCase().trim() === String(selections?.size || '').toLowerCase().trim();

              return sortMatch && sizeMatch;
          });

          if (priorityMatch) {
              console.log('✅ Found priority match (sort+size):', priorityMatch?.id, priorityMatch?.attrs, 'Price:', priorityMatch?.price);
              return priorityMatch;
          }

          // Якщо не знайдено - шукаємо хоча б по сорту
          const sortMatch = safeVariants.find((v: any) => {
              return selections?.sort &&
                  String(v?.attrs?.sort || '').toLowerCase().trim() === String(selections?.sort || '').toLowerCase().trim();
          });

          if (sortMatch) {
              console.log('✅ Found sort match:', sortMatch?.id, sortMatch?.attrs, 'Price:', sortMatch?.price);
              return sortMatch;
          }

          // Останній fallback - будь-який варіант з хоча б одним співпадінням
          const partialMatch = safeVariants.find((v: any) => {
              let matchCount = 0;
              Object.keys(selections || {}).forEach((key) => {
                  const selectedVal = selections ? selections[key] : undefined;
                  const variantVal = v?.attrs ? v.attrs[key] : null;

                  if (key === 'variant_selection') {
                      if (getVariantSelectionValue(v) === String(selectedVal ?? '')) matchCount++;
                      return;
                  }

                  const normalizedSelected = String(selectedVal || '').toLowerCase().trim();
                  const normalizedVariant = String(variantVal || '').toLowerCase().trim();

                  if (normalizedVariant === normalizedSelected) {
                      matchCount++;
                  }
              });
              return matchCount > 0;
          });

          if (partialMatch) {
              console.log('✅ Found partial match:', partialMatch?.id, partialMatch?.attrs, 'Price:', partialMatch?.price);
              return partialMatch;
          }

          console.log('Available variants:', safeVariants.map((v: any) => ({ id: v?.id, attrs: v?.attrs, price: v?.price })));
      }

      return found;
  };

  // Update selection handler
  const handleVariationSelect = (groupId: string, value: string) => {
    const newSels = { ...selectedVariations, [groupId]: value };
    setSelectedVariations(newSels);
    
    const variants = parseMaybeJsonArray(selectedProduct?.variants);
    const match = findBestVariant(variants, newSels);
    
    if (match) {
      setSelectedVariant(match);
      setCurrentPrice(Number(match.price) || selectedProduct?.price || 0);
    }
  };
  
  const openProductWithRecent = async (item: Product) => {
    if (!item?.id) return;

    try {
      const raw = await AsyncStorage.getItem('recentProducts');
      const parsed = raw ? JSON.parse(raw) : [];
      const list = Array.isArray(parsed) ? parsed : [];
      const next = [item, ...list.filter((p: Product) => p?.id !== item.id)].slice(0, 12);

      setRecentProducts(next);
      await AsyncStorage.setItem('recentProducts', JSON.stringify(next));
    } catch {}

    router.push(`/product/${item.id}`);
  };

  // Render Product Item
  const renderProductItem = ({ item }: { item: Product }) => {
    const isFavorite = favorites.some(fav => fav.id === item?.id);
    const displayPrice = formatPrice(item.price);
        
    return (
      <ProductCard
        item={item} // Pass item as is
        displayPrice={displayPrice} // Pass custom price string
        onPress={() => {
          if (!item?.id) {
            Alert.alert('Увага', 'id не знайдено');
            return;
          }
          console.warn("NAV product press", item.id);
          router.push(`/product/${item.id}`);
        }}
        onFavoritePress={() => {
           // ... favorite logic ...
           Vibration.vibrate(10);
           toggleFavorite({
               id: item.id,
               name: item.name,
               price: item.price,
               image: item.image || item.picture || item.image_url || '',
               category: item.category,
               old_price: item.old_price,
               badge: item.badge,
               unit: item.unit,
               variants: item.variants,
               option_names: item.option_names,
               minPrice: item.minPrice
           });
           showToast(isFavorite ? 'Видалено з обраного' : 'Додано в обране ❤️');
        }}
        onCartPress={() => {
           Vibration.vibrate(10);

           const picked = _pickDefaultVariant(item);
           addItem(item, 1, picked.packSize, item.unit || 'шт', picked.price);
           showToast('Товар додано в кошик');
        }}
        isFavorite={isFavorite}
      />
    );
  };

  // Reviews state
  const [reviews, setReviews] = useState<any[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [averageRating, setAverageRating] = useState(0);
  const [totalReviews, setTotalReviews] = useState(0);
  const [reviewModalVisible, setReviewModalVisible] = useState(false);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');


  useEffect(() => {
    const loadRecentProducts = async () => {
      try {
        const raw = await AsyncStorage.getItem('recentProducts');
        const parsed = raw ? JSON.parse(raw) : [];
        setRecentProducts(Array.isArray(parsed) ? parsed.slice(0, 12) : []);
      } catch {
        setRecentProducts([]);
      }
    };

    loadRecentProducts();
  }, []);

  const loadBanners = useCallback(async () => {
    const CACHE_KEY = 'cached_banners_v2'; // Новый ключ кэша
    
    try {
      // STEP 1: Сначала загружаем из кэша (если есть) и показываем сразу
      try {
        const cachedData = await AsyncStorage.getItem(CACHE_KEY);
        if (cachedData) {
          try {
            const cachedBanners = JSON.parse(cachedData);
            if (Array.isArray(cachedBanners) && cachedBanners.length > 0) {
              // Используем оптимизированные данные из кэша как есть
              setBanners(cachedBanners); // Показываем кэшированные баннеры сразу
            }
          } catch (parseError) {
            console.error('Error parsing cached banners:', parseError);
            // Очищаем поврежденный кэш
            await AsyncStorage.removeItem(CACHE_KEY);
          }
        }
      } catch (cacheError) {
        console.error('Error reading cached banners:', cacheError);
      }

      // STEP 2: Затем загружаем свежие данные с API
      const bannersUrl = `${API_URL}/banners`;
      const controller2 = new AbortController();
      const timeout2 = setTimeout(() => controller2.abort(), 10000); // Уменьшили timeout до 10 секунд
      
      const bannerRes = await fetch(bannersUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
        signal: controller2.signal,
      });
      
      clearTimeout(timeout2);
      if (bannerRes.ok) {
        const bannersData = await bannerRes.json();
        const bannersArray = Array.isArray(bannersData) ? bannersData : [];
        if (bannersArray.length > 0) {
          // Horoshop is the source of truth, so keep the full synchronized hero slider.
          const limitedBanners = bannersArray;
          
          // STEP 3: Обновляем состояние свежими данными
          setBanners(limitedBanners);
          
          // STEP 4: Сохраняем в кэш для следующего раза с оптимизацией
          try {
            // Создаем оптимизированную версию для кэша (только необходимые поля)
            const optimizedBanners = limitedBanners.map(banner => ({
              id: banner.id,
              image_url: banner.image_url || banner.image || banner.picture,
              title: banner.title || '',
              link_type: banner.link_type || 'none',
              link_value: banner.link_value || ''
            }));
            
            const dataToCache = JSON.stringify(optimizedBanners);
            // Проверяем размер данных перед сохранением
            if (dataToCache.length < 3000) { // Уменьшили ограничение до ~3KB
              await AsyncStorage.setItem(CACHE_KEY, dataToCache);
              console.log('✅ Saved optimized banners to cache');
            } else {
              console.log('ℹ️ Banner data still too large, using API-only mode');
            }
          } catch (saveError) {
            console.error('Error saving banners to cache:', saveError);
            // Не прерываем работу, просто не сохраняем в кэш
          }
        }
      }
    } catch (bannerError: any) {
      // Не очищаем баннеры при ошибке - оставляем кэшированные данные
      if (bannerError.name !== 'AbortError') {
        console.error("❌ Banner fetch error:", bannerError.message);
      }
    }
  }, [API_URL]);

  const applyCatalogHomeData = useCallback((data: any) => {
    const nextBanners = Array.isArray(data?.banners) ? data.banners : [];
    const nextCategories = Array.isArray(data?.categories) ? data.categories : [];
    const nextHits = Array.isArray(data?.hits) ? data.hits : [];
    const nextPromotions = Array.isArray(data?.promotions) ? data.promotions : [];
    const nextNewProducts = Array.isArray(data?.new_products) ? data.new_products : [];

    if (nextBanners.length > 0) {
      setBanners(nextBanners);
    }

    setHomeCategories(nextCategories);
    setHomeHits(nextHits);
    setHomePromotions(nextPromotions);
    setHomeNewProducts(nextNewProducts);
    setCatalogHomeLoaded(true);
  }, []);

  const loadCatalogHome = useCallback(async () => {
    const CACHE_KEY = 'cached_catalog_home_v5';

    try {
      const cachedData = await AsyncStorage.getItem(CACHE_KEY);
      if (cachedData) {
        try {
          applyCatalogHomeData(JSON.parse(cachedData));
        } catch {
          await AsyncStorage.removeItem(CACHE_KEY);
        }
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(`${API_URL}/api/catalog/home`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`catalog home HTTP ${response.status}`);
      }

      const data = await response.json();
      applyCatalogHomeData(data);

      try {
        const serialized = JSON.stringify(data);
        if (serialized.length < 200000) {
          await AsyncStorage.setItem(CACHE_KEY, serialized);
        }
      } catch (cacheError) {
        console.error('Error saving catalog home cache:', cacheError);
      }
    } catch (error: any) {
      if (error?.name !== 'AbortError') {
        console.error('❌ Catalog home fetch error:', error?.message || error);
      }
    }
  }, [API_URL, applyCatalogHomeData]);

  // Load banners on mount
  useEffect(() => {
    console.log('Component mounted - loading dynamic catalog home');
    loadBanners();
    loadCatalogHome();
  }, [loadBanners, loadCatalogHome]);

  // Загрузка баннеров из кэша при монтировании (для быстрого старта)
  useEffect(() => {
    const loadCachedBanners = async () => {
      const CACHE_KEY = 'cached_banners_v2';
      try {
        const cachedData = await AsyncStorage.getItem(CACHE_KEY);
        if (cachedData) {
          try {
            const cachedBanners = JSON.parse(cachedData);
            if (Array.isArray(cachedBanners) && cachedBanners.length > 0) {
              // Используем оптимизированные данные из кэша как есть
              setBanners(cachedBanners); // Показываем кэшированные баннеры сразу при старте
            }
          } catch (parseError) {
            console.error('Error parsing cached banners on mount:', parseError);
            // Очищаем поврежденный кэш
            await AsyncStorage.removeItem(CACHE_KEY);
          }
        }
      } catch (error) {
        console.error('Error loading cached banners on mount:', error);
        // Очищаем поврежденный кэш
        try {
          await AsyncStorage.removeItem('cached_banners_v2');
        } catch (clearError) {
          console.error('Error clearing corrupted cache on mount:', clearError);
        }
      }
    };
    loadCachedBanners();
  }, []);

  // Обработка параметра для открытия профиля после заказа
  useEffect(() => {
    if (params.showProfile === 'true') {
      // Небольшая задержка для плавного перехода
      const timer = setTimeout(() => {
        router.push('/(tabs)/profile');
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [params.showProfile]);

  // Set initial selectedSize when product is selected
  // Legacy useEffect for selectedSize removed to avoid conflicts and errors with string pack_sizes
  const [aiVisible, setAiVisible] = useState(false);
  const [inputMessage, setInputMessage] = useState('');
  const [messages, setMessages] = useState([
    { id: 1, text: 'Привіт! Я експерт із сили природи. Допоможу підібрати гриби, вітаміни чи трави для твого здоров\'я. Що шукаємо? 🌿🍄', sender: 'bot' }
  ]);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scrollViewRef = useRef<ScrollView>(null);
  const flatListRef = useRef<FlatList>(null);
  const chatFlatListRef = useRef<FlatList>(null);
  const bannerRef = useRef<ScrollView>(null);
  const categoryTabsRef = useRef<ScrollView>(null);

  const showHomeScreen = useCallback(() => {
    setCategoryViewOpen(false);
    setSelectedCategory('');
    setSearchQuery('');
    setIsSearchVisible(false);
    setFilterModalVisible(false);
    setExpandedFilterSection('sort');
    setOnlyAvailable(false);
    setOnlyPromo(false);
    setSelectedRawMaterials([]);
    setSelectedPackageForms([]);
    setPriceFrom('');
    setPriceTo('');
    setSortType('popular');
    scrollViewRef.current?.scrollTo({ y: 0, animated: true });
  }, []);

  useEffect(() => {
    if (params.homeReset) {
      showHomeScreen();
    }
  }, [params.homeReset, showHomeScreen]);

  useEffect(() => {
    if (!params.categoryOpen) return;

    const rawCategory = Array.isArray(params.category) ? params.category[0] : params.category;
    const category = String(rawCategory || '').trim();

    setSelectedCategory(category);
    setSearchQuery('');
    setIsSearchVisible(false);
    setFilterModalVisible(false);
    setExpandedFilterSection('sort');
    setOnlyAvailable(false);
    setOnlyPromo(false);
    setSelectedRawMaterials([]);
    setSelectedPackageForms([]);
    setPriceFrom('');
    setPriceTo('');
    setSortType('popular');
    setCategoryViewOpen(true);

    requestAnimationFrame(() => {
      scrollViewRef.current?.scrollTo({ y: 0, animated: false });
    });
  }, [params.categoryOpen, params.category]);


  // Автоматическая прокрутка баннеров
  useEffect(() => {
    if (banners.length === 0) return;
    
    let index = 0;
    const interval = setInterval(() => {
      index = (index + 1) % banners.length;
      flatListRef.current?.scrollToIndex({
        index,
        animated: true,
        viewPosition: 0.5
      });
    }, 4000); // Листаем каждые 4 секунды
    return () => clearInterval(interval);
  }, [banners]);

  const showToast = (message: string) => {
    setToastMessage(message);
    setToastVisible(true);
    
    // Анимация появления
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true,
    }).start();
    
    // Автоматическое скрытие через 2 секунды
    setTimeout(() => {
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start(() => {
        setToastVisible(false);
      });
    }, 2000);
  };

  const addToCart = (item: Product, size?: string) => {
    Vibration.vibrate(50); // Легкий отклик (50мс)
    const unit = String((item as any)?.unit || 'шт');
    const sizeLabel = _clean(size);

    let packSize = sizeLabel;
    let price = Number((item as any)?.price ?? 0) || 0;

    // If a size label is provided, try matching an existing variant to keep the correct price.
    if (packSize) {
      let variants: any[] = [];
      try {
        if (typeof (item as any)?.variants === 'string') {
          const parsed = JSON.parse((item as any).variants);
          variants = Array.isArray(parsed) ? parsed : [];
        } else if (Array.isArray((item as any)?.variants)) {
          variants = (item as any).variants;
        }
      } catch {}

      const normalizedNeedle = _clean(packSize).toLowerCase();
      const match = variants.find((v: any) => {
        const label = _clean(v?.name || v?.variant || v?.title || v?.size || v?.pack_size || v?.packSize).toLowerCase();
        return label && (label === normalizedNeedle || label.includes(normalizedNeedle) || normalizedNeedle.includes(label));
      });
      if (match) {
        const label = _clean(match?.name || match?.variant || match?.title || match?.size || match?.pack_size || match?.packSize);
        if (label) packSize = label;
        price = Number(match?.price ?? 0) || price;
      }
    } else {
      const picked = _pickDefaultVariant(item);
      packSize = picked.packSize;
      price = picked.price;
    }

    const finalPack = packSize || unit;
    addItem(item, 1, finalPack, unit, price);
    showToast('Товар додано в кошик');
  };

  const applyPromo = () => {
    if (promoCode.trim().toUpperCase() === 'START') {
      setDiscount(0.1); // 10% скидка
      showToast('Промокод активовано! -10%');
    } else {
      setDiscount(0);
      showToast('Невірний промокод');
    }
  };



  const onShare = async (product: Product) => {
    try {
      await Share.share({
        message: `Дивись, цікава річ: ${product.name} за ${formatPrice(product.price)}!`,
      });
    } catch (error: any) {
      console.log(error.message);
    }
  };

  const CHAT_API_URL = `${API_URL}/chat`;

  const sendMessage = async () => {
    if (!inputMessage.trim() || isChatLoading) return;

    const userMessage = inputMessage.trim();
    const userMsg = { id: Date.now(), text: userMessage, sender: 'user' };
    
    // Добавляем сообщение пользователя
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInputMessage('');
    setIsChatLoading(true);
    
    // Скроллим после добавления сообщения пользователя
    setTimeout(() => {
      chatFlatListRef.current?.scrollToEnd({ animated: true });
    }, 100);

    // Формируем историю для отправки
    const history = updatedMessages.map(msg => ({
      role: msg.sender === 'user' ? 'user' : 'assistant',
      content: msg.text
    }));
    
    // Отправляем запрос
    try {
      const response = await fetch(CHAT_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ messages: history }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const replyText = data.text || data.response || 'Вибачте, не вдалося отримати відповідь.';
      const recommendedProducts = data.products || [];
      
      const botMsg = { 
        id: Date.now() + 1, 
        text: replyText, 
        sender: 'bot',
        products: recommendedProducts
      };
      
      // Добавляем ответ бота
      setMessages(prev => [...prev, botMsg]);
      
      // Скроллим после получения ответа
      setTimeout(() => {
        chatFlatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
      
      Vibration.vibrate(50);
      setIsChatLoading(false);
    } catch (error) {
      console.error('Error calling API:', error);
      const errorMsg = { 
        id: Date.now() + 1, 
        text: 'Вибачте, не вдалося підключитися до сервера. Перевірте, чи запущений сервер.', 
        sender: 'bot' 
      };
      setMessages(prev => [...prev, errorMsg]);
      setIsChatLoading(false);
    }
  };

  const subtotal = cart.reduce((sum: number, item: Product) => sum + (item.price * (Number(item.quantity) || 1)), 0);
  const totalAmount = subtotal - (subtotal * discount);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      fetchProducts(),
      loadCatalogHome(),
    ]);
    setRefreshing(false);
  }, [fetchProducts, loadCatalogHome]);

  // Safe products array
  const safeProductsRaw = Array.isArray(products) ? products : [];

  const variantChildIds = useMemo(() => {
    const ids = new Set<number>();

    safeProductsRaw.forEach((product: any) => {
      const variants = parseMaybeJsonArray(product?.variants);

      if (variants.length <= 1) return;

      variants.forEach((variant: any) => {
        const variantId = Number(variant?.id);
        const productId = Number(product?.id);

        if (variantId && variantId !== productId) {
          ids.add(variantId);
        }
      });
    });

    return ids;
  }, [safeProductsRaw]);

  const safeProducts = useMemo(() => {
    return safeProductsRaw.filter((product: any) => {
      const name = String(product?.name ?? '').trim();
      const price = getCatalogProductPrice(product);

      if (variantChildIds.has(Number(product?.id))) return false;
      if (!name || name.toLowerCase() === 'без назви') return false;
      if (!Number.isFinite(price) || price <= 0) return false;

      return true;
    });
  }, [safeProductsRaw, variantChildIds]);

  const homeFallbackProducts = useMemo(() => {
    return safeProducts.filter(isCatalogProductAvailable);
  }, [safeProducts]);

  // Derive only root categories from products for the home screen
  const derivedCategories = useMemo(() => {
    const categorySet = new Set<string>();

    safeProducts.forEach(p => {
      const rootCategory = getRootCategoryName(p?.category);
      if (rootCategory) {
        categorySet.add(rootCategory);
      }
    });

    return SITE_CATEGORY_ORDER.filter(cat => categorySet.has(cat));
  }, [safeProducts]);

  const catalogCategories = useMemo(() => {
    const categorySet = new Set<string>();

    homeCategories.forEach(category => {
      const rootCategory = getRootCategoryName(categoryNameFromHome(category));
      if (rootCategory) {
        categorySet.add(rootCategory);
      }
    });

    if (categorySet.size === 0) return derivedCategories;

    const ordered = SITE_CATEGORY_ORDER.filter(cat => categorySet.has(cat));
    const extra = Array.from(categorySet)
      .filter(cat => !SITE_CATEGORY_ORDER.includes(cat))
      .sort((a, b) => a.localeCompare(b));

    return [...ordered, ...extra];
  }, [homeCategories, derivedCategories]);

  // Фильтрация товаров по поисковому запросу и категории
  const getSortedProducts = () => {
    const normalizedSearch = searchQuery.trim().toLowerCase();
    const minPrice = Number(priceFrom.replace(',', '.'));
    const maxPrice = Number(priceTo.replace(',', '.'));

    let result = safeProducts.filter(p => {
      const productName = String(p?.name ?? '').toLowerCase();
      const price = getCatalogProductPrice(p);

      if (normalizedSearch && !productName.includes(normalizedSearch)) return false;
      if (selectedCategory && !categoryMatches(p?.category, selectedCategory)) return false;
      if (onlyAvailable && !isCatalogProductAvailable(p)) return false;
      if (onlyPromo && !isCatalogPromoProduct(p)) return false;
      if (!productMatchesSelectedFilters(p, selectedRawMaterials, getCatalogRawMaterials)) return false;
      if (!productMatchesSelectedFilters(p, selectedPackageForms, getCatalogPackageForms)) return false;
      if (Number.isFinite(minPrice) && minPrice > 0 && price < minPrice) return false;
      if (Number.isFinite(maxPrice) && maxPrice > 0 && price > maxPrice) return false;

      return true;
    });

    if (sortType === 'new') {
      return [...result].sort((a, b) => {
        const aOrder = getHomeSectionOrder(a, 'home_new_order');
        const bOrder = getHomeSectionOrder(b, 'home_new_order');

        if (aOrder !== bOrder) return aOrder - bOrder;

        const aIsNew = (a as any)?.is_new ? 1 : 0;
        const bIsNew = (b as any)?.is_new ? 1 : 0;
        if (aIsNew !== bIsNew) return bIsNew - aIsNew;

        return Number(b?.id ?? 0) - Number(a?.id ?? 0);
      });
    }

    if (sortType === 'asc') {
      return [...result].sort((a, b) => getCatalogProductPrice(a) - getCatalogProductPrice(b));
    } else if (sortType === 'desc') {
      return [...result].sort((a, b) => getCatalogProductPrice(b) - getCatalogProductPrice(a));
    }

    if (sortType === 'popular' && result.some(product => getCatalogSourceOrder(product) !== Number.MAX_SAFE_INTEGER)) {
      return [...result].sort((a, b) => getCatalogSourceOrder(a) - getCatalogSourceOrder(b));
    }

    return result; // 'popular' keeps Horoshop/API source order when no explicit order exists
  };
  
  const filteredProducts = getSortedProducts();

  const categoryFilterBaseProducts = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase();
    return safeProducts.filter((p: any) => {
      const productName = String(p?.name ?? '').toLowerCase();
      if (normalizedSearch && !productName.includes(normalizedSearch)) return false;
      if (selectedCategory && !categoryMatches(p?.category, selectedCategory)) return false;
      return true;
    });
  }, [safeProducts, searchQuery, selectedCategory]);

  const rawMaterialFilterOptions = useMemo(() => {
    const values = new Set<string>();
    categoryFilterBaseProducts.forEach((product: any) => {
      getCatalogRawMaterials(product).forEach(value => addFilterOption(values, value));
    });
    return sortFilterOptions(values);
  }, [categoryFilterBaseProducts]);

  const packageFormFilterOptions = useMemo(() => {
    const values = new Set<string>();
    categoryFilterBaseProducts.forEach((product: any) => {
      getCatalogPackageForms(product).forEach(value => addFilterOption(values, value));
    });
    return sortFilterOptions(values);
  }, [categoryFilterBaseProducts]);

  const activeFilterCount = selectedRawMaterials.length + selectedPackageForms.length + (onlyAvailable ? 1 : 0) + (onlyPromo ? 1 : 0) + (priceFrom.trim() ? 1 : 0) + (priceTo.trim() ? 1 : 0);
  const activeSortLabel = CATEGORY_SORT_OPTIONS.find(option => option.key === sortType)?.label || 'Популярні';
  const categoryFilterSummary = [
    `${filteredProducts.length} товарів`,
    activeSortLabel,
    selectedFilterLabel('Сировина', selectedRawMaterials),
    selectedFilterLabel('Форма', selectedPackageForms),
    onlyAvailable ? 'В наявності' : null,
    onlyPromo ? 'Акційні' : null,
  ].filter(Boolean).join(' · ');

  const fallbackHitProducts = sortByHomeSectionOrder(
    homeFallbackProducts.filter((p: any) => p?.home_hit_order != null && Number.isFinite(Number(p.home_hit_order))),
    'home_hit_order'
  ).slice(0, 16);

  const fallbackPromoProducts = sortByHomeSectionOrder(
    homeFallbackProducts.filter((p: any) => p?.home_promotion_order != null && Number.isFinite(Number(p.home_promotion_order))),
    'home_promotion_order'
  ).slice(0, 16);

  const fallbackNewProducts = sortByHomeSectionOrder(
    homeFallbackProducts.filter((p: any) => p?.home_new_order != null && Number.isFinite(Number(p.home_new_order))),
    'home_new_order'
  ).slice(0, 16);

  const hitProducts = catalogHomeLoaded ? homeHits : fallbackHitProducts;
  const promoProducts = catalogHomeLoaded ? homePromotions : fallbackPromoProducts;
  const newProducts = catalogHomeLoaded ? homeNewProducts : fallbackNewProducts;

  const toggleFilterSection = (section: string) => {
    setExpandedFilterSection(prev => prev === section ? null : section);
  };

  const renderFilterSectionHeader = (section: string, title: string, subtitle?: string | null) => {
    const expanded = expandedFilterSection === section;
    return (
      <TouchableOpacity
        onPress={() => toggleFilterSection(section)}
        activeOpacity={0.82}
        style={{
          minHeight: 52,
          borderRadius: 14,
          backgroundColor: '#F9FAFB',
          borderWidth: 1,
          borderColor: expanded ? '#2E7D32' : '#E5E7EB',
          paddingHorizontal: 14,
          marginBottom: expanded ? 10 : 8,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
        }}
      >
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#111827', fontSize: 16, fontWeight: '900' }}>{title}</Text>
          {!!subtitle && (
            <Text style={{ color: '#6B7280', fontSize: 12, fontWeight: '700', marginTop: 2 }} numberOfLines={1}>
              {subtitle}
            </Text>
          )}
        </View>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={20} color={expanded ? '#2E7D32' : '#6B7280'} />
      </TouchableOpacity>
    );
  };

  const filterOptionChipStyle = (active: boolean) => ({
    minHeight: 40,
    paddingHorizontal: 12,
    borderRadius: 12,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: active ? '#E8F5E9' : '#FFFFFF',
    borderWidth: 1,
    borderColor: active ? '#2E7D32' : '#E5E7EB',
  });

  const scrollCategoryTabsToIndex = (index: number) => {
    const estimatedTabWidth = 118;
    const targetX = Math.max(0, (index - 1) * estimatedTabWidth);

    requestAnimationFrame(() => {
      categoryTabsRef.current?.scrollTo({
        x: targetX,
        animated: true,
      });
    });
  };

  const openCategoryFromTab = (category: string, index: number) => {
    scrollCategoryTabsToIndex(index);

    setTimeout(() => {
      setSelectedCategory(category);
      setSelectedRawMaterials([]);
      setSelectedPackageForms([]);
      setExpandedFilterSection('sort');
      setCategoryViewOpen(true);
    }, 120);
  };

  // Removed fetchProducts useEffect as we use local DB now

  // Auto-scrolling banner carousel
  useEffect(() => {
    if (banners.length === 0) return;
    
    const { width } = Dimensions.get('window');
    const TOTAL_WIDTH = width;
    
    const interval = setInterval(() => {
      setBannerIndex(prev => {
        const next = prev === banners.length - 1 ? 0 : prev + 1;
        const scrollPosition = next * TOTAL_WIDTH;
        bannerRef.current?.scrollTo({ x: scrollPosition, animated: true });
        return next;
      });
    }, 3000);

    return () => clearInterval(interval);
  }, [banners]);

  // Загрузка отзывов для товара
  const loadReviews = async (productId: number) => {
    setReviewsLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/reviews/${productId}`);
      if (response.ok) {
        const data = await response.json();
        setReviews(data.reviews || []);
        setAverageRating(data.average_rating || 0);
        setTotalReviews(data.total_count || 0);
      }
    } catch (error) {
      console.error('Error loading reviews:', error);
    } finally {
      setReviewsLoading(false);
    }
  };

  // Отправка отзыва
  const submitReview = async () => {
    if (!selectedProduct) return;

    const accessToken = await AsyncStorage.getItem('accessToken');
    let userName = await AsyncStorage.getItem('userName');

    if (!accessToken) {
      Alert.alert('Увага', 'Для написання відгуку потрібно увійти в систему');
      return;
    }

    if (!userName) {
      try {
        const response = await fetch(`${API_URL}/api/user/me`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (response.ok) {
          const userData = await response.json();
          userName = userData.name || 'Користувач';
          if (userName) {
            await AsyncStorage.setItem('userName', userName);
          }
        } else {
          userName = 'Користувач';
        }
      } catch (error) {
        console.error('Error fetching user name:', error);
        userName = 'Користувач';
      }
    }

    if (!reviewComment.trim()) {
      Alert.alert('Увага', 'Будь ласка, напишіть коментар');
      return;
    }

    try {
      const response = await fetch(`${API_URL}/api/reviews`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          product_id: selectedProduct.id,
          user_name: userName || 'Користувач',
          rating: reviewRating,
          comment: reviewComment
        })
      });

      const data = await response.json();

      if (response.ok) {
        Alert.alert('Дякуємо!', data.message || 'Ваш відгук успішно додано');
        setReviewModalVisible(false);
        setReviewComment('');
        setReviewRating(5);
        // Перезагружаем отзывы
        loadReviews(selectedProduct.id);
      } else {
        Alert.alert('Помилка', data.detail || 'Не вдалося додати відгук');
      }
    } catch (error) {
      console.error('Error submitting review:', error);
      Alert.alert('Помилка', 'Не вдалося відправити відгук');
    }
  };



  return (
    <View style={styles.container}>
      <AppHeader showLogo showSearch showFavorites onLogoPress={showHomeScreen} />

      {!categoryViewOpen && (
        <View style={styles.categoriesList}>
          <ScrollView
            ref={categoryTabsRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.categoriesContent}
          >
            <TouchableOpacity
              key="all"
              onPress={() => {
                scrollCategoryTabsToIndex(0);
                setSelectedCategory('');
                setSearchQuery('');
                setSelectedRawMaterials([]);
                setSelectedPackageForms([]);
                setExpandedFilterSection('sort');
                setCategoryViewOpen(true);
              }}
              style={styles.categoryTab}
              activeOpacity={0.8}
            >
              <Text style={[styles.categoryText, styles.categoryTextActive]}>Усі</Text>
              <View style={styles.categoryUnderlineActive} />
            </TouchableOpacity>

            <TouchableOpacity
              key="news"
              onPress={() => {
                scrollCategoryTabsToIndex(1);
                router.push('/news');
              }}
              style={styles.categoryTab}
              activeOpacity={0.8}
            >
              <Text style={styles.categoryText}>Акції</Text>
              <View style={styles.categoryUnderline} />
            </TouchableOpacity>

            {catalogCategories.map((cat, index) => (
              <TouchableOpacity
                key={index}
                onPress={() => openCategoryFromTab(cat, index + 2)}
                style={styles.categoryTab}
                activeOpacity={0.8}
              >
                <Text style={styles.categoryText} numberOfLines={1}>
                  {cat}
                </Text>
                <View style={styles.categoryUnderline} />
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {categoryViewOpen && (
        <View style={{ flex: 1 }}>
          <View style={styles.categoryScreenTitleRow}>
            <TouchableOpacity
              onPress={() => {
                setCategoryViewOpen(false);
                setSelectedCategory('');
              }}
              style={styles.categoryScreenBackButton}
              activeOpacity={0.75}
            >
              <Ionicons name="arrow-back" size={24} color="#111827" />
            </TouchableOpacity>

            <Text style={styles.categoryScreenTitle} numberOfLines={1}>
              {selectedCategory || 'Усі товари'}
            </Text>

            <View style={styles.categoryScreenBackButton} />
          </View>

          {selectedCategoryBanners.length > 0 && (() => {
            const { width } = Dimensions.get('window');
            const slideWidth = width;
            const bannerWidth = width - 16;
            const bannerHeight = Math.round(bannerWidth * 0.48);
            return (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                pagingEnabled
                snapToInterval={slideWidth}
                decelerationRate="fast"
                style={{ marginBottom: 14 }}
              >
                {selectedCategoryBanners.map((banner: any) => {
                  const imageUrl = banner?.image_url || banner?.image;
                  if (!imageUrl) return null;
                  const linkType = String(banner?.link_type || 'none').toLowerCase();
                  const isClickable = linkType !== 'none';
                  return (
                    <View key={banner?.id || imageUrl} style={{ width: slideWidth, paddingHorizontal: 8 }}>
                      <TouchableOpacity
                        activeOpacity={isClickable ? 0.88 : 1}
                        disabled={!isClickable}
                        onPress={() => handleBannerPress(banner)}
                      >
                        <BannerImage
                          uri={getImageUrl(imageUrl, { width: bannerWidth, height: bannerHeight, quality: 80, format: 'jpg' })}
                          width={bannerWidth}
                          height={bannerHeight}
                        />
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </ScrollView>
            );
          })()}

          {isSearchVisible && (
            <View style={{ paddingHorizontal: 4, marginBottom: 12 }}>
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Пошук у категорії"
                placeholderTextColor="#9CA3AF"
                style={{
                  height: 44,
                  borderRadius: 12,
                  backgroundColor: '#FFFFFF',
                  borderWidth: 1,
                  borderColor: '#E5E7EB',
                  paddingHorizontal: 14,
                  color: '#111827',
                  fontSize: 15,
                }}
              />
            </View>
          )}

          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12, paddingHorizontal: 4 }}>
            <Text style={{ flex: 1, color: '#6B7280', fontSize: 13, fontWeight: '700' }} numberOfLines={2}>
              {categoryFilterSummary}
            </Text>
            <TouchableOpacity
              onPress={() => setFilterModalVisible(true)}
              activeOpacity={0.8}
              style={{
                height: 38,
                paddingHorizontal: 13,
                borderRadius: 999,
                backgroundColor: activeFilterCount > 0 ? '#E8F5E9' : '#FFFFFF',
                borderWidth: 1,
                borderColor: activeFilterCount > 0 ? '#2E7D32' : '#E5E7EB',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <Ionicons name="options-outline" size={18} color={activeFilterCount > 0 ? '#2E7D32' : '#111827'} />
              <Text style={{ color: activeFilterCount > 0 ? '#2E7D32' : '#111827', fontSize: 14, fontWeight: '900' }}>
                Фільтр{activeFilterCount > 0 ? ` ${activeFilterCount}` : ''}
              </Text>
            </TouchableOpacity>
          </View>

          <FlatList
            data={filteredProducts}
            renderItem={renderProductItem}
            keyExtractor={item => item?.id?.toString() || Math.random().toString()}
            numColumns={2}
            columnWrapperStyle={{ justifyContent: 'space-between', gap: 0 }}
            contentContainerStyle={{ paddingBottom: 110, paddingHorizontal: 0 }}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={styles.emptyStateContainer}>
                <Text style={styles.emptyStateText}>∅</Text>
                <Text style={styles.emptyStateMessage}>Товарів за цими фільтрами не знайдено</Text>
              </View>
            }
          />
        </View>
      )}

      {!categoryViewOpen && (
        <ScrollView
          ref={scrollViewRef}
          showsVerticalScrollIndicator={false}
          style={{ flex: 1, width: '100%', backgroundColor: '#f5f5f5' }}
          contentContainerStyle={{ paddingBottom: 120, backgroundColor: '#f5f5f5' }}
        >
      {/* BANNERS */}
      {banners.length > 0 && (() => {
        const { width } = Dimensions.get('window');
        const SLIDE_WIDTH = width;
        const BANNER_WIDTH = width - 16;
        const BANNER_HEIGHT = Math.round(BANNER_WIDTH * 0.52);

        return (
          <ScrollView
            ref={bannerRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            pagingEnabled={true}
            style={{ marginBottom: 20 }}
            snapToInterval={SLIDE_WIDTH}
            decelerationRate="fast"
          >
            {banners.map((b) => {
              const imageUrl = b.image_url || b.image || b.picture;
              if (!imageUrl) {
                return null;
              }

              const fullImageUrl = getImageUrl(imageUrl, {
                width: BANNER_WIDTH,
                height: BANNER_HEIGHT,
                quality: 80,
                format: 'jpg'
              });

              return (
                <View
                  key={b?.id || Math.random()}
                  style={{
                    width: SLIDE_WIDTH,
                    paddingHorizontal: 8
                  }}
                >
                  <TouchableOpacity
                    activeOpacity={b?.link_type && b.link_type !== 'none' ? 0.88 : 1}
                    disabled={!b?.link_type || b.link_type === 'none'}
                    onPress={() => handleBannerPress(b)}
                  >
                    <BannerImage
                      uri={fullImageUrl}
                      width={BANNER_WIDTH}
                      height={BANNER_HEIGHT}
                    />
                  </TouchableOpacity>
                </View>
              );
            })}
          </ScrollView>
        );
      })()}

      {recentProducts.length > 0 && (
        <View style={{ marginBottom: 22 }}>
          <Text style={{ fontSize: 22, fontWeight: '900', color: '#111827', marginBottom: 12, textAlign: 'center' }}>
            Останні переглянуті
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: 0 }}>
            {recentProducts.map((item) => {
              const imageUrl = getImageUrl(item.image || item.picture || item.image_url || '');
              return (
                <TouchableOpacity
                  key={item.id}
                  activeOpacity={0.85}
                  onPress={() => openProductWithRecent(item)}
                  style={{
                    width: 86,
                    height: 86,
                    borderRadius: 14,
                    backgroundColor: '#F3F4F6',
                    marginRight: 0,
                    overflow: 'hidden',
                    borderWidth: 1,
                    borderColor: '#EEF0F2'
                  }}
                >
                  <Image
                    source={{ uri: imageUrl }}
                    style={{ width: '100%', height: '100%' }}
                    resizeMode="cover"
                  />
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      <HomeProductCarousel
        title={'\u0425\u0456\u0442\u0438 \u043f\u0440\u043e\u0434\u0430\u0436\u0456\u0432'}
        products={hitProducts}
        favorites={favorites}
        onOpenProduct={(item) => openProductWithRecent(item as Product)}
        onAddToCart={(item) => {
          Vibration.vibrate(10);
          const picked = _pickDefaultVariant(item);
          addItem(item, 1, picked.packSize, item.unit || 'шт', picked.price);
          showToast('Товар додано в кошик');
        }}
        onToggleFavorite={(item) => {
          Vibration.vibrate(10);
          const isFav = favorites.some(fav => fav.id === item.id);
          toggleFavorite({
            id: item.id,
            name: item.name || '',
            price: item.price || 0,
            image: item.image || item.picture || item.image_url || '',
            category: item.category,
            old_price: item.old_price,
            badge: item.badge,
            unit: item.unit
          });
          showToast(isFav ? 'Видалено з обраного' : 'Додано в обране');
        }}
      />

      <HomeProductCarousel
        title={'Товари зі знижкою'}
        products={promoProducts}
        favorites={favorites}
        onOpenProduct={(item) => openProductWithRecent(item as Product)}
        onAddToCart={(item) => {
          Vibration.vibrate(10);
          const picked = _pickDefaultVariant(item);
          addItem(item, 1, picked.packSize, item.unit || 'шт', picked.price);
          showToast('Товар додано в кошик');
        }}
        onToggleFavorite={(item) => {
          Vibration.vibrate(10);
          const isFav = favorites.some(fav => fav.id === item.id);
          toggleFavorite({
            id: item.id,
            name: item.name || '',
            price: item.price || 0,
            image: item.image || item.picture || item.image_url || '',
            category: item.category,
            old_price: item.old_price,
            badge: item.badge,
            unit: item.unit
          });
          showToast(isFav ? 'Видалено з обраного' : 'Додано в обране');
        }}
      />

      <HomeProductCarousel
        title={'Новинки'}
        products={newProducts}
        favorites={favorites}
        onOpenProduct={(item) => openProductWithRecent(item as Product)}
        onAddToCart={(item) => {
          Vibration.vibrate(10);
          const picked = _pickDefaultVariant(item);
          addItem(item, 1, picked.packSize, item.unit || 'шт', picked.price);
          showToast('Товар додано в кошик');
        }}
        onToggleFavorite={(item) => {
          Vibration.vibrate(10);
          const isFav = favorites.some(fav => fav.id === item.id);
          toggleFavorite({
            id: item.id,
            name: item.name || '',
            price: item.price || 0,
            image: item.image || item.picture || item.image_url || '',
            category: item.category,
            old_price: item.old_price,
            badge: item.badge,
            unit: item.unit
          });
          showToast(isFav ? 'Видалено з обраного' : 'Додано в обране');
        }}
      />

        </ScrollView>
      )}
      <Modal
        animationType="slide"
        transparent
        visible={filterModalVisible && categoryViewOpen}
        onRequestClose={() => setFilterModalVisible(false)}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(17, 24, 39, 0.45)', justifyContent: 'flex-end' }}>
          <TouchableOpacity
            activeOpacity={1}
            onPress={() => setFilterModalVisible(false)}
            style={{ flex: 1 }}
          />
          <View style={{
            backgroundColor: '#FFFFFF',
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
            paddingHorizontal: 20,
            paddingTop: 16,
            paddingBottom: 28,
            maxHeight: '86%',
            position: 'relative',
          }}>
            <View style={{ alignItems: 'center', marginBottom: 14 }}>
              <View style={{ width: 42, height: 4, borderRadius: 999, backgroundColor: '#D1D5DB' }} />
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
              <Text style={{ fontSize: 22, fontWeight: '900', color: '#111827' }}>Фільтр</Text>
              <TouchableOpacity onPress={() => setFilterModalVisible(false)} style={{ padding: 6 }}>
                <Ionicons name="close" size={24} color="#111827" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 140 }}>
              {renderFilterSectionHeader('sort', 'Сортування', activeSortLabel)}
              {expandedFilterSection === 'sort' && (
                <View style={{ gap: 8, marginBottom: 14 }}>
                  {CATEGORY_SORT_OPTIONS.map((option) => {
                    const active = sortType === option.key;
                    return (
                      <TouchableOpacity
                        key={option.key}
                        onPress={() => setSortType(option.key)}
                        style={{
                          minHeight: 44,
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          borderRadius: 12,
                          paddingHorizontal: 12,
                          backgroundColor: active ? '#E8F5E9' : '#FFFFFF',
                          borderWidth: 1,
                          borderColor: active ? '#2E7D32' : '#E5E7EB',
                        }}
                      >
                        <Text style={{ color: '#111827', fontSize: 15, fontWeight: active ? '900' : '700' }}>
                          {option.label}
                        </Text>
                        <Ionicons name={active ? 'radio-button-on' : 'radio-button-off'} size={20} color={active ? '#2E7D32' : '#9CA3AF'} />
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              {renderFilterSectionHeader('price', 'Ціна', priceFrom || priceTo ? `${priceFrom || '0'} – ${priceTo || '∞'} ₴` : 'Будь-яка')}
              {expandedFilterSection === 'price' && (
                <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
                  <TextInput
                    value={priceFrom}
                    onChangeText={setPriceFrom}
                    placeholder="Від"
                    placeholderTextColor="#9CA3AF"
                    keyboardType="numeric"
                    style={{
                      flex: 1,
                      height: 46,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: '#E5E7EB',
                      backgroundColor: '#FFFFFF',
                      paddingHorizontal: 12,
                      color: '#111827',
                      fontSize: 15,
                      fontWeight: '700',
                    }}
                  />
                  <TextInput
                    value={priceTo}
                    onChangeText={setPriceTo}
                    placeholder="До"
                    placeholderTextColor="#9CA3AF"
                    keyboardType="numeric"
                    style={{
                      flex: 1,
                      height: 46,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: '#E5E7EB',
                      backgroundColor: '#FFFFFF',
                      paddingHorizontal: 12,
                      color: '#111827',
                      fontSize: 15,
                      fontWeight: '700',
                    }}
                  />
                </View>
              )}

              {rawMaterialFilterOptions.length > 0 && (
                <>
                  {renderFilterSectionHeader('raw', 'Сировина', selectedRawMaterials.length ? selectedRawMaterials.join(', ') : `${rawMaterialFilterOptions.length} варіантів`)}
                  {expandedFilterSection === 'raw' && (
                    <View style={{ maxHeight: 230, marginBottom: 14, borderRadius: 14, borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#FFFFFF', padding: 10 }}>
                      <ScrollView nestedScrollEnabled showsVerticalScrollIndicator>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                          {rawMaterialFilterOptions.map((option) => {
                            const active = selectedRawMaterials.includes(option);
                            return (
                              <TouchableOpacity
                                key={option}
                                onPress={() => toggleFilterValue(option, setSelectedRawMaterials)}
                                activeOpacity={0.8}
                                style={filterOptionChipStyle(active)}
                              >
                                <Text style={{ color: active ? '#2E7D32' : '#111827', fontSize: 14, fontWeight: '800' }}>
                                  {option}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      </ScrollView>
                    </View>
                  )}
                </>
              )}

              {packageFormFilterOptions.length > 0 && (
                <>
                  {renderFilterSectionHeader('form', 'Форма упаковки', selectedPackageForms.length ? selectedPackageForms.join(', ') : `${packageFormFilterOptions.length} варіантів`)}
                  {expandedFilterSection === 'form' && (
                    <View style={{ maxHeight: 230, marginBottom: 14, borderRadius: 14, borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#FFFFFF', padding: 10 }}>
                      <ScrollView nestedScrollEnabled showsVerticalScrollIndicator>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                          {packageFormFilterOptions.map((option) => {
                            const active = selectedPackageForms.includes(option);
                            return (
                              <TouchableOpacity
                                key={option}
                                onPress={() => toggleFilterValue(option, setSelectedPackageForms)}
                                activeOpacity={0.8}
                                style={filterOptionChipStyle(active)}
                              >
                                <Text style={{ color: active ? '#2E7D32' : '#111827', fontSize: 14, fontWeight: '800' }}>
                                  {option}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      </ScrollView>
                    </View>
                  )}
                </>
              )}

              {renderFilterSectionHeader('offers', 'Наявність та пропозиції', [onlyAvailable ? 'В наявності' : null, onlyPromo ? 'Акційні' : null].filter(Boolean).join(', ') || 'Без обмежень')}
              {expandedFilterSection === 'offers' && (
                <View style={{ gap: 8, marginBottom: 14, borderRadius: 14, borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#FFFFFF', padding: 12 }}>
                  <TouchableOpacity
                    onPress={() => setOnlyAvailable(prev => !prev)}
                    style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10 }}
                  >
                    <Ionicons name={onlyAvailable ? 'checkbox-outline' : 'square-outline'} size={23} color={onlyAvailable ? '#2E7D32' : '#6B7280'} />
                    <Text style={{ color: '#111827', fontSize: 15, fontWeight: '800' }}>Тільки в наявності</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setOnlyPromo(prev => !prev)}
                    style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10 }}
                  >
                    <Ionicons name={onlyPromo ? 'checkbox-outline' : 'square-outline'} size={23} color={onlyPromo ? '#2E7D32' : '#6B7280'} />
                    <Text style={{ color: '#111827', fontSize: 15, fontWeight: '800' }}>Тільки акційні</Text>
                  </TouchableOpacity>
                </View>
              )}
            </ScrollView>

            <View style={{ position: 'absolute', left: 20, right: 20, bottom: 82, flexDirection: 'row', gap: 10, paddingTop: 8 }}>
              <TouchableOpacity
                onPress={() => {
                  setSortType('popular');
                  setPriceFrom('');
                  setPriceTo('');
                  setOnlyAvailable(false);
                  setOnlyPromo(false);
                  setSelectedRawMaterials([]);
                  setSelectedPackageForms([]);
                }}
                style={{
                  flex: 0.85,
                  height: 50,
                  borderRadius: 14,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 1,
                  borderColor: '#D1D5DB',
                  backgroundColor: '#FFFFFF',
                }}
              >
                <Text style={{ color: '#111827', fontSize: 15, fontWeight: '900' }}>Скинути</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setFilterModalVisible(false)}
                style={{
                  flex: 1.15,
                  height: 50,
                  borderRadius: 14,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: '#2E7D32',
                }}
              >
                <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '900' }}>Показати {filteredProducts.length}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      {/* SUCCESS ORDER MODAL */}
      <Modal animationType="fade" transparent={true} visible={successVisible}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ backgroundColor: 'white', width: '80%', padding: 30, borderRadius: 25, alignItems: 'center', shadowColor: "#000", shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.25, shadowRadius: 3.84, elevation: 5 }}>

            <View style={{ width: 80, height: 80, backgroundColor: '#e8f5e9', borderRadius: 40, alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
              <Ionicons name="checkmark-circle" size={50} color="#4CAF50" />
            </View>

            <Text style={{ fontSize: 24, fontWeight: 'bold', marginBottom: 10, textAlign: 'center' }}>Замовлення прийнято! 🎉</Text>
            <Text style={{ color: '#666', textAlign: 'center', marginBottom: 25, lineHeight: 22 }}>
              Дякуємо за довіру.{'\n'}Менеджер зв’яжеться з вами найближчим часом для підтвердження.
            </Text>

            <TouchableOpacity 
              onPress={() => {
                setSuccessVisible(false);
                setTimeout(() => {
                  router.push('/(tabs)/profile');
                }, 300);
              }}
              style={{ backgroundColor: '#2E7D32', paddingVertical: 15, paddingHorizontal: 40, borderRadius: 15, width: '100%' }}
            >
              <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 16, textAlign: 'center' }}>Чудово</Text>
            </TouchableOpacity>

          </View>
        </View>
      </Modal>
      {/* AI CHAT MODAL */}
      <Modal animationType="slide" visible={aiVisible} presentationStyle="pageSheet">
        <SafeAreaView style={{ flex: 1, backgroundColor: '#f2f2f2' }}>
          <KeyboardAvoidingView 
            style={{ flex: 1 }} 
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
          >
            {/* Header */}
            <View style={{ 
              padding: 15, 
              backgroundColor: 'white', 
              borderBottomWidth: 1, 
              borderColor: '#e0e0e0',
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                <View style={{ 
                  width: 45, 
                  height: 45, 
                  backgroundColor: '#E8F5E9', 
                  borderRadius: 22.5, 
                  alignItems: 'center', 
                  justifyContent: 'center', 
                  marginRight: 12 
                }}>
                  <Ionicons name="chatbubble-ellipses" size={24} color="#2E7D32" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: 'bold', fontSize: 17, color: '#000' }}>Експерт природи 🌿</Text>
                  <Text style={{ color: '#4CAF50', fontSize: 13, marginTop: 2 }}>Online • Готовий допомогти</Text>
                </View>
              </View>
              <TouchableOpacity 
                onPress={() => setAiVisible(false)}
                style={{ padding: 8, borderRadius: 8 }}
              >
                <Ionicons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>

            {/* Сообщения */}
            <FlatList
              ref={chatFlatListRef}
              data={messages}
              renderItem={({ item }) => {
                const isUser = item.sender === 'user';
                return (
                  <View style={{ alignItems: isUser ? 'flex-end' : 'flex-start', marginBottom: 15 }}>
                    {/* Текст сообщения */}
                    <View style={[
                      {
                        padding: 12,
                        borderRadius: 18,
                        maxWidth: '80%',
                      },
                      isUser ? {
                        backgroundColor: '#2E7D32',
                        borderBottomRightRadius: 4,
                      } : {
                        backgroundColor: '#fff',
                        borderBottomLeftRadius: 4,
                        borderWidth: 1,
                        borderColor: '#e5e5e5',
                      }
                    ]}>
                      <Text style={{ 
                        color: isUser ? '#fff' : '#333', 
                        fontSize: 16 
                      }}>
                        {item.text}
                      </Text>
                    </View>

                    {/* Карточки товаров (только у бота) */}
                    {!isUser && (item as any).products && Array.isArray((item as any).products) && (item as any).products.length > 0 && (
                      <View style={{ marginTop: 8, width: '85%' }}>
                        {((item as any).products as any[]).map((prod: any) => (
                          <TouchableOpacity 
                            key={prod?.id || Math.random()} 
                            style={{
                              flexDirection: 'row',
                              backgroundColor: '#fff',
                              padding: 10,
                              borderRadius: 12,
                              marginBottom: 8,
                              borderWidth: 1,
                              borderColor: '#eee',
                              alignItems: 'center',
                              shadowColor: '#000',
                              shadowOpacity: 0.05,
                              shadowRadius: 5,
                              elevation: 2,
                            }}
                            activeOpacity={0.7}
                            onPress={() => {
                              setAiVisible(false);
                              setTimeout(() => {
                                router.push(`/product/${prod?.id}`);
                              }, 300);
                            }}
                          >
                            <Image 
                              source={{ uri: getImageUrl(prod.image || prod.image_url || prod.picture) }} 
                              style={{
                                width: 50,
                                height: 50,
                                borderRadius: 8,
                                marginRight: 0,
                                backgroundColor: '#f0f0f0',
                              }}
                              resizeMode="cover"
                            />
                            <View style={{ flex: 1, justifyContent: 'center' }}>
                              <Text style={{
                                fontWeight: '600',
                                fontSize: 14,
                                color: '#000',
                                marginBottom: 4,
                              }} numberOfLines={1}>
                                {prod.name}
                              </Text>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                {prod.old_price && prod.old_price > prod.price && (
                                  <Text style={{
                                    textDecorationLine: 'line-through',
                                    color: '#999',
                                    fontSize: 12
                                  }}>
                                    {formatPrice(prod.old_price)}
                                  </Text>
                                )}
                                <Text style={{
                                  color: '#2ecc71',
                                  fontWeight: 'bold',
                                  fontSize: 14,
                                }}>
                                  {formatPrice(prod.price)}
                                </Text>
                              </View>
                            </View>
                            <Ionicons name="chevron-forward" size={20} color="#ccc" />
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </View>
                );
              }}
              keyExtractor={item => `msg-${item?.id || Math.random()}`}
              contentContainerStyle={{ padding: 15, paddingBottom: 20 }}
              style={{ flex: 1 }}
              onContentSizeChange={() => {
                setTimeout(() => {
                  chatFlatListRef.current?.scrollToEnd({ animated: true });
                }, 100);
              }}
              ListFooterComponent={
                isLoading ? (
                  <View style={{ 
                    flexDirection: 'row', 
                    alignItems: 'center', 
                    paddingVertical: 12,
                    alignSelf: 'flex-start'
                  }}>
                    <ActivityIndicator size="small" color="#999" style={{ marginRight: 10 }} />
                    <Text style={{ color: '#999', fontSize: 14 }}>Бот печатає...</Text>
                  </View>
                ) : null
              }
            />

            {/* Зона ввода */}
            <View style={{
              flexDirection: 'row',
              padding: 10,
              paddingHorizontal: 15,
              backgroundColor: '#fff',
              borderTopWidth: 1,
              borderColor: '#eee',
              alignItems: 'center',
            }}>
              <TextInput
                style={{
                  flex: 1,
                  backgroundColor: '#f5f5f5',
                  borderRadius: 25,
                  paddingHorizontal: 15,
                  paddingVertical: 10,
                  fontSize: 16,
                  marginRight: 0,
                  height: 45,
                }}
                value={inputMessage}
                onChangeText={setInputMessage}
                placeholder="Запитайте про товар..."
                placeholderTextColor="#888"
                onSubmitEditing={sendMessage}
                editable={!isLoading}
                multiline={false}
              />
              <TouchableOpacity 
                style={{
                  width: 45,
                  height: 45,
                  borderRadius: 25,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: (isLoading || !inputMessage.trim()) ? '#b0b0b0' : '#000'
                }} 
                onPress={sendMessage}
                disabled={isLoading || !inputMessage.trim()}
              >
                {isLoading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Ionicons name="arrow-up" size={24} color="#fff" />
                )}
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
      {/* ELEGANT TOP TOAST */}
      {toastVisible && (
        <Animated.View
          style={{
            position: 'absolute',
            top: 60,
            alignSelf: 'center',
            backgroundColor: 'rgba(30, 30, 30, 0.85)',
            paddingHorizontal: 24,
            paddingVertical: 12,
            borderRadius: 50,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 5 },
            shadowOpacity: 0.15,
            shadowRadius: 10,
            elevation: 5,
            zIndex: 10000,
            opacity: fadeAnim,
            transform: [{
              translateY: fadeAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [-20, 0]
              })
            }]
          }}
        >
          <Ionicons 
            name={toastMessage.includes('Видалено') ? "trash-outline" : "checkmark-circle"} 
            size={20} 
            color="white" 
            style={{ marginRight: 10 }}
          />
          <Text style={{ color: 'white', fontWeight: '600', fontSize: 14, letterSpacing: 0.5 }}>
            {toastMessage}
          </Text>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  headerLogo: {
    width: 150,
    height: 45,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 50,
    paddingBottom: 20,
    width: '100%',
    maxWidth: '100%',
  },
  headerIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexShrink: 0,
  },
  categoriesList: {
    paddingHorizontal: 0,
    marginBottom: 14,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  categoriesContent: {
    paddingHorizontal: 18,
    alignItems: 'center',
  },
  categoryTab: {
    paddingTop: 12,
    paddingBottom: 0,
    marginRight: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryText: {
    fontSize: 17,
    fontWeight: '800',
    color: '#1F2937',
  },
  categoryTextActive: {
    color: '#2E7D32',
    fontWeight: '900',
  },
  categoryUnderline: {
    height: 3,
    minWidth: 26,
    marginTop: 9,
    borderRadius: 2,
    backgroundColor: 'transparent',
  },
  categoryUnderlineActive: {
    height: 3,
    minWidth: 34,
    marginTop: 9,
    borderRadius: 2,
    backgroundColor: '#2E7D32',
  },
  categoryScreenTitleRow: {
    height: 58,
    paddingHorizontal: 14,
    backgroundColor: '#F8FAF8',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryScreenBackButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryScreenTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 22,
    fontWeight: '900',
    color: '#111827',
  },
  emptyStateContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 100,
  },
  emptyStateText: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyStateMessage: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
  },
});
