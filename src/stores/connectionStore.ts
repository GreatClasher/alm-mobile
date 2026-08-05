import { create } from 'zustand';
import { BleConnectionState } from '../features/bluetooth/types/BleConnectionState';
import type { Device } from 'react-native-ble-plx';

export interface PttPacketLog {
  id: number;
  timestamp: number;
  direction: 'received' | 'sent';
  status: 'ok' | 'error' | 'pending';
  packetId?: string;
  byteSize?: number;
}

export type FastLaneStage =
  | 'idle'
  | 'listening'   // PTT pressed, receiving audio from Watch
  | 'uploading'   // sending packets to backend
  | 'processing'  // backend is transcribing / thinking
  | 'answering'   // backend is generating answer
  | 'done'        // answer received
  | 'error';      // something failed

interface ConnectionStore {
  bleState: BleConnectionState;
  wsConnected: boolean;
  pendingPacketCount: number;
  packetsReceived: number;
  packetsSent: number;
  bleDevice: Device | null;
  hardwareId: string | null;
  authToken: string | null;
  assistantMessage: string | null;
  assistantPrompt: string | null;
  fastLaneActive: boolean;
  fastLaneStage: FastLaneStage;
  fastLaneError: string | null;
  pttLog: PttPacketLog[];

  setBleState: (state: BleConnectionState) => void;
  setWsConnected: (connected: boolean) => void;
  setPendingPacketCount: (count: number) => void;
  incrementPacketsReceived: () => void;
  incrementPacketsSent: () => void;
  setBleDevice: (device: Device | null) => void;
  setHardwareId: (id: string | null) => void;
  setAuthToken: (token: string | null) => void;
  setAssistantMessage: (msg: string | null) => void;
  setAssistantPrompt: (prompt: string | null) => void;
  setFastLaneActive: (active: boolean) => void;
  setFastLaneStage: (stage: FastLaneStage, error?: string) => void;
  addPttLog: (entry: Omit<PttPacketLog, 'id'>) => void;
  clearPttLog: () => void;
}

let _logId = 0;

export const useConnectionStore = create<ConnectionStore>((set) => ({
  bleState: BleConnectionState.DISCONNECTED,
  wsConnected: false,
  pendingPacketCount: 0,
  packetsReceived: 0,
  packetsSent: 0,
  bleDevice: null,
  hardwareId: null,
  authToken: null,
  assistantMessage: null,
  assistantPrompt: null,
  fastLaneActive: false,
  fastLaneStage: 'idle',
  fastLaneError: null,
  pttLog: [],

  setBleState: (state) => set({ bleState: state }),
  setWsConnected: (connected) => set({ wsConnected: connected }),
  setPendingPacketCount: (count) => set({ pendingPacketCount: count }),
  incrementPacketsReceived: () => set((s) => ({ packetsReceived: s.packetsReceived + 1 })),
  incrementPacketsSent: () => set((s) => ({ packetsSent: s.packetsSent + 1 })),
  setBleDevice: (device) => set({ bleDevice: device }),
  setHardwareId: (id) => set({ hardwareId: id }),
  setAuthToken: (token) => set({ authToken: token }),
  setAssistantMessage: (msg) => set({ assistantMessage: msg }),
  setAssistantPrompt: (prompt) => set({ assistantPrompt: prompt }),
  setFastLaneActive: (active) => set({ fastLaneActive: active }),
  setFastLaneStage: (stage, error) => set({ fastLaneStage: stage, fastLaneError: error ?? null }),
  addPttLog: (entry) =>
    set((s) => ({
      pttLog: [{ ...entry, id: ++_logId }, ...s.pttLog].slice(0, 50),
    })),
  clearPttLog: () => set({ pttLog: [] }),
}));
