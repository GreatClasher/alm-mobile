import NetInfo, { NetInfoSubscription } from '@react-native-community/netinfo';
import { MobileLogger } from '@/shared/utils/logger';

const logger = new MobileLogger('NetworkMonitor');

export interface NetworkMonitorCallbacks {
  onDisconnected: () => void;
  onRestored: () => void;
}

export class NetworkMonitor {
  private subscription: NetInfoSubscription | null = null;
  private wasConnected: boolean | null = null;

  startMonitoring(callbacks: NetworkMonitorCallbacks): void {
    if (this.subscription) {
      return;
    }

    logger.info('Starting network monitoring');

    this.subscription = NetInfo.addEventListener(state => {
      const isConnected = state.isConnected ?? false;
      
      if (this.wasConnected === true && !isConnected) {
        logger.warn('Network disconnected');
        callbacks.onDisconnected();
      } else if (this.wasConnected === false && isConnected) {
        logger.info('Network restored');
        callbacks.onRestored();
      }

      this.wasConnected = isConnected;
    });
  }

  stopMonitoring(): void {
    if (this.subscription) {
      logger.info('Stopping network monitoring');
      this.subscription();
      this.subscription = null;
    }
  }
}
