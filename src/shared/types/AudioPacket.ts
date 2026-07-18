/**
 * AudioPacket types — shared across BLE, SQLite, and WebSocket layers.
 * Import from here: `import type { AudioPacket, StoredPacket } from '@/shared/types/AudioPacket'`
 */
import type { PacketStatus } from './PacketStatus';

export const PacketPayloadType = {
  AUDIO: 'AUDIO',
  HEARTBEAT: 'HEARTBEAT',
  CONTROL: 'CONTROL',
  DIAGNOSTIC: 'DIAGNOSTIC',
} as const;
export type PacketPayloadType = (typeof PacketPayloadType)[keyof typeof PacketPayloadType];

export interface AudioPacket {
  readonly deviceId: string;
  readonly sessionId: string;
  readonly sequenceNo: number;
  readonly timestamp: number;
  readonly payloadType: PacketPayloadType;
  readonly payload: Uint8Array;
  /** CRC32 checksum as 8-character hex string (e.g. "a1b2c3d4") */
  readonly checksum: string;
}

export interface StoredPacket extends AudioPacket {
  /** SQLite AUTOINCREMENT row ID */
  readonly localId: number;
  readonly status: PacketStatus;
  /** Unix milliseconds when packet was received from BLE */
  readonly receivedAt: number;
  /** Unix milliseconds when packet was acknowledged by backend, or null */
  readonly deliveredAt: number | null;
}
