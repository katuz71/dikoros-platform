import { useCart } from '@/context/CartContext';
import { useGlobalSearch } from '@/context/GlobalSearchContext';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Image, StyleProp, StyleSheet, Text, TouchableOpacity, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type AppHeaderProps = {
  title?: string;
  subtitle?: string;
  showLogo?: boolean;
  showBack?: boolean;
  backIcon?: string;
  onBack?: () => void;
  showSearch?: boolean;
  showFilter?: boolean;
  onFilter?: () => void;
  showFavorites?: boolean;
  showCart?: boolean;
  showShare?: boolean;
  onShare?: () => void;
  showFavoriteToggle?: boolean;
  isFavorite?: boolean;
  onFavoritePress?: () => void;
  showTrash?: boolean;
  onTrash?: () => void;
  showLogout?: boolean;
  onLogout?: () => void;
  onLogoPress?: () => void;
  style?: StyleProp<ViewStyle>;
};

export function AppHeader({
  title,
  subtitle,
  showLogo = false,
  showBack = false,
  backIcon = 'arrow-back',
  onBack,
  showSearch = true,
  showFilter = false,
  onFilter,
  showFavorites = false,
  showCart = false,
  showShare = false,
  onShare,
  showFavoriteToggle = false,
  isFavorite = false,
  onFavoritePress,
  showTrash = false,
  onTrash,
  showLogout = false,
  onLogout,
  onLogoPress,
  style,
}: AppHeaderProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { openSearch } = useGlobalSearch();
  const { items: cartItems } = useCart() as any;

  const cartCount = Array.isArray(cartItems)
    ? cartItems.reduce((sum: number, item: any) => sum + (Number(item?.quantity) || 1), 0)
    : 0;

  const goBack = () => {
    if (onBack) {
      onBack();
      return;
    }
    router.back();
  };

  return (
    <View style={[styles.header, { height: 60 + insets.top, paddingTop: insets.top }, style]}>
      <View style={styles.row}>
        <View style={styles.leftArea}>
          {showBack ? (
            <TouchableOpacity onPress={goBack} style={styles.iconButton} activeOpacity={0.75}>
              <Ionicons name={backIcon as any} size={26} color="#111827" />
            </TouchableOpacity>
          ) : showLogo && showSearch ? (
            <TouchableOpacity onPress={openSearch} style={styles.iconButton} activeOpacity={0.75}>
              <Ionicons name="search" size={24} color="#111827" />
            </TouchableOpacity>
          ) : (
            <View style={styles.iconButtonPlaceholder} />
          )}
        </View>

        <View style={styles.centerArea}>
          {showLogo ? (
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={onLogoPress || (() => router.replace('/(tabs)' as any))}
              style={styles.logoButton}
            >
              <Image
                source={require('../assets/images/dikoros-logo.webp')}
                style={styles.logo}
                resizeMode="contain"
              />
            </TouchableOpacity>
          ) : (
            <>
              {!!title && <Text style={styles.title} numberOfLines={1}>{title}</Text>}
              {!!subtitle && <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>}
            </>
          )}
        </View>

        <View style={styles.rightArea}>
          {showSearch && !(showLogo && !showBack) && (
            <TouchableOpacity onPress={openSearch} style={styles.iconButton} activeOpacity={0.75}>
              <Ionicons name="search" size={24} color="#111827" />
            </TouchableOpacity>
          )}

          {showFilter && (
            <TouchableOpacity onPress={onFilter} style={styles.iconButton} activeOpacity={0.75}>
              <Ionicons name="options-outline" size={24} color="#111827" />
            </TouchableOpacity>
          )}

          {showFavorites && (
            <TouchableOpacity onPress={() => router.push('/(tabs)/favorites')} style={styles.iconButton} activeOpacity={0.75}>
              <Ionicons name="heart" size={24} color="#EF4444" />
            </TouchableOpacity>
          )}

          {showCart && (
            <TouchableOpacity onPress={() => router.push('/(tabs)/cart')} style={styles.iconButton} activeOpacity={0.75}>
              <Ionicons name="cart-outline" size={25} color="#111827" />
              {cartCount > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{cartCount > 99 ? '99+' : cartCount}</Text>
                </View>
              )}
            </TouchableOpacity>
          )}

          {showShare && (
            <TouchableOpacity onPress={onShare} style={styles.iconButton} activeOpacity={0.75}>
              <Ionicons name="share-outline" size={22} color="#111827" />
            </TouchableOpacity>
          )}

          {showFavoriteToggle && (
            <TouchableOpacity onPress={onFavoritePress} style={styles.iconButton} activeOpacity={0.75}>
              <Ionicons name={isFavorite ? 'heart' : 'heart-outline'} size={24} color={isFavorite ? '#EF4444' : '#111827'} />
            </TouchableOpacity>
          )}

          {showTrash && (
            <TouchableOpacity onPress={onTrash} style={styles.iconButton} activeOpacity={0.75}>
              <Ionicons name="trash-outline" size={23} color="#EF4444" />
            </TouchableOpacity>
          )}

          {showLogout && (
            <TouchableOpacity onPress={onLogout} style={styles.iconButton} activeOpacity={0.75}>
              <Ionicons name="log-out-outline" size={24} color="#EF4444" />
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    zIndex: 50,
  },
  row: {
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
  },
  leftArea: {
    width: 48,
    alignItems: 'flex-start',
    justifyContent: 'center',
    zIndex: 2,
  },
  centerArea: {
    position: 'absolute',
    left: 76,
    right: 76,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  rightArea: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    zIndex: 2,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
  },
  iconButtonPlaceholder: {
    width: 40,
    height: 40,
  },
  logoButton: {
    minWidth: 150,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    width: 132,
    height: 38,
  },
  title: {
    fontSize: 22,
    fontWeight: '900',
    color: '#111827',
    textAlign: 'center',
  },
  subtitle: {
    marginTop: 1,
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
    textAlign: 'center',
  },
  badge: {
    position: 'absolute',
    right: 1,
    top: 1,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '900',
  },
});
