import { API_URL } from '@/config/api';
import { getImageUrl } from '@/utils/image';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  Vibration,
  View,
} from 'react-native';

interface Product {
  id: string | number;
  name?: string;
  title?: string;
  price?: number;
  currency?: string;
  image?: string;
  image_url?: string;
  picture?: string;
  url?: string;
  old_price?: number;
  badges?: string[];
}

interface Message {
  id: string | number;
  text: string;
  sender: 'user' | 'bot';
  products?: Product[];
  quickReplies?: string[];
}

const CHAT_STORAGE_VERSION = '20260613_encoding_v2';
const CHAT_STORAGE_VERSION_KEY = 'chat_storage_version';

const INITIAL_QUICK_REPLIES = [
  'Що таке мікродозинг?',
  'Для фокусу та енергії',
  'Для спокою та сну',
  'Набори для старту',
  'Каталог усіх грибів',
];

const INITIAL_WELCOME_MESSAGE: Message = {
  id: 'welcome',
  text: 'Привіт! Я експерт Dikoros. Допоможу підібрати гриби, вітаміни чи трави під вашу потребу. Що шукаємо?',
  sender: 'bot',
  quickReplies: INITIAL_QUICK_REPLIES,
};

const mojibakePairs: Record<string, string> = {
  'Рђ': 'А', 'Р‘': 'Б', 'Р’': 'В', 'Р“': 'Г', 'Р”': 'Д', 'Р•': 'Е', 'Р–': 'Ж', 'Р—': 'З',
  'Р˜': 'И', 'Р™': 'Й', 'Рљ': 'К', 'Р›': 'Л', 'Рњ': 'М', 'Рќ': 'Н', 'Рћ': 'О', 'Рџ': 'П',
  'Р ': 'Р', 'РЎ': 'С', 'Рў': 'Т', 'РЈ': 'У', 'Р¤': 'Ф', 'РҐ': 'Х', 'Р¦': 'Ц', 'Р§': 'Ч',
  'РЁ': 'Ш', 'Р©': 'Щ', 'РЄ': 'Ъ', 'Р«': 'Ы', 'Р¬': 'Ь', 'Р­': 'Э', 'Р®': 'Ю', 'РЇ': 'Я',
  'Р°': 'а', 'Р±': 'б', 'РІ': 'в', 'Рі': 'г', 'Рґ': 'д', 'Рµ': 'е', 'Р¶': 'ж', 'Р·': 'з',
  'Рё': 'и', 'Р№': 'й', 'Рє': 'к', 'Р»': 'л', 'Рј': 'м', 'РЅ': 'н', 'Рѕ': 'о', 'Рї': 'п',
  'СЂ': 'р', 'СЃ': 'с', 'С‚': 'т', 'Сѓ': 'у', 'С„': 'ф', 'С…': 'х', 'С†': 'ц', 'С‡': 'ч',
  'С€': 'ш', 'С‰': 'щ', 'СЉ': 'ъ', 'С‹': 'ы', 'СЊ': 'ь', 'СЌ': 'э', 'СЋ': 'ю', 'СЏ': 'я',
  'РЃ': 'Ё', 'С‘': 'ё', 'Р„': 'Є', 'С”': 'є', 'Р†': 'І', 'С–': 'і', 'Р‡': 'Ї', 'С—': 'ї',
  'Тђ': 'Ґ', 'Т‘': 'ґ', 'вЂ™': '’', 'вЂњ': '“', 'вЂќ': '”', 'вЂ“': '–', 'вЂ”': '—', 'в„–': '№',
};

const decodeLiteralUnicodeEscapes = (value: string) => {
  if (!/\\u[0-9a-fA-F]{4}/.test(value)) return value;
  return value.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
};

const repairMojibakePairs = (value: string) => {
  let output = value;
  Object.entries(mojibakePairs).forEach(([bad, good]) => {
    output = output.split(bad).join(good);
  });
  return output;
};

const repairTextEncoding = (value?: unknown): string => {
  if (value === null || value === undefined) return '';
  let text = String(value);
  text = decodeLiteralUnicodeEscapes(text);
  text = repairMojibakePairs(text);
  return text.replace(/\uFFFD/g, '').trim();
};

