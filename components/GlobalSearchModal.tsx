import { API_ENDPOINTS, API_URL } from '@/config/api';
import { useGlobalSearch } from '@/context/GlobalSearchContext';
import { useOrders } from '@/context/OrdersContext';
import { getImageUrl } from '@/utils/image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

type SearchResult = {
  id: string;
  type: 'product' | 'content';
  title: string;
  subtitle?: string;
  image?: string;
  payload: any;
  score: number;
};

type ContentSource = {
  endpoint: string;
  contentType: 'news' | 'blog';
  detailPath: '/news-detail' | '/blog-detail';
  pageTitle: 'Акції' | 'Блог';
};

const CONTENT_SOURCES: ContentSource[] = [
  {
    endpoint: API_ENDPOINTS.newsPage,
    contentType: 'news',
    detailPath: '/news-detail',
    pageTitle: 'Акції',
  },
  {
    endpoint: API_ENDPOINTS.blogPage,
    contentType: 'blog',
    detailPath: '/blog-detail',
    pageTitle: 'Блог',
  },
];

const SEARCH_STOPWORDS = new Set([
  'для', 'про', 'под', 'під', 'при', 'над', 'без', 'или', 'або', 'что', 'що', 'как', 'як',
  'мне', 'мені', 'надо', 'нужно', 'треба', 'хочу', 'покажи', 'покажіть', 'посоветуй',
  'порадь', 'підкажи', 'подскажи', 'товар', 'товары', 'товари', 'купить', 'купити',
]);

const SYNONYM_GROUPS = [
  ['їжовик', 'іжовик', 'ижовик', 'ежовик', 'герицій', 'гериций', 'hericium', 'lion', 'mane', 'львиная', 'левова'],
  ['мухомор', 'мухамор', 'amanita'],
  ['кордицепс', 'cordyceps'],
  ['чага', 'chaga'],
  ['рейші', 'рейши', 'reishi', 'ганодерма', 'ganoderma'],
  ['лисичка', 'лисички', 'cantharellus'],
  ['мікродозинг', 'микродозинг', 'мікродоз', 'микродоз', 'microdosing', 'microdose'],
  ['капсули', 'капсулы', 'капсул', 'capsules'],
  ['порошок', 'порошок', 'мелений', 'молотый', 'powder'],
  ['настоянка', 'настойка', 'tincture'],
  ['мазь', 'бальзам', 'ointment'],
  ['набір', 'набор', 'комплект', 'set'],
  ['сушені', 'сушеные', 'цілі', 'целые'],
  ['імунітет', 'иммунитет', 'імун', 'иммун', 'immunity'],
  ['сон', 'сну', 'сна', 'sleep', 'спокій', 'спокой'],
  ['енергія', 'энергия', 'енерг', 'энерг', 'energy'],
  ['фокус', 'память', 'память', 'мозок', 'мозг', 'focus'],
];

