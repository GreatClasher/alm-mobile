import React, { useEffect, useState } from 'react';
import { DeviceEventEmitter, Modal, View, Text, TouchableOpacity, StyleSheet, PermissionsAndroid, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppNavigator } from './navigation/AppNavigator';
import { SqlitePacketQueue } from './features/storage/SqlitePacketQueue';
import { useConnectionStore } from './stores/connectionStore';
import * as AlmAudioService from '../modules/alm-audio-service';
import { deserializePacket } from './features/bluetooth/utils/packet-deserializer';
import { verifyChecksum } from './shared/utils/checksum';
import { Buffer } from 'buffer';
import { WebSocketClient } from './features/streaming/WebSocketClient';
import { PacketRelayService } from './features/streaming/PacketRelayService';
import { NetworkMonitor } from './features/streaming/NetworkMonitor';
import { BleConnectionState } from './features/bluetooth/types/BleConnectionState';
import { MobileLogger } from './shared/utils/logger';
import { OtaCoordinator } from './features/ota/OtaCoordinator';
import { DeviceAuthManager } from './features/auth/DeviceAuthManager';
import { HealthSyncService } from './features/health/HealthSyncService';
import BackgroundJob from 'react-native-background-actions';
import { initialize as hcInitialize, requestPermission as hcRequestPermission, getGrantedPermissions as hcGetGrantedPermissions } from 'react-native-health-connect';

const logger = new MobileLogger('App');

