/**
 * WebSocketSendError — thrown when a WebSocket packet send fails.
 * On WebSocketSendError: leave packet as PENDING in SQLite (never mark FAILED).
 */
export class WebSocketSendError extends Error {
  public readonly context: Record<string, unknown>;

  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message);
    this.name = 'WebSocketSendError';
    this.context = context;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