const isManagerContactMessage = (value?: unknown) => {
  const text = repairTextEncoding(value).toLowerCase();
  return (
    text.includes('зв’язатися з менеджером можна так') ||
    text.includes("зв'язатися з менеджером можна так") ||
    text.includes('viber://chat?number=') ||
    text.includes('https://t.me/dikorosua') ||
    text.includes('email: dikorosua@gmail.com')
  );
};

const openContactUrl = (url: string) => {
  Linking.openURL(url).catch((error) => {
    console.warn('Open contact URL failed:', error);
  });
};

const formatPrice = (price?: number) => {
  const safePrice = price || 0;
  return `${safePrice.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ₴`;
};

const normalizeProducts = (items: any[] = []): Product[] => {
  return items.map((item) => ({
    ...item,
    id: item.id,
    name: repairTextEncoding(item.name || item.title || ''),
    title: repairTextEncoding(item.title || item.name || ''),
    image: item.image || item.image_url || item.picture,
    price: Number(item.price || 0),
    currency: repairTextEncoding(item.currency || 'грн'),
    badges: Array.isArray(item.badges) ? item.badges.map(repairTextEncoding).filter(Boolean) : [],
  }));
};

const normalizeMessage = (message: Message): Message => ({
  ...message,
  text: repairTextEncoding(message.text),
  products: message.products ? normalizeProducts(message.products) : message.products,
  quickReplies: message.quickReplies?.map(repairTextEncoding).filter(Boolean),
});

