import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const WELCOME_BONUS_MODAL_SEEN_KEY = 'welcomeBonusModalSeenV1';

export function WelcomeBonusModal() {
  const router = useRouter();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let mounted = true;

    const maybeShowModal = async () => {
      try {
        const [seen, accessToken] = await Promise.all([
          AsyncStorage.getItem(WELCOME_BONUS_MODAL_SEEN_KEY),
          AsyncStorage.getItem('accessToken'),
        ]);

        if (!mounted) return;
        if (!seen && !accessToken) {
          setVisible(true);
        }
      } catch (error) {
        console.warn('Welcome bonus modal check failed:', error);
      }
    };

    maybeShowModal();

    return () => {
      mounted = false;
    };
  }, []);

  const closeModal = async () => {
    await AsyncStorage.setItem(WELCOME_BONUS_MODAL_SEEN_KEY, '1');
    setVisible(false);
  };

  const goToRegistration = async () => {
    await closeModal();
    router.push('/(tabs)/profile' as any);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={closeModal}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <TouchableOpacity style={styles.closeButton} onPress={closeModal} activeOpacity={0.8}>
            <Ionicons name="close" size={22} color="#6B7280" />
          </TouchableOpacity>

          <View style={styles.iconWrap}>
            <Ionicons name="gift" size={34} color="#FFFFFF" />
          </View>

          <Text style={styles.kicker}>Бонус для нових клієнтів</Text>
          <Text style={styles.title}>Зареєструйся та отримай 150 грн</Text>
          <Text style={styles.subtitle}>
            Використай бонус на покупку товарів Dikoros після створення акаунта.
          </Text>

          <TouchableOpacity style={styles.primaryButton} onPress={goToRegistration} activeOpacity={0.9}>
            <Text style={styles.primaryButtonText}>Зареєструватися</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.secondaryButton} onPress={closeModal} activeOpacity={0.8}>
            <Text style={styles.secondaryButtonText}>Пізніше</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    paddingHorizontal: 24,
    paddingTop: 34,
    paddingBottom: 22,
    alignItems: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.22,
    shadowRadius: 28,
    elevation: 12,
  },
  closeButton: {
    position: 'absolute',
    top: 14,
    right: 14,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F3F4F6',
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#458B00',
    marginBottom: 16,
  },
  kicker: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.4,
    color: '#458B00',
    textTransform: 'uppercase',
    marginBottom: 8,
    textAlign: 'center',
  },
  title: {
    fontSize: 27,
    lineHeight: 32,
    fontWeight: '900',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 23,
    color: '#4B5563',
    textAlign: 'center',
    marginBottom: 22,
  },
  primaryButton: {
    width: '100%',
    height: 54,
    borderRadius: 18,
    backgroundColor: '#458B00',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '900',
  },
  secondaryButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  secondaryButtonText: {
    color: '#6B7280',
    fontSize: 15,
    fontWeight: '700',
  },
});
