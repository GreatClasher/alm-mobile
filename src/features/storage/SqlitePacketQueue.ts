import * as SQLite from 'expo-sqlite';
import { MobileLogger } from '@/shared/utils/logger';
import type { AudioPacket, StoredPacket, PacketPayloadType } from '@/shared/types/AudioPacket';
import type { PacketStatus } from '@/shared/types/PacketStatus';

const logger = new MobileLogger('SqlitePacketQueue');
const DB_NAME = 'jabbelpin.db';

export class SqlitePacketQueue {
  private db: SQLite.SQLiteDatabase | null = null;

  constructor(private readonly onChange?: () => void) {}

  private notifyTimeout: NodeJS.Timeout | null = null;

  private notifyChange() {
    if (this.onChange) {
      if (this.notifyTimeout) return;
      this.notifyTimeout = setTimeout(() => {
        this.notifyTimeout = null;
        try {
          if (this.onChange) this.onChange();
        } catch (e) {}
      }, 1000);
    }
  }

  async initialize(): Promise<void> {
    if (this.db) {
      return;
    }

    try {
      logger.info('Initializing SQLite database');
      this.db = await SQLite.openDatabaseAsync(DB_NAME);

      // Execute migration
      await this.db.execAsync(`
        CREATE TABLE IF NOT EXISTS packet_queue (
          local_id INTEGER PRIMARY KEY AUTOINCREMENT,
          device_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          sequence_no INTEGER NOT NULL,
          payload_type TEXT NOT NULL,
          payload TEXT NOT NULL,         -- base64-encoded Uint8Array bytes
          checksum TEXT NOT NULL,        -- CRC32 as 8-char hex string
          timestamp INTEGER NOT NULL,    -- Unix milliseconds from watch
          status TEXT NOT NULL DEFAULT 'PENDING',
          received_at INTEGER NOT NULL,  -- Unix milliseconds when received by phone
          delivered_at INTEGER,          -- Unix milliseconds when ACK'd by backend, NULL until then
          UNIQUE(session_id, sequence_no)
        );

        CREATE INDEX IF NOT EXISTS idx_packet_queue_status
          ON packet_queue(status);

        CREATE INDEX IF NOT EXISTS idx_packet_queue_session_seq
          ON packet_queue(session_id, sequence_no);
      `);
      logger.info('SQLite database initialized successfully');
    } catch (error) {
      logger.error({ error }, 'Failed to initialize SQLite database');
      throw error;
    }
  }

  private requireDb(): SQLite.SQLiteDatabase {
    if (!this.db) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    return this.db;
  }

  // removed manual base64 functions

  private packetBuffer: AudioPacket[] = [];
  private flushTimeout: NodeJS.Timeout | null = null;
  private isFlushing = false;

  async enqueue(packet: AudioPacket): Promise<void> {
    this.packetBuffer.push(packet);
    
    if (this.packetBuffer.length >= 50) {
      this.flushBuffer();
    } else if (!this.flushTimeout) {
      this.flushTimeout = setTimeout(() => this.flushBuffer(), 200);
    }
  }

  private async flushBuffer() {
    if (this.isFlushing || this.packetBuffer.length === 0) return;
    this.isFlushing = true;
    
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
      this.flushTimeout = null;
    }

    const packetsToInsert = [...this.packetBuffer];
    this.packetBuffer = [];
    
