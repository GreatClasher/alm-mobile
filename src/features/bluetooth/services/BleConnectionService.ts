import { MobileLogger } from '@/shared/utils/logger';
import { getBleManager } from '../BleManager';
import { BLE_SERVICE_UUID, BLE_SCAN_TIMEOUT_MS, MAX_RECONNECT_INTERVAL_MS, BLE_DEVICE_INFO_SERVICE_UUID, BLE_SERIAL_NUMBER_CHAR_UUID } from '@/shared/constants/ble.constants';
import type { Device, BleError } from 'react-native-ble-plx';
import { PermissionsAndroid, Platform } from 'react-native';
import { BleConnectionError } from '@/shared/errors/BleConnectionError';
import { useConnectionStore } from '@/stores/connectionStore';

const logger = new MobileLogger('BleConnectionService');

export interface BleConnectionCallbacks {
  onConnected: (device: Device, hardwareId: string) => void;
  onDisconnected: () => void;
  onError: (error: Error) => void;
}

export class BleConnectionService {
  private device: Device | null = null;
  private reconnectAttempt = 0;
  private reconnectTimeoutId: NodeJS.Timeout | null = null;
  private scanTimeoutId: NodeJS.Timeout | null = null;
  private isIntentionalDisconnect = false;
  // Guard against re-entrant connect calls (e.g. onDisconnected + handleUnexpectedDisconnect racing)
  private isConnecting = false;

