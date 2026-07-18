import { PacketRelayService } from '../PacketRelayService';

const mockSqliteQueue = {
  getPendingPackets: jest.fn(),
  markDelivered: jest.fn(),
  markFailed: jest.fn()
};

const mockWsClient = {
  isConnected: false,
  sendPacket: jest.fn()
};

const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
};

describe('PacketRelayService', () => {
  let service: PacketRelayService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockWsClient.isConnected = false;
    service = new PacketRelayService(mockSqliteQueue as any, mockWsClient as any, mockLogger as any);
  });

  it('should drain immediately on triggerReplay', async () => {
    mockWsClient.isConnected = true;
    mockSqliteQueue.getPendingPackets.mockResolvedValueOnce([{ localId: 1 }]).mockResolvedValue([]);
    mockWsClient.sendPacket.mockResolvedValue({ status: 'accepted' });

    await service.triggerReplay();

    expect(mockSqliteQueue.getPendingPackets).toHaveBeenCalled();
    expect(mockWsClient.sendPacket).toHaveBeenCalledTimes(1);
  });

  it('should read 50 packets and send them when WS is connected', async () => {
    mockWsClient.isConnected = true;
    const packets = Array.from({ length: 50 }).map((_, i) => ({ localId: i + 1, sequenceNo: i + 1 }));
    mockSqliteQueue.getPendingPackets.mockResolvedValueOnce(packets).mockResolvedValue([]);
    mockWsClient.sendPacket.mockResolvedValue({ status: 'accepted' });

    await service.triggerReplay();

    expect(mockSqliteQueue.getPendingPackets).toHaveBeenCalled();
    expect(mockWsClient.sendPacket).toHaveBeenCalledTimes(50);
    expect(mockSqliteQueue.markDelivered).toHaveBeenCalledTimes(50);
  });

  it('should not call getPendingPackets when WS is disconnected', async () => {
    mockWsClient.isConnected = false;
    
    await service.triggerReplay();
    
    expect(mockSqliteQueue.getPendingPackets).not.toHaveBeenCalled();
  });

  it('should leave packet PENDING on send failure (transient)', async () => {
    mockWsClient.isConnected = true;
    mockSqliteQueue.getPendingPackets.mockResolvedValueOnce([{ localId: 1, sequenceNo: 1 }]).mockResolvedValue([]);
    mockWsClient.sendPacket.mockRejectedValue(new Error('timeout'));

    await service.triggerReplay();

    expect(mockWsClient.sendPacket).toHaveBeenCalledTimes(1);
    expect(mockSqliteQueue.markDelivered).not.toHaveBeenCalled();
    expect(mockSqliteQueue.markFailed).not.toHaveBeenCalled();
  });

  it('should break loop early if WS disconnects mid-loop', async () => {
    mockWsClient.isConnected = true;
    const packets = [{ localId: 1 }, { localId: 2 }];
    mockSqliteQueue.getPendingPackets.mockResolvedValueOnce(packets).mockResolvedValue([]);
    
    mockWsClient.sendPacket.mockImplementationOnce(() => {
      mockWsClient.isConnected = false; // disconnects after first
      return Promise.reject(new Error('dropped'));
    });

    await service.triggerReplay();

    expect(mockWsClient.sendPacket).toHaveBeenCalledTimes(1); // Only tried first packet
  });

  it('should return quickly with no errors on empty queue', async () => {
    mockWsClient.isConnected = true;
    mockSqliteQueue.getPendingPackets.mockResolvedValueOnce([]);

    await service.triggerReplay();

    expect(mockWsClient.sendPacket).not.toHaveBeenCalled();
  });

  it('should handle batch of 51 packets across two polls', async () => {
    mockWsClient.isConnected = true;
    const batch1 = Array.from({ length: 50 }).map((_, i) => ({ localId: i + 1 }));
    const batch2 = [{ localId: 51 }];
    
    mockSqliteQueue.getPendingPackets
      .mockResolvedValueOnce(batch1)
      .mockResolvedValueOnce(batch2)
      .mockResolvedValue([]);
      
    mockWsClient.sendPacket.mockResolvedValue({ status: 'accepted' });

    await service.triggerReplay();

    expect(mockWsClient.sendPacket).toHaveBeenCalledTimes(51);
  });
});
