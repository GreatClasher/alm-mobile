import { WebSocketClient } from '../WebSocketClient';
import { WebSocketSendError } from '@/shared/errors/WebSocketSendError';
import type { StoredPacket } from '@/shared/types/AudioPacket';

// Mock Socket.IO
const mockEmit = jest.fn();
const mockOn = jest.fn();
const mockDisconnect = jest.fn();
const mockConnect = jest.fn();

let mockConnected = false;

const mockSocket = {
  get connected() {
    return mockConnected;
  },
  emit: mockEmit,
  on: mockOn,
  disconnect: mockDisconnect,
  connect: mockConnect,
  timeout: jest.fn().mockReturnThis(),
};

jest.mock('socket.io-client', () => {
  return {
    io: jest.fn(() => mockSocket)
  };
});

jest.useFakeTimers();

describe('WebSocketClient', () => {
  let client: WebSocketClient;
  let mockPacket: StoredPacket;
  let setTimeoutSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    mockConnected = false;
    process.env.EXPO_PUBLIC_WS_URL = 'wss://api.jabbelpin.com';
    
    mockPacket = {
      localId: 1,
      deviceId: 'dev1',
      sessionId: 'ses1',
      sequenceNo: 1,
      timestamp: 1000,
      payloadType: 'AUDIO',
      payload: new Uint8Array(),
      checksum: 'abc',
      status: 'PENDING',
      receivedAt: 1000,
      deliveredAt: null
    };

    client = new WebSocketClient();
  });

  describe('connect', () => {
    it('should connect and reset reconnectAttempt on connect event', () => {
      client.connect();
      expect(mockOn).toHaveBeenCalledWith('connect', expect.any(Function));
      
      const connectHandler = mockOn.mock.calls.find(c => c[0] === 'connect')[1];
      mockConnected = true;
      connectHandler();

      expect(client.isConnected).toBe(true);
    });
  });

  describe('sendPacket', () => {
    it('should throw if not connected', async () => {
      await expect(client.sendPacket(mockPacket)).rejects.toThrow('not connected');
    });

    it('should resolve if ACK is accepted', async () => {
      mockConnected = true;
      client.connect();

      mockSocket.timeout.mockReturnValueOnce({
        emit: jest.fn((event, data, cb) => {
          cb(null, { status: 'accepted', packetId: 'some-id' });
        })
      });

      const res = await client.sendPacket(mockPacket);
      expect(res.status).toBe('accepted');
      expect(res.packetId).toBe('some-id');
    });

    it('should throw WebSocketSendError if ACK is rejected', async () => {
      mockConnected = true;
      client.connect();

      mockSocket.timeout.mockReturnValueOnce({
        emit: jest.fn((event, data, cb) => {
          cb(null, { status: 'rejected' });
        })
      });

      await expect(client.sendPacket(mockPacket)).rejects.toThrow(WebSocketSendError);
    });

    it('should throw WebSocketSendError on timeout', async () => {
      mockConnected = true;
      client.connect();

      mockSocket.timeout.mockReturnValueOnce({
        emit: jest.fn((event, data, cb) => {
          cb(new Error('timeout'), null);
        })
      });

      await expect(client.sendPacket(mockPacket)).rejects.toThrow('timeout');
    });
  });
});