  async connect(callbacks: BleConnectionCallbacks): Promise<void> {
    if (this.isConnecting) {
      logger.warn('Connect already in progress, ignoring duplicate call');
      return;
    }

    const manager = getBleManager();
    this.isIntentionalDisconnect = false;
    this.isConnecting = true;
    logger.info({ reconnectAttempt: this.reconnectAttempt }, 'BLE connect() called');

    try {
      const hasPermissions = await this.requestPermissions();
      if (!hasPermissions) {
        logger.error('Bluetooth permissions denied — cannot connect');
        callbacks.onError(new BleConnectionError('Bluetooth permissions denied'));
        return;
      }
      logger.info('Bluetooth permissions confirmed');

      // Cancel any stale cached connection before scanning so we don't hit
      // the "Device is already connected" error on reconnect attempts.
      if (this.device) {
        logger.info({ deviceId: this.device.id }, 'Cancelling stale BLE connection before scan');
        try {
          await this.device.cancelConnection();
          logger.info('Stale connection cancelled');
        } catch (e) {
          logger.debug({ error: e }, 'cancelConnection on stale device threw (safe to ignore)');
        }
        this.device = null;
      }

      // Prompt user to enable Bluetooth if it's off (Android only)
      const state = await manager.state();
      if (state !== 'PoweredOn') {
        if (Platform.OS === 'android') {
          try {
            await manager.enable();
          } catch (e) {
            logger.warn('User refused to enable Bluetooth');
            callbacks.onError(new BleConnectionError('Bluetooth is disabled. Please enable it to connect.'));
            return;
          }
        } else {
            callbacks.onError(new BleConnectionError('Bluetooth is disabled. Please enable it in Settings.'));
            return;
        }
      }

      return await new Promise((resolve) => {
        logger.info('Starting BLE scan...');

        this.scanTimeoutId = setTimeout(() => {
          logger.warn('BLE scan timeout');
          manager.stopDeviceScan();
          callbacks.onError(new BleConnectionError('Scan timeout'));
          resolve();
        }, BLE_SCAN_TIMEOUT_MS);

        manager.startDeviceScan(
          [BLE_SERVICE_UUID],
          null,
          async (error: BleError | null, scannedDevice: Device | null) => {
            if (error) {
              logger.error({ error }, 'Scan failed');
              if (this.scanTimeoutId) clearTimeout(this.scanTimeoutId);
              manager.stopDeviceScan();
              this.scheduleReconnect(callbacks);
              resolve();
              return;
            }

            if (scannedDevice) {
              logger.info({ deviceId: scannedDevice.id, name: scannedDevice.name }, 'Found JabbelPin device — stopping scan and connecting');
              if (this.scanTimeoutId) clearTimeout(this.scanTimeoutId);
              manager.stopDeviceScan();

              try {
                // Cancel any OS-level cached connection before connecting to prevent
                // "Device is already connected" errors on fast reconnects.
                logger.debug({ deviceId: scannedDevice.id }, 'Cancelling any OS-cached connection');
                try {
                  await manager.cancelDeviceConnection(scannedDevice.id);
                } catch {
                  // ignore — most likely wasn't connected
                }

                logger.info({ deviceId: scannedDevice.id }, 'Calling device.connect()');
                this.device = await scannedDevice.connect();
                logger.info({ deviceId: this.device.id }, 'GATT connected — discovering services and characteristics');

                await this.device.discoverAllServicesAndCharacteristics();
                logger.info({ deviceId: this.device.id }, 'Service/characteristic discovery complete');

                // Request larger MTU for audio throughput. Timeout to avoid stalling.
                try {
                  const mtuResult = await Promise.race([
                    this.device.requestMTU(512),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('MTU request timed out')), 5000))
                  ]) as any;
                  logger.info({ negotiatedMtu: mtuResult?.mtu ?? 'unknown' }, 'MTU negotiation complete');
                } catch (mtuErr: any) {
                  logger.warn({ error: mtuErr.message }, 'MTU negotiation failed or timed out — continuing with default MTU');
                }

                // Read hardware ID from Device Information Service serial number char.
                let hardwareId = scannedDevice.id; // Fallback to BLE MAC address
                try {
                  logger.debug({ deviceId: this.device.id }, 'Reading Serial Number characteristic');
                  const char = await this.device.readCharacteristicForService(
                    BLE_DEVICE_INFO_SERVICE_UUID,
                    BLE_SERIAL_NUMBER_CHAR_UUID
                  );
                  if (char.value) {
                    hardwareId = Buffer.from(char.value, 'base64').toString('utf8');
                    logger.info({ hardwareId }, 'Read Hardware UUID from device');
                  } else {
                    logger.warn('Serial Number characteristic returned empty value — falling back to BLE ID');
                  }
                } catch (e: any) {
                  logger.warn({ error: e.message }, 'Could not read Serial Number characteristic — falling back to BLE ID');
                }

                this.reconnectAttempt = 0;

                // Register disconnect listener ONCE per successful connection.
                // Local flag prevents double-scheduling from multiple onDisconnected firings.
                let disconnectHandled = false;
                this.device.onDisconnected((_, disconnectedDevice) => {
                  logger.info({ deviceId: disconnectedDevice?.id }, 'Device onDisconnected callback fired');
                  if (!this.isIntentionalDisconnect && !disconnectHandled) {
                    disconnectHandled = true;
                    this.handleUnexpectedDisconnect(callbacks);
                  } else {
                    logger.info('Disconnect was intentional or already handled — skipping reconnect');
                  }
                });

                useConnectionStore.getState().setBleDevice(this.device);

                logger.info({ deviceId: this.device.id, hardwareId }, 'BLE connection fully established — firing onConnected');
                callbacks.onConnected(this.device, hardwareId);
                resolve();
              } catch (connErr: any) {
                logger.error({ error: connErr.message, stack: connErr.stack }, 'GATT connection flow failed');
                callbacks.onError(new BleConnectionError(`Connection failed: ${connErr.message}`));
                this.scheduleReconnect(callbacks);
                resolve();
              }
            }
          }
        );
      });
    } finally {
      this.isConnecting = false;
    }
  }

  disconnect(): void {
    logger.info('disconnect() called — setting intentional disconnect flag and cleaning up');
    this.isIntentionalDisconnect = true;
    if (this.scanTimeoutId) {
      clearTimeout(this.scanTimeoutId);
      this.scanTimeoutId = null;
      logger.debug('Scan timeout cleared');
    }
    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
      logger.debug('Reconnect timer cleared');
    }
    if (this.device) {
      logger.info({ deviceId: this.device.id }, 'Cancelling GATT connection');
      this.device.cancelConnection().catch(e => logger.warn({ error: e }, 'cancelConnection threw during explicit disconnect'));
      this.device = null;
    } else {
      logger.debug('No active device to disconnect');
    }
  }

  private handleUnexpectedDisconnect(callbacks: BleConnectionCallbacks) {
    if (this.isIntentionalDisconnect) return;
    logger.warn('Unexpected BLE disconnect detected — scheduling reconnect');
    this.device = null;
    callbacks.onDisconnected();
    this.scheduleReconnect(callbacks);
  }

  private scheduleReconnect(callbacks: BleConnectionCallbacks) {
    if (this.isIntentionalDisconnect) return;

    // Clear any existing pending reconnect before scheduling a new one
    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }

    const baseDelay = 1000;
    const maxDelay = MAX_RECONNECT_INTERVAL_MS;
    const delay = Math.min(baseDelay * Math.pow(2, this.reconnectAttempt), maxDelay);
    this.reconnectAttempt++;

    logger.info({ delay, attempt: this.reconnectAttempt }, 'Scheduling reconnect');

    this.reconnectTimeoutId = setTimeout(() => {
      this.reconnectTimeoutId = null;
      this.connect(callbacks);
    }, delay);
  }

  private async requestPermissions(): Promise<boolean> {
    if (Platform.OS === 'android') {
      if ((Platform.Version as number) >= 31) {
        const granted = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN as any,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT as any,
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        ]);
        return (
          granted['android.permission.BLUETOOTH_SCAN'] === PermissionsAndroid.RESULTS.GRANTED &&
          granted['android.permission.BLUETOOTH_CONNECT'] === PermissionsAndroid.RESULTS.GRANTED
        );
      } else {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION as any,
        );
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      }
    }
    return true;
  }
}
