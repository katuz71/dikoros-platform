import { AppHeader } from '@/components/AppHeader';
import { API_URL } from '@/config/api';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

type Review = {
  id: number;
  product_name?: string;
  rating: number;
  comment?: string;
  created_at: string;
};

export default function ProfileReviewsScreen() {
  const router = useRouter();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadReviews = useCallback(async () => {
    try {
      const accessToken = await AsyncStorage.getItem('accessToken');

      if (!accessToken) {
        router.replace('/login' as any);
        return;
      }

      const res = await fetch(`${API_URL}/api/user/reviews/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!res.ok) {
        if (res.status === 401 || res.status === 403 || res.status === 404) {
          await AsyncStorage.multiRemove(['accessToken', 'userPhone', 'userName']);
          router.replace('/login' as any);
          return;
        }

        Alert.alert('Помилка', 'Не вдалося завантажити відгуки');
        return;
      }

      setReviews(await res.json());
    } catch (e) {
      console.error(e);
      Alert.alert('Помилка', 'Немає з’єднання');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [router]);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    loadReviews();
  }, [loadReviews]));

  const onRefresh = () => {
    setRefreshing(true);
    loadReviews();
  };

  const deleteReview = async (id: number) => {
    Alert.alert('Видалити відгук?', 'Цю дію неможливо скасувати', [
      { text: 'Скасувати', style: 'cancel' },
      {
        text: 'Видалити',
        style: 'destructive',
        onPress: async () => {
          try {
            const accessToken = await AsyncStorage.getItem('accessToken');

            if (!accessToken) {
              router.replace('/login' as any);
              return;
            }

            const res = await fetch(`${API_URL}/api/reviews/${id}`, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${accessToken}` },
            });

            if (!res.ok) {
              Alert.alert('Помилка', 'Не вдалося видалити відгук');
              return;
            }

            setReviews((prev) => prev.filter((review) => review.id !== id));
          } catch (e) {
            console.error(e);
            Alert.alert('Помилка', 'Немає з’єднання');
          }
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <AppHeader title="Мої відгуки" showBack />

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#458B00" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {reviews.length === 0 ? (
            <View style={styles.emptyCard}>
              <Ionicons name="chatbubbles-outline" size={64} color="#CCC" />
              <Text style={styles.emptyTitle}>У вас поки немає відгуків</Text>
              <Text style={styles.emptyText}>Після покупки ви зможете залишити відгук на товар.</Text>
            </View>
          ) : (
            reviews.map((review, index) => (
              <View key={review.id || index} style={styles.reviewCard}>
                <View style={styles.reviewHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.productName}>{review.product_name || 'Товар'}</Text>
                    <View style={styles.starsRow}>
                      {[1, 2, 3, 4, 5].map((star) => (
                        <Ionicons
                          key={star}
                          name={star <= review.rating ? 'star' : 'star-outline'}
                          size={17}
                          color="#FFD700"
                        />
                      ))}
                    </View>
                  </View>

                  <TouchableOpacity onPress={() => deleteReview(review.id)} style={styles.trashButton}>
                    <Ionicons name="trash-outline" size={21} color="#EF4444" />
                  </TouchableOpacity>
                </View>

                {review.comment ? (
                  <Text style={styles.comment}>{review.comment}</Text>
                ) : null}

                <Text style={styles.dateText}>
                  {new Date(review.created_at).toLocaleDateString('uk-UA')}
                </Text>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F4F4F4' },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 15, paddingBottom: 150 },
  emptyCard: { backgroundColor: '#FFF', borderRadius: 16, padding: 28, alignItems: 'center', borderWidth: 1, borderColor: '#EEE' },
  emptyTitle: { fontSize: 18, fontWeight: '900', color: '#111827', marginTop: 12, marginBottom: 6 },
  emptyText: { color: '#6B7280', textAlign: 'center', lineHeight: 20 },
  reviewCard: { backgroundColor: '#FFF', padding: 16, borderRadius: 16, marginBottom: 14, borderWidth: 1, borderColor: '#EEE' },
  reviewHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
  productName: { fontWeight: '900', fontSize: 16, color: '#111827', marginBottom: 5 },
  starsRow: { flexDirection: 'row', gap: 2 },
  trashButton: { padding: 6, marginLeft: 10 },
  comment: { color: '#374151', fontSize: 14, lineHeight: 21, marginBottom: 8 },
  dateText: { color: '#9CA3AF', fontSize: 12 },
});
