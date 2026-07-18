import React, { useEffect, useState } from 'react';
import { DeviceEventEmitter, Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppNavigator } from './navigation/AppNavigator';
import { SqlitePacketQueue } from './features/storage/SqlitePacketQueue';
import { useConnectionStore } from './stores/connectionStore';
import { BleConnectionService } from './features/bluetooth/services/BleConnectionService';
import { BlePacketService } from './features/bluetooth/services/BlePacketService';
import { WebSocketClient } from './features/streaming/WebSocketClient';
import { PacketRelayService } from './features/streaming/PacketRelayService';
import { NetworkMonitor } from './features/streaming/NetworkMonitor';
import { BleConnectionState } from './features/bluetooth/types/BleConnectionState';
import { MobileLogger } from './shared/utils/logger';
import { HeartbeatForwarder } from './features/heartbeat/HeartbeatForwarder';
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
    setLastHeartbeatAt,
    incrementPacketsReceived,
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
    const bleConnection = new BleConnectionService();
    const blePacket = new BlePacketService();
    const heartbeatForwarder = new HeartbeatForwarder(new MobileLogger('HeartbeatForwarder'));

    const connectBle = () => {
      logger.info('connectBle() called — initiating BLE connection cycle');
      bleConnection.disconnect();
      setBleState(BleConnectionState.SCANNING);
      bleConnection.connect({
        onConnected: (device, hardwareId) => {
          logger.info({ deviceId: device.id, hardwareId }, 'BLE connected — starting packet monitoring');
          setBleState(BleConnectionState.CONNECTED);

          // Pass the full Device object so BlePacketService can call
          // device.monitorCharacteristicForService() — which writes the CCCD descriptor
          // directly without doing an internal read on a NOTIFY-only characteristic.
          blePacket.startMonitoring(device, {
            onPacketReceived: async (packet) => {
              logger.debug(
                { payloadType: packet.payloadType, sequenceNo: packet.sequenceNo },
                'Packet received from watch'
              );
              incrementPacketsReceived();
              if (packet.payloadType === 'HEARTBEAT') {
                logger.info('Heartbeat packet received — forwarding to backend');
                setLastHeartbeatAt(Date.now());
                const pendingCount = await sqliteQueue.getPendingCount();
                await heartbeatForwarder.forwardHeartbeat(packet, true, pendingCount);
              } else if (packet.payloadType === 'AUDIO') {
                logger.debug('Audio packet received — enqueuing for relay');
                await sqliteQueue.enqueue(packet);
              } else {
                logger.warn({ payloadType: packet.payloadType }, 'Unknown packet payload type — dropping');
              }
            },
            onError: (error) => {
              logger.error({ error }, 'Error in packet stream');
              blePacket.stopMonitoring();
            }
          });
        },
        onDisconnected: () => {
          logger.info('BLE disconnected — stopping packet monitoring, entering RECONNECTING state');
          setBleState(BleConnectionState.RECONNECTING);
          blePacket.stopMonitoring();
        },
        onError: (error) => {
          logger.error({ error }, 'BLE connection error — entering DISCONNECTED state');
          setBleState(BleConnectionState.DISCONNECTED);
        }
      });
    };

    const reconnectListener = DeviceEventEmitter.addListener('MANUAL_RECONNECT', () => {
      logger.info('Manual reconnect triggered');
      wsClient.disconnect();
      wsClient.connect();
      connectBle();
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

        connectBle();

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
      blePacket.stopMonitoring();
      bleConnection.disconnect();
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
