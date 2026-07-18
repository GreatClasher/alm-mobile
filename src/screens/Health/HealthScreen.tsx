import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity, DeviceEventEmitter, Platform } from 'react-native';
import { useConnectionStore } from '@/stores/connectionStore';
import { useHealthSyncStore } from '@/stores/healthSyncStore';
import { Activity, Heart, Moon, Zap, Clock, CheckCircle, XCircle } from 'lucide-react-native';
import { useFocusEffect } from '@react-navigation/native';
import { authenticatedFetch } from '@/shared/utils/apiClient';
import { initialize, requestPermission } from 'react-native-health-connect';

export function HealthScreen() {
  const [metrics, setMetrics] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  const syncLogs = useHealthSyncStore(state => state.logs);

  const fetchHealthData = async () => {
    try {
      console.log('[HealthScreen] fetchHealthData triggered');
      setLoading(true);
      const { hardwareId } = useConnectionStore.getState();
      console.log('[HealthScreen] using hardwareId:', hardwareId);
      
      const baseUrl = process.env.EXPO_PUBLIC_API_BASE_URL || 'https://api.jabbelpin.com/v1';
      
      // Fetch last 24 hours of data
      const endedAt = new Date();
      const startedAt = new Date(endedAt.getTime() - 24 * 60 * 60 * 1000);
      
      const url = `${baseUrl}/health/metrics?deviceId=${hardwareId}&startedAt=${startedAt.toISOString()}&endedAt=${endedAt.toISOString()}`;
      console.log('[HealthScreen] Fetching metrics from:', url);

      const response = await authenticatedFetch(url);
      console.log('[HealthScreen] Fetch response status:', response.status);
      
      if (!response.ok) {
        let errorMessage = 'Failed to fetch health data';
        try {
          const errorText = await response.text();
          console.log('[HealthScreen] Error text:', errorText);
          const parsed = JSON.parse(errorText);
          errorMessage = parsed.message || errorMessage;
        } catch (e) {
          console.log('[HealthScreen] Failed to parse error text:', e);
        }
        throw new Error(errorMessage);
      }
      
      const json = await response.json();
      const payload = Array.isArray(json) ? json : (json.data || []);
      console.log('[HealthScreen] Fetched metrics payload size:', payload.length);
      setMetrics(payload);
      setError('');
    } catch (err: any) {
      console.error('[HealthScreen] Error in fetchHealthData:', err);
      setError(err.message || 'Unknown error');
    } finally {
      console.log('[HealthScreen] fetchHealthData finally block, setting loading false');
      setLoading(false);
    }
  };

  const handleSyncNow = async () => {
    try {
      console.log('[HealthScreen] handleSyncNow clicked');
      // Must initialize first
      const providerPackageName = Platform.Version >= 34
        ? 'com.android.healthconnect.controller'
        : 'com.google.android.apps.healthdata';
      
      const isInitialized = await initialize(providerPackageName);
      console.log('[HealthScreen] initialize returned:', isInitialized);
      if (!isInitialized) {
        console.warn('Health Connect is not available');
        return;
      }

      console.log('[HealthScreen] calling requestPermission...');
      const granted = await requestPermission([
        { accessType: 'read', recordType: 'HeartRate' },
        { accessType: 'read', recordType: 'Steps' },
        { accessType: 'read', recordType: 'SleepSession' },
        { accessType: 'read', recordType: 'OxygenSaturation' },
      ]);
      console.log('[HealthScreen] requestPermission returned:', granted);
      
      if (granted.length > 0) {
        console.log('[HealthScreen] emitting FORCE_HEALTH_SYNC');
        DeviceEventEmitter.emit('FORCE_HEALTH_SYNC');
        // Optional: reload server data after a short delay
        setTimeout(fetchHealthData, 3000);
      } else {
        console.log('[HealthScreen] permissions not granted');
      }
    } catch (e: any) {
      console.error('[HealthScreen] Failed to request health connect permissions:', e);
    }
  };

  useFocusEffect(
    useCallback(() => {
      fetchHealthData();
    }, [])
  );

  // Group latest metrics by type
  const latestMetrics = metrics.reduce((acc: any, curr: any) => {
    if (!acc[curr.metricType] || new Date(curr.recordedAt) > new Date(acc[curr.metricType].recordedAt)) {
      acc[curr.metricType] = curr;
    }
    return acc;
  }, {});

  const lastSyncTime = metrics.length > 0 
    ? new Date(Math.max(...metrics.map(m => new Date(m.createdAt).getTime()))).toLocaleString()
    : 'Never';

  const renderCard = (title: string, value: string, icon: React.ReactNode, timestamp?: string) => (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        {icon}
        <Text style={styles.cardTitle}>{title}</Text>
      </View>
      <Text style={styles.cardValue}>{value}</Text>
      {timestamp && (
        <Text style={styles.cardTimestamp}>
          Recorded: {new Date(timestamp).toLocaleTimeString()}
        </Text>
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerTopRow}>
          <View>
            <Text style={styles.headerTitle}>Health Overview</Text>
            <Text style={styles.headerSubtitle}>Last synced with server: {lastSyncTime}</Text>
          </View>
          <TouchableOpacity onPress={handleSyncNow} style={styles.syncNowButton}>
            <Text style={styles.syncNowText}>Sync Watch Data</Text>
          </TouchableOpacity>
        </View>
      </View>

      {loading && metrics.length === 0 ? (
        <ActivityIndicator size="large" color="#00F0FF" style={styles.loader} />
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={fetchHealthData} style={styles.retryButton}>
            <Text style={styles.retryText}>Retry Fetch</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.grid}>
            {renderCard(
              'Heart Rate',
              latestMetrics['heart_rate']?.value?.bpm ? `${Math.round(latestMetrics['heart_rate'].value.bpm)} bpm` : '--',
              <Heart color="#FF3366" size={24} />,
              latestMetrics['heart_rate']?.recordedAt
            )}
            
            {renderCard(
              'SpO2',
              latestMetrics['spo2']?.value?.percentage ? `${Math.round(latestMetrics['spo2'].value.percentage)}%` : '--',
              <Zap color="#00F0FF" size={24} />,
              latestMetrics['spo2']?.recordedAt
            )}

            {renderCard(
              'Steps (24h)',
              latestMetrics['steps']?.value?.count ? `${latestMetrics['steps'].value.count}` : '--',
              <Activity color="#33FF99" size={24} />,
              latestMetrics['steps']?.recordedAt
            )}

            {renderCard(
              'Sleep Stage',
              latestMetrics['sleep']?.value?.stage ? `${latestMetrics['sleep'].value.stage}` : '--',
              <Moon color="#9933FF" size={24} />,
              latestMetrics['sleep']?.recordedAt
            )}
          </View>

          <View style={styles.logsSection}>
            <Text style={styles.logsTitle}>Background Sync Activity</Text>
            {syncLogs.length === 0 ? (
              <Text style={styles.noLogsText}>No syncs yet. Waiting for background job...</Text>
            ) : (
              syncLogs.map(log => (
                <View key={log.id} style={styles.logRow}>
                  {log.status === 'success' ? (
                    <CheckCircle color="#33FF99" size={16} />
                  ) : (
                    <XCircle color="#FF3366" size={16} />
                  )}
                  <View style={styles.logContent}>
                    <Text style={styles.logTime}>{new Date(log.timestamp).toLocaleTimeString()}</Text>
                    <Text style={styles.logMessage}>{log.message}</Text>
                  </View>
                </View>
              ))
            )}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    padding: 20,
    paddingTop: 60,
    backgroundColor: '#0A0A0A',
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  headerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  syncNowButton: {
    backgroundColor: '#33FF99',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  syncNowText: {
    color: '#000',
    fontWeight: 'bold',
    fontSize: 12,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
  },
  headerSubtitle: {
    color: '#888',
    fontSize: 14,
    marginTop: 4,
  },
  scroll: {
    padding: 16,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  card: {
    width: '48%',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  cardTitle: {
    color: '#aaa',
    fontSize: 14,
    marginLeft: 8,
    fontWeight: '500',
  },
  cardValue: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  cardTimestamp: {
    color: '#666',
    fontSize: 10,
  },
  loader: {
    flex: 1,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    color: '#ff4444',
    fontSize: 16,
    marginBottom: 16,
  },
  retryButton: {
    backgroundColor: '#00F0FF',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryText: {
    color: '#000',
    fontWeight: 'bold',
  },
  logsSection: {
    marginTop: 20,
    padding: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  logsTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
  },
  noLogsText: {
    color: '#666',
    fontStyle: 'italic',
  },
  logRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  logContent: {
    marginLeft: 8,
    flex: 1,
  },
  logTime: {
    color: '#aaa',
    fontSize: 12,
    marginBottom: 2,
  },
  logMessage: {
    color: '#eee',
    fontSize: 14,
  },
});
