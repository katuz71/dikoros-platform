const fs = require('fs');
const path = require('path');

const profilePath = path.join(__dirname, '..', 'app', '(tabs)', 'profile.tsx');
let source = fs.readFileSync(profilePath, 'utf8').replace(/\r\n/g, '\n');
let changed = false;

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
    console.warn('handleShare/openLink block was not found; skipped');
  } else {
    source = source.replace(shareBlockPattern, newShare);
    changed = true;
  }
}

const oldFirstTier = `    let currentPercent = 0;
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
    }`;

const newFirstTier = `    let currentPercent = 5;
    let nextLevel = 5000;
    let nextPercent = 10;
    let prevLevel = 0;

    if (totalSpent < 5000) {
      currentPercent = 5;
      nextLevel = 5000;
      nextPercent = 10;
      prevLevel = 0;
    }`;

if (source.includes(oldFirstTier)) {
  source = source.replace(oldFirstTier, newFirstTier);
  changed = true;
} else {
  const fallbackBefore = source;
  source = source
    .replace('    let currentPercent = 0;\n    let nextLevel = 2000;\n    let nextPercent = 5;\n    let prevLevel = 0;', '    let currentPercent = 5;\n    let nextLevel = 5000;\n    let nextPercent = 10;\n    let prevLevel = 0;')
    .replace(/\n    if \(totalSpent < 2000\) \{\n      currentPercent = 0;\n      nextLevel = 2000;\n      nextPercent = 5;\n      prevLevel = 0;\n    \} else if \(totalSpent < 5000\) \{/, '\n    if (totalSpent < 5000) {')
    .replace('      prevLevel = 2000;', '      prevLevel = 0;');
  if (source !== fallbackBefore) changed = true;
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

if (source.includes(oldTable)) {
  source = source.replace(oldTable, newTable);
  changed = true;
}

fs.writeFileSync(profilePath, source, 'utf8');
console.log(changed ? 'Referral profile patch applied' : 'Referral profile patch already applied');
console.log(profilePath);
