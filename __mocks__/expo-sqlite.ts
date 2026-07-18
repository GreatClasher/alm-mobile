/**
 * Mock for expo-sqlite
 * Provides an in-memory SQLite implementation suitable for Jest unit tests.
 * Uses a simple Map-based store to simulate database operations.
 */

type SqliteRow = Record<string, unknown>;
type SqliteParams = ReadonlyArray<string | number | null>;

interface ExecResult {
  insertId: number | undefined;
  rowsAffected: number;
  rows: {
    _array: SqliteRow[];
    length: number;
    item: (index: number) => SqliteRow | undefined;
  };
}

// Simple in-memory table store for tests
const _databases: Map<string, MockSQLiteDatabase> = new Map();

class MockSQLiteDatabase {
  private tables: Map<string, SqliteRow[]> = new Map();
  private autoIncrements: Map<string, number> = new Map();

  async execAsync(sql: string): Promise<void> {
    // Handle CREATE TABLE IF NOT EXISTS
    if (sql.trim().toUpperCase().startsWith('CREATE TABLE IF NOT EXISTS')) {
      const match = /CREATE TABLE IF NOT EXISTS\s+(\w+)/i.exec(sql);
      if (match?.[1] && !this.tables.has(match[1])) {
        this.tables.set(match[1], []);
        this.autoIncrements.set(match[1], 1);
      }
    }
    // CREATE INDEX — no-op
  }

  async runAsync(sql: string, params: SqliteParams = []): Promise<{ lastInsertRowId: number; changes: number }> {
    const normalizedSql = sql.trim().toUpperCase();

    if (normalizedSql.startsWith('INSERT')) {
      return this._handleInsert(sql, params);
    }
    if (normalizedSql.startsWith('UPDATE')) {
      return this._handleUpdate(sql, params);
    }
    if (normalizedSql.startsWith('DELETE')) {
      return this._handleDelete(sql, params);
    }

    return { lastInsertRowId: 0, changes: 0 };
  }

  async getAllAsync(sql: string, params: SqliteParams = []): Promise<SqliteRow[]> {
    const normalizedSql = sql.trim().toUpperCase();

    if (normalizedSql.startsWith('SELECT')) {
      return this._handleSelect(sql, params);
    }

    return [];
  }

  async getFirstAsync(sql: string, params: SqliteParams = []): Promise<SqliteRow | null> {
    const rows = await this.getAllAsync(sql, params);
    return rows[0] ?? null;
  }

  // ---- Internal helpers ----

  private _getTableName(sql: string): string {
    // Extract table name from INSERT/UPDATE/DELETE/SELECT
    const insertMatch = /(?:INSERT\s+(?:OR\s+\w+\s+)?INTO)\s+(\w+)/i.exec(sql);
    if (insertMatch?.[1]) return insertMatch[1];
    const updateMatch = /UPDATE\s+(\w+)/i.exec(sql);
    if (updateMatch?.[1]) return updateMatch[1];
    const deleteMatch = /DELETE\s+FROM\s+(\w+)/i.exec(sql);
    if (deleteMatch?.[1]) return deleteMatch[1];
    const selectMatch = /FROM\s+(\w+)/i.exec(sql);
    if (selectMatch?.[1]) return selectMatch[1];
    return '';
  }

  private _handleInsert(sql: string, params: SqliteParams): { lastInsertRowId: number; changes: number } {
    const tableName = this._getTableName(sql);
    if (!tableName) return { lastInsertRowId: 0, changes: 0 };

    if (!this.tables.has(tableName)) this.tables.set(tableName, []);
    const rows = this.tables.get(tableName)!;

    // Extract column names
    const colMatch = /\(([^)]+)\)\s+VALUES/i.exec(sql);
    if (!colMatch?.[1]) return { lastInsertRowId: 0, changes: 0 };

