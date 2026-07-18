import { useEffect, useRef } from 'react';
import { NetworkMonitor } from '../NetworkMonitor';
import { MobileLogger } from '@/shared/utils/logger';

const logger = new MobileLogger('useNetworkMonitor');

export interface UseNetworkMonitorProps {
  onDisconnected: () => void;
  onRestored: () => void;
}

export function useNetworkMonitor(callbacks: UseNetworkMonitorProps) {
  const monitorRef = useRef<NetworkMonitor | null>(null);

  useEffect(() => {
    logger.info('Initializing NetworkMonitor in hook');
    const monitor = new NetworkMonitor();
    monitorRef.current = monitor;

    monitor.startMonitoring({
      onDisconnected: callbacks.onDisconnected,
      onRestored: callbacks.onRestored
    });

    return () => {
      logger.info('Cleaning up NetworkMonitor in hook');
      monitor.stopMonitoring();
      monitorRef.current = null;
    };
  }, [callbacks.onDisconnected, callbacks.onRestored]);
}
