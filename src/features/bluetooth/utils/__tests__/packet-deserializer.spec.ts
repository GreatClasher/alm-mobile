/**
 * packet-deserializer.spec.ts — TDD spec written BEFORE implementation (RED phase)
 *
 * Tests all 11 scenarios for the BLE packet deserializer:
 *   1. Valid AUDIO packet
 *   2. Valid HEARTBEAT packet (empty payload)
 *   3. Wrong MAGIC bytes
 *   4. Wrong VERSION
 *   5. Unknown PAYLOAD_TYPE
 *   6. PAYLOAD_LEN mismatch
 *   7. Packet too short (< 55 bytes)
 *   8. UUID formatting (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
 *   9. SEQUENCE_NO parsed correctly (uint32 BE)
 *   10. TIMESTAMP parsed correctly (int64 BE)
 *   11. CHECKSUM parsed as 8-char hex string
 */

import { deserializePacket } from '@/features/bluetooth/utils/packet-deserializer';
import { PacketValidationError } from '@/shared/errors/PacketValidationError';

// ---- Helpers ----

/**
 * Build a valid 55-byte BLE packet header + optional payload.
 * All fields big-endian as per docs/10-ble-protocol.md.
 */
function buildValidPacket(overrides: {
  magic?: number;
  version?: number;
  payloadType?: number;
  flags?: number;
  sequenceNo?: number;
  timestamp?: bigint;
  deviceId?: Uint8Array;
  sessionId?: Uint8Array;
  payload?: Uint8Array;
  checksumOverride?: number;
} = {}): Buffer {
  const payload = overrides.payload ?? new Uint8Array([0xaa, 0xbb, 0xcc]);
  const payloadLen = payload.length;

  const buf = Buffer.alloc(55 + payloadLen, 0);

  // Bytes 0-1: MAGIC
  buf.writeUInt16BE(overrides.magic ?? 0x4a50, 0);
  // Byte 2: VERSION
  buf.writeUInt8(overrides.version ?? 0x01, 2);
  // Byte 3: PAYLOAD_TYPE (0x01 = AUDIO)
  buf.writeUInt8(overrides.payloadType ?? 0x01, 3);
  // Byte 4: FLAGS
  buf.writeUInt8(overrides.flags ?? 0x00, 4);
  // Bytes 5-8: SEQUENCE_NO (uint32 BE)
  buf.writeUInt32BE(overrides.sequenceNo ?? 42, 5);
  // Bytes 9-16: TIMESTAMP (int64 BE)
  buf.writeBigInt64BE(overrides.timestamp ?? BigInt(1700000000000), 9);
  // Bytes 17-32: DEVICE_ID (16 bytes UUID)
  const deviceId = Buffer.from(overrides.deviceId ?? Buffer.from('550e8400e29b41d4a716446655440000', 'hex'));
  deviceId.copy(buf, 17);
  // Bytes 33-48: SESSION_ID (16 bytes UUID)
  const sessionId = Buffer.from(overrides.sessionId ?? Buffer.from('661e8400e29b41d4a716446655440001', 'hex'));
  sessionId.copy(buf, 33);
  // Bytes 49-50: PAYLOAD_LEN (uint16 BE)
  buf.writeUInt16BE(payloadLen, 49);
  // Bytes 51-54: CHECKSUM (uint32 BE)
  const checksum = overrides.checksumOverride ?? computeSimpleCrc32(payload);
  buf.writeUInt32BE(checksum, 51);
  // Bytes 55+: PAYLOAD
  Buffer.from(payload).copy(buf, 55);

  return buf;
}

