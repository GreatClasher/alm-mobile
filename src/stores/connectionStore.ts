import { create } from 'zustand';
import { BleConnectionState } from '../features/bluetooth/types/BleConnectionState';

import type { Device } from 'react-native-ble-plx';

interface ConnectionStore {
  bleState: BleConnectionState;
  wsConnected: boolean;
  pendingPacketCount: number;
  packetsReceived: number;
  lastHeartbeatAt: number | null;
  bleDevice: Device | null;
  hardwareId: string | null;
  setBleState: (state: BleConnectionState) => void;
  setWsConnected: (connected: boolean) => void;
  setPendingPacketCount: (count: number) => void;
  incrementPacketsReceived: () => void;
  setLastHeartbeatAt: (timestamp: number) => void;
  setBleDevice: (device: Device | null) => void;
  setHardwareId: (id: string | null) => void;
  authToken: string | null;
  setAuthToken: (token: string | null) => void;
}

export const useConnectionStore = create<ConnectionStore>((set) => ({
  bleState: BleConnectionState.DISCONNECTED,
  wsConnected: false,
  pendingPacketCount: 0,
  packetsReceived: 0,
  lastHeartbeatAt: null,
  bleDevice: null,
  hardwareId: null,
  setBleState: (state) => set({ bleState: state }),
  setWsConnected: (connected) => set({ wsConnected: connected }),
  setPendingPacketCount: (count) => set({ pendingPacketCount: count }),
  incrementPacketsReceived: () => set((s) => ({ packetsReceived: s.packetsReceived + 1 })),
  setLastHeartbeatAt: (timestamp) => set({ lastHeartbeatAt: timestamp }),
  setBleDevice: (device) => set({ bleDevice: device }),
  setHardwareId: (id) => set({ hardwareId: id }),
  authToken: null,
  setAuthToken: (token) => set({ authToken: token }),
}));
