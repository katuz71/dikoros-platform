import { FloatingChatButton } from '@/components/FloatingChatButton';
import { API_URL } from '@/config/api';
import { useCart } from '@/context/CartContext';
import { useOrders } from '@/context/OrdersContext';
import { getImageUrl } from '@/utils/image';
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Animated, Dimensions, FlatList, Image, KeyboardAvoidingView, Modal, Platform, RefreshControl, SafeAreaView, ScrollView, Share, StyleSheet, Text, TextInput, TouchableOpacity, Vibration, View } from "react-native";
import ProductCard from '../../components/ProductCard';
import { AnalyticsService } from '../../services/analytics';
import { getCategories, getProducts, initDatabase } from '../../services/database';
import { useFavoritesStore } from '../../store/favoritesStore';
import { getConnectionErrorMessage } from '../../utils/serverCheck';

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
  quantity?: number;
  composition?: string; // Changed from ingredients to match OrdersContext
  usage?: string;
  weight?: string;
  pack_sizes?: string[] | string;  // Changed to array to match backend, but might be string from DB
  old_price?: number;  // For discount logic
  unit?: string;  // Measurement unit (e.g., "шт", "г", "мл")
  variants?: Variant[] | any[];  // Variants with different prices or JSON string from DB
  variationGroups?: any[]; // For multi-dimensional variations
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
        borderRadius: 15,
        marginRight: 10,
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
        borderTopLeftRadius: 0,
        borderTopRightRadius: 15,
        borderBottomLeftRadius: 0,
        borderBottomRightRadius: 15,
        marginRight: 10,
        backgroundColor: '#f5f5f5'
      }} 
      resizeMode="cover"
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

