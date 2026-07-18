/**
 * BleCharacteristicError — thrown when a BLE characteristic read/write/notification fails.
 */
export class BleCharacteristicError extends Error {
  public readonly context: Record<string, unknown>;

  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message);
    this.name = 'BleCharacteristicError';
    this.context = context;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
