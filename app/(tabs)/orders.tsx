import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { API_URL } from '@/config/api';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const OrderItem = ({ order, onPress, formatPrice }: any) => (
  <TouchableOpacity style={styles.card} onPress={onPress}>
    <View style={styles.cardHeader}>
      <Text style={styles.orderId}>Замовлення #{order.id}</Text>
      <Text style={styles.orderDate}>{order.date?.split(' ')[0]}</Text>
    </View>
    <View style={styles.divider} />
    <View style={styles.cardContent}>
      <View>
        <Text style={styles.priceLabel}>Сума замовлення</Text>
        <Text style={styles.priceValue}>{formatPrice(order.totalPrice)}</Text>
      </View>
      <View style={[
        styles.statusBadge, 
        { backgroundColor: ['Completed', 'Виконано', 'Paid'].includes(order.status) ? '#E8F5E9' : '#FFF3E0' }
      ]}>
        <Text style={[
          styles.statusText,
          { color: ['Completed', 'Виконано', 'Paid'].includes(order.status) ? '#2E7D32' : '#EF6C00' }
        ]}>
          {order.status === 'New' ? 'Новий' : 
           order.status === 'Completed' ? 'Виконано' :
           order.status === 'Paid' ? 'Оплачено' : order.status}
        </Text>
      </View>
    </View>
    {order.items && order.items.length > 0 && (
       <Text style={styles.itemsSummary} numberOfLines={1}>
          {order.items.map((i: any) => `${i.name}${i.variant_info || i.packSize || i.unit ? ` — ${i.variant_info || i.packSize || i.unit}` : ''} (${i.quantity} шт)`).join(', ')}
       </Text>
    )}
  </TouchableOpacity>
);

export default function OrdersScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const headerTopInset = Math.max(insets.top, 18);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const formatPrice = (value: number) => {
    const safeValue = Math.round(Number(value) || 0);
    return `${safeValue.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ₴`;
  };

  const fetchOrders = async () => {
    try {
      setLoading(true);
      const accessToken = await AsyncStorage.getItem('accessToken');
      if (!accessToken) {
        setOrders([]);
        setLoading(false);
        return;
      }

      const response = await fetch(`${API_URL}/api/client/orders/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      
      if (response.ok) {
        const data = await response.json();
        setOrders(data);
      }
    } catch (e) {
      console.log(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
        fetchOrders();
    }, [])
  );

  useEffect(() => {
    // Fallback: ensure initial load even if focus hook doesn't fire
    fetchOrders();
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    fetchOrders();
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: headerTopInset + 16 }]}> 
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Мої замовлення</Text>
        <View style={{ width: 34 }} />
      </View>

      <FlatList
        data={orders}
        keyExtractor={(item: any) => item.id.toString()}
        renderItem={({ item }) => (
            <OrderItem 
                order={item} 
                onPress={() => {}} 
                formatPrice={formatPrice}
            />
        )}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.emptyContainer}>
              <Ionicons name="receipt-outline" size={64} color="#DDD" />
              <Text style={styles.emptyText}>У вас ще немає замовлень</Text>
              <TouchableOpacity style={styles.shopBtn} onPress={() => router.push('/(tabs)')}>
                  <Text style={styles.shopBtnText}>Перейти до покупок</Text>
              </TouchableOpacity>
            </View>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5' },
  header: {
    backgroundColor: '#FFF', paddingHorizontal: 20, paddingBottom: 16, 
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderBottomWidth: 1, borderBottomColor: '#EEE'
  },
  headerTitle: { fontSize: 18, fontWeight: 'bold' },
  backBtn: { padding: 5 },
  list: { padding: 15 },
  card: { backgroundColor: '#FFF', borderRadius: 12, padding: 15, marginBottom: 15 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10, alignItems: 'center' },
  orderId: { fontWeight: 'bold', fontSize: 16 },
  orderDate: { color: '#888' },
  divider: { height: 1, backgroundColor: '#EEE', marginVertical: 10 },
  cardContent: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  priceLabel: { fontSize: 12, color: '#888' },
  priceValue: { fontSize: 18, fontWeight: 'bold' },
  statusBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  statusText: { fontWeight: 'bold', fontSize: 12 },
  itemsSummary: { marginTop: 10, color: '#666', fontSize: 13 },
  emptyContainer: { 
    flex: 1,
    padding: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 100 // Оставляем отступ сверху т.к. список
  },
  emptyText: { 
    color: '#888', 
    fontSize: 16, 
    marginTop: 15, 
    marginBottom: 32, // Как везде (было 20)
    textAlign: 'center',
    width: '80%',
    lineHeight: 20
  },
  shopBtn: { 
    backgroundColor: '#458B00', // Как везде
    paddingHorizontal: 40,
    paddingVertical: 15,
    borderRadius: 12,     // 12
    shadowColor: '#458B00',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4
  },
  shopBtnText: { color: '#FFF', fontWeight: 'bold', fontSize: 16 }
});