import { AppHeader } from '@/components/AppHeader';
import { API_ENDPOINTS, API_URL } from '@/config/api';
import { useAppFooterAutoHide } from '@/hooks/use-app-footer-auto-hide';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

type BlogSection = {
  heading?: string;
  body?: string;
  image_url?: string | null;
  source_url?: string | null;
};

type BlogPage = {
  title?: string;
  updated_at?: string;
  sections?: BlogSection[];
};

const BLOG_LOAD_ERROR = 'Не вдалося завантажити блог. Спробуйте оновити сторінку.';
const BLOG_CACHE_KEY = 'cached_blog_page_v2';
const BLOG_TIMEOUT_MS = 10000;

export default function BlogScreen() {
  const router = useRouter();
  const [page, setPage] = useState<BlogPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const { handleFooterScroll } = useAppFooterAutoHide();

  const applyCachedPage = useCallback(async () => {
    try {
      const cachedData = await AsyncStorage.getItem(BLOG_CACHE_KEY);
      if (!cachedData) return false;

      const cachedPage = JSON.parse(cachedData);
      if (cachedPage && typeof cachedPage === 'object') {
        setPage(cachedPage);
        setLoading(false);
        return true;
      }
    } catch (cacheError) {
      console.warn('Blog cache read failed:', cacheError);
      try {
        await AsyncStorage.removeItem(BLOG_CACHE_KEY);
      } catch {}
    }

    return false;
  }, []);

  const loadPage = useCallback(async () => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    try {
      setError('');
      const hadCache = await applyCachedPage();
      if (!hadCache) setLoading(true);

      const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), BLOG_TIMEOUT_MS);

      const response = await fetch(`${API_URL}${API_ENDPOINTS.blogPage}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });

      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      setPage(data);

      try {
        await AsyncStorage.setItem(BLOG_CACHE_KEY, JSON.stringify(data));
      } catch (cacheError) {
        console.warn('Blog cache save failed:', cacheError);
      }
    } catch (err: any) {
      if (timeoutId) clearTimeout(timeoutId);
      console.warn('Blog page load failed:', err?.message || err);
      if (!page) setError(BLOG_LOAD_ERROR);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [applyCachedPage, page]);

  useEffect(() => {
    loadPage();
  }, [loadPage]);

  const onRefresh = () => {
    setRefreshing(true);
    loadPage();
  };

  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/(tabs)' as any);
  };

  const openArticle = (section: BlogSection) => {
    if (!section.source_url) return;

    router.push({
      pathname: '/blog-detail',
      params: {
        heading: section.heading || '',
        body: section.body || '',
        image_url: section.image_url || '',
        source_url: section.source_url,
      },
    });
  };

  return (
    <View style={styles.container}>
      <AppHeader showLogo showSearch showFavorites />

      <View style={styles.pageTitleRow}>
        <TouchableOpacity
          onPress={goBack}
          style={styles.pageBackButton}
          activeOpacity={0.75}
        >
          <Ionicons name="arrow-back" size={24} color="#111827" />
        </TouchableOpacity>

        <Text style={styles.pageTitle} numberOfLines={1}>
          {page?.title || 'Блог'}
        </Text>

        <View style={styles.pageBackButton} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#2E7D32" />
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          onScroll={handleFooterScroll}
          scrollEventThrottle={16}
        >
          {!!error && <Text style={styles.error}>{error}</Text>}

          {(page?.sections || []).map((section, index) => (
            <TouchableOpacity
              key={`${section.source_url || section.body || 'article'}-${index}`}
              style={styles.card}
              activeOpacity={0.88}
              disabled={!section.source_url}
              onPress={() => openArticle(section)}
            >
              {!!section.image_url && (
                <Image
                  source={{ uri: section.image_url }}
                  style={styles.cardImage}
                  resizeMode="cover"
                />
              )}

              {!!section.heading && <Text style={styles.cardDate}>{section.heading}</Text>}
              {!!section.body && <Text style={styles.cardTitle}>{section.body}</Text>}
            </TouchableOpacity>
          ))}

          {!error && (!page?.sections || page.sections.length === 0) && (
            <Text style={styles.empty}>Статті поки що відсутні.</Text>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAF8',
  },
  pageTitleRow: {
    height: 58,
    paddingHorizontal: 14,
    backgroundColor: '#F8FAF8',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageBackButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 22,
    fontWeight: '900',
    color: '#111827',
  },
  scroll: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 120,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  cardImage: {
    width: '100%',
    height: 200,
    borderRadius: 14,
    marginBottom: 14,
    backgroundColor: '#EEF2EE',
  },
  cardDate: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '800',
    color: '#2E7D32',
    marginBottom: 7,
  },
  cardTitle: {
    fontSize: 18,
    lineHeight: 25,
    fontWeight: '900',
    color: '#111827',
  },
  error: {
    fontSize: 15,
    lineHeight: 22,
    color: '#B91C1C',
    marginBottom: 14,
  },
  empty: {
    fontSize: 15,
    color: '#6B7280',
    textAlign: 'center',
    marginTop: 30,
  },
});
