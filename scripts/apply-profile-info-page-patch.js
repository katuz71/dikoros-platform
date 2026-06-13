const fs = require('fs');
const path = require('path');

const profilePath = path.join(__dirname, '..', 'app', '(tabs)', 'profile.tsx');
let source = fs.readFileSync(profilePath, 'utf8');

const oldBlock = `  const openInfoModal = () => {
    if (!profile) {
      Alert.alert('Увага', 'Спочатку увійдіть в акаунт');
      return;
    }
    setInfoName(profile.name || '');
    setInfoCity(profile.city || '');
    setInfoWarehouse(profile.warehouse || '');
    setInfoEmail(profile.email || '');
    setInfoContactPreference(profile.contact_preference || 'call');
    setInfoModalVisible(true);
  };`;

const newBlock = `  const openInfoModal = () => {
    if (!profile) {
      Alert.alert('Увага', 'Спочатку увійдіть в акаунт');
      return;
    }
    router.push('/profile-info' as any);
  };`;

if (!source.includes(oldBlock)) {
  console.error('Profile info modal block was not found. Patch was not applied.');
  process.exit(1);
}

source = source.replace(oldBlock, newBlock);
fs.writeFileSync(profilePath, source, 'utf8');
console.log('Profile info action now opens /profile-info page.');
