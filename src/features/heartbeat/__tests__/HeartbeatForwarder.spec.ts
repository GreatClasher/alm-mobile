import { HeartbeatForwarder } from '../HeartbeatForwarder';
import type { AudioPacket } from '@/shared/types/AudioPacket';

import { authenticatedFetch } from '@/shared/utils/apiClient';

const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
};

jest.mock('@/shared/utils/apiClient', () => ({
  authenticatedFetch: jest.fn()
}));

describe('HeartbeatForwarder', () => {
  let forwarder: HeartbeatForwarder;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.jabbelpin.com/v1';
    forwarder = new HeartbeatForwarder(mockLogger as any);
  });

  it('should call POST /heartbeat with correct body and log serverTime', async () => {
    const mockPacket: AudioPacket = {
      deviceId: 'dev-1',
      sessionId: 'sess-1',
      sequenceNo: 1,
      timestamp: 123456,
      payloadType: 'HEARTBEAT',
      payload: new Uint8Array(),
      checksum: 'abc'
    };

    (authenticatedFetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ serverTime: 999999 })
    });

    await forwarder.forwardHeartbeat(mockPacket, true, 5);

    expect(authenticatedFetch).toHaveBeenCalledWith('https://api.jabbelpin.com/v1/devices/dev-1/heartbeat', expect.objectContaining({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        timestamp: 123456,
        batteryLevel: null,
        bleConnected: true,
        pendingPackets: 5
      })
    }));

    expect(mockLogger.info).toHaveBeenCalledWith(expect.objectContaining({ serverTime: 999999 }), 'Heartbeat forwarded successfully');
  });

  it('should log error but not throw on 404', async () => {
    const mockPacket: AudioPacket = {
      deviceId: 'dev-unknown',
      sessionId: 'sess-1',
      sequenceNo: 1,
      timestamp: 123456,
      payloadType: 'HEARTBEAT',
      payload: new Uint8Array(),
      checksum: 'abc'
    };

    (authenticatedFetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found'
    });

    await expect(forwarder.forwardHeartbeat(mockPacket, true, 0)).resolves.toBeUndefined();
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.any(Object), 'Device not found on backend (404)');
  });

  it('should log error but not throw on network timeout', async () => {
    const mockPacket: AudioPacket = {
      deviceId: 'dev-1',
      sessionId: 'sess-1',
      sequenceNo: 1,
      timestamp: 123456,
      payloadType: 'HEARTBEAT',
      payload: new Uint8Array(),
      checksum: 'abc'
    };

    (authenticatedFetch as jest.Mock).mockRejectedValueOnce(new Error('Network timeout'));

    await expect(forwarder.forwardHeartbeat(mockPacket, true, 0)).resolves.toBeUndefined();
    expect(mockLogger.error).toHaveBeenCalledWith(expect.any(Object), 'Network error forwarding heartbeat');
  });

  it('should return early if packet is not HEARTBEAT', async () => {
    const mockPacket: AudioPacket = {
      deviceId: 'dev-1',
      sessionId: 'sess-1',
      sequenceNo: 1,
      timestamp: 123456,
      payloadType: 'AUDIO',
      payload: new Uint8Array(),
      checksum: 'abc'
    };

    await forwarder.forwardHeartbeat(mockPacket, true, 0);
    expect(authenticatedFetch).not.toHaveBeenCalled();
  });
});