export default function Index() {
  const router = useRouter();
  const params = useLocalSearchParams();
  // Get cart context
  const { addItem, items: cartItems, removeItem, clearCart, totalPrice, updateQuantity, addOne, removeOne } = useCart();
  // Get favorites store
  const { favorites, toggleFavorite } = useFavoritesStore();

  // Get products from OrdersContext (fetched from server) - kept for compatibility if needed
  const { products: fetchedProducts, isLoading: productsLoading, fetchProducts, orders, removeOrder, clearOrders } = useOrders();
  
  // Local products state
  const [products, setProducts] = useState<Product[]>([]);
  const [isLocalLoading, setIsLocalLoading] = useState(true);

  // Placeholder for useEffect removal

  // Функция форматирования цены
  const formatPrice = (price: number) => {
    const safePrice = price || 0;
    return `${safePrice.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ")} ₴`;
  };

  // Используем cartItems из контекста вместо локального cart
  const cart = cartItems; // Алиас для совместимости со старым кодом
  const [modalVisible, setModalVisible] = useState(false);
  const [successModalVisible, setSuccessModalVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedCategory, setSelectedCategory] = useState("Всі");
  const [sortType, setSortType] = useState<'popular' | 'asc' | 'desc'>('popular');
  const [successVisible, setSuccessVisible] = useState(false);
  const [currentBannerIndex, setCurrentBannerIndex] = useState(0);
  const [bannerIndex, setBannerIndex] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [promoCode, setPromoCode] = useState('');
  const [discount, setDiscount] = useState(0);
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [categories, setCategories] = useState(['Всі']);
  const [banners, setBanners] = useState<any[]>([]);

  const [connectionError, setConnectionError] = useState(false);
  const [quantity, setQuantity] = useState(1);

  // --- ADVANCED VARIATION LOGIC ---
  const [variationGroups, setVariationGroups] = useState<any[]>([]);
  const [selectedVariations, setSelectedVariations] = useState<{[key: string]: string}>({});
  const [currentPrice, setCurrentPrice] = useState(0);
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [tab, setTab] = useState<'desc' | 'ingr' | 'use'>('desc');
  const [selectedVariant, setSelectedVariant] = useState<any>(null);

  // Helper to parse variations when product opens
  useEffect(() => {
    if (!selectedProduct) return;

    // Завантажуємо відгуки для товару
    loadReviews(selectedProduct.id);
    
    // NEW LOGIC: Use pre-calculated groups from Database Service
    if (selectedProduct.variationGroups && Array.isArray(selectedProduct.variationGroups) && selectedProduct.variationGroups.length > 0) {
        
        setVariationGroups(selectedProduct.variationGroups);
        
        // set initial selections (first option of each group)
        const initialSelections: any = {};
        selectedProduct.variationGroups.forEach((group: any) => {
             if (group.options && group.options.length > 0) {
                 initialSelections[group.id] = group.options[0]; // Select first available
             }
        });
        
        setSelectedVariations(initialSelections);
        
        // Find initial matching variant to set price
        const matchingVariant = findBestVariant(selectedProduct.variants as any[], initialSelections);
        if (matchingVariant) {
            setSelectedVariant(matchingVariant);
            setCurrentPrice(matchingVariant.price);
        } else {
            setSelectedVariant(null);
            setCurrentPrice(selectedProduct.price);
        }
        return;
    }

    // Fallback for simple products (no groups found) or simple variants
    if (selectedProduct.variants && selectedProduct.variants.length > 0) {
        // Flat variants list logic
         const uniqueOptions = [...new Set(selectedProduct.variants.map((v:any) => v.label || v.size))];
         const newGroups = [{
             id: 'variant_selection',
             title: 'Варіант',
             options: uniqueOptions
         }];
         setVariationGroups(newGroups);
         const firstOption = uniqueOptions[0] as string;
         setSelectedVariations({ 'variant_selection': firstOption });
         const v = (selectedProduct.variants as any[]).find((v:any) => (v.label || v.size) === firstOption);
         setSelectedVariant(v || null);
         setCurrentPrice(v ? v.price : selectedProduct.price);
         return;
    }

    setVariationGroups([]);
    setSelectedVariant(null);
    setCurrentPrice(selectedProduct.price);

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
      // Створюємо тестову комбінацію з новою опцією
      const testSelections = { ...currentSelections, [groupId]: optionValue };
      
      // Перевіряємо чи є хоча б один варіант який відповідає цій комбінації
      const hasMatch = variants.some((v: any) => {
          return Object.keys(testSelections).every(key => {
              const selectedVal = testSelections[key];
              const variantVal = v.attrs ? v.attrs[key] : null;
              
              if (key === 'variant_selection') return (v.label || v.size) === selectedVal;
              
              const normalizedSelected = String(selectedVal || '').toLowerCase().trim();
              const normalizedVariant = String(variantVal || '').toLowerCase().trim();
              
              return normalizedVariant === normalizedSelected;
          });
      });
      
      return hasMatch;
  };

  // Helper to find best matching variant
  const findBestVariant = (variants: any[], selections: any) => {
      if (!variants) return null;
      
      console.log('🔍 findBestVariant - selections:', selections);
      console.log('🔍 findBestVariant - variants count:', variants.length);
      
      // Логируем все варианты для диагностики
      console.log('📋 All variants attrs:', variants.map(v => ({ id: v.id, attrs: v.attrs, price: v.price })));
      
      const found = variants.find((v: any) => {
          // Check if all selected attributes match this variant's attributes
          // We iterate over keys in 'selections' (e.g. { year: '2025', weight: '100g' })
          const matches = Object.keys(selections).every(key => {
              // The variant attributes are in v.attrs (e.g. v.attrs.year)
              // We need to match loose equality or exact string
              const selectedVal = selections[key];
              const variantVal = v.attrs ? v.attrs[key] : null;
              
              // Special case: 'variant_selection' is a dummy key for flat lists
              if (key === 'variant_selection') return (v.label || v.size) === selectedVal;
              
              // Нормализуем для сравнения (регистр и пробелы)
              const normalizedSelected = String(selectedVal || '').toLowerCase().trim();
              const normalizedVariant = String(variantVal || '').toLowerCase().trim();
              
              const isMatch = normalizedVariant === normalizedSelected;
              
              if (!isMatch) {
                  console.log(`❌ Mismatch on ${key}: variant ID ${v.id} - "${normalizedVariant}" !== "${normalizedSelected}"`);
              }
              
              return isMatch;
          });
          
          if (matches) {
              console.log('✅ Found matching variant:', v.id, v.attrs, 'Price:', v.price);
          }
          
          return matches;
      });
      
      if (!found) {
          console.log('⚠️ No exact variant found for selections:', selections);
          
          // Пріоритетний пошук: сорт + вага (форма може відрізнятися)
          const priorityMatch = variants.find((v: any) => {
              const sortMatch = !selections.sort || 
                  String(v.attrs?.sort || '').toLowerCase().trim() === String(selections.sort || '').toLowerCase().trim();
              const sizeMatch = !selections.size || 
                  String(v.attrs?.size || '').toLowerCase().trim() === String(selections.size || '').toLowerCase().trim();
              
              return sortMatch && sizeMatch;
          });
          
          if (priorityMatch) {
              console.log('✅ Found priority match (sort+size):', priorityMatch.id, priorityMatch.attrs, 'Price:', priorityMatch.price);
              return priorityMatch;
          }
          
          // Якщо не знайдено - шукаємо хоча б по сорту
          const sortMatch = variants.find((v: any) => {
              return selections.sort && 
                  String(v.attrs?.sort || '').toLowerCase().trim() === String(selections.sort || '').toLowerCase().trim();
          });
          
          if (sortMatch) {
              console.log('✅ Found sort match:', sortMatch.id, sortMatch.attrs, 'Price:', sortMatch.price);
              return sortMatch;
          }
          
          // Останній fallback - будь-який варіант з хоча б одним співпадінням
          const partialMatch = variants.find((v: any) => {
              let matchCount = 0;
              Object.keys(selections).forEach(key => {
                  const selectedVal = selections[key];
                  const variantVal = v.attrs ? v.attrs[key] : null;
                  
                  const normalizedSelected = String(selectedVal || '').toLowerCase().trim();
                  const normalizedVariant = String(variantVal || '').toLowerCase().trim();
                  
                  if (normalizedVariant === normalizedSelected) {
                      matchCount++;
                  }
              });
              return matchCount > 0;
          });
          
          if (partialMatch) {
              console.log('✅ Found partial match:', partialMatch.id, partialMatch.attrs, 'Price:', partialMatch.price);
              return partialMatch;
          }
          
          console.log('Available variants:', variants.map(v => ({ id: v.id, attrs: v.attrs, price: v.price })));
      }
      
      return found;
  };

  // Update selection handler
  const handleVariationSelect = (groupId: string, value: string) => {
      const newSelections = { ...selectedVariations, [groupId]: value };
      setSelectedVariations(newSelections);

      // Find variant for NEW selections
      const matchingVariant = findBestVariant(selectedProduct?.variants as any[], newSelections);
      
      if (matchingVariant) {
          console.log("✅ Found variant:", matchingVariant.id, matchingVariant.price);
          setSelectedVariant(matchingVariant);
          setCurrentPrice(matchingVariant.price);
          // Optional: Update displayed image if variant has one
          // if (matchingVariant.image) ... 
      } else {
          console.log("⚠️ No exact variant found for combination");
          setSelectedVariant(null);
          // Optional: Deselect other incompatible options? 
          // For now, keep price of 'closest' or base
      }
  };
  
  // Render Product Item
  const renderProductItem = ({ item }: { item: Product }) => {
    const isFavorite = favorites.some(fav => fav.id === item?.id);
    // Display "from X UAH" if multiple variants exist
    const displayPrice = item.variants && item.variants.length > 1 && item.minPrice
        ? `від ${formatPrice(item.minPrice)}`
        : formatPrice(item.price);
        
    return (
      <ProductCard
        item={item} // Pass item as is
        displayPrice={displayPrice} // Pass custom price string
        onPress={() => {
          setSelectedProduct(item);
          setModalVisible(true);
          // Analytics if needed
          try { AnalyticsService.logProductView(item); } catch (e) {}
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
               unit: item.unit
           });
           showToast(isFavorite ? 'Видалено з обраного' : 'Додано в обране ❤️');
        }}
        onCartPress={() => {
           // ... cart logic ...
           Vibration.vibrate(10);
           addItem(item, 1, item.unit || 'шт');
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
          // Ограничиваем количество баннеров для экономии памяти и кэша
          const limitedBanners = bannersArray.slice(0, 3);
          
          // STEP 3: Обновляем состояние свежими данными
          setBanners(limitedBanners);
          
          // STEP 4: Сохраняем в кэш для следующего раза с оптимизацией
          try {
            // Создаем оптимизированную версию для кэша (только необходимые поля)
            const optimizedBanners = limitedBanners.map(banner => ({
              id: banner.id,
              image_url: banner.image_url || banner.image || banner.picture,
              title: banner.title || '',
              link: banner.link || ''
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

  // Загрузка данных
  const forceReloadDB = async () => {
    try {
      Alert.alert(
        'Перезагрузить БД?',
        'Это удалит старую БД и загрузит новую из assets',
        [
          { text: 'Отмена', style: 'cancel' },
          {
            text: 'Да',
            onPress: async () => {
              await initDatabase();
              await fetchData();
            }
          }
        ]
      );
    } catch (error) {
      console.error('🔥 Force reload error:', error);
      Alert.alert('Ошибка', 'Не удалось перезагрузить БД');
    }
  };

  const fetchData = async () => {
    try {
      console.log('🚀 fetchData started');
      // 1. Инициализация БД
      await initDatabase();

      // 2. Получаем категории из БД
      const cats = await getCategories(undefined); 
      setCategories(cats);

      // 3. Получаем товары из БД (по умолчанию "Всі")
      const items = await getProducts('Всі', undefined);
      // @ts-ignore
      setProducts(items);
      setIsLocalLoading(false);

      // 4. Temporarily skip server check - use local DB only
      // checkServerHealth().then(available => {
      //   if (!available) {
      //       console.log("⚠️ Server offline, using only local DB");
      //       setConnectionError(true); 
        //   } else {
      //       setConnectionError(false);
      //       loadBanners();
      //   }
      // });

    } catch (e: any) {
      console.error("🔥 Error initializing app:", e);
      setIsLocalLoading(false);
    }
  };

  useEffect(() => {
    console.log('🎬 useEffect triggered - calling fetchData');
    console.log('📍 Component mounted - NEW CODE VERSION 2.0');
    fetchData().catch(err => {
      console.error('❌ fetchData failed:', err);
    });
  }, []);

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
  const [isLoading, setIsLoading] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scrollViewRef = useRef<ScrollView>(null);
  const flatListRef = useRef<FlatList>(null);
  const chatFlatListRef = useRef<FlatList>(null);
  const bannerRef = useRef<ScrollView>(null);


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
    const packSize = size ? String(parseInt(size)) : '30'; // Конвертируем size в строку или используем '30' по умолчанию
    addItem(item, 1, packSize);
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
    if (!inputMessage.trim() || isLoading) return;

    const userMessage = inputMessage.trim();
    const userMsg = { id: Date.now(), text: userMessage, sender: 'user' };
    
    // Добавляем сообщение пользователя
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInputMessage('');
    setIsLoading(true);
    
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
      setIsLoading(false);
    } catch (error) {
      console.error('Error calling API:', error);
      const errorMsg = { 
        id: Date.now() + 1, 
        text: 'Вибачте, не вдалося підключитися до сервера. Перевірте, чи запущений сервер.', 
        sender: 'bot' 
      };
      setMessages(prev => [...prev, errorMsg]);
      setIsLoading(false);
    }
  };

  const subtotal = cart.reduce((sum: number, item: Product) => sum + (item.price * (item.quantity || 1)), 0);
  const totalAmount = subtotal - (subtotal * discount);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setConnectionError(false);
    // Загружаем данные с сервера
    await fetchData();
    setRefreshing(false);
  }, []);

  // Фильтрация товаров по поисковому запросу и категории
  const getSortedProducts = () => {
    if (!products || !Array.isArray(products)) {
      return [];
    }
    
    let result = products.filter(p => 
      p.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    if (sortType === 'asc') {
      return result.sort((a, b) => a.price - b.price);
    } else if (sortType === 'desc') {
      return result.sort((a, b) => b.price - a.price);
    }
    return result; // 'popular' - порядок по умолчанию (id)
  };
  
  const filteredProducts = getSortedProducts();

  // Removed fetchProducts useEffect as we use local DB now

  // Auto-scrolling banner carousel
  useEffect(() => {
    if (banners.length === 0) return;
    
    const { width } = Dimensions.get('window');
    const CARD_WIDTH = width - 40;
    const CARD_MARGIN = 10;
    const TOTAL_WIDTH = CARD_WIDTH + CARD_MARGIN;
    
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

    // Получаем телефон пользователя
    const userPhone = await AsyncStorage.getItem('userPhone');
    let userName = await AsyncStorage.getItem('userName');

    if (!userPhone) {
      Alert.alert('Увага', 'Для написання відгуку потрібно увійти в систему');
      return;
    }

    // Если имени нет в AsyncStorage, пробуем получить из API
    if (!userName) {
      try {
        const response = await fetch(`${API_URL}/user/${userPhone}`);
        if (response.ok) {
          const userData = await response.json();
          userName = userData.name || 'Користувач';
          // Сохраняем для будущего использования
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: selectedProduct.id,
          user_name: userName || 'Користувач',
          user_phone: userPhone,
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
      <View style={styles.headerRow}>
        <View>
          <Text style={{ fontSize: 28, fontWeight: '900', color: 'black', letterSpacing: -1 }}>Dikoros UA 🍄</Text>
          <Text style={{ fontSize: 13, color: '#888', fontWeight: '500' }}>Твій природний вибір</Text>
        </View>
        <View style={styles.headerIcons}>
          <TouchableOpacity 
            onPress={() => setIsSearchVisible(!isSearchVisible)}
            style={{ marginRight: 12, position: 'relative' }}
          >
            <Ionicons name="search" size={24} color="black" />
          </TouchableOpacity>
          <TouchableOpacity 
            onPress={() => router.push('/(tabs)/favorites')}
            style={{ marginRight: 12, position: 'relative' }}
          >
            <Ionicons name="heart" color="red" size={24} />
          </TouchableOpacity>
          <TouchableOpacity 
            style={{ marginRight: 12, position: 'relative' }} 
            onPress={() => router.push('/(tabs)/cart')}
          >
            <Ionicons name="cart" size={26} color="black" />
            {cart.length > 0 && (
              <View style={{
                position: 'absolute',
                right: -8,
                top: -5,
                backgroundColor: 'red',
                borderRadius: 12,
                minWidth: 22,
                height: 22,
                justifyContent: 'center',
                alignItems: 'center',
                paddingHorizontal: 6,
                zIndex: 10,
                borderWidth: 2,
                borderColor: 'white'
              }}>
                <Text style={{ color: 'white', fontSize: 11, fontWeight: 'bold' }}>
                  {cart.reduce((sum: number, item: Product) => sum + (item.quantity || 1), 0)}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>
      {/* BANNERS */}
      {banners.length > 0 && (() => {
        const { width } = Dimensions.get('window');
        const CARD_WIDTH = width - 40;
        return (
          <ScrollView 
            ref={bannerRef}
            horizontal 
            showsHorizontalScrollIndicator={false}
            pagingEnabled={true}
            style={{ marginBottom: 20 }}
            contentContainerStyle={{ paddingLeft: 20, paddingRight: 20 }}
            snapToInterval={CARD_WIDTH + 10}
            decelerationRate="fast"
          >
            {banners.map((b) => {
              // Обеспечиваем правильное формирование URL для баннера
              // Используем getImageUrl для обработки относительных путей
              const imageUrl = b.image_url || b.image || b.picture;
              if (!imageUrl) {
                return null;
              }
              const fullImageUrl = getImageUrl(imageUrl);
              
              return (
                <BannerImage 
                  key={b?.id || Math.random()}
                  uri={fullImageUrl}
                  width={CARD_WIDTH}
                  height={220}
                />
              );
            })}
          </ScrollView>
        );
      })()}
      {isSearchVisible && (
        <View style={{ paddingHorizontal: 20, marginBottom: 10, flexDirection: 'row', alignItems: 'center' }}>
          <TextInput
            placeholder="Пошук..."
            value={searchQuery}
            onChangeText={setSearchQuery}
            style={{
              backgroundColor: '#f0f0f0',
              padding: 10,
              borderRadius: 10,
              fontSize: 16,
              flex: 1,
              marginRight: 10
            }}
            autoFocus={true}
          />
          <TouchableOpacity
            onPress={() => {
              setIsSearchVisible(false);
              setSearchQuery('');
            }}
            style={{ padding: 8 }}
          >
            <Ionicons name="close" size={24} color="black" />
          </TouchableOpacity>
        </View>
      )}
      {/* CATEGORY CHIPS */}
      <View style={styles.categoriesList}>
        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={false} 
          contentContainerStyle={{ paddingRight: 20 }}
        >
          {categories.map((cat, index) => (
            <TouchableOpacity
              key={index}
              onPress={async () => {
                setSelectedCategory(cat);
                setIsLocalLoading(true);
                const items = await getProducts(cat, undefined);
                // @ts-ignore
                setProducts(items);
                setIsLocalLoading(false);
              }}
              style={[
                styles.categoryItem,
                selectedCategory === cat && styles.categoryItemActive
              ]}
            >
              <Text style={[
                styles.categoryText,
                selectedCategory === cat && styles.categoryTextActive
              ]}>
                {cat}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
      {/* SORT & COUNT PANEL */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 8, marginBottom: 15 }}>
        <Text style={{ color: '#888', fontWeight: '600' }}>
          <Text>Знайдено: </Text>
          <Text>{filteredProducts.length}</Text>
        </Text>

        <TouchableOpacity 
          onPress={() => {
            // Циклическое переключение: Popular -> Cheap -> Expensive -> Popular
            if (sortType === 'popular') { setSortType('asc'); showToast('Спочатку дешевші'); }
            else if (sortType === 'asc') { setSortType('desc'); showToast('Спочатку дорожчі'); }
            else { setSortType('popular'); showToast('За популярністю'); }
            Vibration.vibrate(10);
          }}
          style={{ flexDirection: 'row', alignItems: 'center' }}
        >
          <Text style={{ fontWeight: 'bold', marginRight: 5 }}>
            {sortType === 'popular' ? 'Популярні' : sortType === 'asc' ? 'Дешевші' : 'Дорожчі'}
          </Text>
          <Ionicons name="swap-vertical" size={16} color="black" />
        </TouchableOpacity>
      </View>

      {connectionError ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 100, paddingHorizontal: 20 }}>
          <Ionicons name="cloud-offline-outline" size={64} color="#ff6b6b" />
          <Text style={{ marginTop: 20, fontSize: 18, fontWeight: 'bold', color: '#333', textAlign: 'center' }}>
            Не вдалося підключитися до сервера
          </Text>
          <Text style={{ marginTop: 10, fontSize: 14, color: '#666', textAlign: 'center', lineHeight: 20 }}>
            {getConnectionErrorMessage()}
          </Text>
          <TouchableOpacity
            onPress={() => {
              setConnectionError(false);
              fetchData();
            }}
            style={{
              marginTop: 20,
              backgroundColor: '#000',
              paddingHorizontal: 24,
              paddingVertical: 12,
              borderRadius: 8,
            }}
          >
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>Спробувати ще раз</Text>
          </TouchableOpacity>
        </View>
      ) : isLocalLoading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 100 }}>
          <ActivityIndicator size="large" color="#2E7D32" />
          <Text style={{ marginTop: 10, color: '#666' }}>Завантаження товарів...</Text>
        </View>
      ) : (
        <FlatList
          data={filteredProducts}
          renderItem={renderProductItem}
          keyExtractor={item => item?.id?.toString() || Math.random().toString()}
          numColumns={2}
          columnWrapperStyle={{ justifyContent: 'space-between' }}
          contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 100 }}
          ItemSeparatorComponent={() => <View style={{ height: 16 }} />}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={['#2E7D32']}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyStateContainer}>
              <Text style={styles.emptyStateText}>😔</Text>
              <Text style={styles.emptyStateMessage}>Нічого не знайдено</Text>
            </View>
          }
        />
      )}
      <Modal 
        animationType="slide" 
        visible={modalVisible && selectedProduct !== null}
        onRequestClose={() => setModalVisible(false)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: 'white' }}>
          {selectedProduct && (
            <View style={{ flex: 1, backgroundColor: 'white' }}>
              


              {/* Header */}
              <View style={{ 
                flexDirection: 'row', 
                justifyContent: 'space-between', 
                alignItems: 'center',
                paddingHorizontal: 20,
                paddingVertical: 15,
                backgroundColor: 'transparent',
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                zIndex: 10000
              }}
              >
                <TouchableOpacity 
                  onPress={() => {
                    setModalVisible(false);
                    setSelectedProduct(null);
                    setSelectedSize(null);
                    setTab('desc');
                  }}
                  style={{
                    backgroundColor: 'rgba(255, 255, 255, 0.9)',
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    alignItems: 'center',
                    justifyContent: 'center',
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 2 },
                    shadowOpacity: 0.1,
                    shadowRadius: 4,
                    elevation: 3
                  }}
                >
                  <Ionicons name="close" size={24} color="#374151" />
                </TouchableOpacity>

                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <TouchableOpacity 
                    onPress={() => {
                      setModalVisible(false);
                      router.push('/(tabs)/cart');
                    }}
                    style={{ 
                      marginRight: 10,
                      backgroundColor: 'rgba(255, 255, 255, 0.9)',
                      width: 44,
                      height: 44,
                      borderRadius: 22,
                      alignItems: 'center',
                      justifyContent: 'center',
                      shadowColor: '#000',
                      shadowOffset: { width: 0, height: 2 },
                      shadowOpacity: 0.1,
                      shadowRadius: 4,
                      elevation: 3
                    }}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Ionicons name="cart-outline" size={20} color="#374151" />
                    {cartItems.length > 0 && (
                      <View style={{
                        position: 'absolute',
                        top: -4,
                        right: -4,
                        backgroundColor: '#DC2626',
                        borderRadius: 10,
                        minWidth: 18,
                        height: 18,
                        justifyContent: 'center',
                        alignItems: 'center',
                        paddingHorizontal: 4
                      }}>
                        <Text style={{ color: 'white', fontSize: 10, fontWeight: 'bold' }}>
                          {cartItems.length}
                        </Text>
                      </View>
                    )}
                  </TouchableOpacity>

                  <TouchableOpacity 
                    onPress={() => onShare(selectedProduct)}
                    style={{ 
                      marginRight: 10,
                      backgroundColor: 'rgba(255, 255, 255, 0.9)',
                      width: 44,
                      height: 44,
                      borderRadius: 22,
                      alignItems: 'center',
                      justifyContent: 'center',
                      shadowColor: '#000',
                      shadowOffset: { width: 0, height: 2 },
                      shadowOpacity: 0.1,
                      shadowRadius: 4,
                      elevation: 3
                    }}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Ionicons name="share-outline" size={20} color="#374151" />
                  </TouchableOpacity>
                  
                  <TouchableOpacity 
                    onPress={() => {
                      Vibration.vibrate(10);
                      const isFav = favorites.some(fav => fav.id === selectedProduct?.id);
                      toggleFavorite({
                        id: selectedProduct?.id,
                        name: selectedProduct?.name || '',
                        price: selectedProduct?.price || 0,
                        image: selectedProduct?.image || selectedProduct?.picture || selectedProduct?.image_url || '',
                        category: selectedProduct?.category,
                        old_price: selectedProduct?.old_price,
                        badge: selectedProduct?.badge,
                        unit: selectedProduct?.unit
                      });
                      showToast(isFav ? 'Видалено з обраного' : 'Додано в обране ❤️');
                    }}
                    style={{
                      backgroundColor: 'rgba(255, 255, 255, 0.9)',
                      width: 44,
                      height: 44,
                      borderRadius: 22,
                      alignItems: 'center',
                      justifyContent: 'center',
                      shadowColor: '#000',
                      shadowOffset: { width: 0, height: 2 },
                      shadowOpacity: 0.1,
                      shadowRadius: 4,
                      elevation: 3
                    }}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Ionicons 
                      name={favorites.some(f => f.id === selectedProduct?.id) ? "heart" : "heart-outline"} 
                      size={20} 
                      color={favorites.some(f => f.id === selectedProduct?.id) ? "#ef4444" : "#374151"} 
                    />
                  </TouchableOpacity>
                </View>
              </View>
              
              {/* Основной контент (Скролл) */}
              <ScrollView contentContainerStyle={{ paddingBottom: 180 }} showsVerticalScrollIndicator={false}>
                
                {/* 1. Фото товара */}
                <View style={{ paddingTop: 60 }}>
                  <Image source={{ uri: getImageUrl(selectedProduct.image) }} style={{ width: '100%', height: 350, resizeMode: 'cover' }} />
                </View>

                <View style={{ padding: 20 }}>
                  {/* 2. Заголовок и Цена */}
                   {/* Status & Reviews */}
                   <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                         <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#4CAF50', marginRight: 6 }} />
                         <Text style={{ color: '#4CAF50', fontSize: 13, fontWeight: '500' }}>В наявності</Text>
                      </View>
                      
                      {/* Detailed Stars */}
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                         <View style={{ flexDirection: 'row', marginRight: 4 }}>
                            {[1, 2, 3, 4, 5].map(s => (
                               <Ionicons key={s} name="star" size={14} color={s <= averageRating ? "#FFD700" : "#E5E7EB"} />
                            ))}
                         </View>
                         <Text style={{ color: '#666', fontSize: 12 }}>{totalReviews} відгуки</Text>
                      </View>
                   </View>

                   <View style={{ marginBottom: 20 }}>
                      <Text style={{ fontSize: 28, fontWeight: '800', color: '#1a1a1a', marginBottom: 8, letterSpacing: -0.5 }}>{selectedProduct.name}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        <Text style={{ fontSize: 28, fontWeight: '700', color: '#000' }}>
                           {formatPrice(currentPrice > 0 ? currentPrice : selectedProduct.price)}
                        </Text>
                        {selectedProduct.old_price && selectedProduct.old_price > (currentPrice || selectedProduct.price) && (
                          <Text style={{ textDecorationLine: 'line-through', color: '#9ca3af', fontSize: 18, fontWeight: '500' }}>
                            {formatPrice(selectedProduct.old_price)}
                          </Text>
                        )}
                      </View>
                  </View>
  
                   {/* 3. Гарантии (Trust Badges) */}
                   <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 30, backgroundColor: '#f8fafc', padding: 16, borderRadius: 16, borderWidth: 1, borderColor: '#f1f5f9' }}>
                     <View style={{ alignItems: 'center', flex: 1 }}>
                       <Ionicons name="shield-checkmark-outline" size={22} color="#10b981" style={{ marginBottom: 6 }} />
                       <Text style={{ fontSize: 11, fontWeight: '600', color: '#475569' }}>100% Оригінал</Text>
                     </View>
                     <View style={{ alignItems: 'center', flex: 1 }}>
                       <Ionicons name="rocket-outline" size={22} color="#059669" style={{ marginBottom: 6 }} />
                       <Text style={{ fontSize: 11, fontWeight: '600', color: '#475569' }}>Швидка доставка</Text>
                     </View>
                     <View style={{ alignItems: 'center', flex: 1 }}>
                       <Ionicons name="leaf-outline" size={22} color="#059669" style={{ marginBottom: 6 }} />
                       <Text style={{ fontSize: 11, fontWeight: '600', color: '#475569' }}>Еко продукт</Text>
                     </View>
                   </View>
 
                   {/* 4. ВЫБОР ВАРИАЦИЙ (Dynamic Groups) */}
                   {variationGroups.length > 0 && variationGroups.map(group => (
                     <View key={group.id} style={{ marginBottom: 24 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
                           <Text style={{ fontSize: 17, fontWeight: '700', color: '#1a1a1a' }}>
                             {group.title}
                             {group.id === 'weight' && selectedProduct.unit ? ` (${selectedProduct.unit})` : ''}
                           </Text>
                           {(group.id === 'sort' || group.id === 'form') && (
                              <Ionicons name="information-circle-outline" size={16} color="#9ca3af" style={{ marginLeft: 6 }} />
                           )}
                        </View>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingRight: 20 }}>
                         {group.options.map((option: any) => {
                             const optLabel = typeof option === 'string' ? option : (option.label || option.name || String(option));
                             const isSelected = selectedVariations[group.id] === optLabel;
                             
                             // Перевіряємо чи доступна ця опція для поточних вибраних атрибутів
                             const isAvailable = isOptionAvailable(group.id, optLabel, selectedVariations, selectedProduct?.variants || []);
                             
                             return (
                               <TouchableOpacity
                                 key={optLabel}
                                 onPress={() => isAvailable ? handleVariationSelect(group.id, optLabel) : null}
                                 disabled={!isAvailable && !isSelected}
                                 style={{
                                   minWidth: 60, height: 46, borderRadius: 4,
                                   borderWidth: 1.5,
                                   borderColor: isSelected ? 'black' : (!isAvailable ? '#f1f5f9' : '#e2e8f0'),
                                   backgroundColor: isSelected ? 'black' : (!isAvailable ? '#f8fafc' : 'white'),
                                   alignItems: 'center', justifyContent: 'center',
                                   paddingHorizontal: 20,
                                   opacity: (!isAvailable && !isSelected) ? 0.4 : 1,
                                 }}
                               >
                                 <Text style={{ 
                                   color: isSelected ? 'white' : (!isAvailable ? '#cbd5e1' : '#1f2937'), 
                                   fontWeight: isSelected ? 'bold' : '600', 
                                   fontSize: 15,
                                   textDecorationLine: (!isAvailable && !isSelected) ? 'line-through' : 'none'
                                 }}>
                                     {optLabel}
                                 </Text>
                               </TouchableOpacity>
                             );
                         })}
                       </ScrollView>
                     </View>
                   ))}

                  {/* 5. ВКЛАДКИ (Опис / Склад / Прийом) */}
                  <View style={{ flexDirection: 'row', marginBottom: 15, backgroundColor: '#f5f5f5', borderRadius: 10, padding: 4 }}>
                    {['desc', 'ingr', 'use'].map((t) => (
                      <TouchableOpacity
                        key={t}
                        onPress={() => setTab(t as 'desc' | 'ingr' | 'use')}
                        style={{
                          flex: 1, paddingVertical: 8, alignItems: 'center',
                          backgroundColor: tab === t ? 'white' : 'transparent',
                          borderRadius: 8,
                          shadowColor: tab === t ? '#000' : 'transparent', shadowOpacity: 0.1, elevation: tab === t ? 2 : 0
                        }}
                      >
                        <Text style={{ fontWeight: tab === t ? 'bold' : '500', fontSize: 13 }}>
                          {t === 'desc' ? 'Опис' : t === 'ingr' ? 'Склад' : 'Прийом'}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  
                  {/* Текст описания */}
                  <Text style={{ color: '#555', lineHeight: 22, fontSize: 15, marginBottom: 30, minHeight: 80 }}>
                    {tab === 'desc' ? (selectedProduct.description || 'Опис для цього товару поки відсутній.') : tab === 'ingr' ? (selectedProduct.composition || 'Склад не вказано.') : (selectedProduct.usage || 'Спосіб прийому не вказано.')}
                  </Text>

                  {/* 6. Схожі товари */}
                  <Text style={{ fontSize: 18, fontWeight: 'bold', marginBottom: 15 }}>Схожі товари</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 30 }}>
                    {(products || [])
                      .filter((p: Product) => p.category === selectedProduct?.category && p.id !== selectedProduct?.id)
                      .map((item: Product) => (
                        <TouchableOpacity
                          key={item?.id || Math.random()}
                          onPress={() => {
                            router.push(`/product/${item?.id}`);
                          }}
                          style={{ width: 120, marginRight: 15 }}
                        >
                          <Image source={{ uri: getImageUrl(item.image) }} style={{ width: 120, height: 120, borderRadius: 12, backgroundColor: '#f0f0f0' }} />
                          <Text numberOfLines={1} style={{ marginTop: 8, fontWeight: '600', fontSize: 13 }}>{item.name}</Text>
                          <Text style={{ color: '#666', fontSize: 12 }}>{formatPrice(item.price)}</Text>
                        </TouchableOpacity>
                      ))}
                  </ScrollView>

                  {/* 7. Отзывы */}
                  <View style={{ marginBottom: 20 }}>
                     <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
                        <View>
                           <Text style={{ fontSize: 18, fontWeight: 'bold' }}>Відгуки</Text>
                           <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 5 }}>
                              <Ionicons name="star" size={16} color="#FFD700" />
                              <Text style={{ marginLeft: 4, fontWeight: '600', fontSize: 14 }}>
                                {totalReviews > 0 ? `${averageRating} (${totalReviews})` : 'Поки немає'}
                              </Text>
                           </View>
                        </View>
                        <TouchableOpacity 
                          onPress={() => setReviewModalVisible(true)}
                          style={{ backgroundColor: '#000', paddingHorizontal: 15, paddingVertical: 8, borderRadius: 20 }}
                        >
                           <Text style={{ color: '#fff', fontWeight: '600', fontSize: 12 }}>Написати</Text>
                        </TouchableOpacity>
                     </View>
                     
                     {reviewsLoading ? (
                       <ActivityIndicator size="small" color="#000" />
                     ) : reviews.length > 0 ? (
                       <View>
                         {reviews.map((review, index) => (
                           <View 
                             key={review.id || index}
                             style={{
                               backgroundColor: '#f9f9f9',
                               padding: 15,
                               borderRadius: 12,
                               marginBottom: 10
                             }}
                           >
                             <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                               <Text style={{ fontWeight: '600', fontSize: 14 }}>{review.user_name}</Text>
                               <View style={{ flexDirection: 'row' }}>
                                 {[1, 2, 3, 4, 5].map((star) => (
                                   <Ionicons 
                                     key={star}
                                     name={star <= review.rating ? "star" : "star-outline"}
                                     size={14}
                                     color="#FFD700"
                                     style={{ marginLeft: 2 }}
                                   />
                                 ))}
                               </View>
                             </View>
                             {review.comment && (
                               <Text style={{ color: '#666', fontSize: 13, lineHeight: 18 }}>
                                 {review.comment}
                               </Text>
                             )}
                             <Text style={{ color: '#999', fontSize: 11, marginTop: 8 }}>
                               {new Date(review.created_at).toLocaleDateString('uk-UA')}
                             </Text>
                           </View>
                         ))}
                       </View>
                     ) : (
                       <View style={{ 
                         backgroundColor: '#f9f9f9', 
                         padding: 30, 
                         borderRadius: 12, 
                         alignItems: 'center',
                         justifyContent: 'center'
                       }}>
                          <Ionicons name="chatbubbles-outline" size={48} color="#ccc" style={{ marginBottom: 10 }} />
                          <Text style={{ color: '#999', fontSize: 14, textAlign: 'center' }}>
                            Будьте першим, хто залишить відгук про цей товар
                          </Text>
                       </View>
                     )}
                   </View>
                </View>
              </ScrollView>

              {/* 7. ЗАКРЕПЛЕННЫЙ ФУТЕР */}
              <View style={{ 
                position: 'absolute', 
                bottom: 70, 
                left: 20, 
                right: 20
              }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <TouchableOpacity 
                    onPress={() => {
                      // 1. Validation
                      const missingSelection = variationGroups.find(g => !selectedVariations[g.id]);
                      if (missingSelection) {
                          Alert.alert('Увага', `Будь ласка, оберіть ${missingSelection.title.toLowerCase()}`);
                          return;
                      }

                      // 2. Formulate Unit/Size description
                      let finalUnit = selectedProduct.unit || 'шт';
                      
                      // Helper: is it weight?
                      if (selectedVariations['weight']) {
                           const val = selectedVariations['weight'];
                           // If value is just number "50" and unit is "г", combine them
                           if (val.match(/^\d+$/) && selectedProduct.unit) {
                               finalUnit = `${val} ${selectedProduct.unit}`;
                           } else {
                               finalUnit = val;
                           }
                      }

                      // Append other variations (Sort, Type, etc)
                      const otherVariations = Object.keys(selectedVariations)
                          .filter(k => k !== 'weight')
                          .map(k => selectedVariations[k])
                          .join(', ');
                      
                      if (otherVariations) {
                          finalUnit += ` (${otherVariations})`;
                      }

                       // 3. Add to cart with Current Price and Variant ID override
                       const productToAdd = {
                           ...selectedProduct,
                           id: selectedVariant ? selectedVariant.id : selectedProduct.id,
                           price: currentPrice > 0 ? currentPrice : selectedProduct.price
                       };

                       // Signature: product, quantity, packSize, customUnit, customPrice
                       addItem(productToAdd, 1, selectedVariations['size'] || selectedVariations['weight'] || '', finalUnit, currentPrice > 0 ? currentPrice : undefined);
                       showToast('Товар додано в кошик');
                    }}
                    style={{ flex: 1, backgroundColor: 'black', borderRadius: 14, paddingVertical: 16, alignItems: 'center' }}
                  >
                    <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 16 }}>
                      <Text>У кошик • </Text>
                      <Text>{formatPrice(currentPrice > 0 ? currentPrice : selectedProduct.price)}</Text>
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Chat Button inside Modal */}
              <FloatingChatButton bottomOffset={150} />
            </View>
          )}

          {/* TOAST INSIDE MODAL */}
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
                elevation: 10,
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
              <Text style={{ color: 'white', fontWeight: '600', fontSize: 14 }}>
                {toastMessage}
              </Text>
            </Animated.View>
          )}
        </SafeAreaView>
      </Modal>

      {/* REVIEW MODAL */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={reviewModalVisible}
        onRequestClose={() => setReviewModalVisible(false)}
      >
        <KeyboardAvoidingView 
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
            <View style={{ 
              backgroundColor: 'white', 
              borderTopLeftRadius: 25, 
              borderTopRightRadius: 25,
              padding: 20,
              maxHeight: '80%'
            }}>
            {/* Header */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <Text style={{ fontSize: 20, fontWeight: 'bold' }}>Написати відгук</Text>
              <TouchableOpacity onPress={() => setReviewModalVisible(false)}>
                <Ionicons name="close" size={28} color="#000" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Rating */}
              <View style={{ marginBottom: 20 }}>
                <Text style={{ fontSize: 16, fontWeight: '600', marginBottom: 10 }}>Ваша оцінка</Text>
                <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 10 }}>
                  {[1, 2, 3, 4, 5].map((star) => (
                    <TouchableOpacity
                      key={star}
                      onPress={() => setReviewRating(star)}
                    >
                      <Ionicons
                        name={star <= reviewRating ? "star" : "star-outline"}
                        size={40}
                        color="#FFD700"
                      />
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Comment */}
              <View style={{ marginBottom: 20 }}>
                <Text style={{ fontSize: 16, fontWeight: '600', marginBottom: 10 }}>Ваш коментар</Text>
                <TextInput
                  style={{
                    borderWidth: 1,
                    borderColor: '#ddd',
                    borderRadius: 12,
                    padding: 15,
                    fontSize: 14,
                    minHeight: 120,
                    textAlignVertical: 'top'
                  }}
                  placeholder="Розкажіть про свій досвід використання товару..."
                  multiline
                  numberOfLines={5}
                  value={reviewComment}
                  onChangeText={setReviewComment}
                />
              </View>

              {/* Buttons */}
              <View style={{ flexDirection: 'row', gap: 10, marginBottom: 40 }}>
                <TouchableOpacity
                  onPress={() => setReviewModalVisible(false)}
                  style={{
                    flex: 1,
                    backgroundColor: '#f0f0f0',
                    borderRadius: 12,
                    paddingVertical: 16,
                    alignItems: 'center'
                  }}
                >
                  <Text style={{ fontWeight: '600', fontSize: 16, color: '#666' }}>Скасувати</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={submitReview}
                  style={{
                    flex: 1,
                    backgroundColor: '#000',
                    borderRadius: 12,
                    paddingVertical: 16,
                    alignItems: 'center'
                  }}
                >
                  <Text style={{ fontWeight: '600', fontSize: 16, color: '#fff' }}>Відправити</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
        </KeyboardAvoidingView>
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
              Дякуємо за довіру.{'\n'}Менеджер зв'яжеться з вами найближчим часом для підтвердження.
            </Text>

            <TouchableOpacity 
              onPress={() => {
                setSuccessVisible(false);
                setTimeout(() => {
                  router.push('/(tabs)/profile');
                }, 300);
              }}
              style={{ backgroundColor: 'black', paddingVertical: 15, paddingHorizontal: 40, borderRadius: 15, width: '100%' }}
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
                        backgroundColor: '#000',
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
                                marginRight: 12,
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
                  marginRight: 10,
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
      {/* Floating Chat Button */}
      <FloatingChatButton bottomOffset={30} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 50,
    paddingBottom: 20,
  },
  headerIcons: {
    flexDirection: 'row',
  },
  categoriesList: {
    paddingHorizontal: 20,
    marginBottom: 15,
  },
  categoryItem: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#e0e0e0',
    marginRight: 8,
  },
  categoryItemActive: {
    backgroundColor: '#000',
  },
  categoryText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#666',
  },
  categoryTextActive: {
    color: '#fff',
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


