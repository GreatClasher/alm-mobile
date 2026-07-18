import { useEffect, useRef } from 'react';
import { BlePacketService } from '../services/BlePacketService';
import type { AudioPacket } from '@/shared/types/AudioPacket';
import { MobileLogger } from '@/shared/utils/logger';
import type { Device } from 'react-native-ble-plx';

const logger = new MobileLogger('useBlePacketStream');

export function useBlePacketStream(device: Device | null, onPacketReceived: (packet: AudioPacket) => void) {
  const serviceRef = useRef<BlePacketService | null>(null);

  useEffect(() => {
    if (!device) return;

    logger.info({ deviceId: device.id }, 'Initializing BlePacketService in hook');
    const service = new BlePacketService();
    serviceRef.current = service;

    service.startMonitoring(device, {
      onPacketReceived,
      onError: (err: Error) => {
        logger.error({ error: err }, 'Error receiving packets via hook');
      }
    });

    return () => {
      logger.info('Cleaning up BlePacketService in hook');
      service.stopMonitoring();
      serviceRef.current = null;
    };
  }, [device, onPacketReceived]);
}
