import { AppHeader } from '@/components/AppHeader';
import { API_ENDPOINTS, API_URL } from '@/config/api';
import { Ionicons } from '@expo/vector-icons';
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

export default function BlogScreen() {
  const router = useRouter();
  const [page, setPage] = useState<BlogPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const loadPage = useCallback(async () => {
    try {
      setError('');
      const response = await fetch(`${API_URL}${API_ENDPOINTS.blogPage}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      setPage(data);
    } catch (err) {
      console.warn('Blog page load failed:', err);
      setError(BLOG_LOAD_ERROR);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

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
      <AppHeader showLogo showSearch showFavorites showCart />

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
