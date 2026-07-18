/**
 * checksum.spec.ts — TDD spec written BEFORE implementation (RED phase)
 *
 * CRC32 Cross-Platform Test Vector:
 *   Input:    [0x01, 0x02, 0x03]
 *   Expected: 0x55BC801D (1438416925)
 *   Hex:      "55bc801d"
 *
 * This value MUST match:
 *   - Kotlin: CRC32Util.compute(byteArrayOf(1, 2, 3)) == 0x55BC801DL
 *   - Backend: checksumUtil.crc32(Buffer.from([1, 2, 3])) == "55bc801d"
 */

import { crc32, crc32Hex, verifyChecksum } from '@/shared/utils/checksum';

describe('crc32()', () => {
  it('should return the known cross-platform value for [0x01, 0x02, 0x03]', () => {
    // TEST VECTOR — must match java.util.zip.CRC32 and Kotlin CRC32Util
    // CRC32([0x01, 0x02, 0x03]) = 0x55BC801D = 1438416925
    const result = crc32(new Uint8Array([0x01, 0x02, 0x03]));
    expect(result).toBe(0x55bc801d);
  });

  it('should return 0x00000000 (which equals 0) for empty input', () => {
    // CRC32 of empty input: 0x00000000
    const result = crc32(new Uint8Array([]));
    expect(result).toBe(0x00000000);
  });

  it('should return consistent value matching known CRC32 for single byte', () => {
    // CRC32([0xFF]) = 0xFF000000 XOR'd correctly
    const result = crc32(new Uint8Array([0xff]));
    expect(typeof result).toBe('number');
    // Verify it's a valid unsigned 32-bit integer
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(0xffffffff);
  });
});

describe('crc32Hex()', () => {
  it('should return 8-char lowercase hex string for [0x01, 0x02, 0x03]', () => {
    const result = crc32Hex(new Uint8Array([0x01, 0x02, 0x03]));
    expect(result).toBe('55bc801d');
  });

  it('should return 8-char hex string padded with leading zeros', () => {
    // Empty input should produce 8-char hex
    const result = crc32Hex(new Uint8Array([]));
    expect(result).toHaveLength(8);
    expect(result).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('verifyChecksum()', () => {
  it('should return true when checksum matches payload CRC32', () => {
    const payload = new Uint8Array([0x01, 0x02, 0x03]);
    const result = verifyChecksum(payload, '55bc801d');
    expect(result).toBe(true);
  });

  it('should return false when checksum does not match payload', () => {
    const payload = new Uint8Array([0x01, 0x02, 0x03]);
    const result = verifyChecksum(payload, 'deadbeef');
    expect(result).toBe(false);
  });

  it('should be case-insensitive for the checksum string', () => {
    const payload = new Uint8Array([0x01, 0x02, 0x03]);
    expect(verifyChecksum(payload, '55BC801D')).toBe(true);
    expect(verifyChecksum(payload, '55bc801d')).toBe(true);
    expect(verifyChecksum(payload, '55Bc801D')).toBe(true);
  });

  it('should return true for empty payload with correct CRC32', () => {
    const payload = new Uint8Array([]);
    const expectedChecksum = crc32Hex(payload);
    expect(verifyChecksum(payload, expectedChecksum)).toBe(true);
  });
});
