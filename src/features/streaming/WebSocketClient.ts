import { io, Socket } from 'socket.io-client';
import { Buffer } from 'buffer';
import { MobileLogger } from '@/shared/utils/logger';
import { WebSocketSendError } from '@/shared/errors/WebSocketSendError';
import type { StoredPacket } from '@/shared/types/AudioPacket';
import { useConnectionStore } from '@/stores/connectionStore';
import { DeviceAuthManager } from '@/features/auth/DeviceAuthManager';

const logger = new MobileLogger('WebSocketClient');

export class WebSocketClient {
  private socket: Socket | null = null;
  private isIntentionalDisconnect = false;

  connect(): void {
    if (this.socket) {
      logger.warn('Socket already initialized');
      return;
    }

    const wsUrl = process.env.EXPO_PUBLIC_WS_URL || 'ws://localhost:3000';
    this.isIntentionalDisconnect = false;

    logger.info({ wsUrl }, 'Connecting to WebSocket...');
    const token = useConnectionStore.getState().authToken;
    if (!token) {
      logger.error('No auth token available for WebSocket connection');
      return;
    }

    this.socket = io(`${wsUrl}/device`, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      auth: {
        token
      }
    });

    this.socket.on('connect', this.handleConnect.bind(this));
    this.socket.on('disconnect', this.handleDisconnect.bind(this));
    this.socket.on('connect_error', this.handleConnectError.bind(this));
    this.socket.on('auth_error', (error: { message: string }) => {
      this.handleConnectError(new Error(error?.message || 'jwt expired'));
    });
  }

  get isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  async sendPacket(packet: StoredPacket): Promise<{ status: string; packetId?: string }> {
    if (!this.isConnected || !this.socket) {
      throw new WebSocketSendError('not connected');
    }

    return new Promise((resolve, reject) => {
      const jsonPacket = {
        ...packet,
        payload: Buffer.from(packet.payload).toString('base64')
      };

      this.socket!.timeout(5000).emit('audio:packet', jsonPacket, (err: Error | null, response: any) => {
        if (err) {
          logger.error({ error: err }, 'WebSocket send timeout');
          return reject(new WebSocketSendError('timeout'));
        }

        if (response?.status === 'rejected') {
          logger.error({ response }, 'Packet rejected by server');
          return reject(new WebSocketSendError('rejected'));
        }

        resolve(response);
      });
    });
  }

  async sendPacketBatch(packets: StoredPacket[]): Promise<{ status: string; count: number }> {
    if (!this.isConnected || !this.socket) {
      throw new WebSocketSendError('not connected');
    }

    return new Promise((resolve, reject) => {
      const batch = packets.map(p => ({
        ...p,
        payload: Buffer.from(p.payload).toString('base64')
      }));

      this.socket!.timeout(10000).emit('audio:packets:batch', { packets: batch }, (err: Error | null, response: any) => {
        if (err) {
          logger.error({ error: err }, 'WebSocket batch send timeout');
          return reject(new WebSocketSendError('timeout'));
        }
        if (response?.status === 'rejected') {
          logger.error({ response }, 'Packet batch rejected by server');
          return reject(new WebSocketSendError('rejected'));
        }
        resolve(response);
      });
    });
  }

  /**
   * Send a batch of health metrics to the server.
   * Reuses the same authenticated socket as audio packets — no separate connection needed.
   * Emits: health:metrics:batch  { metrics: HealthMetricPayload[] }
   */
  async sendHealthBatch(
    metrics: Array<{ metricType: string; value: Record<string, unknown>; recordedAt: string }>,
  ): Promise<{ status: string; saved: number }> {
    if (!this.isConnected || !this.socket) {
      throw new WebSocketSendError('not connected');
    }

    return new Promise((resolve, reject) => {
      this.socket!.timeout(10000).emit(
        'health:metrics:batch',
        { metrics },
        (err: Error | null, response: any) => {
          if (err) {
            logger.error({ error: err }, 'Health metrics batch send timeout');
            return reject(new WebSocketSendError('timeout'));
          }
          if (response?.status === 'error') {
            return reject(new WebSocketSendError('rejected'));
          }
          resolve(response);
        },
      );
    });
  }

  disconnect(): void {
    logger.info('Disconnecting WebSocket explicitly');
    this.isIntentionalDisconnect = true;

    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  onOtaAvailable(callback: (payload: any) => void): void {
    if (this.socket) {
      this.socket.on('ota:available', callback);
    }
  }


  private handleConnect(): void {
    logger.info('WebSocket connected successfully');
    useConnectionStore.getState().setWsConnected(true);
  }

  private handleDisconnect(reason: string): void {
    logger.warn({ reason }, 'WebSocket disconnected');
    useConnectionStore.getState().setWsConnected(false);
  }

  private handleConnectError(error: Error): void {
    logger.error({ error }, 'WebSocket connection error');
    useConnectionStore.getState().setWsConnected(false);

    // If it's an authentication error (e.g., token expired)
    if (error.message.toLowerCase().includes('unauthorized') || error.message.toLowerCase().includes('jwt')) {
      logger.warn('WebSocket authentication failed. Attempting to refresh token...');
      DeviceAuthManager.refreshToken().then((newToken) => {
        if (this.socket) {
          logger.info('Got new token from refresh, updating socket and reconnecting');
          // Safely update the socket's auth token for future reconnection attempts
          if (this.socket.auth && typeof this.socket.auth === 'object') {
            (this.socket.auth as any).token = newToken;
          } else {
            this.socket.auth = { token: newToken };
          }
          this.socket.connect();
        }
      }).catch(err => {
        logger.error({ err }, 'Failed to refresh token during WS reconnect');
      });
    }
  }
}
