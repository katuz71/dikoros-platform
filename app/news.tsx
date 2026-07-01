import { AppHeader } from '@/components/AppHeader';
import { API_ENDPOINTS, API_URL } from '@/config/api';
import { useAppFooterAutoHide } from '@/hooks/use-app-footer-auto-hide';
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

type NewsSection = {
  heading?: string;
  body?: string;
  image_url?: string | null;
  source_url?: string | null;
};

type NewsPage = {
  title?: string;
  updated_at?: string;
  sections?: NewsSection[];
};

const NEWS_CACHE_KEY = 'cached_news_page_v2';
const NEWS_TIMEOUT_MS = 10000;

export default function NewsScreen() {
  const router = useRouter();
  const [page, setPage] = useState<NewsPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const { handleFooterScroll } = useAppFooterAutoHide();

  const applyCachedPage = useCallback(async () => {
    try {
      const cachedData = await AsyncStorage.getItem(NEWS_CACHE_KEY);
      if (!cachedData) return false;

      const cachedPage = JSON.parse(cachedData);
      if (cachedPage && typeof cachedPage === 'object') {
        setPage(cachedPage);
        setLoading(false);
        return true;
      }
    } catch (cacheError) {
      console.warn('News cache read failed:', cacheError);
      try {
        await AsyncStorage.removeItem(NEWS_CACHE_KEY);
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
      timeoutId = setTimeout(() => controller.abort(), NEWS_TIMEOUT_MS);

      const response = await fetch(`${API_URL}${API_ENDPOINTS.newsPage}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });

      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      setPage(data);

      try {
        await AsyncStorage.setItem(NEWS_CACHE_KEY, JSON.stringify(data));
      } catch (cacheError) {
        console.warn('News cache save failed:', cacheError);
      }
    } catch (err: any) {
      if (timeoutId) clearTimeout(timeoutId);
      console.warn('News page load failed:', err?.message || err);
      if (!page) setError('РќРµ РІРґР°Р»РѕСЃСЏ Р·Р°РІР°РЅС‚Р°Р¶РёС‚Рё С–РЅС„РѕСЂРјР°С†С–СЋ. РЎРїСЂРѕР±СѓР№С‚Рµ РѕРЅРѕРІРёС‚Рё СЃС‚РѕСЂС–РЅРєСѓ.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [applyCachedPage]);

  useEffect(() => {
    loadPage();
  }, [loadPage]);

  const onRefresh = () => {
    setRefreshing(true);
    loadPage();
  };

  const openPromotion = (section: NewsSection) => {
    router.push({
      pathname: '/news-detail',
      params: {
        heading: section.heading || '',
        body: section.body || '',
        image_url: section.image_url || '',
        source_url: section.source_url || '',
      },
    });
  };

  return (
    <View style={styles.container}>
      <AppHeader title={page?.title || 'РђРєС†С–С—'} showBack />

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
              key={`${section.heading || 'promo'}-${index}`}
              style={styles.card}
              activeOpacity={0.88}
              onPress={() => openPromotion(section)}
            >
              {!!section.image_url && (
                <Image
                  source={{ uri: section.image_url }}
                  style={styles.cardImage}
                  resizeMode="cover"
                />
              )}

              {!!section.heading && (
                <Text style={styles.cardTitle}>{section.heading}</Text>
              )}

              {!!section.body && (
                <Text style={styles.cardText} numberOfLines={4}>
                  {section.body}
                </Text>
              )}
            </TouchableOpacity>
          ))}

          {!error && (!page?.sections || page.sections.length === 0) && (
            <Text style={styles.empty}>Р†РЅС„РѕСЂРјР°С†С–СЏ РїРѕРєРё С‰Рѕ РІС–РґСЃСѓС‚РЅСЏ.</Text>
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
  cardTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#111827',
    marginBottom: 8,
  },
  cardText: {
    fontSize: 15,
    lineHeight: 22,
    color: '#374151',
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

