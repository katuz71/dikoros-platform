import { AppHeader } from '@/components/AppHeader';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const advantages = [
  'Власний цикл виробництва: збір, сушіння та обробка продукції.',
  'Контроль якості на кожному етапі.',
  'Натуральна продукція з грибів, трав та ягід.',
  'Швидка обробка замовлень та підтримка клієнтів.',
  'Сертифікати якості та відповідальне ставлення до безпеки продукції.',
];

export default function AboutScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container}>
      <AppHeader showLogo showSearch showFavorites />

      <View style={styles.titleRow}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} activeOpacity={0.75}>
          <Ionicons name="chevron-back" size={26} color="#111827" />
        </TouchableOpacity>

        <Text style={styles.title} numberOfLines={1}>Про нас</Text>

        <View style={styles.backButton} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.heroCard}>
          <Text style={styles.heroKicker}>DikorosUA</Text>
          <Text style={styles.heroTitle}>Дикорослі рослини, гриби та ягоди України</Text>
          <Text style={styles.heroText}>
            Ми створюємо натуральну продукцію з грибів, трав та ягід і розвиваємо власне виробництво з 2019 року.
            Наша мета — дати клієнтам якісний сервіс, зрозумілий каталог та продукцію з ретельним контролем якості.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Що важливо для нас</Text>

          {advantages.map((item) => (
            <View key={item} style={styles.advantageRow}>
              <View style={styles.checkIcon}>
                <Ionicons name="checkmark" size={16} color="#FFFFFF" />
              </View>
              <Text style={styles.advantageText}>{item}</Text>
            </View>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Наш підхід</Text>
          <Text style={styles.paragraph}>
            DikorosUA — це команда, яка працює з природною сировиною та уважно ставиться до деталей:
            від заготівлі й пакування до консультації клієнта та відправлення замовлення.
          </Text>
          <Text style={styles.paragraph}>
            У застосунку ви можете переглядати каталог, додавати товари в обране, оформлювати замовлення,
            отримувати бонуси та звертатися до підтримки.
          </Text>
        </View>

        <View style={styles.noteCard}>
          <Ionicons name="leaf-outline" size={22} color="#2E7D32" />
          <Text style={styles.noteText}>
            Обирайте продукцію свідомо. Якщо маєте індивідуальні питання щодо товару, зверніться до менеджера перед покупкою.
          </Text>
        </View>

        <View style={{ height: 120 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAF8',
  },
  titleRow: {
    height: 54,
    paddingHorizontal: 14,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: 20,
    fontWeight: '900',
    color: '#111827',
  },
  content: {
    padding: 16,
  },
  heroCard: {
    backgroundColor: '#102015',
    borderRadius: 24,
    padding: 20,
    marginBottom: 16,
  },
  heroKicker: {
    color: '#9EE6A8',
    fontSize: 13,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  heroTitle: {
    color: '#FFFFFF',
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '900',
    marginBottom: 12,
  },
  heroText: {
    color: '#E5E7EB',
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
  },
  section: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  sectionTitle: {
    fontSize: 19,
    fontWeight: '900',
    color: '#111827',
    marginBottom: 12,
  },
  advantageRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  checkIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#2E7D32',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    marginTop: 1,
  },
  advantageText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 21,
    color: '#374151',
    fontWeight: '700',
  },
  paragraph: {
    fontSize: 15,
    lineHeight: 23,
    color: '#374151',
    fontWeight: '600',
    marginBottom: 10,
  },
  noteCard: {
    backgroundColor: '#ECFDF3',
    borderRadius: 18,
    padding: 14,
    flexDirection: 'row',
    gap: 10,
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  noteText: {
    flex: 1,
    color: '#166534',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
});