const normalize = (value: any) =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[’ʼ`]/g, "'")
    .replace(/ё/g, 'е')
    .replace(/ґ/g, 'г')
    .replace(/є/g, 'е')
    .replace(/[ії]/g, 'и')
    .replace(/й/g, 'и')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeCode = (value: any) =>
  String(value ?? '')
    .toUpperCase()
    .replace(/А/g, 'A')
    .replace(/В/g, 'B')
    .replace(/Е/g, 'E')
    .replace(/К/g, 'K')
    .replace(/М/g, 'M')
    .replace(/Н/g, 'H')
    .replace(/О/g, 'O')
    .replace(/Р/g, 'P')
    .replace(/С/g, 'C')
    .replace(/Т/g, 'T')
    .replace(/Х/g, 'X')
    .replace(/І/g, 'I')
    .replace(/Ї/g, 'I')
    .replace(/[^A-Z0-9]/g, '');

const stemToken = (token: string) => {
  if (token.length < 5) return token;
  const suffixes = ['ями', 'ами', 'ого', 'ому', 'ему', 'ими', 'ах', 'ях', 'ам', 'ям', 'ом', 'ем', 'ою', 'ею', 'ів', 'ов', 'ев', 'ей', 'ий', 'ый', 'ая', 'яя', 'ое', 'ее', 'ий', 'ій', 'ої', 'ой', 'у', 'ю', 'а', 'я', 'и', 'е', 'о'];
  for (const suffix of suffixes) {
    if (token.endsWith(suffix) && token.length - suffix.length >= 4) {
      return token.slice(0, -suffix.length);
    }
  }
  return token;
};

const tokenize = (value: any) => {
  const text = normalize(value);
  const raw = text.match(/[a-zа-я0-9']{2,}/g) || [];
  const tokens = raw
    .map((token) => stemToken(token.replace(/^'+|'+$/g, '')))
    .filter((token) => token.length >= 2 && !SEARCH_STOPWORDS.has(token));

  const expanded = new Set(tokens);
  for (const token of tokens) {
    for (const group of SYNONYM_GROUPS) {
      const normalizedGroup = group.map((item) => stemToken(normalize(item)));
      if (normalizedGroup.some((item) => item.includes(token) || token.includes(item))) {
        normalizedGroup.forEach((item) => expanded.add(item));
      }
    }
  }

  return Array.from(expanded);
};

const safeJsonText = (value: any) => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
};

const getProductSearchText = (product: any) => {
  const variantText = Array.isArray(product?.variants)
    ? product.variants.map((variant: any) => [variant?.name, variant?.title, variant?.sku, safeJsonText(variant?.options)].filter(Boolean).join(' ')).join(' ')
    : safeJsonText(product?.variants);

  return [
    product?.name,
    product?.variant_name,
    product?.sku,
    product?.external_id,
    product?.parent_sku,
    product?.category,
    product?.description,
    product?.composition,
    product?.usage,
    product?.option_names,
    product?.variant_options,
    variantText,
  ].filter(Boolean).join(' ');
};

const isVisibleProduct = (product: any) => {
  const name = normalize(product?.name);
  const status = normalize(product?.status);
  const price = Number(product?.price || product?.minPrice || 0);

  if (!name || name === 'без назви') return false;
  if (!Number.isFinite(price) || price <= 0) return false;
  if (status === 'out_of_stock' || status === 'not_available' || status === 'unavailable') return false;

  return true;
};

const productDedupeKey = (product: any) => {
  const explicit = String(product?.parent_sku || product?.sku || '').trim();
  if (explicit) return explicit;

  return normalize(`${product?.name || ''} ${product?.category || ''}`)
    .replace(/\b\d+(?:[.,]\d+)?\s*(г|гр|грам|мл|л|шт|капсул|капсули|капсулы)\b/g, ' ')
    .replace(/\b(порошок|капсули|капсулы|сушени|сушеные|цил|цели|настоянка|настойка)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const scoreProduct = (product: any, query: string, tokens: string[]) => {
  if (!isVisibleProduct(product)) return 0;

  const name = normalize(product?.name);
  const category = normalize(product?.category);
  const sku = normalize(product?.sku);
  const allText = normalize(getProductSearchText(product));
  const queryCode = normalizeCode(query);
  const skuCode = normalizeCode(product?.sku || product?.external_id || product?.parent_sku || '');

  let score = 0;

  if (name === query) score += 120;
  if (name.startsWith(query)) score += 80;
  if (name.includes(query)) score += 55;
  if (category.includes(query)) score += 22;
  if (sku && sku.includes(query)) score += 45;
  if (queryCode.length >= 4 && skuCode && (skuCode.includes(queryCode) || queryCode.includes(skuCode))) score += 100;

  for (const token of tokens) {
    if (token.length < 2) continue;
    if (name.includes(token)) score += 20;
    if (category.includes(token)) score += 8;
    if (sku.includes(token)) score += 16;
    if (allText.includes(token)) score += 5;
  }

  if (tokens.length >= 2 && tokens.every((token) => allText.includes(token))) score += 30;
  if (product?.is_hit) score += 2;
  if (product?.is_promotion || Number(product?.old_price || 0) > Number(product?.price || 0)) score += 2;

  return score;
};

const scoreContent = (item: any, query: string, tokens: string[]) => {
  const title = normalize(item?.heading || item?.__pageTitle || '');
  const body = normalize(item?.body || '');

  let score = 0;
  if (title === query) score += 80;
  if (title.startsWith(query)) score += 55;
  if (title.includes(query)) score += 35;

  for (const token of tokens) {
    if (title.includes(token)) score += 12;
    if (body.includes(token)) score += 4;
  }

  return score;
};

const getProductImage = (product: any) => {
  if (product?.image || product?.picture || product?.image_url) {
    return product.image || product.picture || product.image_url;
  }

  if (typeof product?.images === 'string') {
    const first = product.images.split(',').map((item: string) => item.trim()).find(Boolean);
    if (first) return first;
  }

  if (Array.isArray(product?.variants)) {
    const variantImage = product.variants.find((variant: any) => variant?.image)?.image;
    if (variantImage) return variantImage;
  }

  return '';
};

export function GlobalSearchModal() {
  const router = useRouter();
  const { visible, closeSearch } = useGlobalSearch();
  const { products } = useOrders();
  const [query, setQuery] = useState('');
  const [contentItems, setContentItems] = useState<any[]>([]);
  const [contentLoading, setContentLoading] = useState(false);

  useEffect(() => {
    if (!visible) return;

    let mounted = true;

    const loadContent = async () => {
      try {
        setContentLoading(true);
        const loadedContent = await Promise.all(
          CONTENT_SOURCES.map(async (source) => {
            try {
              const response = await fetch(`${API_URL}${source.endpoint}`);
              if (!response.ok) throw new Error(`HTTP ${response.status}`);

              const data = await response.json();
              const sections = Array.isArray(data?.sections) ? data.sections : [];
              return sections.map((section: any, index: number) => ({
                ...section,
                __id: `${source.contentType}-${index}`,
                __contentType: source.contentType,
                __detailPath: source.detailPath,
                __pageTitle: data?.title || source.pageTitle,
              }));
            } catch (error) {
              console.warn(`Global search ${source.contentType} load failed:`, error);
              return [];
            }
          })
        );

        if (!mounted) return;
        setContentItems(loadedContent.flat());
      } catch (error) {
        console.warn('Global search content load failed:', error);
      } finally {
        if (mounted) setContentLoading(false);
      }
    };

    loadContent();

    return () => {
      mounted = false;
    };
  }, [visible]);

  useEffect(() => {
    if (!visible) {
      setQuery('');
    }
  }, [visible]);

  const results = useMemo<SearchResult[]>(() => {
    const q = normalize(query);
    if (q.length < 2) return [];

    const tokens = tokenize(query);
    const seenProducts = new Set<string>();

    const productResults = (Array.isArray(products) ? products : [])
      .map((product: any) => ({ product, score: scoreProduct(product, query, tokens) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .filter(({ product }) => {
        const key = productDedupeKey(product);
        if (!key) return true;
        if (seenProducts.has(key)) return false;
        seenProducts.add(key);
        return true;
      })
      .slice(0, 20)
      .map(({ product, score }) => ({
        id: `product-${product.id}`,
        type: 'product' as const,
        title: product?.name || 'Товар',
        subtitle: [
          product?.category,
          product?.price ? `${product.price} ₴` : null,
        ].filter(Boolean).join(' · '),
        image: getProductImage(product),
        payload: product,
        score,
      }));

    const contentResults = contentItems
      .map((item: any) => ({ item, score: scoreContent(item, q, tokens) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map(({ item, score }) => ({
        id: item.__id,
        type: 'content' as const,
        title: item?.heading || item?.__pageTitle || 'Матеріал',
        subtitle: item?.body || item?.__pageTitle || 'Контент',
        image: item?.image_url || '',
        payload: item,
        score,
      }));

    return [...productResults, ...contentResults].sort((a, b) => b.score - a.score);
  }, [query, products, contentItems]);

  const openResult = (item: SearchResult) => {
    closeSearch();

    if (item.type === 'product') {
      router.push(`/product/${item.payload.id}` as any);
      return;
    }

    router.push({
      pathname: item.payload?.__detailPath || '/news-detail',
      params: {
        heading: item.payload?.heading || '',
        body: item.payload?.body || '',
        image_url: item.payload?.image_url || '',
        source_url: item.payload?.source_url || '',
      },
    } as any);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={closeSearch}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.sheet}>
          <View style={styles.searchRow}>
            <Ionicons name="search" size={22} color="#111827" />
            <TextInput
              value={query}
              onChangeText={setQuery}
              autoFocus
              placeholder="Пошук товарів, акцій, блогу"
              placeholderTextColor="#9CA3AF"
              style={styles.input}
              returnKeyType="search"
            />
            <TouchableOpacity onPress={closeSearch} style={styles.closeButton}>
              <Ionicons name="close" size={24} color="#111827" />
            </TouchableOpacity>
          </View>

          {query.trim().length < 2 ? (
            <View style={styles.emptyBlock}>
              <Text style={styles.emptyTitle}>Що шукаємо?</Text>
              <Text style={styles.emptyText}>Введіть мінімум 2 символи: назву, артикул, категорію, форму або дію товару.</Text>
            </View>
          ) : results.length === 0 ? (
            <View style={styles.emptyBlock}>
              {contentLoading ? (
                <ActivityIndicator color="#2E7D32" />
              ) : (
                <>
                  <Text style={styles.emptyTitle}>Нічого не знайдено</Text>
                  <Text style={styles.emptyText}>Спробуйте інший запит: наприклад «їжовик», «ежовик», «кордицепс», «капсули» або артикул.</Text>
                </>
              )}
            </View>
          ) : (
            <FlatList
              data={results}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.resultsList}
              renderItem={({ item }) => {
                const imageUrl = item.image ? getImageUrl(item.image) : '';
                return (
                  <TouchableOpacity style={styles.resultItem} onPress={() => openResult(item)} activeOpacity={0.85}>
                    <View style={styles.resultImageWrap}>
                      {imageUrl ? (
                        <Image source={{ uri: imageUrl }} style={styles.resultImage} resizeMode="cover" />
                      ) : (
                        <Ionicons name={item.type === 'product' ? 'cube-outline' : 'newspaper-outline'} size={24} color="#6B7280" />
                      )}
                    </View>
                    <View style={styles.resultTextWrap}>
                      <Text style={styles.resultType}>{item.type === 'product' ? 'Товар' : 'Контент'}</Text>
                      <Text style={styles.resultTitle} numberOfLines={2}>{item.title}</Text>
                      {!!item.subtitle && (
                        <Text style={styles.resultSubtitle} numberOfLines={2}>{item.subtitle}</Text>
                      )}
                    </View>
                    <Ionicons name="chevron-forward" size={20} color="#9CA3AF" />
                  </TouchableOpacity>
                );
              }}
            />
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.38)',
    paddingTop: 54,
  },
  sheet: {
    flex: 1,
    backgroundColor: '#F8FAF8',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 14,
  },
  searchRow: {
    marginHorizontal: 14,
    minHeight: 52,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    minHeight: 50,
    paddingHorizontal: 10,
    color: '#111827',
    fontSize: 16,
    fontWeight: '700',
  },
  closeButton: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyBlock: {
    paddingHorizontal: 28,
    paddingTop: 42,
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: 21,
    fontWeight: '900',
    color: '#111827',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 15,
    lineHeight: 22,
    color: '#6B7280',
    textAlign: 'center',
  },
  resultsList: {
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 40,
  },
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#EEF0F2',
  },
  resultImageWrap: {
    width: 58,
    height: 58,
    borderRadius: 14,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginRight: 12,
  },
  resultImage: {
    width: '100%',
    height: '100%',
  },
  resultTextWrap: {
    flex: 1,
  },
  resultType: {
    fontSize: 11,
    color: '#2E7D32',
    fontWeight: '900',
    textTransform: 'uppercase',
    marginBottom: 3,
  },
  resultTitle: {
    fontSize: 15,
    color: '#111827',
    fontWeight: '900',
    lineHeight: 19,
  },
  resultSubtitle: {
    fontSize: 13,
    color: '#6B7280',
    lineHeight: 18,
    marginTop: 3,
  },
});
