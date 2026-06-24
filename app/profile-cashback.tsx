import { AppHeader } from '@/components/AppHeader';
import { API_URL } from '@/config/api';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

type UserProfile = {
  phone: string;
  bonus_balance: number;
  total_spent: number;
  cashback_percent: number;
  cumulative_discount_percent: number;
  global_cashback_percent: number;
};

const getCumulativeDiscountInfo = (totalSpent: number) => {
  if (totalSpent < 1999) return { currentPercent: 0, nextLevel: 1999, nextPercent: 5, prevLevel: 0 };
  if (totalSpent < 5000) return { currentPercent: 5, nextLevel: 5000, nextPercent: 10, prevLevel: 1999 };
  if (totalSpent < 10000) return { currentPercent: 10, nextLevel: 10000, nextPercent: 15, prevLevel: 5000 };
  if (totalSpent < 25000) return { currentPercent: 15, nextLevel: 25000, nextPercent: 20, prevLevel: 10000 };
  return { currentPercent: 20, nextLevel: 0, nextPercent: 20, prevLevel: 25000 };
};

export default function ProfileCashbackScreen() {
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async () => {
    try {
      setLoading(true);
      const accessToken = await AsyncStorage.getItem('accessToken');

      if (!accessToken) {
        router.replace('/login' as any);
        return;
      }

      const res = await fetch(`${API_URL}/api/user/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!res.ok) {
        if (res.status === 401 || res.status === 403 || res.status === 404) {
          await AsyncStorage.multiRemove(['accessToken', 'userPhone', 'userName']);
          router.replace('/login' as any);
          return;
        }

        Alert.alert('Помилка', 'Не вдалося завантажити бонуси');
        return;
      }

      setProfile(await res.json());
    } catch (e) {
      console.error(e);
      Alert.alert('Помилка', 'Немає з’єднання');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useFocusEffect(useCallback(() => {
    loadProfile();
  }, [loadProfile]));

  const totalSpent = profile?.total_spent || 0;
  const bonusBalance = profile?.bonus_balance || 0;
  const cumulativeDiscountPercent = profile?.cumulative_discount_percent
    ?? profile?.cashback_percent
    ?? getCumulativeDiscountInfo(totalSpent).currentPercent;
  const globalCashbackPercent = profile?.global_cashback_percent ?? 5;
  const { nextLevel, nextPercent, prevLevel } = getCumulativeDiscountInfo(totalSpent);
  const progressPercent = nextLevel > 0
    ? Math.min(((totalSpent - prevLevel) / (nextLevel - prevLevel)) * 100, 100)
    : 100;

  return (
    <View style={styles.container}>
      <AppHeader title="Бонуси та знижка" showBack />

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#458B00" />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.bonusCard}>
            <View style={styles.bonusTopRow}>
              <View>
                <Text style={styles.bonusLabel}>Доступні бонуси</Text>
                <Text style={styles.bonusValue}>{bonusBalance} ₴</Text>
              </View>
              <View style={styles.cashbackBadge}>
                <Text style={styles.cashbackText}>{globalCashbackPercent}% кешбек</Text>
              </View>
            </View>

            <Text style={styles.discountText}>
              Накопичувальна знижка: <Text style={styles.discountStrong}>{cumulativeDiscountPercent}%</Text>
            </Text>

            <View style={styles.progressSection}>
              <Text style={styles.progressText}>
                Всього витрачено: <Text style={styles.progressStrong}>{totalSpent} ₴</Text>
              </Text>

              <View style={styles.progressBarBg}>
                <View style={[styles.progressBarFill, { width: `${progressPercent}%` }]} />
              </View>

              <Text style={styles.progressSubtext}>
                {nextLevel > 0
                  ? `Ще ${Math.max(0, nextLevel - totalSpent)} ₴ до знижки ${nextPercent}%`
                  : 'Ви досягли максимальної накопичувальної знижки.'}
              </Text>
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Накопичувальна знижка</Text>

            <View style={styles.table}>
              <View style={[styles.tr, styles.trHead]}>
                <Text style={styles.th}>Сума покупок</Text>
                <Text style={styles.thRight}>Знижка</Text>
              </View>
              <View style={styles.tr}><Text style={styles.td}>0 – 1 998 ₴</Text><Text style={styles.tdRight}>0%</Text></View>
              <View style={styles.tr}><Text style={styles.td}>1 999 – 4 999 ₴</Text><Text style={styles.tdRight}>5%</Text></View>
              <View style={styles.tr}><Text style={styles.td}>5 000 – 9 999 ₴</Text><Text style={styles.tdRight}>10%</Text></View>
              <View style={styles.tr}><Text style={styles.td}>10 000 – 24 999 ₴</Text><Text style={styles.tdRight}>15%</Text></View>
              <View style={[styles.tr, { borderBottomWidth: 0 }]}><Text style={styles.td}>від 25 000 ₴</Text><Text style={styles.tdRight}>20%</Text></View>
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Як це працює</Text>
            <Text style={styles.paragraph}>Кешбек {globalCashbackPercent}% нараховується бонусами після підтвердження виконаного замовлення.</Text>
            <Text style={styles.paragraph}>Накопичена сума покупок підвищує автоматичну знижку в checkout.</Text>
            <Text style={styles.paragraph}>Доступні бонуси можна використати під час оформлення наступного замовлення.</Text>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F4F4F4' },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 15, paddingBottom: 150 },
  bonusCard: { padding: 20, backgroundColor: '#222', borderRadius: 18, marginBottom: 14 },
  bonusTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  bonusLabel: { color: '#AAA', fontSize: 14, marginBottom: 5 },
  bonusValue: { color: '#FFF', fontSize: 34, fontWeight: '900', marginBottom: 10 },
  cashbackBadge: { backgroundColor: '#444', paddingVertical: 7, paddingHorizontal: 12, borderRadius: 10 },
  cashbackText: { color: '#FFD700', fontWeight: '900', fontSize: 14 },
  discountText: { color: '#DDD', fontSize: 14, marginTop: 8 },
  discountStrong: { color: '#FFF', fontWeight: '900' },
  progressSection: { marginTop: 12, paddingTop: 15, borderTopWidth: 1, borderTopColor: '#444' },
  progressText: { fontSize: 14, color: '#CCC' },
  progressStrong: { color: '#FFF', fontWeight: '900' },
  progressBarBg: { height: 7, backgroundColor: '#555', borderRadius: 4, marginVertical: 10 },
  progressBarFill: { height: 7, backgroundColor: '#458B00', borderRadius: 4 },
  progressSubtext: { fontSize: 13, color: '#AAA' },
  card: { backgroundColor: '#FFF', borderRadius: 16, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: '#EEE' },
  cardTitle: { fontSize: 18, fontWeight: '900', color: '#111827', marginBottom: 12 },
  table: { borderWidth: 1, borderColor: '#EEE', borderRadius: 10, overflow: 'hidden' },
  tr: { flexDirection: 'row', justifyContent: 'space-between', padding: 13, borderBottomWidth: 1, borderBottomColor: '#EEE' },
  trHead: { backgroundColor: '#F5F5F5' },
  th: { flex: 1, fontWeight: '900', color: '#111827' },
  thRight: { width: 80, textAlign: 'right', fontWeight: '900', color: '#111827' },
  td: { flex: 1, color: '#374151' },
  tdRight: { width: 80, textAlign: 'right', color: '#111827', fontWeight: '900' },
  paragraph: { fontSize: 15, color: '#374151', lineHeight: 22, marginBottom: 8 },
});
