import { API_URL } from '@/config/api';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
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

  const loadDetail = async () => {
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
      });
    } catch (err) {
      console.warn('News detail load failed:', err);
      setError('Не вдалося завантажити акцію. Спробуйте оновити сторінку.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadDetail();
  }, [sourceUrl]);

  const onRefresh = () => {
    setRefreshing(true);
    loadDetail();
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
          activeOpacity={0.8}
        >
          <Ionicons name="arrow-back" size={26} color="#111" />
        </TouchableOpacity>

        <Text style={styles.title}>Акція</Text>

        <View style={styles.headerSpacer} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#2E7D32" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
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
            {!!detail.body && <Text style={styles.body}>{detail.body}</Text>}
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
    paddingTop: 48,
  },
  header: {
    height: 56,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAF8',
  },
  backButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: 22,
    fontWeight: '900',
    color: '#111',
  },
  headerSpacer: {
    width: 44,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  image: {
    width: '100%',
    height: 220,
    borderRadius: 14,
    marginBottom: 18,
    backgroundColor: '#EEF2EE',
  },
  date: {
    fontSize: 16,
    fontWeight: '800',
    color: '#2E7D32',
    marginBottom: 8,
  },
  heading: {
    fontSize: 22,
    fontWeight: '900',
    color: '#111',
    marginBottom: 12,
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
    color: '#374151',
  },
  error: {
    fontSize: 15,
    lineHeight: 22,
    color: '#B91C1C',
    marginBottom: 14,
  },
});
