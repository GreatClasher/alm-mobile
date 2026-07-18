/**
 * CRC32 checksum utility — MUST match java.util.zip.CRC32 algorithm.
 *
 * Cross-platform test vector:
 *   crc32([0x01, 0x02, 0x03]) === 0x55BC801D === 1438416925
 *   Expected hex string: "55bc801d"
 *
 * This matches:
 *   - Kotlin: CRC32Util.compute(byteArrayOf(1, 2, 3)) == 0x55BC801DL
 *   - Backend: checksumUtil.crc32(Buffer.from([1, 2, 3])) == "55bc801d"
 *
 * Algorithm: ISO 3309 / ITU-T V.42 CRC-32 (same as PKZIP, gzip, Java's java.util.zip.CRC32)
 * Polynomial: 0xEDB88320 (reflected form of 0x04C11DB7)
 */

// Pre-computed CRC32 lookup table (reflected polynomial 0xEDB88320)
const CRC32_TABLE: Uint32Array = buildCrc32Table();

function buildCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  return table;
}

/**
 * Compute CRC32 of a byte array.
 * Returns the checksum as an unsigned 32-bit integer.
 *
 * Test vector: crc32([0x01, 0x02, 0x03]) === 0x55BC801D (1438416925)
 */
export function crc32(bytes: Uint8Array | ReadonlyArray<number>): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i] ?? 0;
    crc = (CRC32_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  // Return as unsigned 32-bit integer
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Compute CRC32 and return as zero-padded 8-character hex string.
 * Example: crc32Hex([0x01, 0x02, 0x03]) === "55bc801d"
 */
export function crc32Hex(bytes: Uint8Array | ReadonlyArray<number>): string {
  return crc32(bytes).toString(16).padStart(8, '0');
}

/**
 * Verify that the CRC32 of the given payload matches the expected checksum string.
 *
 * @param payload - The raw payload bytes
 * @param checksumHex - Expected CRC32 as 8-char hex string (e.g. "55bc801d")
 * @returns true if checksum matches, false otherwise
 */
export function verifyChecksum(
  payload: Uint8Array | ReadonlyArray<number>,
  checksumHex: string,
): boolean {
  const computed = crc32Hex(payload);
  return computed === checksumHex.toLowerCase().padStart(8, '0');
}
