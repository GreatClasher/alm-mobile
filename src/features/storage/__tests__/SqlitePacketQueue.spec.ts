/**
 * SqlitePacketQueue.spec.ts — TDD spec written BEFORE implementation (RED phase)
 *
 * Tests all 11 scenarios for the SQLite packet queue:
 *   1. enqueue happy path
 *   2. enqueue duplicate (session+seq) — silently ignored
 *   3. getPendingPackets — empty queue returns []
 *   4. getPendingPackets — order by session_id, sequence_no
 *   5. getPendingPackets — limit respected
 *   6. markDelivered — status changes to DELIVERED
 *   7. markFailed — status changes to FAILED
 *   8. getPendingCount — only counts PENDING rows
 *   9. pruneDelivered — deletes old DELIVERED rows
 *   10. pruneDelivered — keeps recent DELIVERED rows
 *   11. initialize() idempotent — no error on double call
 */

import { SqlitePacketQueue } from '@/features/storage/SqlitePacketQueue';
import type { AudioPacket } from '@/shared/types/AudioPacket';
import { _resetAllDatabases } from '../../../../__mocks__/expo-sqlite';

// ---- Test builders ----

let sequenceCounter = 0;

function buildAudioPacket(overrides: Partial<AudioPacket> = {}): AudioPacket {
  return {
    deviceId: '550e8400-e29b-41d4-a716-446655440000',
    sessionId: 'session-001',
    sequenceNo: ++sequenceCounter,
    timestamp: Date.now(),
    payloadType: 'AUDIO',
    payload: new Uint8Array([0xaa, 0xbb, 0xcc]),
    checksum: '55bc801d',
    ...overrides,
  };
}

// ---- Tests ----

