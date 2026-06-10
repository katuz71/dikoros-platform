import { getImageUrl } from '@/utils/image';
import { Ionicons } from '@expo/vector-icons';
import React, { memo, useCallback } from 'react';
import { FlatList, Image, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

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

type CardProps = {
  item: Product;
  isFavorite: boolean;
  onOpenProduct: (product: Product) => void;
  onAddToCart: (product: Product) => void;
  onToggleFavorite: (product: Product) => void;
};

const CARD_WIDTH = 150;
const CARD_GAP = 8;
const ITEM_WIDTH = CARD_WIDTH + CARD_GAP;

const formatPrice = (price: number) => `${Number(price || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ₴`;

const getBadges = (item: Product) => {
  const badges: string[] = [];

  if (item.is_promotion || (item.old_price && Number(item.old_price) > Number(item.price))) {
    badges.push('АКЦІЯ');
  }

  if (item.is_hit || item.is_bestseller) {
    badges.push('ХІТ');
  }

  if (item.is_new) {
    badges.push('НОВИНКА');
  }

  if (item.badge && !badges.includes(item.badge)) {
    badges.push(item.badge);
  }

  return badges;
};

const HomeProductCard = memo(function HomeProductCard({
  item,
  isFavorite,
  onOpenProduct,
  onAddToCart,
  onToggleFavorite,
}: CardProps) {
  const badges = getBadges(item);
  const imageUrl = getImageUrl(item.image || item.picture || item.image_url || '', {
    width: 300,
    height: 300,
    quality: 75,
    format: 'webp',
  });

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      style={styles.card}
      onPress={() => onOpenProduct(item)}
    >
      <View style={styles.imageWrap}>
        <Image
          source={{ uri: imageUrl }}
          style={styles.image}
          resizeMode="cover"
          fadeDuration={0}
        />

        {badges.length > 0 && (
          <View style={styles.badgesWrap}>
            {badges.map((badge) => (
              <View key={badge} style={styles.badge}>
                <Text style={styles.badgeText}>{badge}</Text>
              </View>
            ))}
          </View>
        )}

        <TouchableOpacity
          style={styles.favoriteButton}
          onPress={() => onToggleFavorite(item)}
          hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
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

        <TouchableOpacity
          style={styles.cartButton}
          onPress={() => onAddToCart(item)}
          hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
        >
          <Ionicons name="cart-outline" size={16} color="#fff" />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
});

export default function HomeProductCarousel({
  title,
  products,
  favorites = [],
  onOpenProduct,
  onAddToCart,
  onToggleFavorite,
}: Props) {
  const favoriteIds = new Set(favorites.map((favorite) => favorite.id));

  const renderItem = useCallback(
    ({ item }: { item: Product }) => (
      <HomeProductCard
        item={item}
        isFavorite={favoriteIds.has(item.id)}
        onOpenProduct={onOpenProduct}
        onAddToCart={onAddToCart}
        onToggleFavorite={onToggleFavorite}
      />
    ),
    [favoriteIds, onAddToCart, onOpenProduct, onToggleFavorite]
  );

  const keyExtractor = useCallback((item: Product) => String(item.id), []);
  const getItemLayout = useCallback(
    (_: ArrayLike<Product> | null | undefined, index: number) => ({
      length: ITEM_WIDTH,
      offset: ITEM_WIDTH * index,
      index,
    }),
    []
  );

  if (!Array.isArray(products) || products.length === 0) return null;

  return (
    <View style={styles.section}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>{title}</Text>
        <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
      </View>

      <FlatList
        data={products}
        horizontal
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        getItemLayout={getItemLayout}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.list}
        initialNumToRender={4}
        maxToRenderPerBatch={4}
        windowSize={3}
        removeClippedSubviews={Platform.OS === 'android'}
        nestedScrollEnabled
        directionalLockEnabled
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={16}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: 18,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    paddingHorizontal: 2,
  },
  title: {
    fontSize: 22,
    fontWeight: '900',
    color: '#111827',
    textAlign: 'center',
  },
  list: {
    paddingRight: 12,
  },
  card: {
    width: CARD_WIDTH,
    height: 238,
    marginRight: CARD_GAP,
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
  badgesWrap: {
    position: 'absolute',
    top: 8,
    left: 8,
    gap: 4,
    alignItems: 'flex-start',
  },
  badge: {
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
