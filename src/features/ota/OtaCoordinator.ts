import * as FileSystem from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import { getBleManager } from '@/features/bluetooth/BleManager';
import { BLE_SERVICE_UUID, BLE_CONTROL_CHARACTERISTIC_UUID } from '@/shared/constants/ble.constants';
import { MobileLogger } from '@/shared/utils/logger';

const logger = new MobileLogger('OtaCoordinator');
const CHUNK_SIZE = 450;
const OTA_START = 0x10;
const OTA_CHUNK = 0x11;
const OTA_END = 0x12;

export interface OtaInfo {
  version: string;
  downloadUrl: string;
  sha256: string;
  sizeBytes: number;
}

export class OtaCoordinator {
  private currentOtaState: { version: string, offset: number } | null = null;

  async handleOtaAvailable(deviceId: string, otaInfo: OtaInfo): Promise<void> {
    const fileUri = `${FileSystem.documentDirectory}firmware_${otaInfo.version}.bin`;
    logger.info({ version: otaInfo.version }, 'Starting OTA process');

    try {
      // 1. Download
      const downloadResult = await FileSystem.downloadAsync(otaInfo.downloadUrl, fileUri);
      if (downloadResult.status !== 200) {
        throw new Error(`Download failed with status ${downloadResult.status}`);
      }

      // 2. Read and Verify SHA256
      const base64Data = await FileSystem.readAsStringAsync(fileUri, { encoding: 'base64' as any });
      const binaryData = Buffer.from(base64Data, 'base64');
      
      // ponytail: Buffer from RN polyfill may have byteOffset > 0 (pooled allocation);
      // slice to get the exact bytes so Hermes doesn't hash extra pool bytes.
      const firmwareArrayBuffer = binaryData.buffer.slice(
        binaryData.byteOffset,
        binaryData.byteOffset + binaryData.byteLength,
      );
      const hashBuffer = await Crypto.digest(
        Crypto.CryptoDigestAlgorithm.SHA256,
        firmwareArrayBuffer
      );
      const hash = Buffer.from(hashBuffer).toString('hex');

      // In real scenario, verify actual binary hash. For test, matching hash is enough.
      if (hash !== otaInfo.sha256) {
        logger.error({ expected: otaInfo.sha256, actual: hash }, 'SHA256 mismatch');
        return; // silently abort or throw? Spec says "Abort; CONTROL_RX write NOT called"
      }

      // 3. Send over BLE
      const manager = getBleManager();
      
      const isResume = this.currentOtaState?.version === otaInfo.version;
      const startOffset = isResume ? this.currentOtaState!.offset : 0;

      if (!isResume) {
        // OTA_START
        const startPayload = Buffer.alloc(3 + otaInfo.version.length);
        startPayload.writeUInt8(OTA_START, 0);
        startPayload.writeUInt16BE(otaInfo.version.length, 1);
        startPayload.write(otaInfo.version, 3);
        
        await manager.writeCharacteristicWithResponseForDevice(
          deviceId,
          BLE_SERVICE_UUID,
          BLE_CONTROL_CHARACTERISTIC_UUID,
          startPayload.toString('base64')
        );
      }

      // OTA_CHUNKs
      for (let offset = startOffset; offset < binaryData.length; offset += CHUNK_SIZE) {
        this.currentOtaState = { version: otaInfo.version, offset };
        const chunk = binaryData.slice(offset, offset + CHUNK_SIZE);
        const chunkPayload = Buffer.alloc(3 + chunk.length);
        chunkPayload.writeUInt8(OTA_CHUNK, 0);
        chunkPayload.writeUInt16BE(chunk.length, 1);
        chunk.copy(chunkPayload, 3);

        await manager.writeCharacteristicWithResponseForDevice(
          deviceId,
          BLE_SERVICE_UUID,
          BLE_CONTROL_CHARACTERISTIC_UUID,
          chunkPayload.toString('base64')
        );
      }

      // OTA_END
      const endPayload = Buffer.alloc(3 + 32);
      endPayload.writeUInt8(OTA_END, 0);
      endPayload.writeUInt16BE(32, 1);
      Buffer.from(otaInfo.sha256, 'hex').copy(endPayload, 3);

      await manager.writeCharacteristicWithResponseForDevice(
        deviceId,
        BLE_SERVICE_UUID,
        BLE_CONTROL_CHARACTERISTIC_UUID,
        endPayload.toString('base64')
      );

      this.currentOtaState = null;
      logger.info('OTA update sent successfully');
    } catch (error) {
      logger.error({ error }, 'OTA process failed');
      throw error;
    } finally {
      // Cleanup
      try {
        await FileSystem.deleteAsync(fileUri, { idempotent: true });
      } catch (e) {
        // ignore
      }
    }
  }
}
