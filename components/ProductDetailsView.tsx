import { useCart } from '@/context/CartContext';
import { trackEvent } from '@/utils/analytics';
import { logFirebaseEvent } from '@/utils/firebaseAnalytics';
import { getImageUrl } from '@/utils/image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Dimensions, NativeScrollEvent, NativeSyntheticEvent, ScrollView, StyleSheet, Text, TouchableOpacity, Vibration, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppHeader } from './AppHeader';
import ProductCard from './ProductCard';
import ProductImage from './ProductImage';

interface ProductDetailsViewProps {
  product: any;
  variantRows: any[];
  optionKeys: string[];
  internalKeys: string[];
  matrix: Record<string, string[]>;
  selectedOptions: Record<string, string>;
  applyOptionChange: (key: string, value: string) => void;
  isOptionAvailable: (key: string, value: string) => boolean;
  currentPrice: number;
  oldPrice?: number;
  activeRow: any;
  onAddToCart: () => void;
  isInCart?: boolean;
  cartButtonLabel?: string;
  onToggleFavorite: () => void;
  isFavorite: boolean;
  onShare: () => void;
  formatPrice: (price: number) => string;
  clean: (v: any) => string;
  reviews?: any[];
  totalReviews?: number;
  averageRating?: number;
  onWriteReview?: () => void;
  similarProducts?: any[];
  onSimilarProductPress?: (id: number) => void;
  onSimilarProductAddToCart?: (product: any) => void;
  onSimilarProductToggleFavorite?: (product: any) => void;
  favorites?: any[];
}

const screenWidth = Dimensions.get('window').width;