/** Simple test-only CRC32 for building test fixtures */
function computeSimpleCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  for (let i = 0; i < bytes.length; i++) {
    crc = (table[(crc ^ (bytes[i] ?? 0)) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return ((crc ^ 0xffffffff) >>> 0);
}

// ---- Tests ----

describe('deserializePacket()', () => {
  describe('Valid packets', () => {
    it('should parse a valid AUDIO packet with all fields correctly', () => {
      const buf = buildValidPacket({
        payloadType: 0x01,
        sequenceNo: 42,
        timestamp: BigInt(1700000000000),
        payload: new Uint8Array([0xaa, 0xbb, 0xcc]),
      });

      const packet = deserializePacket(buf);

      expect(packet.payloadType).toBe('AUDIO');
      expect(packet.sequenceNo).toBe(42);
      expect(packet.timestamp).toBe(1700000000000);
      expect(packet.payload).toEqual(new Uint8Array([0xaa, 0xbb, 0xcc]));
    });

    it('should parse a valid HEARTBEAT packet with empty payload', () => {
      const buf = buildValidPacket({
        payloadType: 0x02,
        payload: new Uint8Array([]),
      });

      const packet = deserializePacket(buf);

      expect(packet.payloadType).toBe('HEARTBEAT');
      expect(packet.payload.length).toBe(0);
    });

    it('should parse CONTROL payload type', () => {
      const buf = buildValidPacket({ payloadType: 0x03, payload: new Uint8Array([0x10]) });
      const packet = deserializePacket(buf);
      expect(packet.payloadType).toBe('CONTROL');
    });

    it('should parse DIAGNOSTIC payload type', () => {
      const buf = buildValidPacket({ payloadType: 0x04, payload: new Uint8Array([0x01]) });
      const packet = deserializePacket(buf);
      expect(packet.payloadType).toBe('DIAGNOSTIC');
    });
  });

  describe('UUID formatting', () => {
    it('should format DEVICE_ID as xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', () => {
      const buf = buildValidPacket({
        deviceId: Buffer.from('550e8400e29b41d4a716446655440000', 'hex'),
      });

      const packet = deserializePacket(buf);

      expect(packet.deviceId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(packet.deviceId).toBe('550e8400-e29b-41d4-a716-446655440000');
    });

    it('should format SESSION_ID as xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', () => {
      const buf = buildValidPacket({
        sessionId: Buffer.from('661e8400e29b41d4a716446655440001', 'hex'),
      });

      const packet = deserializePacket(buf);

      expect(packet.sessionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(packet.sessionId).toBe('661e8400-e29b-41d4-a716-446655440001');
    });
  });

  describe('SEQUENCE_NO parsing', () => {
    it('should parse SEQUENCE_NO as uint32 big-endian', () => {
      const buf = buildValidPacket({ sequenceNo: 0xdeadbeef });
      const packet = deserializePacket(buf);
      expect(packet.sequenceNo).toBe(0xdeadbeef);
    });

    it('should parse SEQUENCE_NO = 0 correctly', () => {
      const buf = buildValidPacket({ sequenceNo: 0 });
      const packet = deserializePacket(buf);
      expect(packet.sequenceNo).toBe(0);
    });
  });

  describe('CHECKSUM parsing', () => {
    it('should parse CHECKSUM as 8-character lowercase hex string', () => {
      const payload = new Uint8Array([0x01, 0x02, 0x03]);
      const checksum = computeSimpleCrc32(payload);
      const buf = buildValidPacket({ payload, checksumOverride: checksum });

      const packet = deserializePacket(buf);

      expect(packet.checksum).toMatch(/^[0-9a-f]{8}$/);
    });
  });

  describe('Validation errors', () => {
    it('should throw PacketValidationError("Invalid magic bytes") when MAGIC is wrong', () => {
      const buf = buildValidPacket({ magic: 0x1234 });

      expect(() => deserializePacket(buf)).toThrow(PacketValidationError);
      expect(() => deserializePacket(buf)).toThrow('Invalid magic bytes');
    });

    it('should throw PacketValidationError("Unsupported protocol version") when VERSION != 0x01', () => {
      const buf = buildValidPacket({ version: 0x02 });

      expect(() => deserializePacket(buf)).toThrow(PacketValidationError);
      expect(() => deserializePacket(buf)).toThrow('Unsupported protocol version');
    });

    it('should throw PacketValidationError("Unknown payload type") for unknown type codes', () => {
      const buf = buildValidPacket({ payloadType: 0xff });

      expect(() => deserializePacket(buf)).toThrow(PacketValidationError);
      expect(() => deserializePacket(buf)).toThrow('Unknown payload type');
    });

    it('should throw PacketValidationError("Payload length mismatch") when declared len > actual bytes', () => {
      // Build a packet that says payload is 10 bytes but only provide 3
      const buf = buildValidPacket({ payload: new Uint8Array([0xaa, 0xbb, 0xcc]) });
      // Overwrite PAYLOAD_LEN to claim 10 bytes
      buf.writeUInt16BE(10, 49);

      expect(() => deserializePacket(buf)).toThrow(PacketValidationError);
      expect(() => deserializePacket(buf)).toThrow('Payload length mismatch');
    });

    it('should throw PacketValidationError("Packet too short") when buffer < 55 bytes', () => {
      const shortBuf = Buffer.alloc(30, 0);

      expect(() => deserializePacket(shortBuf)).toThrow(PacketValidationError);
      expect(() => deserializePacket(shortBuf)).toThrow('Packet too short');
    });

    it('should include context in PacketValidationError for wrong MAGIC', () => {
      const buf = buildValidPacket({ magic: 0x0000 });

      try {
        deserializePacket(buf);
        fail('Expected PacketValidationError to be thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(PacketValidationError);
        const validationErr = err as PacketValidationError;
        expect(validationErr.context).toBeDefined();
        expect(validationErr.context['magic']).toBeDefined();
      }
    });
  });
});
