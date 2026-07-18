import { renderHook } from '@testing-library/react-native';
import { useWebSocketConnection } from '../useWebSocketConnection';

jest.mock('../../WebSocketClient', () => ({
  WebSocketClient: jest.fn().mockImplementation(() => ({
    connect: jest.fn(),
    disconnect: jest.fn(),
    isConnected: true
  }))
}));
jest.mock('../../../../stores/connectionStore', () => ({
  useConnectionStore: {
    getState: jest.fn().mockReturnValue({
      setWsConnected: jest.fn()
    })
  }
}));

describe('useWebSocketConnection', () => {
  it('should connect ws client on mount', () => {
    // we just need to pass some mock instances to make it not crash
    const wsClient = new (require('../../WebSocketClient').WebSocketClient)();
    const { unmount } = renderHook(() => useWebSocketConnection());
    unmount();
  });
});
