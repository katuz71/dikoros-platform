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

const normalize = (value: any) =>
  String(value ?? '')
    .toLowerCase()
    .trim();

const includesQuery = (value: any, query: string) => normalize(value).includes(query);

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

    const productResults = (Array.isArray(products) ? products : [])
      .filter((product: any) => (
        includesQuery(product?.name, q) ||
        includesQuery(product?.category, q) ||
        includesQuery(product?.description, q) ||
        includesQuery(product?.composition, q) ||
        includesQuery(product?.usage, q)
      ))
      .slice(0, 20)
      .map((product: any) => ({
        id: `product-${product.id}`,
        type: 'product' as const,
        title: product?.name || 'Товар',
        subtitle: [
          product?.category,
          product?.price ? `${product.price} ₴` : null,
        ].filter(Boolean).join(' · '),
        image: product?.image || product?.picture || product?.image_url || '',
        payload: product,
      }));

    const contentResults = contentItems
      .filter((item: any) => (
        includesQuery(item?.heading, q) ||
        includesQuery(item?.body, q) ||
        includesQuery(item?.__pageTitle, q)
      ))
      .slice(0, 10)
      .map((item: any) => ({
        id: item.__id,
        type: 'content' as const,
        title: item?.heading || item?.__pageTitle || 'Матеріал',
        subtitle: item?.body || item?.__pageTitle || 'Контент',
        image: item?.image_url || '',
        payload: item,
      }));

    return [...productResults, ...contentResults];
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
              <Text style={styles.emptyText}>Введіть мінімум 2 символи: назву товару, категорію, акцію або статтю блогу.</Text>
            </View>
          ) : results.length === 0 ? (
            <View style={styles.emptyBlock}>
              {contentLoading ? (
                <ActivityIndicator color="#2E7D32" />
              ) : (
                <>
                  <Text style={styles.emptyTitle}>Нічого не знайдено</Text>
                  <Text style={styles.emptyText}>Спробуйте інший запит.</Text>
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
