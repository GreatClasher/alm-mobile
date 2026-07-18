import { useConnectionStore } from '../connectionStore';
import { BleConnectionState } from '../../features/bluetooth/types/BleConnectionState';

describe('connectionStore', () => {
  it('should set ble state', () => {
    useConnectionStore.getState().setBleState(BleConnectionState.CONNECTED);
    expect(useConnectionStore.getState().bleState).toBe(BleConnectionState.CONNECTED);
  });
  it('should set ws connected', () => {
    useConnectionStore.getState().setWsConnected(true);
    expect(useConnectionStore.getState().wsConnected).toBe(true);
  });
  it('should set pending packet count', () => {
    useConnectionStore.getState().setPendingPacketCount(10);
    expect(useConnectionStore.getState().pendingPacketCount).toBe(10);
  });
  it('should set last heartbeat', () => {
    useConnectionStore.getState().setLastHeartbeatAt(12345);
    expect(useConnectionStore.getState().lastHeartbeatAt).toBe(12345);
  });
  it('should set auth token', () => {
    useConnectionStore.getState().setAuthToken('token123');
    expect(useConnectionStore.getState().authToken).toBe('token123');
  });
});
