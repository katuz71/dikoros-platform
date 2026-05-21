
import { getImageUrl } from '@/utils/image';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

type Product = {
  id: number;
  name: string;
  price: number;
  old_price?: number | null;
  image?: string;
  picture?: string;
  image_url?: string;
  category?: string;
  badge?: string;
  unit?: string;
  is_hit?: boolean;
  is_bestseller?: boolean;
  is_new?: boolean;
  is_promotion?: boolean;
};

type Props = {
  title: string;
  products: Product[];
  favorites?: Product[];
  onOpenProduct: (product: Product) => void;
  onAddToCart: (product: Product) => void;
  onToggleFavorite: (product: Product) => void;
};

const formatPrice = (price: number) => `${Number(price || 0).toString().replace(/\\B(?=(\\d{3})+(?!\\d))/g, ' ')} ₴`;

const getBadge = (item: Product) => {
  if (item.is_promotion || (item.old_price && Number(item.old_price) > Number(item.price))) return '\u0410\u041a\u0426\u0406\u042f';
  if (item.is_hit || item.is_bestseller) return '\u0425\u0406\u0422';
  if (item.is_new) return '\u041d\u041e\u0412\u0418\u041d\u041a\u0410';
  return item.badge || '';
};

export default function HomeProductCarousel({
  title,
  products,
  favorites = [],
  onOpenProduct,
  onAddToCart,
  onToggleFavorite,
}: Props) {
  if (!Array.isArray(products) || products.length === 0) return null;

  return (
    <View style={styles.section}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>{title}</Text>
        <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.list}
      >
        {products.map((item) => {
          const badge = getBadge(item);
          const isFavorite = favorites.some((fav) => fav.id === item.id);
          const imageUrl = getImageUrl(item.image || item.picture || item.image_url || '');

          return (
            <TouchableOpacity
              key={item.id}
              activeOpacity={0.85}
              style={styles.card}
              onPress={() => onOpenProduct(item)}
            >
              <View style={styles.imageWrap}>
                <Image source={{ uri: imageUrl }} style={styles.image} resizeMode="cover" />

                {!!badge && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{badge}</Text>
                  </View>
                )}

                <TouchableOpacity
                  style={styles.favoriteButton}
                  onPress={() => onToggleFavorite(item)}
                >
                  <Ionicons
                    name={isFavorite ? 'heart' : 'heart-outline'}
                    size={17}
                    color={isFavorite ? '#DC2626' : '#4B5563'}
                  />
                </TouchableOpacity>
              </View>

              <Text numberOfLines={2} style={styles.name}>{item.name}</Text>

              <View style={styles.bottomRow}>
                <View style={{ flex: 1 }}>
                  {!!item.old_price && Number(item.old_price) > Number(item.price) && (
                    <Text style={styles.oldPrice}>{formatPrice(Number(item.old_price))}</Text>
                  )}
                  <Text style={styles.price}>{formatPrice(Number(item.price))}</Text>
                </View>

                <TouchableOpacity style={styles.cartButton} onPress={() => onAddToCart(item)}>
                  <Ionicons name="cart-outline" size={16} color="#fff" />
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: 22,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    paddingHorizontal: 2,
  },
  title: {
    fontSize: 22,
    fontWeight: '900',
    color: '#111827',
    textAlign: 'center',
  },
  list: {
    paddingRight: 20,
  },
  card: {
    width: 150,
    height: 238,
    marginRight: 14,
    backgroundColor: '#fff',
  },
  imageWrap: {
    width: '100%',
    height: 150,
    borderRadius: 0,
    backgroundColor: '#fff',
    overflow: 'hidden',
    position: 'relative',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  badge: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: '#F97316',
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 6,
  },
  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '900',
  },
  favoriteButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: {
    marginTop: 8,
    paddingHorizontal: 4,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: '#111827',
    height: 38,
  },
  bottomRow: {
    marginTop: 'auto',
    paddingHorizontal: 4,
    paddingBottom: 2,
    flexDirection: 'row',
    alignItems: 'center',
  },
  oldPrice: {
    fontSize: 11,
    color: '#9CA3AF',
    textDecorationLine: 'line-through',
  },
  price: {
    fontSize: 15,
    color: '#111827',
    fontWeight: '900',
  },
  cartButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#2E7D32',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
