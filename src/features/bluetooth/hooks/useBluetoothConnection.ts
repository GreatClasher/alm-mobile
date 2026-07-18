import { useState, useEffect, useRef } from 'react';
import { BleConnectionState } from '../types/BleConnectionState';
import { BleConnectionService } from '../services/BleConnectionService';
import { MobileLogger } from '@/shared/utils/logger';

const logger = new MobileLogger('useBluetoothConnection');

export function useBluetoothConnection() {
  const [state, setState] = useState<BleConnectionState>(BleConnectionState.DISCONNECTED);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const serviceRef = useRef<BleConnectionService | null>(null);

  useEffect(() => {
    logger.info('Initializing BleConnectionService in hook');
    const service = new BleConnectionService();
    serviceRef.current = service;

    setState(BleConnectionState.SCANNING);
    setError(null);

    service.connect({
      onConnected: (device, hardwareId: string) => {
        logger.info({ hardwareId }, 'Connected via hook');
        setDeviceName(device.name || hardwareId);
        setState(BleConnectionState.CONNECTED);
        setError(null);
      },
      onDisconnected: () => {
        logger.warn('Disconnected via hook');
        setState(BleConnectionState.RECONNECTING);
        setDeviceName(null);
      },
      onError: (err: Error) => {
        logger.error({ error: err }, 'Error in hook');
        setError(err);
        setState(BleConnectionState.DISCONNECTED);
      }
    });

    return () => {
      logger.info('Cleaning up BleConnectionService in hook');
      service.disconnect();
      serviceRef.current = null;
    };
  }, []);

  return { state, deviceName, error };
}
