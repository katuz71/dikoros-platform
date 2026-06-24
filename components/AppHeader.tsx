import { useGlobalSearch } from '@/context/GlobalSearchContext';
import { safeBack } from '@/utils/navigation';
import { Ionicons } from '@expo/vector-icons';
import { usePathname, useRouter } from 'expo-router';
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
  showNotifications?: boolean;
  showCart?: boolean;
  showShare?: boolean;
  onShare?: () => void;
  showDone?: boolean;
  onDone?: () => void;
  doneColor?: string;
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
  showLogo,
  showBack = false,
  backIcon = 'arrow-back',
  onBack,
  showSearch = true,
  showFilter = false,
  onFilter,
  showFavorites = true,
  showNotifications = true,
  showCart = false,
  showShare = false,
  onShare,
  showDone = false,
  onDone,
  doneColor = '#458B00',
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
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { openSearch } = useGlobalSearch();

  const useLogoHeader = showLogo ?? (!title && !subtitle);
  const normalizedPathname = String(pathname || '');
  const suppressLegacyProductHeader = normalizedPathname.startsWith('/product/') && useLogoHeader && showBack;
  const suppressLegacyPoliciesHeader = normalizedPathname.startsWith('/policies') && useLogoHeader && !title && !subtitle;
  const suppressLegacyCheckoutHeader = normalizedPathname.startsWith('/checkout') && useLogoHeader && !title && !subtitle;
  const goBack = () => (onBack ? onBack() : safeBack(router, pathname));
  const openFavorites = () => {
    if (normalizedPathname.includes('/favorites')) return;
    router.replace('/(tabs)/favorites' as any);
  };
  const openNotifications = () => {
    if (normalizedPathname.includes('/profile-notifications')) return;
    router.push('/profile-notifications' as any);
  };
  const openCart = () => {
    if (normalizedPathname.includes('/cart')) return;
    router.replace('/(tabs)/cart' as any);
  };
  const openHome = () => router.replace('/(tabs)' as any);

  const renderSearchButton = () => (
    <TouchableOpacity onPress={openSearch} style={styles.iconButton} activeOpacity={0.75}>
      <Ionicons name="search" size={22} color="#111827" />
    </TouchableOpacity>
  );

  const renderFavoritesButton = () => (
    <TouchableOpacity onPress={openFavorites} style={styles.iconButton} activeOpacity={0.75}>
      <Ionicons name="heart-outline" size={23} color="#111827" />
    </TouchableOpacity>
  );

  const renderNotificationsButton = () => (
    <TouchableOpacity onPress={openNotifications} style={styles.iconButton} activeOpacity={0.75}>
      <Ionicons name="notifications-outline" size={23} color="#111827" />
    </TouchableOpacity>
  );

  if (suppressLegacyProductHeader || suppressLegacyPoliciesHeader || suppressLegacyCheckoutHeader) return null;

  if (useLogoHeader) {
    return (
      <View style={[styles.header, { height: 48 + insets.top, paddingTop: insets.top }, style]}>
        <View style={styles.logoCenteredRow}>
          {showBack && (
            <TouchableOpacity onPress={goBack} style={styles.backOverlayButton} activeOpacity={0.75}>
              <Ionicons name={backIcon as any} size={24} color="#111827" />
            </TouchableOpacity>
          )}

          <View style={[styles.logoActionSlot, styles.logoLeftActionSlot]}>
            {showSearch ? renderSearchButton() : <View style={styles.iconButtonPlaceholder} />}
          </View>

          <TouchableOpacity activeOpacity={0.8} onPress={onLogoPress || openHome} style={styles.logoButton}>
            <Image source={require('../assets/images/dikoros-logo.webp')} style={styles.logo} resizeMode="contain" />
          </TouchableOpacity>

          <View style={[styles.logoActionSlot, styles.logoRightActionSlot]}>
            {showFavorites && renderFavoritesButton()}
            {showNotifications && renderNotificationsButton()}
            {showCart && (
              <TouchableOpacity onPress={openCart} style={styles.iconButton} activeOpacity={0.75}>
                <Ionicons name="cart-outline" size={23} color="#111827" />
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.header, { height: 48 + insets.top, paddingTop: insets.top }, style]}>
      <View style={styles.row}>
        <View style={styles.leftArea}>
          {showBack ? (
            <TouchableOpacity onPress={goBack} style={styles.iconButton} activeOpacity={0.75}>
              <Ionicons name={backIcon as any} size={24} color="#111827" />
            </TouchableOpacity>
          ) : showSearch ? renderSearchButton() : <View style={styles.iconButtonPlaceholder} />}
        </View>

        <View style={styles.centerArea}>
          {!!title && <Text style={styles.title} numberOfLines={1}>{title}</Text>}
          {!!subtitle && <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>}
        </View>

        <View style={styles.rightArea}>
          {showFilter && (
            <TouchableOpacity onPress={onFilter} style={styles.iconButton} activeOpacity={0.75}>
              <Ionicons name="options-outline" size={22} color="#111827" />
            </TouchableOpacity>
          )}
          {showFavorites && renderFavoritesButton()}
          {showNotifications && renderNotificationsButton()}
          {showCart && (
            <TouchableOpacity onPress={openCart} style={styles.iconButton} activeOpacity={0.75}>
              <Ionicons name="cart-outline" size={23} color="#111827" />
            </TouchableOpacity>
          )}
          {showShare && (
            <TouchableOpacity onPress={onShare} style={styles.iconButton} activeOpacity={0.75}>
              <Ionicons name="share-outline" size={20} color="#111827" />
            </TouchableOpacity>
          )}
          {showDone && !!onDone && (
            <TouchableOpacity onPress={onDone} style={styles.iconButton} activeOpacity={0.75}>
              <Ionicons name="checkmark-done-outline" size={23} color={doneColor} />
            </TouchableOpacity>
          )}
          {showFavoriteToggle && !!onFavoritePress && (
            <TouchableOpacity onPress={onFavoritePress} style={styles.iconButton} activeOpacity={0.75}>
              <Ionicons name={isFavorite ? 'heart' : 'heart-outline'} size={22} color={isFavorite ? '#EF4444' : '#111827'} />
            </TouchableOpacity>
          )}
          {showTrash && (
            <TouchableOpacity onPress={onTrash} style={styles.iconButton} activeOpacity={0.75}>
              <Ionicons name="trash-outline" size={21} color="#EF4444" />
            </TouchableOpacity>
          )}
          {showLogout && (
            <TouchableOpacity onPress={onLogout} style={styles.iconButton} activeOpacity={0.75}>
              <Ionicons name="log-out-outline" size={22} color="#EF4444" />
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#E5E7EB', zIndex: 50 },
  row: { height: 48, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14 },
  logoCenteredRow: { height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  logoActionSlot: { width: 108, flexDirection: 'row', alignItems: 'center' },
  logoLeftActionSlot: { justifyContent: 'flex-start' },
  logoRightActionSlot: { justifyContent: 'flex-end' },
  backOverlayButton: { position: 'absolute', left: 8, top: 6, width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', zIndex: 3 },
  leftArea: { width: 48, alignItems: 'flex-start', justifyContent: 'center', zIndex: 2 },
  centerArea: { position: 'absolute', left: 124, right: 124, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', zIndex: 1 },
  rightArea: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', zIndex: 2 },
  iconButton: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  iconButtonPlaceholder: { width: 36, height: 36 },
  logoButton: { width: 146, height: 38, alignItems: 'center', justifyContent: 'center' },
  logo: { width: 126, height: 30 },
  title: { fontSize: 20, fontWeight: '900', color: '#111827', textAlign: 'center' },
  subtitle: { marginTop: 1, fontSize: 11, fontWeight: '600', color: '#6B7280', textAlign: 'center' },
});