export const ProductDetailsView: React.FC<ProductDetailsViewProps> = ({
  product,
  variantRows,
  optionKeys,
  internalKeys,
  matrix,
  selectedOptions,
  applyOptionChange,
  isOptionAvailable,
  currentPrice,
  oldPrice,
  activeRow,
  onAddToCart,
  isInCart = false,
  cartButtonLabel,
  onToggleFavorite,
  isFavorite,
  onShare,
  formatPrice,
  clean,
  reviews = [],
  totalReviews = 0,
  averageRating = 0,
  onWriteReview,
  similarProducts = [],
  onSimilarProductPress,
  onSimilarProductAddToCart,
  onSimilarProductToggleFavorite,
  favorites = [],
}) => {
  const [tab, setTab] = React.useState<'desc' | 'ingr' | 'use'>('desc');
  const [activeImageIndex, setActiveImageIndex] = React.useState(0);
  const [localAddedToCart, setLocalAddedToCart] = React.useState(false);
  const [selectedQuantity, setSelectedQuantity] = React.useState(1);
  const [quantityMenuOpen, setQuantityMenuOpen] = React.useState(false);
  const [descriptionExpanded, setDescriptionExpanded] = React.useState(false);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { addItem } = useCart() as any;
  void onAddToCart;
  void variantRows;

  const quantityOptions = React.useMemo(() => Array.from({ length: 10 }, (_, index) => index + 1), []);

  const selectedSignature = React.useMemo(() => {
    const selected = internalKeys.map(k => selectedOptions[k]).filter(Boolean).join(' | ');
    return `${Number(product?.id || 0)}::${clean(selected || product?.unit || 'шт')}::${clean(activeRow?.rowId || '')}`;
  }, [product?.id, product?.unit, activeRow?.rowId, internalKeys, selectedOptions, clean]);

  React.useEffect(() => {
    setLocalAddedToCart(false);
  }, [selectedSignature]);

  React.useEffect(() => {
    setDescriptionExpanded(false);
  }, [product?.id]);

  const normalizeText = React.useCallback((value: any) => {
    const decodeEntities = (source: string) => source
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&ldquo;/g, '«')
      .replace(/&rdquo;/g, '»')
      .replace(/&lsquo;/g, '‘')
      .replace(/&rsquo;/g, '’')
      .replace(/&laquo;/g, '«')
      .replace(/&raquo;/g, '»')
      .replace(/&mdash;/g, '—')
      .replace(/&ndash;/g, '–')
      .replace(/&hellip;/g, '…')
      .replace(/&deg;/g, '°')
      .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
      .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));

    let text = String(value || '');
    text = decodeEntities(decodeEntities(decodeEntities(text)));

    return text
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<li[^>]*>/gi, '- ')
      .replace(/<h[1-6][^>]*>/gi, '\n')
      .replace(/<\/h[1-6]>/gi, '\n')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/[“”]/g, '"')
      .replace(/[«»]/g, '"')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }, []);

  const getImages = React.useCallback((item: any) => {
    const gallery: string[] = [];
    const pushImage = (value: any) => {
      const src = String(value || '').trim();
      if (src) gallery.push(src);
    };

    pushImage(item?.image || item?.picture || item?.image_url);

    if (Array.isArray(item?.images)) {
      item.images.forEach(pushImage);
    } else if (typeof item?.images === 'string') {
      if (item.images.trim().startsWith('[')) {
        try {
          const parsed = JSON.parse(item.images);
          if (Array.isArray(parsed)) parsed.forEach(pushImage);
        } catch {}
      } else {
        item.images.split(',').forEach(pushImage);
      }
    }

    const seen = new Set<string>();
    const out = gallery
      .map((src) => getImageUrl(src))
      .filter((src) => src && src !== 'null' && src !== 'undefined')
      .filter((src) => {
        if (seen.has(src)) return false;
        seen.add(src);
        return true;
      });

    return out.length ? out : [getImageUrl('')];
  }, []);

  const images = React.useMemo(() => getImages(product), [getImages, product]);

  React.useEffect(() => {
    setActiveImageIndex(0);
  }, [product?.id, product?.image]);

  const isAvailable = React.useCallback((row: any) => {
    const raw = row?.raw || row || {};
    const status = clean(raw?.status || product?.status).toLowerCase();
    const disabled = ['unavailable', 'out_of_stock', 'disabled', 'відсутній', 'немає в наявності', 'нет в наличии'];
    return !disabled.some((word) => status.includes(word));
  }, [clean, product?.status]);

  const requiresVariantRow = variantRows.length > 0;
  const activeAvailable = requiresVariantRow ? !!activeRow && isAvailable(activeRow) : isAvailable(product);
  const resolvedIsInCart = isInCart || localAddedToCart;
  const displaySku = clean(activeRow?.raw?.sku || activeRow?.sku || product?.sku);

  const selectedVariantLabel = React.useMemo(() => {
    return internalKeys.map(k => selectedOptions[k]).filter(Boolean).join(' | ');
  }, [internalKeys, selectedOptions]);

  const selectedUnit = product?.unit || 'шт';
  const selectedPack = selectedVariantLabel || selectedUnit;

  const addSelectedToCart = React.useCallback((goToCheckout: boolean) => {
    setQuantityMenuOpen(false);
    if (requiresVariantRow && !activeRow) return;

    if (resolvedIsInCart && !goToCheckout) {
      router.push('/(tabs)/cart' as any);
      return;
    }

    if (!resolvedIsInCart) {
      Vibration.vibrate(10);
      addItem(product, selectedQuantity, selectedPack, selectedUnit, currentPrice);
      setLocalAddedToCart(true);

      const analyticsItem = {
        item_id: String(product?.id),
        item_name: product?.name,
        price: currentPrice,
        quantity: selectedQuantity,
        item_variant: selectedPack,
      };

      trackEvent('AddToCart', {
        content_ids: [product?.id],
        content_type: 'product',
        content_name: product?.name,
        value: currentPrice * selectedQuantity,
        currency: 'UAH',
        quantity: selectedQuantity,
        items: [analyticsItem],
      });

      logFirebaseEvent('add_to_cart', {
        currency: 'UAH',
        value: currentPrice * selectedQuantity,
        items: [analyticsItem],
      });
    }

    if (goToCheckout) {
      router.push('/checkout' as any);
    }
  }, [activeRow, addItem, currentPrice, product, requiresVariantRow, resolvedIsInCart, router, selectedPack, selectedQuantity, selectedUnit]);

  const handleImageScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const nextIndex = Math.round((event.nativeEvent.contentOffset.x || 0) / screenWidth);
    setActiveImageIndex(Math.max(0, Math.min(nextIndex, images.length - 1)));
  };

  const tabText = React.useMemo(() => {
    const desc = normalizeText(product?.description) || '—';
    return {
      desc,
      ingr: normalizeText(product?.composition) || 'Інформація про склад не вказана.',
      use: normalizeText(product?.usage) || 'Спосіб використання не вказаний.',
    };
  }, [normalizeText, product?.description, product?.composition, product?.usage]);

  const renderParagraphs = (text: string) => (
    <View style={styles.structuredWrap}>
      {String(text || '').split(/\r?\n/).map((line, index) => {
        const trimmed = line.trim();
        if (!trimmed) return <View key={`sp-${index}`} style={styles.structuredSpacer} />;
        if (trimmed.startsWith('- ')) {
          return (
            <View key={`b-${index}`} style={styles.bulletRow}>
              <Text style={styles.bulletDot}>•</Text>
              <Text style={styles.bulletText}>{trimmed.slice(2)}</Text>
            </View>
          );
        }
        return <Text key={`p-${index}`} style={styles.paragraphText}>{trimmed}</Text>;
      })}
    </View>
  );

  const renderProductInfo = (text: string) => {
    const paragraphs = String(text || '')
      .split(/\n{2,}|\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const intro = paragraphs[0] || 'Опис товару буде оновлено найближчим часом.';
    const details = paragraphs.slice(1);
    const hasMore = details.length > 2;
    const visibleDetails = descriptionExpanded ? details : details.slice(0, 2);

    return (
      <View style={styles.productInfoBlock}>
        <Text style={styles.infoSectionTitle}>Інформація про продукт</Text>

        <View style={styles.infoCard}>
          <View style={styles.infoHeaderRow}>
            <View style={styles.infoIconCircle}>
              <Ionicons name="leaf-outline" size={23} color="#FFFFFF" />
            </View>
            <View style={styles.infoHeaderText}>
              <Text style={styles.infoCardTitle}>Огляд продукту</Text>
              <Text style={styles.infoCardNote}>Коротка інформація. Не є медичною рекомендацією.</Text>
            </View>
          </View>

          <Text style={styles.infoHeading}>Коротко про товар</Text>
          <Text style={styles.infoText}>{intro}</Text>

          {visibleDetails.length > 0 && (
            <>
              <Text style={styles.infoHeading}>Детальніше</Text>
              {visibleDetails.map((item, index) => (
                <Text key={`detail-${index}`} style={styles.infoText}>{item}</Text>
              ))}
            </>
          )}

          {hasMore && !descriptionExpanded && <View style={styles.infoFade} pointerEvents="none" />}

          {hasMore && (
            <TouchableOpacity
              onPress={() => setDescriptionExpanded(value => !value)}
              style={styles.expandButton}
              activeOpacity={0.85}
            >
              <Text style={styles.expandButtonText}>{descriptionExpanded ? 'Згорнути' : 'Розгорнути'}</Text>
              <Ionicons name={descriptionExpanded ? 'chevron-up' : 'chevron-down'} size={17} color="#374151" />
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={styles.root}>
      <AppHeader showLogo showBack backIcon="chevron-back" showSearch showFavoriteToggle />

      <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: 210 + insets.bottom }]} showsVerticalScrollIndicator={false}>
        <View style={styles.imageWrap}>
          <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} onMomentumScrollEnd={handleImageScroll}>
            {images.map((img, index) => (
              <ProductImage
                key={`${img}-${index}`}
                uri={img}
                uris={[img, ...images.filter((_, i) => i !== index), getImageUrl('')]}
                cacheKey={`pdp:${String(product?.id || '')}:${index}`}
                style={styles.mainImage}
                size={screenWidth}
                contentFit="contain"
              />
            ))}
          </ScrollView>

          <View style={styles.imageActions}>
            <TouchableOpacity onPress={onToggleFavorite} style={[styles.imageActionButton, isFavorite && styles.imageActionButtonActive]} activeOpacity={0.8}>
              <Ionicons name={isFavorite ? 'heart' : 'heart-outline'} size={27} color={isFavorite ? '#EF4444' : '#111827'} />
            </TouchableOpacity>
            <TouchableOpacity onPress={onShare} style={styles.imageActionButton} activeOpacity={0.8}>
              <Ionicons name="share-social-outline" size={25} color="#111827" />
            </TouchableOpacity>
          </View>

          {images.length > 1 && (
            <View style={styles.imageDots}>
              {images.map((_, index) => <View key={index} style={[styles.imageDot, index === activeImageIndex && styles.imageDotActive]} />)}
            </View>
          )}
        </View>

        <View style={styles.content}>
          <View style={styles.statsRow}>
            <View style={styles.statusBadge}>
              <View style={[styles.statusDot, !activeAvailable && styles.statusDotDisabled]} />
              <Text style={[styles.statusText, !activeAvailable && styles.statusTextDisabled]}>{activeAvailable ? 'В наявності' : 'Немає в наявності'}</Text>
            </View>
            <View style={styles.ratingRow}>
              <View style={styles.stars}>{[1, 2, 3, 4, 5].map(s => <Ionicons key={s} name="star" size={14} color={s <= averageRating ? '#FFD700' : '#E5E7EB'} />)}</View>
              <Text style={styles.reviewCount}>{totalReviews} відгуки</Text>
            </View>
          </View>

          <View style={styles.titleSection}>
            <Text style={styles.productTitle}>{product?.name}</Text>
            <View style={styles.priceRow}>
              <Text style={styles.priceText}>{formatPrice(currentPrice)}</Text>
              {!!oldPrice && oldPrice > currentPrice && <Text style={styles.oldPriceText}>{formatPrice(oldPrice)}</Text>}
            </View>
            {!!displaySku && <Text style={styles.skuText}>Артикул: {displaySku}</Text>}
          </View>

          <View style={styles.trustBadges}>
            <View style={styles.badgeItem}><Ionicons name="shield-checkmark-outline" size={22} color="#10b981" /><Text style={styles.badgeText}>100% Оригінал</Text></View>
            <View style={styles.badgeItem}><Ionicons name="rocket-outline" size={22} color="#059669" /><Text style={styles.badgeText}>Швидка доставка</Text></View>
            <View style={styles.badgeItem}><Ionicons name="leaf-outline" size={22} color="#059669" /><Text style={styles.badgeText}>Еко продукт</Text></View>
          </View>

          {internalKeys.length > 0 && (
            <View style={styles.variationsSection}>
              {internalKeys.map((key, index) => (
                <View key={key} style={styles.optionGroup}>
                  <Text style={styles.optionTitle}>{optionKeys[index]}</Text>
                  <View style={styles.optionValues}>
                    {(matrix[key] || []).map((value) => {
                      const selected = clean(selectedOptions[key]) === clean(value);
                      const disabled = !isOptionAvailable(key, value);
                      return (
                        <TouchableOpacity
                          key={value}
                          onPress={() => applyOptionChange(key, value)}
                          disabled={disabled}
                          accessibilityState={{ selected, disabled }}
                          style={[styles.optionBtn, disabled && styles.optionBtnDisabled, selected && styles.optionBtnActive]}
                        >
                          <Text numberOfLines={1} style={[styles.optionBtnText, disabled && styles.optionBtnTextDisabled, selected && styles.optionBtnTextActive]}>{value}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              ))}
            </View>
          )}

          <View style={styles.tabsContainer}>
            {(['desc', 'ingr', 'use'] as const).map((key) => (
              <TouchableOpacity key={key} onPress={() => setTab(key)} style={[styles.tabBtn, tab === key && styles.tabBtnActive]}>
                <Text style={[styles.tabBtnText, tab === key && styles.tabBtnTextActive]}>{key === 'desc' ? 'Опис' : key === 'ingr' ? 'Склад' : 'Використання'}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {tab === 'desc' ? renderProductInfo(tabText.desc) : renderParagraphs(tabText[tab])}

          {similarProducts.length > 0 && (
            <View style={styles.similarSection}>
              <Text style={styles.sectionTitle}>Схожі товари</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.similarList}>
                {similarProducts.map((item) => (
                  <View key={item.id} style={styles.similarCardContainer}>
                    <ProductCard
                      item={item}
                      onPress={() => onSimilarProductPress?.(item.id)}
                      onCartPress={() => onSimilarProductAddToCart?.(item)}
                      onFavoritePress={() => onSimilarProductToggleFavorite?.(item)}
                      isFavorite={favorites.some((f: any) => f.id === item.id)}
                      style={{ flex: 0, width: '100%', marginLeft: 0 }}
                    />
                  </View>
                ))}
              </ScrollView>
            </View>
          )}

          <View style={styles.reviewsHeader}>
            <Text style={styles.sectionTitle}>Відгуки</Text>
            <TouchableOpacity onPress={onWriteReview} style={styles.writeReviewBtn}><Text style={styles.writeReviewText}>Написати</Text></TouchableOpacity>
          </View>

          {reviews.length > 0 ? reviews.slice(0, 3).map((review) => (
            <View key={review.id} style={styles.reviewCard}>
              <View style={styles.reviewMain}>
                <Text style={styles.reviewerName}>{review.user_name}</Text>
                <View style={styles.starsMini}>{[1, 2, 3, 4, 5].map(star => <Ionicons key={star} name={star <= review.rating ? 'star' : 'star-outline'} size={12} color="#FFD700" />)}</View>
              </View>
              <Text style={styles.reviewComment}>{review.comment}</Text>
            </View>
          )) : (
            <View style={styles.emptyReviews}><Text style={styles.emptyReviewsText}>Поки немає відгуків</Text></View>
          )}
        </View>
      </ScrollView>

      <View style={[styles.stickyCartBar, { bottom: 58 + Math.max(insets.bottom, 0) }]}>
        {quantityMenuOpen && (
          <View style={styles.quantityDropdown}>
            <ScrollView showsVerticalScrollIndicator={false}>
              {quantityOptions.map((qty) => (
                <TouchableOpacity
                  key={qty}
                  style={[styles.quantityOption, qty === selectedQuantity && styles.quantityOptionActive]}
                  onPress={() => {
                    setSelectedQuantity(qty);
                    setQuantityMenuOpen(false);
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.quantityOptionText, qty === selectedQuantity && styles.quantityOptionTextActive]}>{qty}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        <View style={styles.cartControlsRow}>
          <TouchableOpacity style={styles.quantitySelector} onPress={() => setQuantityMenuOpen(v => !v)} activeOpacity={0.8}>
            <Text style={styles.quantityText}>{selectedQuantity}</Text>
            <Ionicons name={quantityMenuOpen ? 'chevron-up' : 'chevron-down'} size={20} color="#6B7280" />
          </TouchableOpacity>

          <TouchableOpacity style={[styles.quickOrderBtn, !activeAvailable && styles.actionBtnDisabled]} onPress={() => addSelectedToCart(true)} disabled={!activeAvailable} activeOpacity={0.88}>
            <Text style={styles.quickOrderText}>Швидке{`\n`}замовлення</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.addToCartBtn, !activeAvailable && styles.actionBtnDisabled]} onPress={() => addSelectedToCart(false)} disabled={!activeAvailable} activeOpacity={0.88}>
            <Text style={styles.addToCartText}>{activeAvailable ? (resolvedIsInCart ? 'Перейти в кошик' : (cartButtonLabel || 'В кошик')) : 'Немає в наявності'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, position: 'relative', zIndex: 200, elevation: 200, backgroundColor: '#fff' },
  scrollContent: { paddingTop: 0 },
  imageWrap: { width: screenWidth, height: 312, backgroundColor: '#fff' },
  mainImage: { width: screenWidth, height: 312 },
  imageActions: { position: 'absolute', right: 16, top: 52, gap: 14, zIndex: 5, elevation: 5 },
  imageActionButton: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#D1D5DB', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.12, shadowRadius: 6, elevation: 4 },
  imageActionButtonActive: { borderColor: '#FCA5A5' },
  imageDots: { position: 'absolute', bottom: 10, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6 },
  imageDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#D1D5DB' },
  imageDotActive: { width: 16, backgroundColor: '#111827' },
  content: { padding: 20 },
  statsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  statusBadge: { flexDirection: 'row', alignItems: 'center' },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#4CAF50', marginRight: 6 },
  statusDotDisabled: { backgroundColor: '#9CA3AF' },
  statusText: { color: '#4CAF50', fontSize: 13, fontWeight: '500' },
  statusTextDisabled: { color: '#6B7280' },
  ratingRow: { flexDirection: 'row', alignItems: 'center' },
  stars: { flexDirection: 'row', marginRight: 8 },
  reviewCount: { color: '#666', fontSize: 12 },
  titleSection: { marginBottom: 20 },
  productTitle: { fontSize: 26, fontWeight: '800', color: '#1a1a1a', marginBottom: 8, letterSpacing: -0.5 },
  skuText: { color: '#6B7280', fontSize: 13, fontWeight: '600', marginTop: 4 },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  priceText: { fontSize: 28, fontWeight: '700', color: '#000' },
  oldPriceText: { textDecorationLine: 'line-through', color: '#9ca3af', fontSize: 18, fontWeight: '500' },
  trustBadges: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 30, backgroundColor: '#f8fafc', padding: 16, borderRadius: 16, borderWidth: 1, borderColor: '#f1f5f9' },
  badgeItem: { alignItems: 'center', flex: 1 },
  badgeText: { fontSize: 11, fontWeight: '600', color: '#475569', marginTop: 6 },
  variationsSection: { marginBottom: 24 },
  optionGroup: { marginBottom: 15 },
  optionTitle: { fontSize: 16, fontWeight: '700', color: '#1a1a1a', marginBottom: 10 },
  optionValues: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  optionBtn: { minHeight: 38, maxWidth: '100%', borderRadius: 999, borderWidth: 1.2, borderColor: '#D1D5DB', backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 8 },
  optionBtnDisabled: { borderColor: '#E5E7EB', backgroundColor: '#F3F4F6', opacity: 0.55 },
  optionBtnActive: { borderColor: '#2E7D32', backgroundColor: '#2E7D32' },
  optionBtnText: { color: '#111827', fontWeight: '800', fontSize: 13, lineHeight: 16 },
  optionBtnTextDisabled: { color: '#9CA3AF' },
  optionBtnTextActive: { color: 'white' },
  tabsContainer: { flexDirection: 'row', marginBottom: 15, backgroundColor: '#f5f5f5', borderRadius: 10, padding: 4 },
  tabBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 8 },
  tabBtnActive: { backgroundColor: 'white', shadowColor: '#000', shadowOpacity: 0.1, elevation: 2 },
  tabBtnText: { fontWeight: '500', fontSize: 14, color: '#666' },
  tabBtnTextActive: { fontWeight: 'bold', color: '#000' },
  productInfoBlock: { marginBottom: 30 },
  infoSectionTitle: { fontSize: 22, fontWeight: '900', color: '#111827', marginBottom: 14 },
  infoCard: { backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1.2, borderColor: '#BFD8E0', padding: 16, paddingBottom: 28, overflow: 'hidden' },
  infoHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 18 },
  infoIconCircle: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#2E9DB4', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  infoHeaderText: { flex: 1 },
  infoCardTitle: { fontSize: 20, fontWeight: '900', color: '#111827', marginBottom: 2 },
  infoCardNote: { fontSize: 13.5, lineHeight: 18, color: '#6B7280' },
  infoHeading: { fontSize: 17, fontWeight: '900', color: '#111827', marginTop: 10, marginBottom: 8 },
  infoText: { fontSize: 16, lineHeight: 24, color: '#2F343B', marginBottom: 10 },
  infoFade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 82, backgroundColor: 'rgba(255,255,255,0.88)' },
  expandButton: { position: 'absolute', alignSelf: 'center', bottom: 10, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#FFFFFF', borderRadius: 999, paddingHorizontal: 18, height: 38, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.12, shadowRadius: 8, elevation: 5 },
  expandButtonText: { fontSize: 15, fontWeight: '700', color: '#111827' },
  structuredWrap: { marginBottom: 30 },
  structuredSpacer: { height: 13 },
  paragraphText: { color: '#4b5563', lineHeight: 23, fontSize: 15.5, marginBottom: 6 },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 7 },
  bulletDot: { width: 16, color: '#10b981', lineHeight: 23, fontSize: 16 },
  bulletText: { flex: 1, color: '#4b5563', lineHeight: 23, fontSize: 15.5 },
  stickyCartBar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 12, paddingTop: 10, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#EEF0F2', shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 300, zIndex: 300, overflow: 'visible' },
  cartControlsRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  quantitySelector: { width: 70, height: 52, borderRadius: 10, borderWidth: 1, borderColor: '#D1D5DB', backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  quantityText: { fontSize: 22, fontWeight: '500', color: '#4B5563' },
  quantityDropdown: { position: 'absolute', left: 12, bottom: 72, width: 70, maxHeight: 260, backgroundColor: '#FFFFFF', borderRadius: 12, borderWidth: 1, borderColor: '#D1D5DB', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.16, shadowRadius: 10, elevation: 310, overflow: 'hidden' },
  quantityOption: { height: 42, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  quantityOptionActive: { backgroundColor: '#EEF7EC' },
  quantityOptionText: { fontSize: 18, fontWeight: '700', color: '#374151' },
  quantityOptionTextActive: { color: '#2E7D32' },
  quickOrderBtn: { flex: 1, height: 52, borderRadius: 11, backgroundColor: '#3F8F00', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  quickOrderText: { color: '#FFFFFF', fontWeight: '900', fontSize: 15, lineHeight: 19, textAlign: 'center' },
  addToCartBtn: { flex: 1.15, backgroundColor: '#FF9500', height: 52, borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  actionBtnDisabled: { backgroundColor: '#9CA3AF' },
  addToCartText: { color: '#fff', fontWeight: '900', fontSize: 15, lineHeight: 19, textAlign: 'center' },
  reviewsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 },
  sectionTitle: { fontSize: 20, fontWeight: 'bold', color: '#1a1a1a' },
  writeReviewBtn: { backgroundColor: '#f0f0f0', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  writeReviewText: { color: '#000', fontWeight: '600', fontSize: 13 },
  reviewCard: { backgroundColor: '#f9f9f9', padding: 16, borderRadius: 14, marginBottom: 10 },
  reviewMain: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  reviewerName: { fontWeight: '700', fontSize: 14, color: '#1f2937' },
  starsMini: { flexDirection: 'row', gap: 2 },
  reviewComment: { color: '#4b5563', fontSize: 14, lineHeight: 20 },
  emptyReviews: { padding: 20, alignItems: 'center' },
  emptyReviewsText: { color: '#9ca3af', fontSize: 14 },
  similarSection: { marginTop: 30, marginBottom: 20 },
  similarList: { gap: 15, paddingRight: 20 },
  similarCardContainer: { width: 180 },
});
