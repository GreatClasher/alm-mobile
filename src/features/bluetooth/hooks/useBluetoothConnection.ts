import { useState, useEffect, useRef } from 'react';
import { BleConnectionState } from '../types/BleConnectionState';
import * as AlmAudioService from '../../../../../modules/alm-audio-service';
import { MobileLogger } from '@/shared/utils/logger';

const logger = new MobileLogger('useBluetoothConnection');

export function useBluetoothConnection() {
  const [state, setState] = useState<BleConnectionState>(BleConnectionState.DISCONNECTED);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    logger.info('Initializing AlmAudioService Native Module in hook');
    
    // Default configs for now, these would typically come from auth/env
    const config = {
      deviceId: 'native-device-id', 
      userId: 'native-user-id',
      wsUrl: 'ws://192.168.1.10:3000', // Update with actual backend URL
      porcupineAccessKey: 'INSERT_YOUR_ACCESS_KEY_HERE' 
    };

    // Start native service
    AlmAudioService.startService(config)
      .then(() => {
        setState(BleConnectionState.CONNECTED);
        setDeviceName('ALM Native Audio');
        setError(null);
      })
      .catch((err) => {
        logger.error({ error: err }, 'Native service start failed');
        setError(err);
        setState(BleConnectionState.DISCONNECTED);
      });

    // Listen to native events
    const wakeSub = AlmAudioService.addWakeWordDetectedListener(() => {
      logger.info('Wake word detected natively!');
      // Update UI state here if needed (e.g. showing "Listening...")
    });

    const responseSub = AlmAudioService.addAssistantResponseListener((event) => {
      logger.info({ answer: event.answer }, 'Assistant response received natively!');
      // Update UI state or trigger TTS here
    });

    return () => {
      logger.info('Cleaning up AlmAudioService in hook');
      AlmAudioService.stopService();
      wakeSub.remove();
      responseSub.remove();
    };
  }, []);

  return { state, deviceName, error };
}
