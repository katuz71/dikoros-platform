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

  const goBack = () => {
    if (onBack) {
      onBack();
      return;
    }
    router.back();
  };

  if (showLogo) {
    const showRightFavorite = showFavoriteToggle || showFavorites;

    return (
      <View style={[styles.header, { height: 48 + insets.top, paddingTop: insets.top }, style]}>
        <View style={styles.logoCenteredRow}>
          {showBack && (
            <TouchableOpacity onPress={goBack} style={styles.backOverlayButton} activeOpacity={0.75}>
              <Ionicons name={backIcon as any} size={24} color="#111827" />
            </TouchableOpacity>
          )}

          <View style={styles.logoActionSlot}>
            {showSearch ? (
              <TouchableOpacity onPress={openSearch} style={styles.iconButton} activeOpacity={0.75}>
                <Ionicons name="search" size={22} color="#111827" />
              </TouchableOpacity>
            ) : (
              <View style={styles.iconButtonPlaceholder} />
            )}
          </View>

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

          <View style={styles.logoActionSlot}>
            {showRightFavorite ? (
              <TouchableOpacity
                onPress={showFavoriteToggle ? onFavoritePress : () => router.push('/(tabs)/favorites')}
                style={styles.iconButton}
                activeOpacity={0.75}
              >
                <Ionicons
                  name={showFavoriteToggle && isFavorite ? 'heart' : 'heart-outline'}
                  size={22}
                  color={showFavoriteToggle && isFavorite ? '#EF4444' : '#111827'}
                />
              </TouchableOpacity>
            ) : (
              <View style={styles.iconButtonPlaceholder} />
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
          ) : (
            <View style={styles.iconButtonPlaceholder} />
          )}
        </View>

        <View style={styles.centerArea}>
          {!!title && <Text style={styles.title} numberOfLines={1}>{title}</Text>}
          {!!subtitle && <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>}
        </View>

        <View style={styles.rightArea}>
          {showSearch && (
            <TouchableOpacity onPress={openSearch} style={styles.iconButton} activeOpacity={0.75}>
              <Ionicons name="search" size={22} color="#111827" />
            </TouchableOpacity>
          )}

          {showFilter && (
            <TouchableOpacity onPress={onFilter} style={styles.iconButton} activeOpacity={0.75}>
              <Ionicons name="options-outline" size={22} color="#111827" />
            </TouchableOpacity>
          )}

          {showFavorites && (
            <TouchableOpacity onPress={() => router.push('/(tabs)/favorites')} style={styles.iconButton} activeOpacity={0.75}>
              <Ionicons name="heart-outline" size={22} color="#111827" />
            </TouchableOpacity>
          )}

          {showShare && (
            <TouchableOpacity onPress={onShare} style={styles.iconButton} activeOpacity={0.75}>
              <Ionicons name="share-outline" size={20} color="#111827" />
            </TouchableOpacity>
          )}

          {showFavoriteToggle && (
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
  header: {
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    zIndex: 50,
  },
  row: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
  },
  logoCenteredRow: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  logoActionSlot: {
    width: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backOverlayButton: {
    position: 'absolute',
    left: 8,
    top: 6,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3,
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
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButtonPlaceholder: {
    width: 36,
    height: 36,
  },
  logoButton: {
    width: 146,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    width: 126,
    height: 30,
  },
  title: {
    fontSize: 20,
    fontWeight: '900',
    color: '#111827',
    textAlign: 'center',
  },
  subtitle: {
    marginTop: 1,
    fontSize: 11,
    fontWeight: '600',
    color: '#6B7280',
    textAlign: 'center',
  },
});