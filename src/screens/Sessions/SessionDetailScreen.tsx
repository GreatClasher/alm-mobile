import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator } from 'react-native';
import { authenticatedFetch } from '@/shared/utils/apiClient';

export function SessionDetailScreen({ route }: any) {
  const { sessionId } = route.params;
  const [utterances, setUtterances] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchUtterances = async () => {
    try {
      setLoading(true);
      const baseUrl = process.env.EXPO_PUBLIC_API_BASE_URL || 'https://api.jabbelpin.com/v1';
      
      const response = await authenticatedFetch(`${baseUrl}/sessions/${sessionId}/utterances`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch transcript');
      }
      
      const data = await response.json();
      setUtterances(data);
      setError('');
    } catch (err: any) {
      setError(err.message || 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUtterances();
  }, [sessionId]);

  const renderItem = ({ item }: { item: any }) => {
    const label = item.speakerLabel || 'Unknown Speaker';
    const isUser = label === 'SPEAKER_00'; // Simplistic assumption
    return (
      <View style={[styles.bubble, isUser ? styles.bubbleRight : styles.bubbleLeft]}>
        <Text style={styles.speakerName}>
          {label}
        </Text>
        <Text style={styles.transcriptText}>{item.text}</Text>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {loading ? (
        <ActivityIndicator size="large" color="#00F0FF" style={styles.loader} />
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : utterances.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>No transcript available for this session yet.</Text>
        </View>
      ) : (
        <FlatList
          data={utterances}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  list: {
    padding: 16,
  },
  loader: {
    flex: 1,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  bubble: {
    padding: 12,
    borderRadius: 16,
    marginBottom: 12,
    maxWidth: '85%',
  },
  bubbleLeft: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderBottomLeftRadius: 4,
  },
  bubbleRight: {
    alignSelf: 'flex-end',
    backgroundColor: 'rgba(0, 240, 255, 0.1)',
    borderBottomRightRadius: 4,
  },
  speakerName: {
    color: '#888',
    fontSize: 12,
    marginBottom: 4,
  },
  transcriptText: {
    color: '#fff',
    fontSize: 16,
    lineHeight: 22,
  },
  errorText: {
    color: '#ff4444',
    fontSize: 16,
    textAlign: 'center',
  },
  emptyText: {
    color: '#888',
    fontSize: 16,
    textAlign: 'center',
  },
});
