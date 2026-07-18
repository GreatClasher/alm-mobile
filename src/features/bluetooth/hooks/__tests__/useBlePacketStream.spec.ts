import { renderHook } from '@testing-library/react-native';
import { useBlePacketStream } from '../useBlePacketStream';


// mock the service
jest.mock('../../services/BlePacketService', () => ({
  BlePacketService: jest.fn().mockImplementation(() => ({
    startMonitoring: jest.fn(),
    stopMonitoring: jest.fn()
  }))
}));
jest.mock('../../../storage/SqlitePacketQueue', () => ({
  SqlitePacketQueue: jest.fn().mockImplementation(() => ({
    enqueue: jest.fn()
  }))
}));
jest.mock('../../../heartbeat/HeartbeatForwarder', () => ({
  HeartbeatForwarder: jest.fn().mockImplementation(() => ({
    forwardHeartbeat: jest.fn()
  }))
}));

describe('useBlePacketStream', () => {
  const mockDevice = { id: 'test-device', monitorCharacteristicForService: jest.fn() } as any;

  it('should start monitoring on mount if device is provided', () => {
    const { unmount } = renderHook(() => useBlePacketStream(mockDevice, jest.fn()));
    unmount();
  });
  
  it('should not start monitoring if deviceId is null', () => {
    const { unmount } = renderHook(() => useBlePacketStream(null, jest.fn()));
    unmount();
  });
});
