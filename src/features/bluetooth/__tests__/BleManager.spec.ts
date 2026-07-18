import { getBleManager } from '../BleManager';
import { BleManager } from 'react-native-ble-plx';

describe('BleManager', () => {
  it('should return a singleton instance of BleManager', () => {
    const manager1 = getBleManager();
    const manager2 = getBleManager();
    expect(manager1).toBeDefined();
    expect(manager1).toBe(manager2);
  });
});
