import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Send, Bot, User } from 'lucide-react-native';
import { authenticatedFetch } from '@/shared/utils/apiClient';
import { useConnectionStore } from '@/stores/connectionStore';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
};

export function AssistantScreen() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  
  const { hardwareId, assistantMessage } = useConnectionStore();

  // Listen for voice-based assistant messages from the WebSocket
  useEffect(() => {
    if (assistantMessage) {
      setMessages(prev => [
        ...prev,
        { id: Date.now().toString(), role: 'assistant', text: assistantMessage }
      ]);
    }
  }, [assistantMessage]);

  const handleAsk = async () => {
    if (!query.trim()) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      text: query.trim()
    };
    
    setMessages(prev => [...prev, userMessage]);
    setQuery('');
    setLoading(true);

    try {
      const baseUrl = process.env.EXPO_PUBLIC_API_BASE_URL || 'https://api.jabbelpin.com';
      const userId = process.env.EXPO_PUBLIC_USER_ID || 'ef26c7d5-5edc-4f24-b9a5-38f6752c8975';
      
      const response = await authenticatedFetch(`${baseUrl}/query/ask`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query: userMessage.text,
          userId: userId
        })
      });

      if (!response.ok) {
        throw new Error('Network response was not ok');
      }

      const data = await response.json();
      
      const assistantResponse: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        text: data.answer || data.response || 'Sorry, I got an empty response.'
      };

      setMessages(prev => [...prev, assistantResponse]);
    } catch (error: any) {
      const errorMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        text: `Error: ${error.message}`
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  };

  const renderMessage = (msg: ChatMessage) => {
    const isUser = msg.role === 'user';
    return (
      <View key={msg.id} style={[styles.messageRow, isUser ? styles.messageRowUser : styles.messageRowAssistant]}>
        {!isUser && (
          <View style={styles.avatarAssistant}>
            <Bot color="#00F0FF" size={20} />
          </View>
        )}
        <View style={[styles.messageBubble, isUser ? styles.messageBubbleUser : styles.messageBubbleAssistant]}>
          <Text style={styles.messageText}>{msg.text}</Text>
        </View>
        {isUser && (
          <View style={styles.avatarUser}>
            <User color="#000" size={20} />
          </View>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Assistant Memory</Text>
        <Text style={styles.headerSubtitle}>Ask questions based on your recorded episodes</Text>
      </View>
      
      <KeyboardAvoidingView 
        style={styles.flex1} 
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView style={styles.messageList} contentContainerStyle={styles.messageListContent}>
          {messages.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Bot color="#333" size={48} style={{ marginBottom: 16 }} />
              <Text style={styles.emptyText}>No questions asked yet.</Text>
              <Text style={styles.emptySubText}>Type a question below to query your memory.</Text>
            </View>
          ) : (
            messages.map(renderMessage)
          )}
          {loading && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator color="#00F0FF" size="small" />
              <Text style={styles.loadingText}>Thinking...</Text>
            </View>
          )}
        </ScrollView>
        
        <View style={styles.inputContainer}>
          <TextInput
            style={styles.textInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Ask something about your day..."
            placeholderTextColor="#666"
            onSubmitEditing={handleAsk}
          />
          <TouchableOpacity 
            style={[styles.sendButton, !query.trim() && styles.sendButtonDisabled]} 
            onPress={handleAsk}
            disabled={!query.trim() || loading}
          >
            <Send color={query.trim() ? '#000' : '#666'} size={20} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  flex1: {
    flex: 1,
  },
  header: {
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
    backgroundColor: '#0a0a0a',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#00F0FF',
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#888',
  },
  messageList: {
    flex: 1,
  },
  messageListContent: {
    padding: 16,
    paddingBottom: 32,
  },
  messageRow: {
    flexDirection: 'row',
    marginBottom: 16,
    alignItems: 'flex-end',
  },
  messageRowUser: {
    justifyContent: 'flex-end',
  },
  messageRowAssistant: {
    justifyContent: 'flex-start',
  },
  avatarUser: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#00F0FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  avatarAssistant: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0, 240, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
    borderWidth: 1,
    borderColor: 'rgba(0, 240, 255, 0.3)',
  },
  messageBubble: {
    maxWidth: '75%',
    padding: 14,
    borderRadius: 16,
  },
  messageBubbleUser: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderBottomRightRadius: 4,
  },
  messageBubbleAssistant: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#333',
    borderBottomLeftRadius: 4,
  },
  messageText: {
    color: '#fff',
    fontSize: 16,
    lineHeight: 22,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 100,
  },
  emptyText: {
    color: '#666',
    fontSize: 18,
    fontWeight: '600',
  },
  emptySubText: {
    color: '#444',
    fontSize: 14,
    marginTop: 8,
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    marginLeft: 40,
  },
  loadingText: {
    color: '#00F0FF',
    marginLeft: 8,
    fontSize: 14,
  },
  inputContainer: {
    flexDirection: 'row',
    padding: 16,
    paddingBottom: 24,
    borderTopWidth: 1,
    borderTopColor: '#222',
    backgroundColor: '#0a0a0a',
    alignItems: 'center',
  },
  textInput: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    color: '#fff',
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingVertical: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#333',
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#00F0FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 12,
  },
  sendButtonDisabled: {
    backgroundColor: '#333',
  },
});
