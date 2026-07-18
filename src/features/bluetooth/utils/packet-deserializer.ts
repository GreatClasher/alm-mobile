/**
 * packet-deserializer.ts — BLE packet binary deserializer.
 *
 * Parses the 55-byte big-endian header as specified in docs/10-ble-protocol.md.
 *
 * Header layout:
 *   Bytes 0-1:   MAGIC     (uint16 BE) = 0x4A50
 *   Byte  2:     VERSION   (uint8)     = 0x01
 *   Byte  3:     PAYLOAD_TYPE (uint8)  = 0x01–0x04
 *   Byte  4:     FLAGS     (uint8)
 *   Bytes 5-8:   SEQUENCE_NO (uint32 BE)
 *   Bytes 9-16:  TIMESTAMP   (int64 BE, Unix ms)
 *   Bytes 17-32: DEVICE_ID   (UUID, 16 bytes)
 *   Bytes 33-48: SESSION_ID  (UUID, 16 bytes)
 *   Bytes 49-50: PAYLOAD_LEN (uint16 BE)
 *   Bytes 51-54: CHECKSUM    (CRC32 uint32 BE)
 *   Bytes 55+:   PAYLOAD     (variable)
 */

import type { AudioPacket, PacketPayloadType } from '@/shared/types/AudioPacket';
import { PacketValidationError } from '@/shared/errors/PacketValidationError';
import {
  PACKET_MAGIC,
  PACKET_VERSION,
  PACKET_HEADER_SIZE,
} from '@/shared/constants/ble.constants';

const PAYLOAD_TYPE_MAP: Readonly<Record<number, PacketPayloadType>> = {
  0x01: 'AUDIO',
  0x02: 'HEARTBEAT',
  0x03: 'CONTROL',
  0x04: 'DIAGNOSTIC',
} as const;

/**
 * Deserialize a raw BLE notification buffer into an AudioPacket.
 * Does NOT verify the CRC32 checksum — that must be done by the caller (BlePacketService).
 *
 * @throws PacketValidationError if any structural validation fails
 */
export function deserializePacket(bytes: Buffer): AudioPacket {
  if (bytes.length < PACKET_HEADER_SIZE) {
    throw new PacketValidationError('Packet too short', {
      length: bytes.length,
      minimumRequired: PACKET_HEADER_SIZE,
    });
  }

  const magic = bytes.readUInt16BE(0);
  if (magic !== PACKET_MAGIC) {
    throw new PacketValidationError('Invalid magic bytes', {
      magic: `0x${magic.toString(16).toUpperCase()}`,
      expected: `0x${PACKET_MAGIC.toString(16).toUpperCase()}`,
    });
  }

  const version = bytes.readUInt8(2);
  if (version !== PACKET_VERSION) {
    throw new PacketValidationError('Unsupported protocol version', {
      version,
      expected: PACKET_VERSION,
    });
  }

  const payloadTypeCode = bytes.readUInt8(3);
  const payloadType = PAYLOAD_TYPE_MAP[payloadTypeCode];
  if (payloadType === undefined) {
    throw new PacketValidationError('Unknown payload type', {
      code: `0x${payloadTypeCode.toString(16).padStart(2, '0')}`,
    });
  }

  // Byte 4: FLAGS — parsed but not yet acted upon (reserved for fragmentation)
  // const flags = bytes.readUInt8(4);

  const sequenceNo = bytes.readUInt32BE(5);
  const timestamp = Number(bytes.readBigInt64BE(9));

  const deviceId = formatUUID(bytes.subarray(17, 33));
  const sessionId = formatUUID(bytes.subarray(33, 49));

  const payloadLen = bytes.readUInt16BE(49);
  const checksumRaw = bytes.readUInt32BE(51);
  const checksum = checksumRaw.toString(16).padStart(8, '0');

  const payload = bytes.subarray(PACKET_HEADER_SIZE, PACKET_HEADER_SIZE + payloadLen);

  if (payload.length !== payloadLen) {
    throw new PacketValidationError('Payload length mismatch', {
      declared: payloadLen,
      actual: payload.length,
    });
  }

  return {
    deviceId,
    sessionId,
    sequenceNo,
    timestamp,
    payloadType,
    payload: new Uint8Array(payload),
    checksum,
  };
}

/**
 * Format 16 raw UUID bytes into RFC 4122 string format:
 * xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
 */
function formatUUID(bytes: Uint8Array): string {
  const hex = Buffer.from(bytes).toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}
