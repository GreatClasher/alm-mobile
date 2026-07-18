import { BleConnectionService } from '../services/BleConnectionService';
import { getBleManager } from '../BleManager';
import { BLE_SERVICE_UUID, BLE_SCAN_TIMEOUT_MS } from '@/shared/constants/ble.constants';
import { Device, BleError } from 'react-native-ble-plx';

jest.mock('../BleManager', () => ({
  getBleManager: jest.fn()
}));

jest.useFakeTimers();

describe('BleConnectionService', () => {
  let service: BleConnectionService;
  let mockManager: any;
  let mockDevice: any;
  let callbacks: any;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockDevice = {
      id: 'test-device-id',
      name: 'Galaxy Watch',
      connect: jest.fn().mockReturnThis(),
      discoverAllServicesAndCharacteristics: jest.fn().mockReturnThis(),
      requestMTU: jest.fn().mockReturnThis(),
      onDisconnected: jest.fn()
    };

    mockManager = {
      startDeviceScan: jest.fn((uuids, options, listener) => {
        // Trigger listener immediately for success flow
        listener(null, mockDevice);
      }),
      stopDeviceScan: jest.fn()
    };

    (getBleManager as jest.Mock).mockReturnValue(mockManager);

    callbacks = {
      onConnected: jest.fn(),
      onDisconnected: jest.fn(),
      onError: jest.fn()
    };

    service = new BleConnectionService();
  });

  describe('connect', () => {
    it('should connect to device and call onConnected', async () => {
      // Run connect and advance timers for async operations
      await service.connect(callbacks);
      
      expect(mockManager.startDeviceScan).toHaveBeenCalledWith(
        [BLE_SERVICE_UUID],
        null,
        expect.any(Function)
      );
      
      expect(mockManager.stopDeviceScan).toHaveBeenCalled();
      expect(mockDevice.connect).toHaveBeenCalled();
      expect(mockDevice.requestMTU).toHaveBeenCalledWith(512);
      expect(mockDevice.discoverAllServicesAndCharacteristics).toHaveBeenCalled();
      expect(callbacks.onConnected).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'test-device-id', name: 'Galaxy Watch' }),
        'test-device-id'
      );
    });

    it('should call onError after BLE_SCAN_TIMEOUT_MS if no device found', async () => {
      mockManager.startDeviceScan.mockImplementation(() => {
        // Do nothing, let it timeout
      });

      const connectPromise = service.connect(callbacks);
      
      jest.advanceTimersByTime(BLE_SCAN_TIMEOUT_MS);
      await Promise.resolve();

      expect(mockManager.stopDeviceScan).toHaveBeenCalled();
      expect(callbacks.onError).toHaveBeenCalled();
      expect(callbacks.onError.mock.calls[0][0].message).toContain('Scan timeout');
    });
  });

  describe('disconnect', () => {
    it('should call onDisconnected and schedule reconnect on unexpected disconnect', async () => {
      let disconnectListener: any;
      mockDevice.onDisconnected.mockImplementation((listener: any) => {
        disconnectListener = listener;
        return { remove: jest.fn() };
      });

      await service.connect(callbacks);
      
      // Simulate unexpected disconnect
      disconnectListener(null, mockDevice);
      
      expect(callbacks.onDisconnected).toHaveBeenCalled();
      
      // Fast-forward 1s for the first reconnect attempt
      mockManager.startDeviceScan.mockClear();
      jest.advanceTimersByTime(1000);
      
      expect(mockManager.startDeviceScan).toHaveBeenCalled();
    });
  });

  describe('Exponential backoff', () => {
    it('should increase delays correctly on repeated failures', async () => {

      mockManager.startDeviceScan.mockImplementation((uuids: any, opts: any, listener: any) => {
        listener(new Error('Scan failed'), null);
      });

      await service.connect(callbacks);
      
      // Initial failure triggers backoff
      mockManager.startDeviceScan.mockClear();
      
      // 1s
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
      expect(mockManager.startDeviceScan).toHaveBeenCalledTimes(1);
      
      // 2s
      mockManager.startDeviceScan.mockClear();
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
      expect(mockManager.startDeviceScan).toHaveBeenCalledTimes(1);

      // 4s
      mockManager.startDeviceScan.mockClear();
      jest.advanceTimersByTime(4000);
      await Promise.resolve();
      expect(mockManager.startDeviceScan).toHaveBeenCalledTimes(1);
    });
  });
});
