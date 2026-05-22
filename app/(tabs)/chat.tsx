import { API_URL } from '@/config/api';
import { getImageUrl } from '@/utils/image';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
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

const INITIAL_QUICK_REPLIES = [
  '?? ???? ????????????',
  '??? ?????? ?? ???????',
  '??? ?????? ?? ???',
  '?????? ??? ??????',
  '??????? ???? ??????',
];

const INITIAL_WELCOME_MESSAGE: Message = {
  id: 'welcome',
  text: '??????! ? ??????? Dikoros. ???????? ????????? ?????, ???????? ?? ????? ??? ???? ???????. ?? ????????',
  sender: 'bot',
  quickReplies: INITIAL_QUICK_REPLIES,
};

const formatPrice = (price?: number) => {
  const safePrice = price || 0;
  return `${safePrice.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ?`;
};

const normalizeProducts = (items: any[] = []): Product[] => {
  return items.map((item) => ({
    ...item,
    id: item.id,
    name: item.name || item.title || '',
    image: item.image || item.image_url || item.picture,
    price: Number(item.price || 0),
  }));
};

export default function ChatScreen() {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([INITIAL_WELCOME_MESSAGE]);
  const [inputText, setInputText] = useState('');
  const [sessionId, setSessionId] = useState<string>('anon');
  const [quickReplies, setQuickReplies] = useState<string[]>(INITIAL_QUICK_REPLIES);
  const [loading, setLoading] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    loadChatSession();
  }, []);

  useEffect(() => {
    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    }, 100);
  }, [messages]);

  const loadChatSession = async () => {
    try {
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
          setMessages(parsed);
          const lastBotWithReplies = [...parsed].reverse().find((m) => m.sender === 'bot' && m.quickReplies?.length);
          if (lastBotWithReplies?.quickReplies) {
            setQuickReplies(lastBotWithReplies.quickReplies);
          }
        }
      }
    } catch (e) {
      console.warn('Load chat session failed:', e);
    }
  };

  const persistMessages = async (nextMessages: Message[]) => {
    try {
      await AsyncStorage.setItem('chat_messages', JSON.stringify(nextMessages.slice(-40)));
    } catch (e) {
      console.warn('Persist chat failed:', e);
    }
  };

  const clearChat = async () => {
    const newSessionId = `app_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    await AsyncStorage.setItem('chat_session_id', newSessionId);
    await AsyncStorage.removeItem('chat_messages');

    setSessionId(newSessionId);
    setMessages([INITIAL_WELCOME_MESSAGE]);
    setQuickReplies(INITIAL_QUICK_REPLIES);
    setInputText('');
    Vibration.vibrate(50);
  };

  const sendMessage = async (textOverride?: string) => {
    const userMessage = (textOverride || inputText).trim();
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
        headers: { 'Content-Type': 'application/json' },
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
      const nextQuickReplies = Array.isArray(data.quick_replies) ? data.quick_replies : [];

      if (data.session_id && data.session_id !== sessionId) {
        setSessionId(data.session_id);
        await AsyncStorage.setItem('chat_session_id', data.session_id);
      }

      const botMsg: Message = {
        id: `b_${Date.now()}`,
        text: data.reply || data.text || data.response || '?? ????, ? ?? ???????? ?????.',
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
        text: '??????? ?????????. ????????? ?? ??? ??? ???????? ?????????.',
        sender: 'bot',
        quickReplies: ['?????????? ? ??????????', '???????'],
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
    if (reply === '?????????? ? ??????????' || reply === "??'??????? ? ??????????") {
      setInputText(reply);
    }
    sendMessage(reply);
  };

  const renderProductCard = (prod: Product) => {
    const productId = String(prod.id || '');
    const title = prod.name || prod.title || '?????';
    const image = prod.image || prod.image_url || prod.picture;

    return (
      <TouchableOpacity
        key={productId || title}
        activeOpacity={0.75}
        onPress={() => productId && router.push(`/product/${productId}`)}
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
                  <Text style={styles.badgeText}>{badge}</Text>
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

  const renderItem = ({ item }: { item: Message }) => {
    const isUser = item.sender === 'user';

    return (
      <View style={{ alignItems: isUser ? 'flex-end' : 'flex-start', marginVertical: 5 }}>
        <View style={[styles.bubble, isUser ? styles.userBubble : styles.botBubble]}>
          <Text style={isUser ? styles.userText : styles.botText}>{item.text}</Text>
        </View>

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
          <Text style={styles.headerTitle}>??? ? ?????????</Text>
          <Text style={styles.headerSubtitle}>Dikoros AI ???????????</Text>
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
                <Text style={styles.loadingText}>??????????? ??????...</Text>
              </View>
            ) : null
          }
        />

        {!!quickReplies.length && !loading && (
          <View style={styles.quickRepliesContainer}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {quickReplies.map((reply) => (
                <TouchableOpacity
                  key={reply}
                  style={styles.quickReply}
                  onPress={() => handleQuickReply(reply)}
                  activeOpacity={0.75}
                >
                  <Text style={styles.quickReplyText}>{reply}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            value={inputText}
            onChangeText={setInputText}
            placeholder="????????? ??? ?????? ??? ????????..."
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
  header: {
    height: 60,
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
