import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleProp, StyleSheet, Text, TouchableOpacity, View, ViewStyle } from 'react-native';
import ProductImage from './ProductImage';

interface ProductCardProps {
  item: {
    id: number;
    name: string;
    price: number | null;
    old_price?: number | null;
    image?: string;
    picture?: string;
    image_url?: string;
    badge?: string;
    category?: string;
    variants?: any[] | string;
    minPrice?: number;
    unit?: string;
  };
  displayPrice?: string;
  onPress: () => void;
  onFavoritePress: () => void;
  onCartPress: () => void;
  isFavorite: boolean;
  style?: StyleProp<ViewStyle>;
}

const formatPrice = (price: number) => `${Number(price || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ₴`;

const clean = (value: any) => String(value ?? '').trim().replace(/^"+|"+$/g, '').replace(/\s+/g, ' ');

const parseVariants = (value: any): any[] => {
  if (Array.isArray(value)) return value.filter(Boolean);

  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch {
      return [];
    }
  }

  return [];
};

const getVariantLabel = (variant: any) => {
  return clean(variant?.name || variant?.variant || variant?.variant_name || variant?.title || variant?.size || variant?.pack_size || variant?.packSize);
};

const getVariantPrice = (variant: any, fallback: number) => {
  const raw = Number(variant?.price ?? 0);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
};

const getVariantOldPrice = (variant: any, fallback: number | null) => {
  const raw = Number(variant?.old_price ?? 0);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
};

const pickDisplayVariant = (item: any) => {
  const variants = parseVariants(item?.variants);
  if (!variants.length) return null;

  const withRealPrice = variants.find((variant) => getVariantPrice(variant, 0) > 0);
  return withRealPrice || variants[0] || null;
};

export default function ProductCard({ 
  item,
  displayPrice,
  onPress, 
  onFavoritePress, 
  onCartPress, 
  isFavorite,
  style
}: ProductCardProps) {
  const safeName = item.name || '';
  const basePrice = typeof item.price === 'number' ? item.price : 0;
  const displayVariant = pickDisplayVariant(item);
  const exactPrice = getVariantPrice(displayVariant, basePrice);
  const safeOldPrice = getVariantOldPrice(displayVariant, typeof item.old_price === 'number' ? item.old_price : null);
  const hasDiscount = safeOldPrice !== null && safeOldPrice > exactPrice;
  const safeBadge = item.badge || null;
  const hasImage = !!(item.picture || item.image || item.image_url);
  const isDefaultGridCard = !style;
  const shouldUseExternalDisplayPrice = !!displayPrice;
  const resolvedDisplayPrice = shouldUseExternalDisplayPrice ? displayPrice : formatPrice(exactPrice);

  return (
    <TouchableOpacity 
      onPress={onPress}
      activeOpacity={0.85}
      style={[styles.card, isDefaultGridCard && styles.categoryGridCard, style]}
    >
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
        
        {safeBadge && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{safeBadge}</Text>
          </View>
        )}
        
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
      
      <View style={styles.infoBlock}>
        <View style={styles.nameContainer}>
          <Text style={styles.name} numberOfLines={2}>
            {safeName}
          </Text>
        </View>
        
        <View style={styles.bottomRow}>
          <View style={styles.priceContainer}>
            <Text style={styles.price}>
              {resolvedDisplayPrice}
            </Text>
            {hasDiscount && (
              <Text style={styles.oldPrice}>
                {formatPrice(safeOldPrice)}
              </Text>
            )}
          </View>
          
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
    flex: 0.48,
    backgroundColor: 'white',
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    overflow: 'hidden',
    minHeight: 300,
    flexDirection: 'column',
  },
  categoryGridCard: {
    flex: 1,
    marginHorizontal: 1,
    marginBottom: 3,
  },
  imageBlock: {
    position: 'relative',
    aspectRatio: 1,
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
    justifyContent: 'space-between',
  },
  nameContainer: {
    minHeight: 40,
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
    marginTop: 'auto',
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