export default function ChatScreen() {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([INITIAL_WELCOME_MESSAGE]);
  const [inputText, setInputText] = useState('');
  const [sessionId, setSessionId] = useState<string>('anon');
  const [quickReplies, setQuickReplies] = useState<string[]>(INITIAL_QUICK_REPLIES);
  const [loading, setLoading] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  const resetChatStorageForEncodingVersion = useCallback(async () => {
    const version = await AsyncStorage.getItem(CHAT_STORAGE_VERSION_KEY);
    if (version === CHAT_STORAGE_VERSION) return;

    await AsyncStorage.multiRemove(['chat_messages', 'chat_session_id']);
    await AsyncStorage.setItem(CHAT_STORAGE_VERSION_KEY, CHAT_STORAGE_VERSION);
  }, []);

  const loadChatSession = useCallback(async () => {
    try {
      await resetChatStorageForEncodingVersion();

      const storedSessionId = await AsyncStorage.getItem('chat_session_id');
      const storedMessages = await AsyncStorage.getItem('chat_messages');

      if (storedSessionId) {
        setSessionId(storedSessionId);
      } else {
        const newSessionId = `app_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        await AsyncStorage.setItem('chat_session_id', newSessionId);
        setSessionId(newSessionId);
      }

      if (storedMessages) {
        const parsed = JSON.parse(storedMessages);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const normalized = parsed.map(normalizeMessage);
          setMessages(normalized);
          const lastBotWithReplies = [...normalized].reverse().find((m) => m.sender === 'bot' && m.quickReplies?.length);
          if (lastBotWithReplies?.quickReplies) {
            setQuickReplies(lastBotWithReplies.quickReplies);
          }
        }
      }
    } catch (e) {
      console.warn('Load chat session failed:', e);
    }
  }, [resetChatStorageForEncodingVersion]);

  useEffect(() => {
    loadChatSession();
  }, [loadChatSession]);

  useEffect(() => {
    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    }, 100);
  }, [messages]);

  const persistMessages = async (nextMessages: Message[]) => {
    try {
      await AsyncStorage.setItem('chat_messages', JSON.stringify(nextMessages.map(normalizeMessage).slice(-40)));
    } catch (e) {
      console.warn('Persist chat failed:', e);
    }
  };

  const clearChat = async () => {
    const newSessionId = `app_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    await AsyncStorage.setItem('chat_session_id', newSessionId);
    await AsyncStorage.setItem(CHAT_STORAGE_VERSION_KEY, CHAT_STORAGE_VERSION);
    await AsyncStorage.removeItem('chat_messages');

    setSessionId(newSessionId);
    setMessages([INITIAL_WELCOME_MESSAGE]);
    setQuickReplies(INITIAL_QUICK_REPLIES);
    setInputText('');
    Vibration.vibrate(50);
  };

  const sendMessage = async (textOverride?: string) => {
    const userMessage = repairTextEncoding(textOverride || inputText);
    if (!userMessage || loading) return;

    const userMsg: Message = {
      id: `u_${Date.now()}`,
      text: userMessage,
      sender: 'user',
    };

    const messagesWithUser = [...messages, userMsg];
    setMessages(messagesWithUser);
    persistMessages(messagesWithUser);
    setInputText('');
    setQuickReplies([]);
    setLoading(true);

    try {
      const response = await fetch(`${API_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          message: userMessage,
          session_id: sessionId,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }

      const data = await response.json();
      const products = normalizeProducts(data.items || data.products || []);
      const nextQuickReplies = Array.isArray(data.quick_replies)
        ? data.quick_replies.map(repairTextEncoding).filter(Boolean)
        : [];

      if (data.session_id && data.session_id !== sessionId) {
        setSessionId(data.session_id);
        await AsyncStorage.setItem('chat_session_id', data.session_id);
      }

      const botMsg: Message = {
        id: `b_${Date.now()}`,
        text: repairTextEncoding(data.reply || data.text || data.response || 'На жаль, я не зрозумів запит.'),
        sender: 'bot',
        products,
        quickReplies: nextQuickReplies,
      };

      const nextMessages = [...messagesWithUser, botMsg];
      setMessages(nextMessages);
      setQuickReplies(nextQuickReplies);
      persistMessages(nextMessages);
      Vibration.vibrate(50);
    } catch (error) {
      console.error(error);
      const errorMsg: Message = {
        id: `e_${Date.now()}`,
        text: 'Помилка з’єднання. Спробуйте ще раз або напишіть менеджеру.',
        sender: 'bot',
        quickReplies: ['Зв’язатися з менеджером', 'Каталог'],
      };
      const nextMessages = [...messagesWithUser, errorMsg];
      setMessages(nextMessages);
      setQuickReplies(errorMsg.quickReplies || []);
      persistMessages(nextMessages);
    } finally {
      setLoading(false);
    }
  };

  const handleQuickReply = (reply: string) => {
    const safeReply = repairTextEncoding(reply);
    if (safeReply === 'Зв’язатися з менеджером' || safeReply === "Зв'язатися з менеджером") {
      setInputText(safeReply);
    }
    sendMessage(safeReply);
  };

  const renderProductCard = (prod: Product) => {
    const productId = String(prod.id || '');
    const title = repairTextEncoding(prod.name || prod.title || 'Товар');
    const image = prod.image || prod.image_url || prod.picture;

    return (
      <TouchableOpacity
        key={productId || title}
        activeOpacity={0.75}
        onPress={() => productId && router.push(`/product/${productId}` as any)}
        style={styles.productCard}
      >
        <Image
          source={{ uri: getImageUrl(image) }}
          style={styles.productImage}
          resizeMode="cover"
        />

        <View style={{ flex: 1 }}>
          {!!prod.badges?.length && (
            <View style={styles.badgesRow}>
              {prod.badges.slice(0, 3).map((badge) => (
                <View key={badge} style={styles.badge}>
                  <Text style={styles.badgeText}>{repairTextEncoding(badge)}</Text>
                </View>
              ))}
            </View>
          )}
          <Text style={styles.productName} numberOfLines={2}>{title}</Text>
          <View style={styles.priceContainer}>
            {!!prod.old_price && prod.price && prod.old_price > prod.price && (
              <Text style={styles.oldPrice}>{formatPrice(prod.old_price)}</Text>
            )}
            <Text style={styles.productPrice}>{formatPrice(prod.price)}</Text>
          </View>
        </View>

        <Ionicons name="chevron-forward" size={20} color="#ccc" />
      </TouchableOpacity>
    );
  };

  const renderManagerContactsCard = () => (
    <View style={styles.contactCard}>
      <View style={styles.contactHeaderRow}>
        <View style={styles.contactIconMain}>
          <Ionicons name="chatbubbles" size={22} color="#FFFFFF" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.contactTitle}>Зв’язатися з менеджером</Text>
          <Text style={styles.contactSubtitle}>Оберіть зручний спосіб зв’язку</Text>
        </View>
      </View>

      <TouchableOpacity style={styles.contactButton} activeOpacity={0.85} onPress={() => openContactUrl('tel:+380632526824')}>
        <View style={styles.contactButtonIcon}>
          <Ionicons name="call" size={19} color="#2E7D32" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.contactButtonTitle}>Телефон</Text>
          <Text style={styles.contactButtonValue}>(063) 25 26 8 24</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
      </TouchableOpacity>

      <TouchableOpacity style={styles.contactButton} activeOpacity={0.85} onPress={() => openContactUrl('viber://chat?number=%2B380632526824')}>
        <View style={styles.contactButtonIcon}>
          <Ionicons name="chatbox-ellipses" size={19} color="#2E7D32" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.contactButtonTitle}>Viber</Text>
          <Text style={styles.contactButtonValue}>Написати у Viber</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
      </TouchableOpacity>

      <TouchableOpacity style={styles.contactButton} activeOpacity={0.85} onPress={() => openContactUrl('https://t.me/Dikorosua')}>
        <View style={styles.contactButtonIcon}>
          <Ionicons name="paper-plane" size={19} color="#2E7D32" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.contactButtonTitle}>Telegram</Text>
          <Text style={styles.contactButtonValue}>@Dikorosua</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
      </TouchableOpacity>

      <TouchableOpacity style={styles.contactButton} activeOpacity={0.85} onPress={() => openContactUrl('mailto:dikorosua@gmail.com')}>
        <View style={styles.contactButtonIcon}>
          <Ionicons name="mail" size={19} color="#2E7D32" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.contactButtonTitle}>Email</Text>
          <Text style={styles.contactButtonValue}>dikorosua@gmail.com</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
      </TouchableOpacity>
    </View>
  );

  const renderItem = ({ item }: { item: Message }) => {
    const isUser = item.sender === 'user';
    const isContactMessage = !isUser && isManagerContactMessage(item.text);

    return (
      <View style={{ alignItems: isUser ? 'flex-end' : 'flex-start', marginVertical: 5 }}>
        {isContactMessage ? (
          renderManagerContactsCard()
        ) : (
          <View style={[styles.bubble, isUser ? styles.userBubble : styles.botBubble]}>
            <Text style={isUser ? styles.userText : styles.botText}>{repairTextEncoding(item.text)}</Text>
          </View>
        )}

        {!isUser && !!item.products?.length && (
          <View style={styles.productsWrap}>
            {item.products.map(renderProductCard)}
          </View>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f9f9f9' }}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.closeButton} activeOpacity={0.7}>
          <Ionicons name="close" size={24} color="#000" />
        </TouchableOpacity>

        <View style={{ alignItems: 'center' }}>
          <Text style={styles.headerTitle}>Чат з експертом</Text>
          <Text style={styles.headerSubtitle}>Dikoros AI консультант</Text>
        </View>

        <TouchableOpacity onPress={clearChat} style={styles.clearButton} activeOpacity={0.7}>
          <Ionicons name="trash-outline" size={22} color="#666" />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderItem}
          keyExtractor={(item) => `msg-${item.id}`}
          contentContainerStyle={{ padding: 15, paddingBottom: 120 }}
          style={{ flex: 1 }}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => {
            setTimeout(() => {
              flatListRef.current?.scrollToEnd({ animated: true });
            }, 100);
          }}
          ListFooterComponent={
            loading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="small" color="#999" style={{ marginRight: 10 }} />
                <Text style={styles.loadingText}>Консультант друкує...</Text>
              </View>
            ) : null
          }
        />

        {!!quickReplies.length && !loading && (
          <View style={styles.quickRepliesContainer}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {quickReplies.map((reply) => {
                const label = repairTextEncoding(reply);
                return (
                  <TouchableOpacity
                    key={label}
                    style={styles.quickReply}
                    onPress={() => handleQuickReply(label)}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.quickReplyText}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}

        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            value={inputText}
            onChangeText={setInputText}
            placeholder="Запитайте про товари або доставку..."
            placeholderTextColor="#999"
            multiline
            maxLength={500}
            editable={!loading}
          />

          <TouchableOpacity
            onPress={() => sendMessage()}
            disabled={loading || !inputText.trim()}
            style={[
              styles.sendButton,
              { backgroundColor: (loading || !inputText.trim()) ? '#ccc' : '#2E7D32' },
            ]}
          >
            {loading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Ionicons name="arrow-up" size={20} color="#fff" />
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  bubble: {
    padding: 12,
    borderRadius: 16,
    maxWidth: '84%',
  },
  userBubble: {
    backgroundColor: '#2E7D32',
    borderBottomRightRadius: 2,
  },
  botBubble: {
    backgroundColor: '#fff',
    borderBottomLeftRadius: 2,
    borderWidth: 1,
    borderColor: '#e5e5e5',
  },
  userText: {
    color: '#fff',
    fontSize: 16,
    lineHeight: 22,
  },
  botText: {
    color: '#333',
    fontSize: 16,
    lineHeight: 22,
  },
  productsWrap: {
    marginTop: 6,
    width: '88%',
  },
  productCard: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    padding: 10,
    borderRadius: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#eee',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
  },
  productImage: {
    width: 58,
    height: 58,
    borderRadius: 10,
    marginRight: 12,
    backgroundColor: '#f0f0f0',
  },
  productName: {
    fontWeight: '700',
    fontSize: 14,
    color: '#111',
    marginBottom: 4,
  },
  priceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  oldPrice: {
    color: '#999',
    textDecorationLine: 'line-through',
    fontSize: 12,
  },
  productPrice: {
    color: '#2E7D32',
    fontWeight: '800',
    fontSize: 15,
  },
  badgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginBottom: 4,
  },
  badge: {
    backgroundColor: '#E8F5E9',
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  badgeText: {
    color: '#2E7D32',
    fontSize: 10,
    fontWeight: '700',
  },
  contactCard: {
    width: '88%',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E4EFE5',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  contactHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 10,
  },
  contactIconMain: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#2E7D32',
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactTitle: {
    color: '#111827',
    fontSize: 17,
    fontWeight: '900',
  },
  contactSubtitle: {
    color: '#6B7280',
    fontSize: 13,
    marginTop: 2,
  },
  contactButton: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 58,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: '#F7FBF7',
    borderRadius: 16,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#E3F1E3',
  },
  contactButtonIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#E8F5E9',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  contactButtonTitle: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '800',
  },
  contactButtonValue: {
    color: '#4B5563',
    fontSize: 13,
    marginTop: 2,
  },
  header: {
    minHeight: Platform.OS === 'android' ? 86 : 70,
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 0) + 8 : 8,
    paddingBottom: 10,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 15,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111',
  },
  headerSubtitle: {
    fontSize: 11,
    color: '#777',
    marginTop: 2,
  },
  closeButton: {
    padding: 8,
  },
  clearButton: {
    padding: 8,
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
  },
  loadingText: {
    color: '#777',
    fontSize: 14,
  },
  quickRepliesContainer: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: '#f9f9f9',
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  quickReply: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#D7E8D8',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
    marginHorizontal: 4,
  },
  quickReplyText: {
    color: '#2E7D32',
    fontWeight: '700',
    fontSize: 13,
  },
  inputContainer: {
    flexDirection: 'row',
    padding: 10,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#eee',
    alignItems: 'flex-end',
    paddingBottom: Platform.OS === 'ios' ? 25 : 10,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 110,
    backgroundColor: '#f2f2f2',
    borderRadius: 22,
    paddingHorizontal: 15,
    paddingVertical: 10,
    fontSize: 16,
    marginRight: 8,
    color: '#111',
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
