import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Dimensions, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import ProductImage from './ProductImage';

const { width: screenWidth } = Dimensions.get('window');
// Используем flex вместо фиксированной ширины для идеальной симметрии

interface ProductCardProps {
  item: {
    id: number;
    name: string;
    price: number;
    old_price?: number;
    image?: string;
    picture?: string;
    image_url?: string;
    badge?: string;
    category?: string;
  };
  displayPrice?: string;
  onPress: () => void;
  onFavoritePress: () => void;
  onCartPress: () => void;
  isFavorite: boolean;
}

export default function ProductCard({ 
  item,
  displayPrice,
  onPress, 
  onFavoritePress, 
  onCartPress, 
  isFavorite 
}: ProductCardProps) {
  const safeName = item.name || '';
  {displayPrice || `${safePrice} ?`}
  const safeOldPrice = typeof item.old_price === 'number' ? item.old_price : null;
  const hasDiscount = safeOldPrice !== null && safeOldPrice > safePrice;
  const safeBadge = item.badge || null;
  const hasImage = !!(item.picture || item.image || item.image_url);

  return (
    <TouchableOpacity 
      onPress={onPress}
      activeOpacity={0.85}
      style={styles.card}
    >
      {/* Блок изображения (Верх) */}
      <View style={styles.imageBlock}>
        {hasImage ? (
          <ProductImage 
            uri={item.picture || item.image || item.image_url || ''} 
            style={styles.image}
          />
        ) : (
          <View style={styles.imagePlaceholder}>
            <Ionicons name="image-outline" size={32} color="#ccc" />
          </View>
        )}
        
        {/* Бейдж */}
        {safeBadge && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{safeBadge}</Text>
          </View>
        )}
        
        {/* Кнопка избранного */}
        <TouchableOpacity 
          onPress={onFavoritePress}
          style={styles.favoriteButton}
          activeOpacity={0.7}
        >
          <Ionicons 
            name={isFavorite ? "heart" : "heart-outline"} 
            size={18} 
            color={isFavorite ? "#DC2626" : "white"} 
          />
        </TouchableOpacity>
      </View>
      
      {/* Инфо-блок (Центр + Низ) */}
      <View style={styles.infoBlock}>
        {/* Название товара */}
        <View style={styles.nameContainer}>
          <Text style={styles.name} numberOfLines={2}>
            {safeName}
          </Text>
        </View>
        
        {/* Нижний ряд (Цена + Корзина) - прижат к низу */}
        <View style={styles.bottomRow}>
          <View style={styles.priceContainer}>
            <Text style={styles.price}>
              {safePrice} ₴
            </Text>
            {hasDiscount && (
              <Text style={styles.oldPrice}>
                {safeOldPrice} ₴
              </Text>
            )}
          </View>
          
          {/* Кнопка корзины */}
          <TouchableOpacity 
            onPress={onCartPress}
            style={styles.cartButton}
            activeOpacity={0.7}
          >
            <Ionicons 
              name="cart-outline" 
              size={16} 
              color="white" 
            />
          </TouchableOpacity>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
  flex: 0.48, // 48% ширины контейнера для идеального распределения
  backgroundColor: 'white',
  borderRadius: 12,
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.1,
  shadowRadius: 4,
  elevation: 3,
  overflow: 'hidden',
  minHeight: 300, // Фиксированная минимальная высота
  flexDirection: 'column',
},
  imageBlock: {
    position: 'relative',
    aspectRatio: 1, // Квадратный блок изображения
    backgroundColor: '#f5f5f5',
  },
  image: {
    width: '100%',
    height: '100%',
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    resizeMode: 'cover',
  },
  imagePlaceholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },
  badge: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: '#DC2626',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  badgeText: {
    color: 'white',
    fontSize: 10,
    fontWeight: 'bold',
  },
  favoriteButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  infoBlock: {
    flex: 1,
    flexDirection: 'column',
    padding: 12,
    justifyContent: 'space-between', // Распределяем пространство
  },
  nameContainer: {
    minHeight: 40, // Фиксированная высота на 2 строки
    maxHeight: 40,
  },
  name: {
    fontSize: 14,
    fontWeight: '500',
    color: '#111827',
    lineHeight: 20,
  },
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 'auto', // Прижимаем к низу
  },
  priceContainer: {
    flex: 1,
  },
  price: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#111827',
  },
  oldPrice: {
    fontSize: 12,
    color: '#9CA3AF',
    textDecorationLine: 'line-through',
  },
  cartButton: {
    backgroundColor: '#2E7D32',
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
});
