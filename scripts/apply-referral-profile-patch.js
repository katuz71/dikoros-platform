const fs = require('fs');
const path = require('path');

const profilePath = path.join(__dirname, '..', 'app', '(tabs)', 'profile.tsx');
let source = fs.readFileSync(profilePath, 'utf8');

const oldShare = `  // 4. Поделиться
  const handleShare = async () => {
    try {
      await Share.share({
        message: \`Привіт! Тримай від мене 50 грн на покупки в Dikoros UA! \nВкажи мій номер \${phone} при замовленні.\`,
      });
    } catch (error: any) { console.log(error.message); }
  };`;

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
    } catch (error: any) {
      console.log(error?.message || error);
      Alert.alert('Помилка', 'Не вдалося створити реферальне посилання. Спробуйте ще раз.');
    }
  };`;

if (!source.includes(newShare)) {
  if (!source.includes(oldShare)) {
    throw new Error('handleShare block was not found or was already changed differently');
  }
  source = source.replace(oldShare, newShare);
}

const oldCashback = `    let currentPercent = 0;
    let nextLevel = 2000;
    let nextPercent = 5;
    let prevLevel = 0;

    if (totalSpent < 2000) {
      currentPercent = 0;
      nextLevel = 2000;
      nextPercent = 5;
      prevLevel = 0;
    } else if (totalSpent < 5000) {
      currentPercent = 5;
      nextLevel = 5000;
      nextPercent = 10;
      prevLevel = 2000;
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

if (!source.includes(newCashback)) {
  if (!source.includes(oldCashback)) {
    throw new Error('cashback block was not found or was already changed differently');
  }
  source = source.replace(oldCashback, newCashback);
}

const oldTable = `                <View style={styles.tr}><Text style={styles.td}>0 - 1 999 ₴</Text><Text style={styles.tdR}>0%</Text></View>
                <View style={styles.tr}><Text style={styles.td}>2 000 - 4 999 ₴</Text><Text style={styles.tdR}>5%</Text></View>
                <View style={styles.tr}><Text style={styles.td}>5 000 - 9 999 ₴</Text><Text style={styles.tdR}>10%</Text></View>
                <View style={styles.tr}><Text style={styles.td}>10 000 - 24 999 ₴</Text><Text style={styles.tdR}>15%</Text></View>
                <View style={[styles.tr, {borderBottomWidth:0}]}><Text style={styles.td}>від 25 000 ₴</Text><Text style={styles.tdR}>20%</Text></View>`;

const newTable = `                <View style={styles.tr}><Text style={styles.td}>0 - 4 999 ₴</Text><Text style={styles.tdR}>5%</Text></View>
                <View style={styles.tr}><Text style={styles.td}>5 000 - 9 999 ₴</Text><Text style={styles.tdR}>10%</Text></View>
                <View style={styles.tr}><Text style={styles.td}>10 000 - 24 999 ₴</Text><Text style={styles.tdR}>15%</Text></View>
                <View style={[styles.tr, {borderBottomWidth:0}]}><Text style={styles.td}>від 25 000 ₴</Text><Text style={styles.tdR}>20%</Text></View>`;

if (!source.includes(newTable)) {
  if (!source.includes(oldTable)) {
    throw new Error('cashback table block was not found or was already changed differently');
  }
  source = source.replace(oldTable, newTable);
}

fs.writeFileSync(profilePath, source, 'utf8');
console.log('Referral profile patch applied:', profilePath);
