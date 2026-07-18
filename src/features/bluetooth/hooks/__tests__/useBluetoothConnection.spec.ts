import { renderHook } from '@testing-library/react-native';
import { useBluetoothConnection } from '../useBluetoothConnection';
import { useConnectionStore } from '../../../../stores/connectionStore';
import { BleConnectionState } from '../../types/BleConnectionState';

// mock the service
jest.mock('../../services/BleConnectionService', () => ({
  BleConnectionService: jest.fn().mockImplementation(() => ({
    connect: jest.fn(),
    disconnect: jest.fn()
  }))
}));

describe('useBluetoothConnection', () => {
  it('should initialize and connect on mount', () => {
    const { result, unmount } = renderHook(() => useBluetoothConnection());
    expect(result.current).toBeDefined();
    // the hook state should be SCANNING after mount
    expect(result.current.state).toBe(BleConnectionState.SCANNING);
    unmount();
  });
});
