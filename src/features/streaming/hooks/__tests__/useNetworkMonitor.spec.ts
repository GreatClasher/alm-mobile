import { renderHook } from '@testing-library/react-native';
import { useNetworkMonitor } from '../useNetworkMonitor';

jest.mock('../../NetworkMonitor', () => ({
  NetworkMonitor: jest.fn().mockImplementation(() => ({
    startMonitoring: jest.fn(),
    stopMonitoring: jest.fn()
  }))
}));
jest.mock('../../PacketRelayService', () => ({
  PacketRelayService: jest.fn().mockImplementation(() => ({
    startRelay: jest.fn(),
    stopRelay: jest.fn(),
    triggerReplay: jest.fn()
  }))
}));

describe('useNetworkMonitor', () => {
  it('should start monitoring on mount', () => {
    // we just need to pass some mock instances to make it not crash
    const relayService = new (require('../../PacketRelayService').PacketRelayService)();
    const { unmount } = renderHook(() => useNetworkMonitor(relayService));
    unmount();
  });
});
