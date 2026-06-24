import { AppHeader } from '@/components/AppHeader';
import { API_URL } from '@/config/api';
import { useAppFooterAutoHide } from '@/hooks/use-app-footer-auto-hide';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

type NotificationItem = {
  id: number;
  type: string;
  title: string;
  body: string;
  data?: Record<string, any>;
  is_read: boolean;
  created_at?: string;
};

type PushStatus = 'checking' | 'granted' | 'undetermined' | 'denied' | 'unavailable';

const EXPO_PROJECT_ID = '66618f31-dc39-46f1-ba09-55c52d037f4a';

const TYPE_FILTERS = [
  { id: 'all', label: 'Всі' },
  { id: 'order_notification', label: 'Замовлення' },
  { id: 'cashback', label: 'Кешбек' },
  { id: 'promo', label: 'Акції' },
  { id: 'system', label: 'Системні' },
];

const DATE_FILTERS = [
  { id: 'all', label: 'Весь час' },
  { id: 'today', label: 'Сьогодні' },
  { id: 'yesterday', label: 'Вчора' },
  { id: 'week', label: '7 днів' },
  { id: 'month', label: '30 днів' },
];

const getTypeIcon = (type: string) => {
  const normalized = String(type || '').toLowerCase();
  if (normalized.includes('order')) return 'receipt-outline';
  if (normalized.includes('cashback')) return 'wallet-outline';
  if (normalized.includes('promo')) return 'pricetag-outline';
  return 'notifications-outline';
};

