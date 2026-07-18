import { OtaCoordinator } from '../OtaCoordinator';
import * as FileSystem from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import { getBleManager } from '@/features/bluetooth/BleManager';

jest.mock('expo-file-system', () => ({
  downloadAsync: jest.fn(),
  readAsStringAsync: jest.fn(),
  deleteAsync: jest.fn()
}));

jest.mock('expo-crypto', () => ({
  digestStringAsync: jest.fn(),
  digest: jest.fn(),
  CryptoDigestAlgorithm: { SHA256: 'SHA256' }
}));

jest.mock('@/features/bluetooth/BleManager', () => ({
  getBleManager: jest.fn()
}));

describe('OtaCoordinator', () => {
  let coordinator: OtaCoordinator;
  let mockManager: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockManager = {
      writeCharacteristicWithResponseForDevice: jest.fn().mockResolvedValue({})
    };
    (getBleManager as jest.Mock).mockReturnValue(mockManager);

    coordinator = new OtaCoordinator();
  });

  it('should abort if SHA-256 mismatch after download', async () => {
    (FileSystem.downloadAsync as jest.Mock).mockResolvedValue({ status: 200, uri: 'file://test' });
    (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValue('binarydata');
    (Crypto.digest as jest.Mock).mockResolvedValue(Buffer.from('111111', 'hex'));

    await coordinator.handleOtaAvailable('dev1', {
      version: '1.0.1',
      downloadUrl: 'https://example.com/firmware.bin',
      sha256: '222222',
      sizeBytes: 1000
    });

    expect(mockManager.writeCharacteristicWithResponseForDevice).not.toHaveBeenCalled();
    expect(FileSystem.deleteAsync).toHaveBeenCalled();
  });

  it('should send OTA_START, OTA_CHUNKs, and OTA_END if hash matches', async () => {
    (FileSystem.downloadAsync as jest.Mock).mockResolvedValue({ status: 200, uri: 'file://test' });
    // Mock 1000 bytes of base64
    const fakeBase64 = Buffer.alloc(1000, 0).toString('base64');
    (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValue(fakeBase64);
    (Crypto.digest as jest.Mock).mockResolvedValue(Buffer.from('abcdef', 'hex'));

    await coordinator.handleOtaAvailable('dev1', {
      version: '1.0.1',
      downloadUrl: 'https://example.com/firmware.bin',
      sha256: 'abcdef',
      sizeBytes: 1000
    });

    expect(mockManager.writeCharacteristicWithResponseForDevice).toHaveBeenCalled();
    const calls = mockManager.writeCharacteristicWithResponseForDevice.mock.calls;
    
    // Check first call (OTA_START)
    expect(calls[0][3]).toMatch(/^[A-Za-z0-9+/=]+$/); // Should be base64
    
    // Check last call (OTA_END)
    expect(calls[calls.length - 1][3]).toMatch(/^[A-Za-z0-9+/=]+$/);
    
    expect(FileSystem.deleteAsync).toHaveBeenCalled();
  });

  it('should abort if BLE write fails mid-chunk', async () => {
    (FileSystem.downloadAsync as jest.Mock).mockResolvedValue({ status: 200, uri: 'file://test' });
    const fakeBase64 = Buffer.alloc(1000, 0).toString('base64');
    (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValue(fakeBase64);
    (Crypto.digest as jest.Mock).mockResolvedValue(Buffer.from('abcdef', 'hex'));

    mockManager.writeCharacteristicWithResponseForDevice
      .mockResolvedValueOnce({}) // OTA_START
      .mockResolvedValueOnce({}) // CHUNK 1
      .mockRejectedValueOnce(new Error('BLE write failed')); // CHUNK 2

    await expect(
      coordinator.handleOtaAvailable('dev1', {
        version: '1.0.1',
        downloadUrl: 'https://example.com/firmware.bin',
        sha256: 'abcdef',
        sizeBytes: 1000
      })
    ).rejects.toThrow('BLE write failed');

    // Make sure it stopped calling after the error
    expect(mockManager.writeCharacteristicWithResponseForDevice).toHaveBeenCalledTimes(3);
  });

  it('should abort if download status is not 200', async () => {
    (FileSystem.downloadAsync as jest.Mock).mockResolvedValue({ status: 404, uri: 'file://test' });

    await expect(
      coordinator.handleOtaAvailable('dev1', {
        version: '1.0.1',
        downloadUrl: 'https://example.com/firmware.bin',
        sha256: 'abcdef',
        sizeBytes: 1000
      })
    ).rejects.toThrow('Download failed with status 404');
    
    expect(mockManager.writeCharacteristicWithResponseForDevice).not.toHaveBeenCalled();
  });
});
