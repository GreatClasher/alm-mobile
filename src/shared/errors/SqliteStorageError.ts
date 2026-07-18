/**
 * SqliteStorageError — thrown when a SQLite database operation fails.
 * This is critical — local packet durability depends on SQLite working correctly.
 */
export class SqliteStorageError extends Error {
  public readonly context: Record<string, unknown>;

  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message);
    this.name = 'SqliteStorageError';
    this.context = context;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
