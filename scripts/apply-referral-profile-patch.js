const fs = require('fs');
const path = require('path');

const profilePath = path.join(__dirname, '..', 'app', '(tabs)', 'profile.tsx');
let source = fs.readFileSync(profilePath, 'utf8');

const newShare = `  // 4. Реферальная ссылка
  const handleShare = async () => {
    try {
      const accessToken = await AsyncStorage.getItem('accessToken');

      if (!accessToken) {
        Alert.alert('Потрібен вхід', 'Увійдіть у профіль, щоб запросити друга.');
        setShowLoginModal(true);
        return;
      }

      const res = await fetch(\`\${API_URL}/api/referral/me\`, {
        headers: { Authorization: \`Bearer \${accessToken}\` },
      });
      const referral = await res.json().catch(() => null);

      if (!res.ok || !referral?.web_link) {
        throw new Error(referral?.detail || 'Referral link unavailable');
      }

      await Share.share({
        message: referral.message || \`Запрошую тебе в DikorosUA 🍄\\nЗа реєстрацію отримаєш 150 грн бонусами.\\nМоє реферальне посилання: \${referral.web_link}\`,
        url: referral.web_link,
        title: 'Запрошення в DikorosUA',
      });
    } catch (error) {
      console.log(error?.message || error);
      Alert.alert('Помилка', 'Не вдалося створити реферальне посилання. Спробуйте ще раз.');
    }
  };

  const openLink =`;

const shareBlockPattern = /  \/\/ 4\.[\s\S]*?  const openLink =/;
if (!source.includes('const res = await fetch(`${API_URL}/api/referral/me`')) {
  if (!shareBlockPattern.test(source)) {
    throw new Error('handleShare/openLink block was not found');
  }
  source = source.replace(shareBlockPattern, newShare);
}

const newCashback = `    let currentPercent = 5;
    let nextLevel = 5000;
    let nextPercent = 10;
    let prevLevel = 0;

    if (totalSpent < 5000) {
      currentPercent = 5;
      nextLevel = 5000;
      nextPercent = 10;
      prevLevel = 0;
    } else if (totalSpent < 10000) {
      currentPercent = 10;
      nextLevel = 10000;
      nextPercent = 15;
      prevLevel = 5000;
    } else if (totalSpent < 25000) {
      currentPercent = 15;
      nextLevel = 25000;
      nextPercent = 20;
      prevLevel = 10000;
    } else {
      currentPercent = 20;
      nextLevel = 0;
      nextPercent = 20;
      prevLevel = 25000;
    }`;

const cashbackBlockPattern = /    let currentPercent = [\s\S]*?\n\n    \/\/ Считаем % заполнения/;
if (!source.includes(newCashback)) {
  if (!cashbackBlockPattern.test(source)) {
    console.warn('cashback block was not found; skipped');
  } else {
    source = source.replace(cashbackBlockPattern, `${newCashback}\n\n    // Считаем % заполнения`);
  }
}

const newTable = `                <View style={styles.tr}><Text style={styles.td}>0 - 4 999 ₴</Text><Text style={styles.tdR}>5%</Text></View>
                <View style={styles.tr}><Text style={styles.td}>5 000 - 9 999 ₴</Text><Text style={styles.tdR}>10%</Text></View>
                <View style={styles.tr}><Text style={styles.td}>10 000 - 24 999 ₴</Text><Text style={styles.tdR}>15%</Text></View>
                <View style={[styles.tr, {borderBottomWidth:0}]}><Text style={styles.td}>від 25 000 ₴</Text><Text style={styles.tdR}>20%</Text></View>`;

const tableBlockPattern = /                <View style=\{styles\.tr\}><Text style=\{styles\.td\}>0 -[\s\S]*?від 25 000 ₴<\/Text><Text style=\{styles\.tdR\}>20%<\/Text><\/View>/;
if (!source.includes(newTable)) {
  if (!tableBlockPattern.test(source)) {
    console.warn('cashback table block was not found; skipped');
  } else {
    source = source.replace(tableBlockPattern, newTable);
  }
}

fs.writeFileSync(profilePath, source, 'utf8');
console.log('Referral profile patch applied:', profilePath);
