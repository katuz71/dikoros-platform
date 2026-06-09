import { API_ENDPOINTS, API_URL } from '@/config/api';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
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

type NewsSection = {
  heading?: string;
  body?: string;
  image_url?: string | null;
};

type NewsPage = {
  title?: string;
  updated_at?: string;
  sections?: NewsSection[];
};

export default function NewsScreen() {
  const router = useRouter();
  const [page, setPage] = useState<NewsPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const loadPage = async () => {
    try {
      setError('');
      const response = await fetch(`${API_URL}${API_ENDPOINTS.newsPage}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      setPage(data);
    } catch (err) {
      console.warn('News page load failed:', err);
      setError('Не вдалося завантажити інформацію. Спробуйте оновити сторінку.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadPage();
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    loadPage();
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

        <Text style={styles.title}>{page?.title || 'Акції'}</Text>

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

          {(page?.sections || []).map((section, index) => (
            <View key={index} style={styles.card}>
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
                <Text style={styles.cardText}>{section.body}</Text>
              )}
            </View>
          ))}

          {!error && (!page?.sections || page.sections.length === 0) && (
            <Text style={styles.empty}>Інформація поки що відсутня.</Text>
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
    fontWeight: '800',
    color: '#111',
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
