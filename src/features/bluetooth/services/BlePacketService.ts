import { MobileLogger } from '@/shared/utils/logger';
import { BLE_SERVICE_UUID, BLE_AUDIO_CHARACTERISTIC_UUID } from '@/shared/constants/ble.constants';
import { deserializePacket } from '../utils/packet-deserializer';
import { verifyChecksum } from '@/shared/utils/checksum';
import type { AudioPacket } from '@/shared/types/AudioPacket';
import { BleCharacteristicError } from '@/shared/errors/BleCharacteristicError';
import type { Subscription, BleError, Characteristic, Device } from 'react-native-ble-plx';

const logger = new MobileLogger('BlePacketService');

export interface BlePacketServiceCallbacks {
  onPacketReceived: (packet: AudioPacket) => void;
  onError: (error: Error) => void;
}

export class BlePacketService {
  private subscription: Subscription | null = null;

  /**
   * Subscribe to AUDIO_TX notifications using the connected Device object.
   *
   * IMPORTANT: We call device.monitorCharacteristicForService() (instance method on the
   * connected Device) NOT manager.monitorCharacteristicForDevice(). The manager-level
   * method attempts an internal characteristic read before enabling notifications on some
   * BLE stacks — which fails because AUDIO_TX is NOTIFY-only (no PROPERTY_READ). Using
   * the Device instance method writes the CCCD descriptor directly.
   */
  startMonitoring(device: Device, callbacks: BlePacketServiceCallbacks): void {
    if (this.subscription) {
      logger.warn('Already monitoring — ignoring duplicate startMonitoring call');
      return;
    }

    logger.info(
      { deviceId: device.id, serviceUuid: BLE_SERVICE_UUID, charUuid: BLE_AUDIO_CHARACTERISTIC_UUID },
      'Starting to monitor AUDIO_TX characteristic'
    );

    this.subscription = device.monitorCharacteristicForService(
      BLE_SERVICE_UUID,
      BLE_AUDIO_CHARACTERISTIC_UUID,
      (error: BleError | null, characteristic: Characteristic | null) => {
        if (error) {
          // error.errorCode 205 = device disconnected, not a protocol error — suppress reconnect noise
          const isDisconnect = (error as any).errorCode === 205;
          if (isDisconnect) {
            logger.info(
              { errorCode: (error as any).errorCode, reason: error.message },
              'AUDIO_TX monitor closed — device disconnected'
            );
          } else {
            logger.error(
              {
                error,
                errorCode: (error as any).errorCode,
                serviceUuid: BLE_SERVICE_UUID,
                charUuid: BLE_AUDIO_CHARACTERISTIC_UUID,
              },
              'Error in AUDIO_TX characteristic notification'
            );
            callbacks.onError(new BleCharacteristicError(error.message));
          }
          return;
        }

        if (!characteristic?.value) {
          logger.debug('Received empty AUDIO_TX notification — skipping');
          return;
        }

        logger.debug({ valueLength: characteristic.value.length }, 'Received AUDIO_TX packet (base64 encoded)');

        try {
          const raw = Buffer.from(characteristic.value, 'base64');
          logger.debug({ byteLength: raw.byteLength }, 'Deserializing packet');
          const packet = deserializePacket(raw);
          if (!verifyChecksum(packet.payload, packet.checksum)) {
            logger.warn(
              { sequenceNo: packet.sequenceNo },
              'Packet checksum validation failed — dropping (not fatal)'
            );
            // Per-packet checksum failure: log and drop. Do NOT call onError.
            return;
          }
          logger.debug({ sequenceNo: packet.sequenceNo, payloadBytes: packet.payload.byteLength }, 'Packet OK');
          callbacks.onPacketReceived(packet);
        } catch (deserializeError: any) {
          // Per-packet structural error (wrong header, bad magic, too short, etc.).
          // Log and drop — do NOT propagate as a fatal error that kills the subscription.
          logger.warn(
            { error: deserializeError.message, byteLength: characteristic.value?.length },
            'Packet deserialization failed — dropping bad packet (not fatal)'
          );
        }
      }
    );

    logger.info({ deviceId: device.id }, 'AUDIO_TX subscription established — waiting for packets');
  }

  stopMonitoring(): void {
    if (this.subscription) {
      logger.info('Stopping AUDIO_TX characteristic monitoring');
      this.subscription.remove();
      this.subscription = null;
    } else {
      logger.debug('stopMonitoring called but no active subscription');
    }
  }
}
