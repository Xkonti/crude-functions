/**
 * Configuration options for the DatabaseService
 */
export interface DatabaseServiceOptions {
  /** Path to the database file (e.g., "data/database.db") */
  databasePath: string;
  /** Whether to enable WAL mode for better concurrent read performance (default: true) */
  enableWal?: boolean;
  /** Whether to create the database file if it doesn't exist (default: true) */
  createIfNotExists?: boolean;
}

/**
 * Result of an execute operation (INSERT, UPDATE, DELETE)
 */
export interface ExecuteResult {
  /** Number of rows changed by the operation */
  changes: number;
  /** Row ID of the last inserted row (for INSERT operations) */
  lastInsertRowId: number;
}

/**
 * A generic row object from a query result
 */
export type Row = Record<string, unknown>;
