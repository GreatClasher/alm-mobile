import { SqliteStorageError } from '../SqliteStorageError';

describe('SqliteStorageError', () => {
  it('should be instantiated correctly', () => {
    const error = new SqliteStorageError('test error');
    expect(error.message).toBe('test error');
    expect(error.name).toBe('SqliteStorageError');
  });
});