    const columns = colMatch[1].split(',').map((c) => c.trim().replace(/["`]/g, '').toLowerCase());
    const row: SqliteRow = {};

    columns.forEach((col, i) => {
      row[col] = params[i] ?? null;
    });

    // Handle INSERT OR IGNORE — check UNIQUE constraints
    const isOrIgnore = /INSERT\s+OR\s+IGNORE/i.test(sql);
    if (isOrIgnore) {
      // Check session_id + sequence_no uniqueness
      const sessionId = row['session_id'];
      const seqNo = row['sequence_no'];
      if (sessionId !== undefined && seqNo !== undefined) {
        const exists = rows.some(
          (r) => r['session_id'] === sessionId && r['sequence_no'] === seqNo,
        );
        if (exists) return { lastInsertRowId: 0, changes: 0 };
      }
    }

    const localId = this.autoIncrements.get(tableName) ?? 1;
    row['local_id'] = localId;
    this.autoIncrements.set(tableName, localId + 1);

    // Apply defaults
    if (row['status'] === undefined) row['status'] = 'PENDING';

    rows.push(row);
    return { lastInsertRowId: localId, changes: 1 };
  }

  private _handleUpdate(sql: string, params: SqliteParams): { lastInsertRowId: number; changes: number } {
    const tableName = this._getTableName(sql);
    if (!tableName) return { lastInsertRowId: 0, changes: 0 };

    const rows = this.tables.get(tableName) ?? [];
    let changes = 0;

    // Parse SET columns (simplified for test scenarios)
    const setMatch = /SET\s+(.+?)\s+WHERE/i.exec(sql);
    if (!setMatch?.[1]) return { lastInsertRowId: 0, changes: 0 };

    const setClauses = setMatch[1].split(',').map((c) => {
      const [col] = c.trim().split('=');
      return col?.trim().replace(/["`]/g, '').toLowerCase() ?? '';
    });

    // Parse WHERE clause (simplified: WHERE col = ?)
    const whereMatch = /WHERE\s+(.+)$/i.exec(sql);
    const whereClause = whereMatch?.[1] ?? '';

    let paramIndex = 0;
    const setValues: Record<string, unknown> = {};
    setClauses.forEach((col) => {
      setValues[col] = params[paramIndex++];
    });

    // WHERE local_id = ?
    const whereColMatch = /(\w+)\s*=\s*\?/i.exec(whereClause);
    const whereCol = whereColMatch?.[1]?.toLowerCase() ?? 'local_id';
    const whereVal = params[paramIndex];

    rows.forEach((row) => {
      if (row[whereCol] === whereVal) {
        Object.assign(row, setValues);
        changes++;
      }
    });

    return { lastInsertRowId: 0, changes };
  }

  private _handleDelete(sql: string, params: SqliteParams): { lastInsertRowId: number; changes: number } {
    const tableName = this._getTableName(sql);
    if (!tableName) return { lastInsertRowId: 0, changes: 0 };

    const rows = this.tables.get(tableName) ?? [];
    const initialLength = rows.length;

    // Parse WHERE clause for pruning (delivered_at < ?)
    const whereMatch = /WHERE\s+status\s*=\s*\?\s+AND\s+delivered_at\s*<\s*\?/i.exec(sql);
    if (whereMatch) {
      const statusVal = params[0];
      const threshold = params[1] as number;
      const newRows = rows.filter(
        (r) => !(r['status'] === statusVal && (r['delivered_at'] as number) < threshold),
      );
      this.tables.set(tableName, newRows);
      return { lastInsertRowId: 0, changes: initialLength - newRows.length };
    }

    return { lastInsertRowId: 0, changes: 0 };
  }

  private _handleSelect(sql: string, params: SqliteParams): SqliteRow[] {
    const tableName = this._getTableName(sql);
    if (!tableName) return [];

    let rows = [...(this.tables.get(tableName) ?? [])];

    // Filter by WHERE status = ?
    const statusMatch = /WHERE\s+status\s*=\s*\?/i.exec(sql);
    if (statusMatch && params[0] !== undefined) {
      rows = rows.filter((r) => r['status'] === params[0]);
    }

    // ORDER BY session_id ASC, sequence_no ASC
    if (/ORDER BY session_id(?:\s+ASC)?,\s*sequence_no(?:\s+ASC)?/i.test(sql)) {
      rows.sort((a, b) => {
        const sessionCmp = String(a['session_id'] ?? '').localeCompare(
          String(b['session_id'] ?? ''),
        );
        if (sessionCmp !== 0) return sessionCmp;
        return (a['sequence_no'] as number) - (b['sequence_no'] as number);
      });
    }

    // LIMIT
    const limitMatch = /LIMIT\s+\?/i.test(sql);
    if (limitMatch && params.length > 1) {
      const limit = Number(params[1]);
      if (!isNaN(limit)) {
        rows = rows.slice(0, limit);
      }
    } else {
      const explicitLimitMatch = /LIMIT\s+(\d+)/i.exec(sql);
      if (explicitLimitMatch?.[1]) {
        rows = rows.slice(0, parseInt(explicitLimitMatch[1], 10));
      }
    }

    // COUNT(*)
    if (/SELECT\s+COUNT\(\*\)\s+AS\s+count/i.test(sql)) {
      return [{ count: rows.length }];
    }

    return rows;
  }

  // Reset all data (for test isolation)
  _reset(): void {
    this.tables.clear();
    this.autoIncrements.clear();
  }
}

export async function openDatabaseAsync(name: string): Promise<MockSQLiteDatabase> {
  if (!_databases.has(name)) {
    _databases.set(name, new MockSQLiteDatabase());
  }
  return _databases.get(name)!;
}

export function openDatabaseSync(name: string): MockSQLiteDatabase {
  if (!_databases.has(name)) {
    _databases.set(name, new MockSQLiteDatabase());
  }
  return _databases.get(name)!;
}

// Helper to reset all databases between tests
export function _resetAllDatabases(): void {
  _databases.forEach((db) => db._reset());
  _databases.clear();
}

// Re-export for tests that need ExecResult shape
export type { ExecResult, SqliteRow };

export default { openDatabaseAsync, openDatabaseSync };
