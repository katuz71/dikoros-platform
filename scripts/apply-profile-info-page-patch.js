const fs = require('fs');
const path = require('path');

const profilePath = path.join(__dirname, '..', 'app', '(tabs)', 'profile.tsx');
let source = fs.readFileSync(profilePath, 'utf8');
let changed = false;

const replaceRegex = (regex, replacement, label, required = true) => {
  if (!regex.test(source)) {
    if (required) {
      console.error(`${label}: block was not found. Patch was not applied.`);
      process.exit(1);
    }
    return;
  }
  source = source.replace(regex, replacement);
  changed = true;
};

const replaceText = (search, replacement, label, required = true) => {
  if (!source.includes(search)) {
    if (required) {
      console.error(`${label}: block was not found. Patch was not applied.`);
      process.exit(1);
    }
    return;
  }
  source = source.replace(search, replacement);
  changed = true;
};

// Remove obsolete local state for the old personal-info modal.
replaceRegex(
  /\n\s*\/\/ Info Modal States\s*\n\s*const \[infoModalVisible, setInfoModalVisible\] = useState\(false\);\s*\n\s*const \[infoName, setInfoName\] = useState\(''\);\s*\n\s*const \[infoCity, setInfoCity\] = useState\(''\);\s*\n\s*const \[infoWarehouse, setInfoWarehouse\] = useState\(''\);[^\n]*\n\s*const \[infoEmail, setInfoEmail\] = useState\(''\);\s*\n\s*const \[infoContactPreference, setInfoContactPreference\] = useState<'call' \| 'telegram' \| 'viber'>\('call'\);\s*\n/,
  '\n',
  'Remove info modal state',
  false
);

// Do not request profile data twice on first mount; focus refresh is enough.
replaceRegex(
  /\n\s*useEffect\(\(\) => \{\s*\n\s*checkLogin\(\);\s*\n\s*\}, \[\]\);\s*\n/,
  '\n',
  'Remove duplicate profile load effect',
  false
);

// Make auth state strict: do not show authenticated profile without JWT.
replaceRegex(
  /  const checkLogin = async \(\) => \{[\s\S]*?\n  \};\n\n  const fetchUserReviews/,
  `  const checkLogin = async () => {
    const accessToken = await AsyncStorage.getItem('accessToken');
    const storedPhone = await AsyncStorage.getItem('userPhone');

    if (!accessToken || !storedPhone) {
      setPhone('');
      setProfile(null);
      setOrders([]);
      setUserReviews([]);
      return;
    }

    const canon = canonicalizePhone(storedPhone);
    if (canon && canon !== storedPhone) {
      await AsyncStorage.setItem('userPhone', canon);
    }
    setPhone(canon);
    fetchData(canon);
  };

  const fetchUserReviews`,
  'Replace checkLogin'
);

// Open personal info as a real page and remove the old inline save handler.
replaceRegex(
  /  \/\* 🔥 UPDATE USER INFO \*\/[\s\S]*?\n  const onRefresh = React\.useCallback/,
  `  const openInfoModal = () => {
    if (!profile) {
      Alert.alert('Увага', 'Спочатку увійдіть в акаунт');
      return;
    }
    router.push('/profile-info' as any);
  };

  const onRefresh = React.useCallback`,
  'Replace info modal action'
);

// Remove the old personal-info modal JSX completely.
replaceRegex(
  /\n\s*\{\/\* 🔥 INFO MODAL \*\/\}[\s\S]*?\n\s*\{\/\* 🔥 REVIEWS MODAL \*\/\}/,
  `\n\n      {/* 🔥 REVIEWS MODAL */}`,
  'Remove info modal JSX',
  false
);