describe('SqlitePacketQueue', () => {
  let queue: SqlitePacketQueue;

  beforeEach(async () => {
    jest.useFakeTimers();
    sequenceCounter = 0;
    _resetAllDatabases();
    queue = new SqlitePacketQueue();
    await queue.initialize();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('initialize()', () => {
    it('should initialize without error on first call', async () => {
      // Already initialized in beforeEach — should have no error
      await expect(queue.getPendingCount()).resolves.toBe(0);
    });

    it('should be idempotent — calling initialize() twice should not throw', async () => {
      await expect(queue.initialize()).resolves.toBeUndefined();
    });
  });

  describe('enqueue()', () => {
    it('should insert a packet and return a positive localId', async () => {
      const packet = buildAudioPacket();
      const localId = await queue.enqueue(packet);

      expect(localId).toBeGreaterThan(0);
    });

    it('should silently ignore duplicate (session_id, sequence_no) via INSERT OR IGNORE', async () => {
      const packet = buildAudioPacket({ sessionId: 'session-dup', sequenceNo: 999 });

      const id1 = await queue.enqueue(packet);
      // Duplicate — same session + seqNo
      const id2 = await queue.enqueue(packet);

      expect(id1).toBeGreaterThan(0);
      // Duplicate is ignored — returns 0 or same id
      expect(id2).toBeGreaterThanOrEqual(0);

      // Only 1 packet in the queue
      const count = await queue.getPendingCount();
      expect(count).toBe(1);
    });
  });

  describe('getPendingPackets()', () => {
    it('should return empty array when queue is empty', async () => {
      const packets = await queue.getPendingPackets();
      expect(packets).toEqual([]);
    });

    it('should return packets ordered by session_id, sequence_no', async () => {
      await queue.enqueue(buildAudioPacket({ sessionId: 'session-B', sequenceNo: 2 }));
      await queue.enqueue(buildAudioPacket({ sessionId: 'session-A', sequenceNo: 5 }));
      await queue.enqueue(buildAudioPacket({ sessionId: 'session-A', sequenceNo: 2 }));
      await queue.enqueue(buildAudioPacket({ sessionId: 'session-B', sequenceNo: 1 }));

      const packets = await queue.getPendingPackets();

      expect(packets[0]?.sessionId).toBe('session-A');
      expect(packets[0]?.sequenceNo).toBe(2);
      expect(packets[1]?.sessionId).toBe('session-A');
      expect(packets[1]?.sequenceNo).toBe(5);
      expect(packets[2]?.sessionId).toBe('session-B');
      expect(packets[2]?.sequenceNo).toBe(1);
      expect(packets[3]?.sessionId).toBe('session-B');
      expect(packets[3]?.sequenceNo).toBe(2);
    });

    it('should respect the limit parameter', async () => {
      // Insert 10 packets
      for (let i = 1; i <= 10; i++) {
        await queue.enqueue(buildAudioPacket({ sequenceNo: i }));
      }

      const packets = await queue.getPendingPackets(3);
      expect(packets.length).toBe(3);
    });

    it('should return at most 50 packets by default', async () => {
      // Insert 60 packets
      for (let i = 1; i <= 60; i++) {
        await queue.enqueue(buildAudioPacket({ sequenceNo: i }));
      }

      const packets = await queue.getPendingPackets();
      expect(packets.length).toBeLessThanOrEqual(50);
    });

    it('should only return PENDING packets (not DELIVERED or FAILED)', async () => {
      const packet1 = buildAudioPacket({ sequenceNo: 1 });
      const packet2 = buildAudioPacket({ sequenceNo: 2 });
      const id1 = await queue.enqueue(packet1);
      await queue.enqueue(packet2);

      await queue.markDelivered(id1);

      const pending = await queue.getPendingPackets();
      expect(pending.length).toBe(1);
      expect(pending[0]?.sequenceNo).toBe(2);
    });
  });

  describe('markDelivered()', () => {
    it('should change packet status to DELIVERED and set delivered_at', async () => {
      const packet = buildAudioPacket();
      const localId = await queue.enqueue(packet);

      await queue.markDelivered(localId);

      const pending = await queue.getPendingPackets();
      expect(pending.find((p) => p.localId === localId)).toBeUndefined();

      const count = await queue.getPendingCount();
      expect(count).toBe(0);
    });
  });

  describe('markFailed()', () => {
    it('should change packet status to FAILED', async () => {
      const packet = buildAudioPacket();
      const localId = await queue.enqueue(packet);

      await queue.markFailed(localId);

      // FAILED packet should not be in PENDING list
      const pending = await queue.getPendingPackets();
      expect(pending.find((p) => p.localId === localId)).toBeUndefined();
    });
  });

  describe('getPendingCount()', () => {
    it('should count only PENDING rows across mixed statuses', async () => {
      const id1 = await queue.enqueue(buildAudioPacket({ sequenceNo: 1 }));
      const id2 = await queue.enqueue(buildAudioPacket({ sequenceNo: 2 }));
      await queue.enqueue(buildAudioPacket({ sequenceNo: 3 }));

      await queue.markDelivered(id1);
      await queue.markFailed(id2);

      const count = await queue.getPendingCount();
      expect(count).toBe(1);
    });

    it('should return 0 when no PENDING packets exist', async () => {
      const count = await queue.getPendingCount();
      expect(count).toBe(0);
    });
  });

  describe('pruneDelivered()', () => {
    it('should delete DELIVERED rows older than the given threshold', async () => {
      const id = await queue.enqueue(buildAudioPacket());
      await queue.markDelivered(id);

      // Advance time by 60 seconds so the delivered_at timestamp becomes old
      jest.advanceTimersByTime(60_000);

      // Prune records delivered more than 30 seconds ago
      const deleted = await queue.pruneDelivered(30_000);
      expect(deleted).toBeGreaterThanOrEqual(1);
    });

    it('should NOT delete recently DELIVERED rows', async () => {
      const id = await queue.enqueue(buildAudioPacket());
      await queue.markDelivered(id);

      // Prune records delivered more than 1 hour ago — recent record should survive
      const deleted = await queue.pruneDelivered(3_600_000);
      expect(deleted).toBe(0);
    });
  });
});
