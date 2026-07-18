import type { AudioPacket } from '@/shared/types/AudioPacket';
import { MobileLogger } from '@/shared/utils/logger';
import { authenticatedFetch } from '@/shared/utils/apiClient';

export class HeartbeatForwarder {
  constructor(private readonly logger: MobileLogger) {}

  async forwardHeartbeat(packet: AudioPacket, bleConnected: boolean, pendingPackets: number): Promise<void> {
    if (packet.payloadType !== 'HEARTBEAT') {
      return;
    }

    const baseUrl = process.env.EXPO_PUBLIC_API_BASE_URL || 'https://api.jabbelpin.com/v1';
    const url = `${baseUrl}/devices/${packet.deviceId}/heartbeat`;

    try {
      this.logger.debug({ deviceId: packet.deviceId }, 'Forwarding heartbeat');
      
      let batteryLevel: number | null = null;
      if (packet.payload && packet.payload.length > 0) {
        batteryLevel = packet.payload[0] ?? null;
      }

      const response = await authenticatedFetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          timestamp: packet.timestamp,
          batteryLevel,
          bleConnected,
          pendingPackets
        })
      });

      if (response.ok) {
        const data = await response.json();
        this.logger.info({ serverTime: data.serverTime }, 'Heartbeat forwarded successfully');
      } else if (response.status === 404) {
        this.logger.warn({ status: response.status }, 'Device not found on backend (404)');
      } else {
        this.logger.warn({ status: response.status }, 'Failed to forward heartbeat');
      }
    } catch (error) {
      this.logger.error({ error }, 'Network error forwarding heartbeat');
    }
  }
}