export default function App() {
  const [showPermissionModal, setShowPermissionModal] = useState(false);

  const {
    setBleState,
    setWsConnected,
    setPendingPacketCount,
    incrementPacketsReceived,
    incrementPacketsSent,
    addPttLog,
    setFastLaneStage,
  } = useConnectionStore();

  useEffect(() => {
    // Check if we need to show the permission modal
    const checkPermissions = async () => {
      try {
        const isInitialized = await hcInitialize();
        if (isInitialized) {
          const granted = await hcGetGrantedPermissions();
          const hasAll = granted.some(p => p.recordType === 'HeartRate') &&
                         granted.some(p => p.recordType === 'Steps') &&
                         granted.some(p => p.recordType === 'SleepSession') &&
                         granted.some(p => p.recordType === 'OxygenSaturation');
          if (!hasAll) {
            setShowPermissionModal(true);
          }
        }
      } catch (err) {
        logger.warn({ err }, 'Failed to check health connect permissions');
      }
    };
    checkPermissions();

    logger.info('Initializing App Services');

    const sqliteQueue = new SqlitePacketQueue(async () => {
      try {
        const count = await sqliteQueue.getPendingCount();
        setPendingPacketCount(count);
        // trigger replay when new packets are added
        await relayService.triggerReplay();
      } catch (err) {
        // ignore
      }
    });
    const wsClient = new WebSocketClient();
    const relayService = new PacketRelayService(sqliteQueue, wsClient, new MobileLogger('PacketRelay'));
    const networkMonitor = new NetworkMonitor();

    // Register Native listeners for non-audio packets
    const blePacketSub = AlmAudioService.addBlePacketListener(async (event) => {
      try {
        const raw = Buffer.from(event.data, 'base64');
        const packet = deserializePacket(raw);
        if (!verifyChecksum(packet.payload, packet.checksum)) {
          logger.warn('Checksum failed natively');
          return;
        }

        incrementPacketsReceived();
        addPttLog({
          timestamp: Date.now(),
          direction: 'received',
          status: 'ok',
          byteSize: packet.payload?.length,
        });

        if (packet.payloadType !== 'HEARTBEAT' && packet.payloadType !== 'ACTIVE_QUERY' && packet.payloadType !== 'ACTIVE_QUERY_END') {
          logger.warn({ payloadType: packet.payloadType }, 'Unknown packet payload type from native — dropping');
        }
      } catch (err) {
        logger.warn('Failed to parse native BLE packet');
      }
    });

    const assistantSub = AlmAudioService.addAssistantResponseListener((event) => {
      logger.info({ answer: event.answer }, 'Assistant responded from native socket');
      useConnectionStore.getState().setAssistantMessage(event.answer);
      if (event.prompt) {
        useConnectionStore.getState().setAssistantPrompt(event.prompt);
      }
      useConnectionStore.getState().setFastLaneStage('answering');
      
      // Auto-reset to done then idle
      setTimeout(() => {
        useConnectionStore.getState().setFastLaneStage('done');
        setTimeout(() => {
           useConnectionStore.getState().setFastLaneStage('idle');
        }, 3000);
      }, 5000);
    });

    let fastLaneTimeout: NodeJS.Timeout | null = null;
    let uploadingTimeout: NodeJS.Timeout | null = null;

    const audioPacketSub = AlmAudioService.addAudioPacketListener((event: any) => {
      incrementPacketsReceived();
      addPttLog({
        timestamp: Date.now(),
        direction: 'received',
        status: 'ok',
        byteSize: event.byteSize,
      });

      if (event.type === 5) { // ACTIVE_QUERY — PTT pressed, audio flowing in
        // Stage: listening
        setFastLaneStage('listening');
        useConnectionStore.getState().setFastLaneActive(true);

        // After a short quiet period assume uploading has started
        if (uploadingTimeout) clearTimeout(uploadingTimeout);
        uploadingTimeout = setTimeout(() => {
          const stage = useConnectionStore.getState().fastLaneStage;
          if (stage === 'listening') setFastLaneStage('uploading');
        }, 800);

        if (fastLaneTimeout) clearTimeout(fastLaneTimeout);
        fastLaneTimeout = setTimeout(() => {
          useConnectionStore.getState().setFastLaneActive(false);
          // Move to processing if still uploading
          const stage = useConnectionStore.getState().fastLaneStage;
          if (stage === 'uploading' || stage === 'listening') setFastLaneStage('processing');
        }, 1500);
      } else if (event.type === 6) { // ACTIVE_QUERY_END — PTT released
        if (uploadingTimeout) clearTimeout(uploadingTimeout);
        if (fastLaneTimeout) clearTimeout(fastLaneTimeout);
        useConnectionStore.getState().setFastLaneActive(false);
        const stage = useConnectionStore.getState().fastLaneStage;
        if (stage === 'uploading' || stage === 'listening') setFastLaneStage('processing');
      }
    });

    // Sent events for real-time Fast Lane / Audio packets come from native socket
    const audioPacketSentSub = AlmAudioService.addAudioPacketSentListener(() => {
      incrementPacketsSent();
      addPttLog({
        timestamp: Date.now(),
        direction: 'sent',
        status: 'ok',
      });
    });

    const connectBle = async () => {
      logger.info('connectBle() called — starting native ALM Audio service');
      setBleState(BleConnectionState.SCANNING);

      if (Platform.OS === 'android' && Platform.Version >= 31) {
        await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        ]);
      } else if (Platform.OS === 'android') {
        await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
      }

      
      const wsBaseUrl = process.env.EXPO_PUBLIC_WS_URL || 'ws://192.168.1.10:3000';
      const config = {
        deviceId: useConnectionStore.getState().hardwareId || 'default-device',
        userId: 'native-user',
        wsUrl: `${wsBaseUrl}/device`,
        token: useConnectionStore.getState().authToken || '',
        porcupineAccessKey: 'INSERT_YOUR_ACCESS_KEY_HERE'
      };

      AlmAudioService.startService(config).then(() => {
        logger.info('Native BLE connected');
        setBleState(BleConnectionState.CONNECTED);
      }).catch(err => {
        logger.error({ err }, 'Native BLE connection failed');
        setBleState(BleConnectionState.DISCONNECTED);
      });
    };

    const reconnectListener = DeviceEventEmitter.addListener('MANUAL_RECONNECT', async () => {
      logger.info('Manual reconnect triggered');
      wsClient.disconnect();
      wsClient.connect();
      AlmAudioService.stopService();
      await connectBle();
    });

    const backgroundTask = async (taskDataArguments: any) => {
      try {
        await sqliteQueue.initialize();

        await DeviceAuthManager.initialize();

        wsClient.connect();

        // Initialize Health Connect and request permissions once at startup
        const healthSync = new HealthSyncService();
        await healthSync.setup();

        const forceSyncListener = DeviceEventEmitter.addListener('FORCE_HEALTH_SYNC', async () => {
          logger.info('Manual health sync triggered');
          await healthSync.setup(); // Refresh permissions in case they were just granted
          healthSync.forceSyncNextTick();
          await healthSync.tick().catch((err) => {
            logger.warn({ err }, 'Manual health sync failed');
          });
        });
        
        const otaCoordinator = new OtaCoordinator();
        wsClient.onOtaAvailable((otaInfo: any) => {
          const hardwareId = useConnectionStore.getState().hardwareId;
          if (!hardwareId) {
             logger.warn('OTA available but no hardwareId registered yet');
             return;
          }
          otaCoordinator.handleOtaAvailable(hardwareId, otaInfo).catch(err => {
            logger.error({ err }, 'OTA error');
          });
        });

        networkMonitor.startMonitoring({
          onDisconnected: () => {
            // Nothing needed here now
          },
          onRestored: () => {
            void relayService.triggerReplay();
          }
        });

        await connectBle();

        // Keep task running and perform periodic maintenance
        while (BackgroundJob.isRunning()) {
          await new Promise<void>(resolve => setTimeout(resolve, 60000));
          // Prune delivered packets older than 24 hours
          await sqliteQueue.pruneDelivered(24 * 60 * 60 * 1000).catch(() => {});
          // Enforce 10,000 packet limit
          await sqliteQueue.enforceMaxSize(10000).catch(() => {});
          // Periodically sync health metrics from Health Connect (self-rate-limited to 15 min)
          await healthSync.tick().catch((err) => {
            logger.warn({ err }, 'Health sync tick failed — will retry next loop');
          });
        }
      } catch (error) {
        logger.error({ error }, 'Failed to initialize app services in background');
      }
    };

    const options = {
      taskName: 'JabbelPinSync',
      taskTitle: 'JabbelPin Syncing',
      taskDesc: 'Syncing watch data with backend',
      taskIcon: {
        name: 'ic_launcher',
        type: 'mipmap',
      },
      color: '#ff00ff',
      parameters: {
        delay: 1000,
      },
      foregroundServiceType: ['dataSync' as 'dataSync'],
    };

    let cleanupInitialize = () => {
      BackgroundJob.stop().catch(() => {});
    };

    BackgroundJob.start(backgroundTask, options).catch(err => {
      logger.error({ err }, 'Failed to start background job');
    });

    return () => {
      logger.info('Tearing down App Services');
      reconnectListener.remove();
      if (cleanupInitialize) cleanupInitialize();
      blePacketSub.remove();
      assistantSub.remove();
      audioPacketSub.remove();
      audioPacketSentSub.remove();
      AlmAudioService.stopService();
      networkMonitor.stopMonitoring();
      wsClient.disconnect();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleGrantPermissions = async () => {
    try {
      await hcRequestPermission([
        { accessType: 'read', recordType: 'HeartRate' },
        { accessType: 'read', recordType: 'Steps' },
        { accessType: 'read', recordType: 'SleepSession' },
        { accessType: 'read', recordType: 'OxygenSaturation' },
      ]);
      setShowPermissionModal(false);
      // Trigger a sync manually since permissions are now granted
      DeviceEventEmitter.emit('FORCE_HEALTH_SYNC');
    } catch (err) {
      logger.error({ err }, 'Failed to request permissions from modal');
    }
  };

  return (
    <SafeAreaProvider>
      <AppNavigator />
      <Modal visible={showPermissionModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Health Connect</Text>
            <Text style={styles.modalText}>
              JabbelPin needs access to your health data to sync it with the backend. Please grant the required permissions.
            </Text>
            <TouchableOpacity style={styles.modalButton} onPress={handleGrantPermissions}>
              <Text style={styles.modalButtonText}>Grant Permissions</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalSecondaryButton} onPress={() => setShowPermissionModal(false)}>
              <Text style={styles.modalSecondaryButtonText}>Later</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '85%',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 12,
    color: '#1a1a1a',
  },
  modalText: {
    fontSize: 16,
    color: '#4a4a4a',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 24,
  },
  modalButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    width: '100%',
    alignItems: 'center',
  },
  modalButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  modalSecondaryButton: {
    marginTop: 12,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    width: '100%',
    alignItems: 'center',
  },
  modalSecondaryButtonText: {
    color: '#007AFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
