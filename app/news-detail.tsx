import { AppHeader } from '@/components/AppHeader';
import { API_URL } from '@/config/api';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
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

type NewsDetail = {
  title: string;
  heading: string;
  body: string;
  image_url: string;
  body_items?: NewsBodyItem[];
};

type NewsBodyItem = {
  text: string;
  product_id: number | null;
  product_name?: string | null;
  product_sku?: string | null;
};

export default function NewsDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    heading?: string;
    body?: string;
    image_url?: string;
    source_url?: string;
  }>();

  const initialHeading = Array.isArray(params.heading) ? params.heading[0] : params.heading;
  const initialBody = Array.isArray(params.body) ? params.body[0] : params.body;
  const initialImageUrl = Array.isArray(params.image_url) ? params.image_url[0] : params.image_url;
  const sourceUrl = Array.isArray(params.source_url) ? params.source_url[0] : params.source_url;

  const [detail, setDetail] = useState<NewsDetail>({
    title: '',
    heading: initialHeading || '',
    body: initialBody || '',
    image_url: initialImageUrl || '',
  });
  const [loading, setLoading] = useState(!!sourceUrl);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const loadDetail = useCallback(async () => {
    if (!sourceUrl) {
      setLoading(false);
      setRefreshing(false);
      return;
    }

    try {
      setError('');
      const response = await fetch(
        `${API_URL}/api/pages/news/detail?source_url=${encodeURIComponent(sourceUrl)}`
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      setDetail({
        title: data.title || '',
        heading: data.heading || initialHeading || '',
        body: data.body || initialBody || '',
        image_url: data.image_url || initialImageUrl || '',
        body_items: Array.isArray(data.body_items) ? data.body_items : undefined,
      });
    } catch (err) {
      console.warn('News detail load failed:', err);
      setError('Не вдалося завантажити акцію. Спробуйте оновити сторінку.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [initialBody, initialHeading, initialImageUrl, sourceUrl]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  const bodyItems = useMemo<NewsBodyItem[]>(() => {
    if (Array.isArray(detail.body_items) && detail.body_items.length > 0) {
      const serverItems = detail.body_items.filter(
        item => typeof item?.text === 'string' && item.text.trim()
      );
      if (serverItems.length > 0) return serverItems;
    }

    return detail.body
      .split(/\n+/)
      .map(line => line.trim())
      .filter(Boolean)
      .map(text => ({ text, product_id: null }));
  }, [detail.body, detail.body_items]);

  const onRefresh = () => {
    setRefreshing(true);
    loadDetail();
  };

  const openProduct = (productId: number) => {
    router.push(`/product/${productId}` as any);
  };

  return (
    <View style={styles.container}>
      <AppHeader title="Акція" showBack />

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

          <View style={styles.card}>
            {!!detail.image_url && (
              <Image
                source={{ uri: detail.image_url }}
                style={styles.image}
                resizeMode="cover"
              />
            )}

            {!!detail.heading && <Text style={styles.date}>{detail.heading}</Text>}
            {!!detail.title && <Text style={styles.heading}>{detail.title}</Text>}

            {!!bodyItems.length && (
              <View style={styles.bodyBlock}>
                {bodyItems.map((item, index) => {
                  const productId = Number(item.product_id);
                  const hasProductLink = Number.isInteger(productId) && productId > 0;

                  if (hasProductLink) {
                    return (
                      <TouchableOpacity
                        key={`${index}-${item.text}`}
                        style={styles.bodyLink}
                        activeOpacity={0.8}
                        onPress={() => openProduct(productId)}
                      >
                        <Text style={styles.bodyLinkText}>{item.text}</Text>
                        <Text style={styles.bodyLinkHint}>Перейти до товару →</Text>
                      </TouchableOpacity>
                    );
                  }

                  return (
                    <Text key={`${index}-${item.text}`} style={styles.bodyLine}>
                      {item.text}
                    </Text>
                  );
                })}
              </View>
            )}
          </View>
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
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  image: {
    width: '100%',
    height: 230,
    backgroundColor: '#EEF2EE',
  },
  date: {
    paddingHorizontal: 16,
    paddingTop: 16,
    fontSize: 14,
    fontWeight: '800',
    color: '#2E7D32',
  },
  heading: {
    paddingHorizontal: 16,
    paddingTop: 8,
    fontSize: 22,
    lineHeight: 29,
    fontWeight: '900',
    color: '#111827',
  },
  bodyBlock: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 18,
    gap: 10,
  },
  bodyLine: {
    fontSize: 16,
    lineHeight: 24,
    color: '#374151',
  },
  bodyLink: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#BBF7D0',
    backgroundColor: '#F0FDF4',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  bodyLinkText: {
    fontSize: 16,
    lineHeight: 23,
    color: '#166534',
    fontWeight: '800',
  },
  bodyLinkHint: {
    marginTop: 4,
    fontSize: 12,
    color: '#15803D',
    fontWeight: '800',
  },
  error: {
    fontSize: 15,
    lineHeight: 22,
    color: '#B91C1C',
    marginBottom: 14,
  },
});
