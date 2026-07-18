export const BleConnectionState = {
  DISCONNECTED: 'DISCONNECTED',
  SCANNING: 'SCANNING',
  CONNECTING: 'CONNECTING',
  CONNECTED: 'CONNECTED',
  RECONNECTING: 'RECONNECTING',
} as const;

export type BleConnectionState = (typeof BleConnectionState)[keyof typeof BleConnectionState];
