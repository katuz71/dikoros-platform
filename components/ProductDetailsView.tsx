import { getImageUrl } from '@/utils/image';
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import {
    Dimensions,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from "react-native";
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
  currentPrice: number;
  oldPrice?: number;
  activeRow: any;
  onAddToCart: () => void;
  onToggleFavorite: () => void;
  isFavorite: boolean;
  onShare: () => void;
  formatPrice: (price: number) => string;
  clean: (v: any) => string;
  // Extra data for tabs and reviews (optional but recommended for 1-to-1 look)
  reviews?: any[];
  totalReviews?: number;
  averageRating?: number;
  onWriteReview?: () => void;
  
  // Similar Products
  similarProducts?: any[];
  onSimilarProductPress?: (id: number) => void;
  onSimilarProductAddToCart?: (product: any) => void;
  onSimilarProductToggleFavorite?: (product: any) => void;
  favorites?: any[];
}

export const ProductDetailsView: React.FC<ProductDetailsViewProps> = ({
  product,
  variantRows,
  optionKeys,
  internalKeys,
  matrix,
  selectedOptions,
  applyOptionChange,
  currentPrice,
  oldPrice,
  activeRow,
  onAddToCart,
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
  favorites = []
}) => {
  const [tab, setTab] = React.useState<'desc' | 'ingr' | 'use'>('desc');

  const cleanProductHtml = (html: any) => {
    const decode = (value: string) => {
      return String(value || '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ')
        .replace(/&mdash;/g, '\u2014')
        .replace(/&ndash;/g, '\u2013')
        .replace(/&deg;/g, '\u00b0')
        .replace(/&rsquo;/g, '\u2019')
        .replace(/&lsquo;/g, '\u2018')
        .replace(/&ldquo;/g, '\u201c')
        .replace(/&rdquo;/g, '\u201d')
        .replace(/&laquo;/g, '\u00ab')
        .replace(/&raquo;/g, '\u00bb')
        .replace(/&hellip;/g, '\u2026')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
    };

    let text = String(html || '');

    // several passes for double/triple encoded content
    text = decode(text);
    text = decode(text);
    text = decode(text);

    return text
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<li[^>]*>/gi, '- ')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  };

  const splitProductText = () => {
    const source = cleanProductHtml(product?.description);
    const compositionField = cleanProductHtml(product?.composition);
    const usageField = cleanProductHtml(product?.usage);

    const lines = source
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);

    const skladWords = ['СЃРєР»Р°Рґ', 'С–РЅРіСЂРµРґС–С”РЅС‚'];
    const usageWords = ['Р·Р°СЃС‚РѕСЃСѓРІР°РЅРЅСЏ', 'РІРёРєРѕСЂРёСЃС‚Р°РЅРЅСЏ', 'РїСЂРёР№РѕРј', 'РґРѕР·СѓРІР°РЅРЅСЏ', 'РІР¶РёРІР°С‚Рё', 'РЅР°РЅРѕСЃРёС‚Рё', 'Р·РѕРІРЅС–С€РЅСЊРѕРіРѕ', 'РІРЅСѓС‚СЂС–С€РЅСЊРѕРіРѕ'];

    const findLines = (words: string[]) => {
      return lines
        .filter(line => {
          const lower = line.toLowerCase();
          return words.some(word => lower.includes(word));
        })
        .join('\n')
        .trim();
    };

    const extractedComposition = findLines(skladWords);
    const extractedUsage = findLines(usageWords);

    return {
      desc: source || '?',
      composition: compositionField || extractedComposition || 'Р†РЅС„РѕСЂРјР°С†С–СЏ РїСЂРѕ СЃРєР»Р°Рґ РЅРµ РІРєР°Р·Р°РЅР°.',
      usage: usageField || extractedUsage || 'РЎРїРѕСЃС–Р± РІРёРєРѕСЂРёСЃС‚Р°РЅРЅСЏ РЅРµ РІРєР°Р·Р°РЅРёР№.',
    };
  };

  const toDisplayText = (value: any) => {
    const s = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
    return s.length > 0 ? s : 'вЂ”';
  };

  const renderStructuredText = (raw: any) => {
    const text = toDisplayText(raw);
    const lines = String(text || '').split(/\r?\n/);
    const headings = new Set([
      'РћРїРёСЃ',
      'РџРµСЂРµРІР°РіРё',
      'РҐР°СЂР°РєС‚РµСЂРёСЃС‚РёРєРё',
      'РЇРє РІРёРєРѕСЂРёСЃС‚РѕРІСѓРІР°С‚Рё',
      'Р—Р±РµСЂС–РіР°РЅРЅСЏ',
      'Р’Р°Р¶Р»РёРІРѕ',
    ]);

    return (
      <View style={styles.structuredWrap}>
        {lines.map((line, idx) => {
          const trimmed = String(line || '').trim();
          if (!trimmed) {
            return <View key={`sp-${idx}`} style={styles.structuredSpacer} />;
          }

          if (headings.has(trimmed)) {
            return (
              <Text key={`h-${idx}`} style={styles.sectionHeading}>
                {trimmed}
              </Text>
            );
          }

          if (trimmed.startsWith('- ')) {
            return (
              <View key={`b-${idx}`} style={styles.bulletRow}>
                <Text style={styles.bulletDot}>{'вЂў'}</Text>
                <Text style={styles.bulletText}>{trimmed.slice(2)}</Text>
              </View>
            );
          }

          return (
            <Text key={`p-${idx}`} style={styles.paragraphText}>
              {trimmed}
            </Text>
          );
        })}
      </View>
    );
  };

  const getAllImages = (p: any) => {
    let gallery: string[] = [];

    if (Array.isArray(p?.images)) {
      gallery = p.images.map((u: any) => String(u ?? '').trim()).filter(Boolean);
    } else if (p?.images && typeof p.images === 'string') {
      if (p.images.startsWith('[') && p.images.endsWith(']')) {
        try {
          const parsed = JSON.parse(p.images);
          if (Array.isArray(parsed)) {
            gallery = parsed.map((u: any) => String(u ?? '').trim()).filter(Boolean);
          }
        } catch {}
      } else {
        gallery = p.images.split(',').map((u: string) => u.trim()).filter(Boolean);
      }
    }

    const main = String(p?.image || p?.picture || p?.image_url || '').trim();
    const ordered = [main, ...gallery]
      .map((u: any) => String(u ?? '').trim())
      .filter(Boolean);

    const listFull = ordered
      .map((u: any) => getImageUrl(String(u ?? '').trim()))
      .filter((u: string) => !!u && u !== 'null' && u !== 'undefined');

    // Dedupe (preserve order)
    const seen = new Set<string>();
    const deduped: string[] = [];
    listFull.forEach((u: any) => {
      const s = String(u ?? '').trim();
      if (!s) return;
      if (seen.has(s)) return;
      seen.add(s);
      deduped.push(s);
    });

    return deduped;
  };

  const isVariantAvailable = (row: any) => {
    const raw = row?.raw || row || {};
    const status = clean(raw?.status || product?.status).toLowerCase();
    const disabledStatuses = ['unavailable', 'not_available', 'out_of_stock', 'disabled', 'РІС–РґСЃСѓС‚РЅС–Р№', 'РЅРµРјР°С” РІ РЅР°СЏРІРЅРѕСЃС‚С–', 'РЅРµС‚ РІ РЅР°Р»РёС‡РёРё'];
    if (status && disabledStatuses.some(s => status.includes(s))) return false;

    const stockRaw = raw?.remains ?? raw?.quantity ?? raw?.qty ?? raw?.balance ?? raw?.stock;
    if (stockRaw === undefined || stockRaw === null || stockRaw === '') return true;
    const stock = Number(stockRaw);
    return !Number.isFinite(stock) || stock > 0;
  };

  const images = getAllImages(product);
  const slideImages = React.useMemo(() => {
    const cleaned = (images || [])
      .map((u: any) => String(u ?? '').trim())
      .filter((u: string) => u && u !== 'null' && u !== 'undefined');
    return cleaned.length > 0 ? cleaned : ['']; // '' -> getImageUrl('') РІРµСЂРЅС‘С‚ placeholder
  }, [images]);

  // Normalize to final URLs once to keep ordering stable.
  const slideImagesFull = React.useMemo(() => {
    return (slideImages || []).map((u: any) => getImageUrl(String(u ?? '').trim()));
  }, [slideImages]);

  const productTextTabs = splitProductText();
  const activeAvailable = activeRow ? isVariantAvailable(activeRow) : isVariantAvailable(product);

  return (
    <ScrollView contentContainerStyle={{ paddingTop: 88, paddingBottom: 100 }} showsVerticalScrollIndicator={false}>
      {/* 1. Р¤РѕС‚Рѕ С‚РѕРІР°СЂР° (Carousel start) */}
      <View style={{ height: 320, width: Dimensions.get('window').width }}>
        <ScrollView key={`${String(product?.id ?? '')}:${String(product?.image ?? '')}`} horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
            {slideImagesFull.map((img: string, i: number) => {
              const placeholder = getImageUrl('');
              const candidates = [img, ...slideImagesFull.filter((_, j) => j !== i), placeholder];
              return (
              <ProductImage
                key={i}
                uri={img}
                uris={candidates}
                cacheKey={`pdp:${String(product?.id ?? '')}:${i}`}
                style={styles.mainImage}
                size={Dimensions.get('window').width}
                contentFit="contain" 
              />
              );
            })}
        </ScrollView>
      </View>

      <View style={styles.content}>
        {/* Status & Reviews */}
        <View style={styles.statsRow}>
          <View style={styles.statusBadge}>
            <View style={[styles.statusDot, !activeAvailable && styles.statusDotDisabled]} />
            <Text style={[styles.statusText, !activeAvailable && styles.statusTextDisabled]}>
              {activeAvailable ? 'Р’ РЅР°СЏРІРЅРѕСЃС‚С–' : 'РќРµРјР°С” РІ РЅР°СЏРІРЅРѕСЃС‚С–'}
            </Text>
          </View>
          
          <View style={styles.ratingRow}>
            <View style={styles.stars}>
              {[1, 2, 3, 4, 5].map(s => (
                <Ionicons key={s} name="star" size={14} color={s <= averageRating ? "#FFD700" : "#E5E7EB"} />
              ))}
            </View>
            <Text style={styles.reviewCount}>{totalReviews} РІС–РґРіСѓРєРё</Text>
          </View>
        </View>

        {/* Title and Price */}
        <View style={styles.titleSection}>
          <Text style={styles.productTitle}>{product.name}</Text>
          <View style={styles.priceRow}>
            <Text style={styles.priceText}>{formatPrice(currentPrice)}</Text>
            {!!oldPrice && oldPrice > currentPrice && (
              <Text style={styles.oldPriceText}>{formatPrice(oldPrice)}</Text>
            )}
          </View>
        </View>

        {/* Trust Badges */}
        <View style={styles.trustBadges}>
          <View style={styles.badgeItem}>
            <Ionicons name="shield-checkmark-outline" size={22} color="#10b981" />
            <Text style={styles.badgeText}>100% РћСЂРёРіС–РЅР°Р»</Text>
          </View>
          <View style={styles.badgeItem}>
            <Ionicons name="rocket-outline" size={22} color="#059669" />
            <Text style={styles.badgeText}>РЁРІРёРґРєР° РґРѕСЃС‚Р°РІРєР°</Text>
          </View>
          <View style={styles.badgeItem}>
            <Ionicons name="leaf-outline" size={22} color="#059669" />
            <Text style={styles.badgeText}>Р•РєРѕ РїСЂРѕРґСѓРєС‚</Text>
          </View>
        </View>

        {/* Variations */}
        {internalKeys.length > 0 ? (
          <View style={styles.variationsSection}>
            {internalKeys.map((ik, idx) => (
              <View key={ik} style={styles.optionGroup}>
                <Text style={styles.optionTitle}>{optionKeys[idx]}</Text>

                <View style={styles.optionValues}>
                  {(matrix[ik] || []).map((val) => {
                    const isSel = clean(selectedOptions[ik]) === clean(val);

                    const isAvailable = variantRows.some((row: any) => {
                      if (!isVariantAvailable(row)) return false;
                      return internalKeys.every((key) => {
                        const expected = key === ik ? val : selectedOptions[key];
                        if (!expected) return true;
                        return clean(row.options[key]) === clean(expected);
                      });
                    });


                    return (
                      <TouchableOpacity
                        key={val}
                        disabled={false}
                        onPress={() => {
                          applyOptionChange(ik, val);
                        }}
                        style={[
                          styles.optionBtn,
                          isSel && styles.optionBtnActive,
                        ]}
                      >
                        <Text
                          numberOfLines={1}
                          style={[
                            styles.optionBtnText,
                            isSel && styles.optionBtnTextActive,
                            !isAvailable && styles.optionBtnTextDisabled,
                          ]}
                        >
                          {val}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {/* Tabs */}
        <View style={styles.tabsContainer}>
          {['desc', 'ingr', 'use'].map((t) => (
            <TouchableOpacity
              key={t}
              onPress={() => setTab(t as 'desc' | 'ingr' | 'use')}
              style={[styles.tabBtn, tab === t && styles.tabBtnActive]}
            >
              <Text style={[styles.tabBtnText, tab === t && styles.tabBtnTextActive]}>
                {t === 'desc' ? 'РћРїРёСЃ' : t === 'ingr' ? 'РЎРєР»Р°Рґ' : 'Р’РёРєРѕСЂРёСЃС‚Р°РЅРЅСЏ'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {tab === 'desc'
          ? renderStructuredText(productTextTabs.desc)
          : (
            <Text style={styles.descriptionText}>
              {tab === 'ingr' ? productTextTabs.composition : productTextTabs.usage}
            </Text>
          )}

        {/* Add to Cart Button */}
        <TouchableOpacity
          style={[styles.addToCartBtn, !activeAvailable && styles.addToCartBtnDisabled]}
          onPress={onAddToCart}
          disabled={!activeAvailable}
        >
          <Text style={styles.addToCartText}>{activeAvailable ? 'Р’ РєРѕС€РёРє' : 'РќРµРјР°С” РІ РЅР°СЏРІРЅРѕСЃС‚С–'}</Text>
        </TouchableOpacity>

        {/* Similar Products */}
        {similarProducts.length > 0 && (
          <View style={styles.similarSection}>
            <Text style={styles.sectionTitle}>РЎС…РѕР¶С– С‚РѕРІР°СЂРё</Text>
            <ScrollView 
              horizontal 
              showsHorizontalScrollIndicator={false} 
              contentContainerStyle={styles.similarList}
            >
              {similarProducts.map((p) => (
                <View key={p.id} style={styles.similarCardContainer}>
                  <ProductCard
                    item={p}
                    onPress={() => onSimilarProductPress?.(p.id)}
                    onCartPress={() => onSimilarProductAddToCart?.(p)}
                    onFavoritePress={() => onSimilarProductToggleFavorite?.(p)}
                    isFavorite={favorites.some((f: any) => f.id === p.id)}
                    style={{ flex: 0, width: '100%', marginLeft: 0 }} 
                  />
                </View>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Reviews Section Wrapper */}
        <View style={styles.reviewsHeader}>
          <Text style={styles.sectionTitle}>Р’С–РґРіСѓРєРё</Text>
          <TouchableOpacity onPress={onWriteReview} style={styles.writeReviewBtn}>
            <Text style={styles.writeReviewText}>РќР°РїРёСЃР°С‚Рё</Text>
          </TouchableOpacity>
        </View>

        {reviews.length > 0 ? (
          reviews.slice(0, 3).map((review) => (
            <View key={review.id} style={styles.reviewCard}>
              <View style={styles.reviewMain}>
                <Text style={styles.reviewerName}>{review.user_name}</Text>
                <View style={styles.starsMini}>
                  {[1, 2, 3, 4, 5].map(star => (
                    <Ionicons key={star} name={star <= review.rating ? "star" : "star-outline"} size={12} color="#FFD700" />
                  ))}
                </View>
              </View>
              <Text style={styles.reviewComment}>{review.comment}</Text>
            </View>
          ))
        ) : (
          <View style={styles.emptyReviews}>
            <Text style={styles.emptyReviewsText}>РџРѕРєРё РЅРµРјР°С” РІС–РґРіСѓРєС–РІ</Text>
          </View>
        )}
      </View>
    </ScrollView>

  );
};

const styles = StyleSheet.create({
  mainImage: { width: Dimensions.get('window').width, height: 320 },
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
  optionBtnActive: { borderColor: '#2E7D32', backgroundColor: '#2E7D32' },
  optionBtnDisabled: { opacity: 0.35 },
  optionBtnText: { color: '#111827', fontWeight: '800', fontSize: 13, lineHeight: 16 },
  optionBtnTextActive: { color: 'white' },
  optionBtnTextDisabled: { color: '#6B7280' },
  tabsContainer: { flexDirection: 'row', marginBottom: 15, backgroundColor: '#f5f5f5', borderRadius: 10, padding: 4 },
  tabBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 8 },
  tabBtnActive: { backgroundColor: 'white', shadowColor: '#000', shadowOpacity: 0.1, elevation: 2 },
  tabBtnText: { fontWeight: '500', fontSize: 14, color: '#666' },
  tabBtnTextActive: { fontWeight: 'bold', color: '#000' },
  descriptionText: { color: '#4b5563', lineHeight: 22, fontSize: 15, marginBottom: 30, minHeight: 80 },
  structuredWrap: { marginBottom: 30 },
  structuredSpacer: { height: 10 },
  sectionHeading: { fontSize: 16, fontWeight: '800', color: '#1a1a1a', marginBottom: 6 },
  paragraphText: { color: '#4b5563', lineHeight: 22, fontSize: 15 },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 4 },
  bulletDot: { width: 16, color: '#10b981', lineHeight: 22, fontSize: 16 },
  bulletText: { flex: 1, color: '#4b5563', lineHeight: 22, fontSize: 15 },
  addToCartBtn: { backgroundColor: '#2E7D32', height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 30 },
  addToCartBtnDisabled: { backgroundColor: '#9CA3AF' },
  addToCartText: { color: '#fff', fontWeight: 'bold', fontSize: 18 },
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
  similarCardContainer: { width: 180 }
});
