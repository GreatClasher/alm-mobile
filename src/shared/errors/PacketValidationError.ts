/**
 * PacketValidationError — thrown when a BLE packet fails structural or checksum validation.
 */
export class PacketValidationError extends Error {
  public readonly context: Record<string, unknown>;

  constructor(message: string, context: Record<string, unknown>) {
    super(message);
    this.name = 'PacketValidationError';
    this.context = context;
    // Maintain proper prototype chain (required for ES5 compilation targets)
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
