import { useState, useEffect, useRef } from 'react';
import { WebSocketClient } from '../WebSocketClient';
import { MobileLogger } from '@/shared/utils/logger';
import { useConnectionStore } from '@/stores/connectionStore';

const logger = new MobileLogger('useWebSocketConnection');

export function useWebSocketConnection() {
  const isConnected = useConnectionStore(state => state.wsConnected);
  const clientRef = useRef<WebSocketClient | null>(null);

  useEffect(() => {
    logger.info('Initializing WebSocketClient in hook');
    const client = new WebSocketClient();
    clientRef.current = client;

    client.connect();

    return () => {
      logger.info('Cleaning up WebSocketClient in hook');
      client.disconnect();
      clientRef.current = null;
    };
  }, []);

  return {
    isConnected,
    client: clientRef.current
  };
}
