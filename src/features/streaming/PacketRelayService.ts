import { SqlitePacketQueue } from '../storage/SqlitePacketQueue';
import { WebSocketClient } from './WebSocketClient';
import { MobileLogger } from '@/shared/utils/logger';
import { RELAY_BATCH_SIZE } from '@/shared/constants/ble.constants';

export class PacketRelayService {
  private isReplaying = false;

  constructor(
    private readonly sqliteQueue: SqlitePacketQueue,
    private readonly wsClient: WebSocketClient,
    private readonly logger: MobileLogger,
  ) {}

  async triggerReplay(): Promise<void> {
    if (!this.wsClient.isConnected) return;
    if (this.isReplaying) return;
    this.isReplaying = true;

    try {
      while (this.wsClient.isConnected) {
        const packets = await this.sqliteQueue.getPendingPackets(RELAY_BATCH_SIZE);
        if (packets.length === 0) break;
        if (!this.wsClient.isConnected) break;
        
        try {
          await this.wsClient.sendPacketBatch(packets);
          // Only mark as delivered if the entire batch was accepted
          const localIds = packets.map(p => p.localId);
          await this.sqliteQueue.markDeliveredBatch(localIds);
        } catch (error) {
          this.logger.error({ error, batchSize: packets.length }, 'Batch relay failed');
          return; // stop relay on error, wait for next trigger
        }
      }
    } catch (dbError) {
      this.logger.error({ error: dbError }, 'Failed to read packets from queue');
    } finally {
      this.isReplaying = false;
    }
  }
}
