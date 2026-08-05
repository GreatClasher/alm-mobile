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

    const token = useConnectionStore.getState().authToken;
    if (!token) {
      logger.error('No auth token available for WebSocket connection — will retry after token refresh');
      // Kick off a refresh, then reconnect once we have a token
      DeviceAuthManager.refreshToken()
        .then(() => this.connect())
        .catch(err => logger.error({ err }, 'Token refresh failed, cannot connect WS'));
      return;
    }

    logger.info({ wsUrl }, 'Connecting to WebSocket...');

    this.socket = io(`${wsUrl}/device`, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      // Use a callback instead of a static object so socket.io fetches
      // the LATEST token on every reconnect attempt (not just the first).
      auth: (cb: (data: object) => void) => {
        const currentToken = useConnectionStore.getState().authToken;
        if (currentToken) {
          cb({ token: currentToken });
        } else {
          // Token gone mid-session — refresh then callback
          DeviceAuthManager.refreshToken()
            .then(newToken => cb({ token: newToken }))
            .catch(() => cb({ token: '' }));
        }
      },
    });

    this.socket.on('connect', this.handleConnect.bind(this));
    this.socket.on('disconnect', this.handleDisconnect.bind(this));
    this.socket.on('connect_error', this.handleConnectError.bind(this));
    this.socket.on('auth_error', (error: { message: string }) => {
      this.handleConnectError(new Error(error?.message || 'jwt expired'));
    });

    this.socket.on('assistant:response', (payload: { answer: string, prompt?: string }) => {
      logger.info({ payload }, 'Received assistant response');
      const { setFastLaneStage, setAssistantMessage, setAssistantPrompt } = useConnectionStore.getState();
      
      setAssistantMessage(payload.answer);
      if (payload.prompt) {
        setAssistantPrompt(payload.prompt);
      }
      setFastLaneStage('answering');
      
      // Clear stage after showing answer
      setTimeout(() => {
        setFastLaneStage('done');
        setTimeout(() => setFastLaneStage('idle'), 3000);
      }, 5000);
    });
  }

  get isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  async sendPacket(packet: StoredPacket): Promise<{ status: string; packetId?: string }> {
    if (!this.isConnected || !this.socket) {
      throw new WebSocketSendError('not connected');
    }

    const { addPttLog, incrementPacketsSent } = useConnectionStore.getState();
    const byteSize = packet.payload?.length;

    return new Promise((resolve, reject) => {
      const jsonPacket = {
        ...packet,
        payload: Buffer.from(packet.payload).toString('base64')
      };

      this.socket!.timeout(5000).emit('audio:packet', jsonPacket, (err: Error | null, response: any) => {
        if (err) {
          logger.error({ error: err }, 'WebSocket send timeout');
          addPttLog({ timestamp: Date.now(), direction: 'sent', status: 'error', byteSize });
          return reject(new WebSocketSendError('timeout'));
        }

        if (response?.status === 'rejected') {
          logger.error({ response }, 'Packet rejected by server');
          addPttLog({ timestamp: Date.now(), direction: 'sent', status: 'error', byteSize });
          return reject(new WebSocketSendError('rejected'));
        }

        incrementPacketsSent();
        addPttLog({ timestamp: Date.now(), direction: 'sent', status: 'ok', packetId: response?.packetId, byteSize });
        resolve(response);
      });
    });
  }

  async sendPacketBatch(packets: StoredPacket[]): Promise<{ status: string; count: number }> {
    if (!this.isConnected || !this.socket) {
      throw new WebSocketSendError('not connected');
    }

    const { addPttLog, incrementPacketsSent } = useConnectionStore.getState();

    return new Promise((resolve, reject) => {
      const batch = packets.map(p => ({
        ...p,
        payload: Buffer.from(p.payload).toString('base64')
      }));

      this.socket!.timeout(10000).emit('audio:packets:batch', { packets: batch }, (err: Error | null, response: any) => {
        if (err) {
          logger.error({ error: err }, 'WebSocket batch send timeout');
          // Log each packet in the batch as failed
          for (const p of packets) {
            addPttLog({ timestamp: Date.now(), direction: 'sent', status: 'error', byteSize: p.payload?.length });
          }
          return reject(new WebSocketSendError('timeout'));
        }
        if (response?.status === 'rejected') {
          logger.error({ response }, 'Packet batch rejected by server');
          for (const p of packets) {
            addPttLog({ timestamp: Date.now(), direction: 'sent', status: 'error', byteSize: p.payload?.length });
          }
          return reject(new WebSocketSendError('rejected'));
        }
        // Success — log each packet as sent
        for (const p of packets) {
          incrementPacketsSent();
          addPttLog({ timestamp: Date.now(), direction: 'sent', status: 'ok', byteSize: p.payload?.length });
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

    const msg = error.message.toLowerCase();
    const isAuthError = msg.includes('unauthorized') || msg.includes('jwt') || msg.includes('missing token') || msg.includes('401');

    if (isAuthError) {
      logger.warn('WebSocket auth error — re-initializing device auth (full re-register if needed)');
      // initialize() checks the stored token; if expired or missing it calls registerDevice()
      // The auth callback will pick up the fresh token on the next auto-reconnect.
      DeviceAuthManager.initialize().catch(err =>
        logger.error({ err }, 'Failed to re-initialize auth during WS reconnect'),
      );
    }
  }
}
