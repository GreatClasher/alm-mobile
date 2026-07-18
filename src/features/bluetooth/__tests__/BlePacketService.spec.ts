import { BlePacketService } from '../services/BlePacketService';
import { BLE_SERVICE_UUID, BLE_AUDIO_CHARACTERISTIC_UUID } from '@/shared/constants/ble.constants';
import { deserializePacket } from '../utils/packet-deserializer';
import { verifyChecksum } from '@/shared/utils/checksum';

jest.mock('../utils/packet-deserializer', () => ({
  deserializePacket: jest.fn()
}));

jest.mock('@/shared/utils/checksum', () => ({
  verifyChecksum: jest.fn()
}));

/** Create a mock Device with monitorCharacteristicForService stubbed */
function makeMockDevice(subscription: any, listenerCapture?: (fn: any) => void) {
  return {
    id: 'test-device',
    monitorCharacteristicForService: jest.fn().mockImplementation(
      (_serviceUuid: string, _charUuid: string, listener: any) => {
        if (listenerCapture) listenerCapture(listener);
        return subscription;
      }
    )
  } as any;
}

describe('BlePacketService', () => {
  let service: BlePacketService;
  let mockSubscription: any;
  let callbacks: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockSubscription = { remove: jest.fn() };

    callbacks = {
      onPacketReceived: jest.fn(),
      onError: jest.fn()
    };

    service = new BlePacketService();
  });

  describe('startMonitoring', () => {
    it('should call onPacketReceived with valid packet', () => {
      let notifyListener: any;
      const device = makeMockDevice(mockSubscription, (fn) => { notifyListener = fn; });

      service.startMonitoring(device, callbacks);

      const mockPacket = { sequenceNo: 1, checksum: '1234abcd', payload: new Uint8Array() };
      (deserializePacket as jest.Mock).mockReturnValue(mockPacket);
      (verifyChecksum as jest.Mock).mockReturnValue(true);

      notifyListener(null, { value: 'base64encoded=' });

      expect(callbacks.onPacketReceived).toHaveBeenCalledWith(mockPacket);
      expect(deserializePacket).toHaveBeenCalled();
      expect(verifyChecksum).toHaveBeenCalled();
    });

    it('should call onError when deserialization fails', () => {
      let notifyListener: any;
      const device = makeMockDevice(mockSubscription, (fn) => { notifyListener = fn; });

      service.startMonitoring(device, callbacks);

      const error = new Error('PacketValidationError');
      (deserializePacket as jest.Mock).mockImplementation(() => { throw error; });

      notifyListener(null, { value: 'invalid=' });

      expect(callbacks.onError).toHaveBeenCalled();
      expect(callbacks.onPacketReceived).not.toHaveBeenCalled();
    });

    it('should call onError when a non-disconnect BLE error event occurs', () => {
      let notifyListener: any;
      const device = makeMockDevice(mockSubscription, (fn) => { notifyListener = fn; });

      service.startMonitoring(device, callbacks);

      // errorCode 205 is treated as a silent disconnect, not an error
      const bleError = Object.assign(new Error('BLE protocol error'), { errorCode: 999 });
      notifyListener(bleError, null);

      expect(callbacks.onError).toHaveBeenCalledWith(expect.any(Error));
    });

    it('should silently swallow disconnect errors (errorCode 205)', () => {
      let notifyListener: any;
      const device = makeMockDevice(mockSubscription, (fn) => { notifyListener = fn; });

      service.startMonitoring(device, callbacks);

      const disconnectError = Object.assign(new Error('Device disconnected'), { errorCode: 205 });
      notifyListener(disconnectError, null);

      // Should NOT call onError for a clean disconnect
      expect(callbacks.onError).not.toHaveBeenCalled();
    });

    it('should silently skip if characteristic value is null', () => {
      let notifyListener: any;
      const device = makeMockDevice(mockSubscription, (fn) => { notifyListener = fn; });

      service.startMonitoring(device, callbacks);
      notifyListener(null, { value: null });

      expect(callbacks.onError).not.toHaveBeenCalled();
      expect(callbacks.onPacketReceived).not.toHaveBeenCalled();
    });

    it('should warn and not resubscribe if already monitoring', () => {
      const device = makeMockDevice(mockSubscription);
      service.startMonitoring(device, callbacks);
      service.startMonitoring(device, callbacks);

      expect(device.monitorCharacteristicForService).toHaveBeenCalledTimes(1);
    });
  });

  describe('stopMonitoring', () => {
    it('should clean up subscription', () => {
      const device = makeMockDevice(mockSubscription);
      service.startMonitoring(device, callbacks);
      service.stopMonitoring();

      expect(mockSubscription.remove).toHaveBeenCalled();
    });
  });
});
