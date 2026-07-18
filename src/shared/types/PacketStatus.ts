/**
 * PacketStatus — lifecycle state of a packet in the local SQLite queue.
 * PENDING → DELIVERED (on ACK from backend)
 * FAILED is only used for unrecoverable protocol errors (not network errors)
 */
export const PacketStatus = {
  PENDING: 'PENDING',
  DELIVERED: 'DELIVERED',
  FAILED: 'FAILED',
} as const;
export type PacketStatus = (typeof PacketStatus)[keyof typeof PacketStatus];