// Clean menu: remove placeholders and split guest/user menu.
replaceRegex(
  /  \/\/ === ОБЩИЙ КОНТЕНТ ===[\s\S]*?\n  \/\/ === ЭКРАН ГОСТЯ ===/,
  `  // === МЕНЮ АВТОРИЗОВАНОГО КЛІЄНТА ===
  const renderCommonMenu = () => (
    <>
      <View style={styles.gridContainer}>
        <GridBtn icon="receipt-outline" label="Замовлення" onPress={() => router.push('/(tabs)/orders')} />
        <GridBtn icon="chatbubble-ellipses-outline" label="Підтримка" onPress={() => openLink('https://t.me/dikoros_support')} />
        <GridBtn icon="heart-outline" label="Мої списки" onPress={() => router.push('/(tabs)/favorites')} />
        <GridBtn icon="person-outline" label="Інформація" onPress={openInfoModal} />
      </View>

      <MenuSection title="Бонуси та знижки">
        <MenuItem label="Мої винагороди" onPress={() => setModalVisible(true)} />
        <MenuItem label="Бонуси на покупки" isLast onPress={() => setModalVisible(true)} />
      </MenuSection>

      <MenuSection title="Моя активність">
        <MenuItem label="Моя сторінка" onPress={openInfoModal} />
        <MenuItem label="Мої відгуки" isLast onPress={() => setReviewsModalVisible(true)} />
      </MenuSection>

      <MenuSection title="Налаштування">
        <MenuItem label="Прив’язати Google" onPress={handleGoogleLinkStart} />
        <MenuItem label="Видалити акаунт" color="#D32F2F" isLast onPress={handleDeleteAccount} />
      </MenuSection>

      <MenuSection title="Інформація">
        <MenuItem label="Оплата і доставка" onPress={() => openPolicy("delivery")} />
        <MenuItem label="Міжнародні відправки" onPress={() => openPolicy("international")} />
        <MenuItem label="Рейтинг та відгуки" isLast onPress={() => setReviewsModalVisible(true)} />
      </MenuSection>

      <MenuSection title="Детальніше">
        <MenuItem label="Контактна інформація" onPress={() => openPolicy("contacts")} />
        <MenuItem label="Політика конфіденційності" onPress={() => openPolicy("privacy")} />
        <MenuItem label="Обмін та повернення" onPress={() => openPolicy("returns")} />
        <MenuItem label="Договір оферти" onPress={() => openPolicy("offer")} />
        <MenuItem label="Часті питання" isLast onPress={() => openPolicy("faq")} />
      </MenuSection>

      <View style={{height: 50}} />
    </>
  );

  // === МЕНЮ ГОСТЯ ===
  const renderGuestMenu = () => (
    <>
      <View style={styles.gridContainer}>
        <GridBtn icon="chatbubble-ellipses-outline" label="Підтримка" onPress={() => openLink('https://t.me/dikoros_support')} />
        <GridBtn icon="card-outline" label="Оплата" onPress={() => openPolicy("delivery")} />
        <GridBtn icon="call-outline" label="Контакти" onPress={() => openPolicy("contacts")} />
        <GridBtn icon="help-circle-outline" label="FAQ" onPress={() => openPolicy("faq")} />
      </View>

      <MenuSection title="Інформація">
        <MenuItem label="Оплата і доставка" onPress={() => openPolicy("delivery")} />
        <MenuItem label="Міжнародні відправки" onPress={() => openPolicy("international")} />
        <MenuItem label="Контактна інформація" onPress={() => openPolicy("contacts")} />
        <MenuItem label="Обмін та повернення" onPress={() => openPolicy("returns")} />
        <MenuItem label="Політика конфіденційності" onPress={() => openPolicy("privacy")} />
        <MenuItem label="Договір оферти" onPress={() => openPolicy("offer")} />
        <MenuItem label="Часті питання" isLast onPress={() => openPolicy("faq")} />
      </MenuSection>

      <View style={{height: 50}} />
    </>
  );

  // === ЭКРАН ГОСТЯ ===`,
  'Replace profile menus'
);

replaceText(
  '      {renderCommonMenu()}\n      </ScrollView>',
  '      {renderGuestMenu()}\n      </ScrollView>',
  'Use guest menu',
  false
);

// Avoid stale checkout autofill after logout.
replaceText(
  `          await AsyncStorage.removeItem('accessToken');\n          setPhone('');`,
  `          await AsyncStorage.removeItem('accessToken');
          await AsyncStorage.removeItem('savedCheckoutInfo');
          setPhone('');`,
  'Clear saved checkout info on logout',
  false
);

if (/setInfoModalVisible\(true\)|infoModalVisible|saveUserInfo/.test(source)) {
  console.error('Old info modal references are still present. Patch stopped.');
  process.exit(1);
}

fs.writeFileSync(profilePath, source, 'utf8');
console.log('Profile section fixed: info opens as page, guest menu is clean, old info modal removed.');