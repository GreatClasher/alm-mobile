import { SqlitePacketQueue } from '@/features/storage/SqlitePacketQueue';
import { PacketRelayService } from '@/features/streaming/PacketRelayService';
import { WebSocketClient } from '@/features/streaming/WebSocketClient';
import { BlePacketService } from '@/features/bluetooth/services/BlePacketService';
import { getBleManager } from '@/features/bluetooth/BleManager';
import { OtaCoordinator, OtaInfo } from '@/features/ota/OtaCoordinator';
import { MobileLogger } from '@/shared/utils/logger';
import { _resetAllDatabases } from '../../__mocks__/expo-sqlite';
import { BleManager } from 'react-native-ble-plx';
import * as FileSystem from 'expo-file-system';
import * as Crypto from 'expo-crypto';

// mock logger to suppress noise
jest.mock('@/shared/utils/logger', () => {
  return {
    MobileLogger: jest.fn().mockImplementation(() => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    })),
  };
});

jest.mock('expo-file-system', () => ({
  documentDirectory: 'file:///mock/doc/dir/',
  downloadAsync: jest.fn().mockResolvedValue({ status: 200 }),
  readAsStringAsync: jest.fn().mockResolvedValue('YmluYXJ5ZGF0YQ=='), // length = 12 bytes decoded
  deleteAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digest: jest.fn().mockResolvedValue(new Uint8Array(32)),
}));

describe('Real-World Integration Test Scenarios (Mobile)', () => {
  let sqliteQueue: SqlitePacketQueue;
  let wsClient: WebSocketClient;
  let relayService: PacketRelayService;
  let bleService: BlePacketService;
  let otaCoordinator: OtaCoordinator;
  let logger: MobileLogger;

  beforeEach(async () => {
    jest.useFakeTimers();
    _resetAllDatabases();
    jest.clearAllMocks();

    sqliteQueue = new SqlitePacketQueue();
    await sqliteQueue.initialize();

    wsClient = new WebSocketClient();
    logger = new MobileLogger('test');
    relayService = new PacketRelayService(sqliteQueue, wsClient, logger);
    bleService = new BlePacketService();
    otaCoordinator = new OtaCoordinator();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('2.1 BLE Signal Loss Mid-Transmission', () => {
    it('MTU Fragmentation Interruption: partial fragments discarded via checksum', () => {
      const callbacks = {
        onPacketReceived: jest.fn(),
        onError: jest.fn(),
      };

      let monitorCallback: any;
      const mockDevice = {
        id: 'device-1',
        monitorCharacteristicForService: jest.fn().mockImplementation(
          (_s: string, _c: string, listener: any) => {
            monitorCallback = listener;
            return { remove: jest.fn() };
          }
        )
      } as any;

      bleService.startMonitoring(mockDevice, callbacks);

      // Bad packet (malformed or bad checksum)
      const badPacketBuffer = Buffer.alloc(30);
      badPacketBuffer.write('invalid data');


      monitorCallback(null, { value: badPacketBuffer.toString('base64') });

      expect(callbacks.onPacketReceived).not.toHaveBeenCalled();
      expect(callbacks.onError).toHaveBeenCalled();
    });
  });

  describe('2.2 WebSocket Connection Drops', () => {
    it('Drop During BLE Stream & WebSocket Reconnect and Replay', async () => {
      // simulate 100 pending packets in sqlite
      for (let i = 1; i <= 100; i++) {
        await sqliteQueue.enqueue({
          deviceId: 'dev',
          sessionId: 'ses',
          sequenceNo: i,
          payloadType: 'AUDIO',
          payload: new Uint8Array([0xaa]),
          checksum: 'abc',
          timestamp: Date.now(),
        });
      }
      expect(await sqliteQueue.getPendingCount()).toBe(100);

      // ws client not connected yet
      expect(wsClient.isConnected).toBe(false);
      await relayService.triggerReplay();
      expect(await sqliteQueue.getPendingCount()).toBe(100); // nothing relayed

      // ws client connects
      jest.spyOn(wsClient, 'isConnected', 'get').mockReturnValue(true);
      
      // trigger Replay
      jest.spyOn(wsClient, 'sendPacket').mockResolvedValue({ status: 'ok' });
      await relayService.triggerReplay();

      // all packets should have been processed and marked DELIVERED
      expect(await sqliteQueue.getPendingCount()).toBe(0);
      // batches of 50 -> 2 batches
      expect(wsClient.sendPacket).toHaveBeenCalledTimes(100);
    });
  });

  describe('2.4 SQLite Database Locks & Concurrency', () => {
    it('Unique Constraint Collision: INSERT OR IGNORE handles duplicate cleanly', async () => {
      const packet = {
        deviceId: 'dev',
        sessionId: 'ses',
        sequenceNo: 1,
        payloadType: 'AUDIO' as const,
        payload: new Uint8Array([0xaa]),
        checksum: 'abc',
        timestamp: Date.now(),
      };
      
      const id1 = await sqliteQueue.enqueue(packet);
      const id2 = await sqliteQueue.enqueue(packet); // same session + sequence
      
      expect(id1).toBeGreaterThan(0);
      expect(id2).toBeGreaterThanOrEqual(0); // handles cleanly without throwing
      expect(await sqliteQueue.getPendingCount()).toBe(1);
    });
  });

  describe('2.5 OTA Interruptions', () => {
    it('BLE Disconnect During Chunk Transfer resumes correctly', async () => {
      const manager = getBleManager();
      
      const otaInfo: OtaInfo = {
        version: '1.0.0',
        downloadUrl: 'http://url',
        sha256: Buffer.alloc(32).toString('hex'), // dummy hash to match mock
        sizeBytes: 12
      };

      // Mock write to throw on the first chunk to simulate BLE disconnect
      manager.writeCharacteristicWithResponseForDevice = jest.fn()
        .mockResolvedValueOnce(undefined) // OTA_START ok
        .mockRejectedValueOnce(new Error('BLE Disconnect')) // Chunk 1 fails

      await expect(otaCoordinator.handleOtaAvailable('dev', otaInfo))
        .rejects.toThrow('BLE Disconnect');

      // Reconnect and resume
      manager.writeCharacteristicWithResponseForDevice = jest.fn()
        .mockResolvedValue(undefined); // all ok
      
      // when we resume, it shouldn't resend OTA_START and should continue from chunk 1
      await otaCoordinator.handleOtaAvailable('dev', otaInfo);

      // We expect it to NOT send OTA_START again, and just send chunks and OTA_END
      // Wait, how do we verify it didn't send OTA_START?
      // First payload should be chunk type (0x11), not OTA_START (0x10)
      const firstCallArg = (manager.writeCharacteristicWithResponseForDevice as jest.Mock).mock.calls[0][3];
      const decoded = Buffer.from(firstCallArg, 'base64');
      expect(decoded[0]).toBe(0x11); // OTA_CHUNK
    });
  });
});
