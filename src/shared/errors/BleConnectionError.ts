/**
 * BleConnectionError — thrown when BLE connection establishment or maintenance fails.
 */
export class BleConnectionError extends Error {
  public readonly context: Record<string, unknown>;

  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message);
    this.name = 'BleConnectionError';
    this.context = context;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
