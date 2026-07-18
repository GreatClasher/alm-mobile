import { BleManager } from 'react-native-ble-plx';
import { MobileLogger } from '@/shared/utils/logger';

const logger = new MobileLogger('BleManagerSingleton');

class BleManagerSingleton {
  private static instance: BleManager | null = null;

  static getInstance(): BleManager {
    if (!BleManagerSingleton.instance) {
      logger.info('Initializing BleManager instance');
      BleManagerSingleton.instance = new BleManager();
    }
    return BleManagerSingleton.instance;
  }

  static destroyInstance(): void {
    if (BleManagerSingleton.instance) {
      logger.info('Destroying BleManager instance');
      BleManagerSingleton.instance.destroy();
      BleManagerSingleton.instance = null;
    }
  }
}

export const getBleManager = () => BleManagerSingleton.getInstance();