const formatDate = (value?: string) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 16);
  return date.toLocaleString('uk-UA', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export default function ProfileNotificationsScreen() {
  const router = useRouter();
  const { handleFooterScroll } = useAppFooterAutoHide();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [typeFilter, setTypeFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('all');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pushStatus, setPushStatus] = useState<PushStatus>('checking');
  const [subscribing, setSubscribing] = useState(false);

  const checkPushSubscriptionStatus = useCallback(async () => {
    try {
      if (!Device.isDevice) {
        setPushStatus('unavailable');
        return;
      }

      const permission = await Notifications.getPermissionsAsync();
      const storedToken = await AsyncStorage.getItem('expoPushToken');

      if (permission.status === 'granted' && storedToken) {
        setPushStatus('granted');
        return;
      }

      if (permission.status === 'denied') {
        setPushStatus('denied');
        return;
      }

      setPushStatus('undetermined');
    } catch {
      setPushStatus('undetermined');
    }
  }, []);

  const fetchNotifications = useCallback(async (nextType = typeFilter, nextDate = dateFilter) => {
    try {
      setLoading(true);
      const accessToken = await AsyncStorage.getItem('accessToken');
      if (!accessToken) {
        setItems([]);
        setUnreadCount(0);
        return;
      }

      const url = `${API_URL}/api/notifications/me?type=${encodeURIComponent(nextType)}&date_filter=${encodeURIComponent(nextDate)}&limit=100`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) return;

      setItems(Array.isArray(data?.items) ? data.items : []);
      setUnreadCount(Number(data?.unread_count || 0));
    } catch (error) {
      console.log(error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [typeFilter, dateFilter]);

  useFocusEffect(
    useCallback(() => {
      checkPushSubscriptionStatus();
      fetchNotifications();
    }, [checkPushSubscriptionStatus, fetchNotifications])
  );

  const subscribeToPushNotifications = async () => {
    if (subscribing) return;

    try {
      setSubscribing(true);

      if (!Device.isDevice) {
        setPushStatus('unavailable');
        Alert.alert('Недоступно', 'Push-сповіщення працюють тільки на реальному телефоні.');
        return;
      }

      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'default',
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#458B00',
        });
      }

      const existingPermission = await Notifications.getPermissionsAsync();
      let finalStatus = existingPermission.status;

      if (existingPermission.status !== 'granted') {
        const requestedPermission = await Notifications.requestPermissionsAsync();
        finalStatus = requestedPermission.status;
      }

      if (finalStatus !== 'granted') {
        setPushStatus('denied');
        Alert.alert(
          'Дозвіл не надано',
          'Щоб отримувати статуси замовлень, увімкніть сповіщення в налаштуваннях телефону.',
          [
            { text: 'Пізніше', style: 'cancel' },
            { text: 'Налаштування', onPress: () => Linking.openSettings().catch(() => {}) },
          ]
        );
        return;
      }

      const tokenData = await Notifications.getExpoPushTokenAsync({ projectId: EXPO_PROJECT_ID });
      const token = tokenData.data;
      await AsyncStorage.setItem('expoPushToken', token);

      const accessToken = await AsyncStorage.getItem('accessToken');
      if (!accessToken) {
        Alert.alert('Потрібен вхід', 'Увійдіть у профіль, щоб підписатися на сповіщення.');
        return;
      }

      const res = await fetch(`${API_URL}/api/user/push-token/me`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ token }),
      });

      if (!res.ok) {
        throw new Error('Failed to save push token');
      }

      setPushStatus('granted');
      Alert.alert('Готово', 'Сповіщення увімкнено.');
    } catch (error) {
      console.log(error);
      Alert.alert('Помилка', 'Не вдалося увімкнути сповіщення. Спробуйте ще раз.');
    } finally {
      setSubscribing(false);
    }
  };

  const setTypeAndReload = (value: string) => {
    setTypeFilter(value);
    fetchNotifications(value, dateFilter);
  };

  const setDateAndReload = (value: string) => {
    setDateFilter(value);
    fetchNotifications(typeFilter, value);
  };

  const markRead = async (notification: NotificationItem) => {
    if (!notification?.id || notification.is_read) return;
    try {
      const accessToken = await AsyncStorage.getItem('accessToken');
      if (!accessToken) return;
      await fetch(`${API_URL}/api/notifications/${notification.id}/read`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      setItems(prev => prev.map(item => item.id === notification.id ? { ...item, is_read: true } : item));
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch {
      // Reading is optional and must not block navigation.
    }
  };

  const markAllRead = async () => {
    try {
      const accessToken = await AsyncStorage.getItem('accessToken');
      if (!accessToken) return;
      await fetch(`${API_URL}/api/notifications/read-all`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      setItems(prev => prev.map(item => ({ ...item, is_read: true })));
      setUnreadCount(0);
    } catch (error) {
      console.log(error);
    }
  };

  const openNotification = async (notification: NotificationItem) => {
    await markRead(notification);
    const screen = String(notification?.data?.screen || '').toLowerCase();
    const type = String(notification?.type || notification?.data?.type || '').toLowerCase();
    if (screen === 'orders' || type.includes('order')) {
      router.push({ pathname: '/(tabs)/orders', params: { from: 'profile' } } as any);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    checkPushSubscriptionStatus();
    fetchNotifications();
  };

  const renderFilter = (filter: { id: string; label: string }, activeValue: string, onPress: (value: string) => void) => (
    <TouchableOpacity
      key={filter.id}
      style={[styles.filterChip, activeValue === filter.id && styles.filterChipActive]}
      onPress={() => onPress(filter.id)}
      activeOpacity={0.8}
    >
      <Text style={[styles.filterText, activeValue === filter.id && styles.filterTextActive]}>{filter.label}</Text>
    </TouchableOpacity>
  );

  const renderPushSubscriptionCard = () => {
    if (pushStatus === 'checking' || pushStatus === 'granted') return null;

    const isDenied = pushStatus === 'denied';
    const isUnavailable = pushStatus === 'unavailable';

    return (
      <View style={styles.subscribeCard}>
        <View style={styles.subscribeIconBox}>
          <Ionicons name={isDenied ? 'settings-outline' : 'notifications-outline'} size={24} color="#458B00" />
        </View>
        <View style={styles.subscribeTextBox}>
          <Text style={styles.subscribeTitle}>Увімкніть push-сповіщення</Text>
          <Text style={styles.subscribeText}>
            {isUnavailable
              ? 'Push працюють тільки на реальному телефоні.'
              : isDenied
                ? 'Дозвіл вимкнено. Відкрийте налаштування телефону та дозвольте сповіщення.'
                : 'Отримуйте статуси замовлень, кешбек та важливі повідомлення одразу.'}
          </Text>
        </View>
        {!isUnavailable && (
          <TouchableOpacity
            style={[styles.subscribeButton, subscribing && styles.subscribeButtonDisabled]}
            onPress={isDenied ? () => Linking.openSettings().catch(() => {}) : subscribeToPushNotifications}
            activeOpacity={0.85}
            disabled={subscribing}
          >
            {subscribing ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <Text style={styles.subscribeButtonText}>{isDenied ? 'Налаштування' : 'Увімкнути'}</Text>
            )}
          </TouchableOpacity>
        )}
      </View>
    );
  };

  const renderItem = ({ item }: { item: NotificationItem }) => (
    <TouchableOpacity style={[styles.card, !item.is_read && styles.cardUnread]} onPress={() => openNotification(item)} activeOpacity={0.85}>
      <View style={styles.iconBox}>
        <Ionicons name={getTypeIcon(item.type) as any} size={22} color="#458B00" />
      </View>
      <View style={styles.cardBody}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
          {!item.is_read && <View style={styles.unreadDot} />}
        </View>
        <Text style={styles.cardText}>{item.body}</Text>
        <Text style={styles.cardDate}>{formatDate(item.created_at)}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color="#C7C7C7" />
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <AppHeader
        title="Сповіщення"
        showBack
        showDone
        onDone={markAllRead}
        doneColor={unreadCount > 0 ? '#458B00' : '#9CA3AF'}
      />

      {renderPushSubscriptionCard()}

      <View style={styles.filtersWrap}>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={TYPE_FILTERS}
          keyExtractor={item => item.id}
          renderItem={({ item }) => renderFilter(item, typeFilter, setTypeAndReload)}
          contentContainerStyle={styles.filterList}
        />
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={DATE_FILTERS}
          keyExtractor={item => item.id}
          renderItem={({ item }) => renderFilter(item, dateFilter, setDateAndReload)}
          contentContainerStyle={styles.filterList}
        />
      </View>

      {loading && items.length === 0 ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#458B00" />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={item => String(item.id)}
          renderItem={renderItem}
          onScroll={handleFooterScroll}
          scrollEventThrottle={16}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Ionicons name="notifications-off-outline" size={62} color="#D1D5DB" />
              <Text style={styles.emptyTitle}>Сповіщень поки немає</Text>
              <Text style={styles.emptyText}>Тут будуть статуси замовлень, кешбек, акції та системні повідомлення.</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5' },
  filtersWrap: {
    backgroundColor: '#FFF',
    paddingTop: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#EEE',
  },
  filterList: { paddingHorizontal: 12, gap: 8, paddingBottom: 8 },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#F3F4F6',
    marginRight: 8,
  },
  filterChipActive: { backgroundColor: '#458B00' },
  filterText: { color: '#374151', fontWeight: '700', fontSize: 13 },
  filterTextActive: { color: '#FFF' },
  subscribeCard: {
    marginHorizontal: 14,
    marginTop: 12,
    marginBottom: 10,
    padding: 14,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D7E7D1',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  subscribeIconBox: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EEF7EA',
  },
  subscribeTextBox: { flex: 1 },
  subscribeTitle: { fontSize: 15, fontWeight: '900', color: '#111827', marginBottom: 3 },
  subscribeText: { fontSize: 12, lineHeight: 17, color: '#4B5563' },
  subscribeButton: { height: 38, paddingHorizontal: 14, borderRadius: 19, backgroundColor: '#458B00', alignItems: 'center', justifyContent: 'center', minWidth: 88 },
  subscribeButtonDisabled: { opacity: 0.7 },
  subscribeButtonText: { color: '#FFF', fontSize: 13, fontWeight: '900' },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 14, paddingBottom: 145 },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#EEE',
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardUnread: { borderColor: '#BBDDB2', backgroundColor: '#FBFFF9' },
  iconBox: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#EEF7EA', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  cardBody: { flex: 1 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { flex: 1, fontSize: 15, fontWeight: '900', color: '#111827' },
  unreadDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#458B00' },
  cardText: { marginTop: 5, fontSize: 13, color: '#4B5563', lineHeight: 18 },
  cardDate: { marginTop: 7, fontSize: 11, color: '#9CA3AF', fontWeight: '700' },
  emptyBox: { paddingTop: 80, alignItems: 'center', paddingHorizontal: 24 },
  emptyTitle: { marginTop: 14, fontSize: 18, fontWeight: '900', color: '#111827' },
  emptyText: { marginTop: 6, fontSize: 14, color: '#6B7280', textAlign: 'center', lineHeight: 20 },
});
