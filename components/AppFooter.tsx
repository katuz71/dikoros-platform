import { useCart } from '@/context/CartContext';
import { useGlobalSearch } from '@/context/GlobalSearchContext';
import { useOrders } from '@/context/OrdersContext';
import { Ionicons } from '@expo/vector-icons';
import { usePathname, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type FooterItem = {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  activeIcon: keyof typeof Ionicons.glyphMap;
  route?: any;
};

const SITE_CATEGORY_ORDER = [
  'Мікродозінг',
  'Сушені гриби',
  'CBD',
  'Адаптогени та суперфуди',
  'Мазі',
  'Настоянки',
  'Трави та ягоди',
  'Ваги',
  'Консервація та мед',
];

const ITEMS: FooterItem[] = [
  {
    key: 'home',
    label: 'Головна',
    icon: 'home-outline',
    activeIcon: 'home',
    route: { pathname: '/(tabs)', params: { homeReset: '1' } },
  },
  {
    key: 'menu',
    label: 'Меню',
    icon: 'compass-outline',
    activeIcon: 'compass',
  },
  {
    key: 'categories',
    label: 'Категорії',
    icon: 'list-outline',
    activeIcon: 'list',
  },
  {
    key: 'cart',
    label: 'Кошик',
    icon: 'cart-outline',
    activeIcon: 'cart',
    route: '/(tabs)/cart',
  },
  {
    key: 'profile',
    label: 'Профіль',
    icon: 'person-outline',
    activeIcon: 'person',
    route: '/(tabs)/profile',
  },
];

const getRootCategoryName = (value: any) => {
  const raw = String(value || '').trim();
  if (!raw) return '';

  return raw
    .split(/[>»/|]/)
    .map(part => part.trim())
    .filter(Boolean)[0] || raw;
};

export function AppFooter() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { items } = useCart();
  const { openSearch } = useGlobalSearch();
  const { products, fetchProducts } = useOrders();
  const [menuVisible, setMenuVisible] = useState(false);
  const [categoriesVisible, setCategoriesVisible] = useState(false);

  const cartCount = items.reduce((sum: number, item: any) => sum + Number(item?.quantity || 1), 0);

  useEffect(() => {
    if (!Array.isArray(products) || products.length === 0) {
      fetchProducts().catch(() => {});
    }
  }, []);

  const categories = useMemo(() => {
    const set = new Set<string>();

    (Array.isArray(products) ? products : []).forEach((product: any) => {
      const root = getRootCategoryName(product?.category);
      if (root) set.add(root);
    });

    const ordered = SITE_CATEGORY_ORDER.filter(cat => set.has(cat));
    const extra = Array.from(set)
      .filter(cat => !SITE_CATEGORY_ORDER.includes(cat))
      .sort((a, b) => a.localeCompare(b));

    return [...ordered, ...extra];
  }, [products]);

  const getActive = (key: string) => {
    const path = pathname || '';

    if (key === 'home') {
      return path === '/' || path === '/(tabs)' || path === '/index';
    }

    if (key === 'menu') return menuVisible;
    if (key === 'categories') return categoriesVisible;
    if (key === 'cart') return path.includes('/cart') || path.includes('/checkout');
    if (key === 'profile') return path.includes('/profile');

    return false;
  };

  const closeMenu = () => {
    setMenuVisible(false);
  };

  const closeCategories = () => {
    setCategoriesVisible(false);
  };

  const goHome = () => {
    router.replace({
      pathname: '/(tabs)',
      params: { homeReset: String(Date.now()) },
    } as any);
  };

  const goCategory = (category: string) => {
    router.replace({
      pathname: '/(tabs)',
      params: {
        category,
        categoryOpen: String(Date.now()),
      },
    } as any);
  };

  const goTo = (item: FooterItem) => {
    if (item.key === 'menu') {
      setMenuVisible(true);
      return;
    }

    if (item.key === 'categories') {
      setCategoriesVisible(true);
      return;
    }

    if (item.key === 'home') {
      goHome();
      return;
    }

    router.replace(item.route);
  };

  const menuAction = (action: () => void) => {
    closeMenu();
    setTimeout(action, 120);
  };

  const categoryAction = (category: string) => {
    closeCategories();
    setTimeout(() => goCategory(category), 120);
  };

  const MenuRow = ({
    icon,
    title,
    subtitle,
    onPress,
    rightIcon = 'chevron-forward',
  }: {
    icon: keyof typeof Ionicons.glyphMap;
    title: string;
    subtitle?: string;
    onPress: () => void;
    rightIcon?: keyof typeof Ionicons.glyphMap;
  }) => (
    <TouchableOpacity style={styles.menuRow} onPress={onPress} activeOpacity={0.78}>
      <View style={styles.menuIconBox}>
        <Ionicons name={icon} size={21} color="#2E7D32" />
      </View>

      <View style={styles.menuTextBox}>
        <Text style={styles.menuTitle}>{title}</Text>
        {!!subtitle && <Text style={styles.menuSubtitle}>{subtitle}</Text>}
      </View>

      <Ionicons name={rightIcon} size={18} color="#9CA3AF" />
    </TouchableOpacity>
  );

  const LegalMenuRow = ({
    title,
    page,
    icon,
    isLast = false,
  }: {
    title: string;
    page: string;
    icon: keyof typeof Ionicons.glyphMap;
    isLast?: boolean;
  }) => (
    <TouchableOpacity
      style={[styles.legalMenuRow, isLast && styles.legalMenuRowLast]}
      onPress={() => menuAction(() => router.push({ pathname: '/policies', params: { page } } as any))}
      activeOpacity={0.78}
    >
      <View style={styles.legalMenuIconBox}>
        <Ionicons name={icon} size={18} color="#2E7D32" />
      </View>

      <Text style={styles.legalMenuTitle}>{title}</Text>
      <Ionicons name="chevron-forward" size={17} color="#9CA3AF" />
    </TouchableOpacity>
  );

  return (
    <>
      <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 4) }]}> 
        <View style={styles.bar}>
          {ITEMS.map((item) => {
            const active = getActive(item.key);
            const showBadge = item.key === 'cart' && cartCount > 0;

            return (
              <TouchableOpacity
                key={item.key}
                style={styles.item}
                activeOpacity={0.78}
                onPress={() => goTo(item)}
              >
                <View style={[styles.iconBox, active && styles.iconBoxActive]}>
                  <Ionicons
                    name={active ? item.activeIcon : item.icon}
                    size={22}
                    color={active ? '#2E7D32' : '#6B7280'}
                  />

                  {showBadge && (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>
                        {cartCount > 99 ? '99+' : cartCount}
                      </Text>
                    </View>
                  )}
                </View>

                <Text style={[styles.label, active && styles.labelActive]} numberOfLines={1}>
                  {item.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <Modal
        visible={menuVisible}
        transparent
        animationType="fade"
        onRequestClose={closeMenu}
      >
        <View style={styles.modalRoot}>
          <Pressable style={styles.backdrop} onPress={closeMenu} />

          <View style={[styles.menuSheet, { paddingBottom: Math.max(insets.bottom + 14, 22) }]}> 
            <View style={styles.menuHandle} />

            <View style={styles.menuHeader}>
              <Text style={styles.menuHeading}>Меню</Text>

              <TouchableOpacity onPress={closeMenu} style={styles.closeButton} activeOpacity={0.75}>
                <Ionicons name="close" size={24} color="#111827" />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.menuScroll}
              contentContainerStyle={styles.menuScrollContent}
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.menuSectionTitle}>Каталог</Text>

              <MenuRow
                icon="grid-outline"
                title="Усі товари"
                subtitle="Відкрити повний каталог"
                onPress={() => menuAction(() => goCategory(''))}
              />

              <MenuRow
                icon="pricetag-outline"
                title="Акції"
                subtitle="Поточні пропозиції та знижки"
                onPress={() => menuAction(() => router.push('/news' as any))}
              />

              <MenuRow
                icon="newspaper-outline"
                title="Блог"
                subtitle="Інформаційні статті Dikoros"
                onPress={() => menuAction(() => router.push('/blog' as any))}
              />

              <Text style={styles.menuSectionTitle}>Сервіс</Text>

              <MenuRow
                icon="information-circle-outline"
                title="Про нас"
                subtitle="Хто ми та як працює DikorosUA"
                onPress={() => menuAction(() => router.push('/about' as any))}
              />

              <MenuRow
                icon="search-outline"
                title="Пошук"
                subtitle="Знайти товар у каталозі"
                onPress={() => menuAction(openSearch)}
              />

              <MenuRow
                icon="heart-outline"
                title="Обране"
                subtitle="Збережені товари"
                onPress={() => menuAction(() => router.replace('/(tabs)/favorites' as any))}
              />

              <MenuRow
                icon="cart-outline"
                title="Кошик"
                subtitle={cartCount > 0 ? `Товарів у кошику: ${cartCount}` : 'Ваш кошик'}
                onPress={() => menuAction(() => router.replace('/(tabs)/cart' as any))}
              />

              <MenuRow
                icon="person-outline"
                title="Профіль"
                subtitle="Бонуси, замовлення та дані клієнта"
                onPress={() => menuAction(() => router.replace('/(tabs)/profile' as any))}
              />

              <MenuRow
                icon="receipt-outline"
                title="Замовлення"
                subtitle="Історія покупок"
                onPress={() => menuAction(() => router.push('/(tabs)/orders' as any))}
              />

              <MenuRow
                icon="chatbubble-ellipses-outline"
                title="Підтримка"
                subtitle="Написати менеджеру"
                onPress={() => menuAction(() => router.push('/(tabs)/chat' as any))}
              />

              <Text style={styles.menuSectionTitle}>Юридична інформація</Text>


                <View style={styles.legalMenuBox}>
                  <LegalMenuRow title="Оплата і доставка" page="delivery" icon="card-outline" />
                  <LegalMenuRow title="Обмін та повернення" page="returns" icon="swap-horizontal-outline" />
                  <LegalMenuRow title="Міжнародні відправки" page="international" icon="airplane-outline" />
                  <LegalMenuRow title="Контактна інформація" page="contacts" icon="call-outline" />
                  <LegalMenuRow title="Договір оферти" page="offer" icon="document-text-outline" />
                  <LegalMenuRow title="Політика конфіденційності" page="privacy" icon="shield-checkmark-outline" />
                  <LegalMenuRow title="Видалення акаунта" page="deleteAccount" icon="trash-outline" />
                  <LegalMenuRow title="Часті питання" page="faq" icon="help-circle-outline" isLast />
                </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        visible={categoriesVisible}
        transparent
        animationType="fade"
        onRequestClose={closeCategories}
      >
        <View style={styles.modalRoot}>
          <Pressable style={styles.backdrop} onPress={closeCategories} />

          <View style={[styles.menuSheet, { paddingBottom: Math.max(insets.bottom + 14, 22) }]}> 
            <View style={styles.menuHandle} />

            <View style={styles.menuHeader}>
              <Text style={styles.menuHeading}>Категорії</Text>

              <TouchableOpacity onPress={closeCategories} style={styles.closeButton} activeOpacity={0.75}>
                <Ionicons name="close" size={24} color="#111827" />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.menuScroll}
              contentContainerStyle={styles.menuScrollContent}
              showsVerticalScrollIndicator={false}
            >
              {categories.map((category) => (
                <MenuRow
                  key={category}
                  icon="leaf-outline"
                  title={category}
                  onPress={() => categoryAction(category)}
                />
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    zIndex: 900,
  },
  bar: {
    minHeight: 58,
    paddingHorizontal: 4,
    paddingTop: 5,
    paddingBottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: '#FFFFFF',
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  iconBox: {
    width: 42,
    height: 30,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBoxActive: {
    backgroundColor: '#E8F7E8',
  },
  label: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '700',
    color: '#6B7280',
  },
  labelActive: {
    color: '#2E7D32',
    fontWeight: '900',
  },
  badge: {
    position: 'absolute',
    top: -5,
    right: -5,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '900',
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(17, 24, 39, 0.45)',
  },
  menuSheet: {
    maxHeight: '84%',
    backgroundColor: '#F8FAF8',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingTop: 10,
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.16,
    shadowRadius: 24,
    elevation: 24,
  },
  menuHandle: {
    alignSelf: 'center',
    width: 46,
    height: 5,
    borderRadius: 999,
    backgroundColor: '#D1D5DB',
    marginBottom: 12,
  },
  menuHeader: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  menuHeading: {
    fontSize: 24,
    fontWeight: '900',
    color: '#111827',
  },
  closeButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  menuScroll: {
    maxHeight: '100%',
  },
  menuScrollContent: {
    paddingBottom: 8,
  },
  menuSectionTitle: {
    marginTop: 8,
    marginBottom: 8,
    fontSize: 13,
    lineHeight: 16,
    fontWeight: '900',
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  menuRow: {
    minHeight: 56,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 7,
  },
  menuIconBox: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#ECFDF3',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 11,
  },
  menuTextBox: {
    flex: 1,
  },
  menuTitle: {
    fontSize: 15,
    lineHeight: 19,
    fontWeight: '900',
    color: '#111827',
  },
  menuSubtitle: {
    marginTop: 1,
    fontSize: 12,
    lineHeight: 15,
    fontWeight: '600',
    color: '#6B7280',
  },
  legalMenuBox: {
    marginTop: -1,
    marginBottom: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 16,
    overflow: 'hidden',
  },
  legalMenuRow: {
    minHeight: 48,
    paddingVertical: 12,
    paddingLeft: 18,
    paddingRight: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  legalMenuRowLast: {
    borderBottomWidth: 0,
  },
  legalMenuIconBox: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#ECFDF3',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  legalMenuTitle: {
    flex: 1,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
    color: '#374151',
  },
});