    try {
      const db = this.requireDb();
      await db.withTransactionAsync(async () => {
        for (const packet of packetsToInsert) {
          const payloadBase64 = Buffer.from(packet.payload).toString('base64');
          await db.runAsync(
            `
              INSERT OR IGNORE INTO packet_queue (
                device_id, session_id, sequence_no, payload_type, payload, checksum, timestamp, status, received_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
              packet.deviceId,
              packet.sessionId,
              packet.sequenceNo,
              packet.payloadType,
              payloadBase64,
              packet.checksum,
              packet.timestamp,
              'PENDING',
              Date.now()
            ]
          );
        }
      });
      
      this.notifyChange();
    } catch (error) {
      logger.error({ error, count: packetsToInsert.length }, 'Failed to flush packet buffer');
    } finally {
      this.isFlushing = false;
      if (this.packetBuffer.length > 0 && !this.flushTimeout) {
        this.flushTimeout = setTimeout(() => this.flushBuffer(), 200);
      }
    }
  }

  async getPendingPackets(limit: number = 500): Promise<StoredPacket[]> {
    const db = this.requireDb();
    
    try {
      const rows = await db.getAllAsync<any>(
        `
          SELECT 
            local_id, device_id, session_id, sequence_no, payload_type, 
            payload, checksum, timestamp, status, received_at, delivered_at
          FROM packet_queue
          WHERE status = ?
          ORDER BY session_id ASC, sequence_no ASC
          LIMIT ?
        `,
        ['PENDING', limit]
      );

      return rows.map((row: any) => ({
        localId: row.local_id,
        deviceId: row.device_id,
        sessionId: row.session_id,
        sequenceNo: row.sequence_no,
        payloadType: row.payload_type as PacketPayloadType,
        payload: new Uint8Array(Buffer.from(row.payload, 'base64')),
        checksum: row.checksum,
        timestamp: row.timestamp,
        status: row.status as PacketStatus,
        receivedAt: row.received_at,
        deliveredAt: row.delivered_at
      }));
    } catch (error) {
      logger.error({ error }, 'Failed to get pending packets');
      throw error;
    }
  }

  async markDelivered(localId: number): Promise<void> {
    const db = this.requireDb();
    
    try {
      await db.runAsync(
        `
          UPDATE packet_queue
          SET status = ?, delivered_at = ?
          WHERE local_id = ?
        `,
        ['DELIVERED', Date.now(), localId]
      );
      this.notifyChange();
    } catch (error) {
      logger.error({ error, localId }, 'Failed to mark packet as delivered');
      throw error;
    }
  }

  async markDeliveredBatch(localIds: number[]): Promise<void> {
    if (localIds.length === 0) return;
    const db = this.requireDb();
    
    try {
      // Create a string of placeholders (?, ?, ...)
      const placeholders = localIds.map(() => '?').join(',');
      await db.runAsync(
        `
          UPDATE packet_queue
          SET status = ?, delivered_at = ?
          WHERE local_id IN (${placeholders})
        `,
        ['DELIVERED', Date.now(), ...localIds]
      );
      this.notifyChange();
    } catch (error) {
      logger.error({ error, batchSize: localIds.length }, 'Failed to mark packet batch as delivered');
      throw error;
    }
  }

  async markFailed(localId: number): Promise<void> {
    const db = this.requireDb();
    
    try {
      await db.runAsync(
        `
          UPDATE packet_queue
          SET status = ?
          WHERE local_id = ?
        `,
        ['FAILED', localId]
      );
      this.notifyChange();
    } catch (error) {
      logger.error({ error, localId }, 'Failed to mark packet as failed');
      throw error;
    }
  }

  async getPendingCount(): Promise<number> {
    const db = this.requireDb();
    
    try {
      const result = await db.getFirstAsync<{ count: number }>(
        `SELECT COUNT(*) as count FROM packet_queue WHERE status = ?`,
        ['PENDING']
      );
      
      return result?.count ?? 0;
    } catch (error) {
      logger.error({ error }, 'Failed to get pending count');
      throw error;
    }
  }

  async pruneDelivered(retentionMs: number): Promise<number> {
    const db = this.requireDb();
    
    try {
      const threshold = Date.now() - retentionMs;
      
      const result = await db.runAsync(
        `
          DELETE FROM packet_queue
          WHERE status = ? AND delivered_at < ?
        `,
        ['DELIVERED', threshold]
      );
      
      if (result.changes > 0) {
        this.notifyChange();
      }
      return result.changes;
    } catch (error) {
      logger.error({ error, retentionMs }, 'Failed to prune delivered packets');
      throw error;
    }
  }

  async enforceMaxSize(maxPackets: number): Promise<number> {
    const db = this.requireDb();
    
    try {
      const currentCount = await this.getPendingCount();
      if (currentCount <= maxPackets) {
        return 0;
      }
      
      const excess = currentCount - maxPackets;
      
      // Delete oldest PENDING packets to bring count down to maxPackets
      const result = await db.runAsync(
        `
          DELETE FROM packet_queue
          WHERE local_id IN (
            SELECT local_id FROM packet_queue
            WHERE status = ?
            ORDER BY timestamp ASC
            LIMIT ?
          )
        `,
        ['PENDING', excess]
      );
      
      if (result.changes > 0) {
        this.notifyChange();
        logger.warn({ dropped: result.changes, maxPackets }, 'Dropped oldest pending packets to enforce max size');
      }
      return result.changes;
    } catch (error) {
      logger.error({ error, maxPackets }, 'Failed to enforce max size on queue');
      throw error;
    }
  }
}
