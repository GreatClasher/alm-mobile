import { NetworkMonitor } from '../NetworkMonitor';
import NetInfo from '@react-native-community/netinfo';

jest.mock('@react-native-community/netinfo', () => {
  return {
    addEventListener: jest.fn()
  };
});

describe('NetworkMonitor', () => {
  let monitor: NetworkMonitor;
  let callbacks: any;
  let simulateNetworkChange: (state: { isConnected: boolean }) => void;
  let mockUnsubscribe: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    monitor = new NetworkMonitor();
    callbacks = {
      onDisconnected: jest.fn(),
      onRestored: jest.fn()
    };
    mockUnsubscribe = jest.fn();

    (NetInfo.addEventListener as jest.Mock).mockImplementation((callback) => {
      simulateNetworkChange = callback;
      return mockUnsubscribe;
    });
  });

  afterEach(() => {
    monitor.stopMonitoring();
  });

  it('should call onDisconnected when network goes down', () => {
    monitor.startMonitoring(callbacks);
    
    // Initial state
    simulateNetworkChange({ isConnected: true });
    
    // Goes down
    simulateNetworkChange({ isConnected: false });

    expect(callbacks.onDisconnected).toHaveBeenCalled();
  });

  it('should call onRestored when network comes back online', () => {
    monitor.startMonitoring(callbacks);
    
    // Initial state
    simulateNetworkChange({ isConnected: false });
    
    // Goes up
    simulateNetworkChange({ isConnected: true });

    expect(callbacks.onRestored).toHaveBeenCalled();
  });
});
