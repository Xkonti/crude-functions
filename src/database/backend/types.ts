/**
 * Common interface for database backends.
 *
 * This minimal abstraction provides lifecycle and health checking
 * that works across both SQLite and SurrealDB. Backend-specific
 * features are exposed via extended interfaces.
 */
export interface DatabaseBackend {
  /** Open the database connection */
  open(): Promise<void>;

  /** Close the database connection */
  close(): Promise<void>;

  /** Check if connection is open */
  readonly isOpen: boolean;

  /** Get backend type identifier */
  readonly backendType: "sqlite" | "surreal";

  /** Health check - returns true if database is responsive */
  healthCheck(): Promise<boolean>;
}

/**
 * Result of a write operation (INSERT, UPDATE, DELETE).
 */
export interface WriteResult {
  /** Number of rows affected */
  changes: number;
  /** Last inserted row ID (backend-specific format) */
  lastInsertId?: string | number;
}

/**
 * Options for query execution.
 */
export interface QueryOptions {
  /** Maximum number of results to return */
  limit?: number;
  /** Number of results to skip */
  offset?: number;
}

/**
 * Extended interface for SQLite-specific features.
 *
 * SQLite uses SQL queries with positional parameters.
 * Supports transactions and prepared statements.
 */
export interface SqliteBackend extends DatabaseBackend {
  readonly backendType: "sqlite";

  /** Execute write operation (INSERT, UPDATE, DELETE) */
  execute(sql: string, params?: unknown[]): Promise<WriteResult>;

  /** Query all matching rows */
  queryAll<T>(sql: string, params?: unknown[]): Promise<T[]>;

  /** Query single row */
  queryOne<T>(sql: string, params?: unknown[]): Promise<T | null>;

  /** Execute DDL or multi-statement SQL */
  exec(sql: string): Promise<number>;

  /** Transaction support */
  transaction<T>(callback: (tx: TransactionContext) => Promise<T>): Promise<T>;
}

/**
 * Transaction context for SQLite.
 * Provides the same query methods but within a transaction scope.
 */
export interface TransactionContext {
  execute(sql: string, params?: unknown[]): Promise<WriteResult>;
  queryAll<T>(sql: string, params?: unknown[]): Promise<T[]>;
  queryOne<T>(sql: string, params?: unknown[]): Promise<T | null>;
  exec(sql: string): Promise<number>;
}

/**
 * Extended interface for SurrealDB-specific features.
 *
 * SurrealDB uses record-based operations and SurrealQL queries.
 * Records are identified by string IDs in "table:id" format.
 */
export interface SurrealBackend extends DatabaseBackend {
  readonly backendType: "surreal";

  /** Get version information */
  version(): Promise<{ version: string }>;

  /** Execute SurrealQL query */
  query<T>(sql: string, vars?: Record<string, unknown>): Promise<T[]>;

  /** Create a new record */
  create<T>(table: string, data: T): Promise<T & { id: unknown }>;

  /** Select all records from a table */
  select<T>(table: string): Promise<T[]>;

  /** Select a single record by ID */
  selectOne<T>(table: string, id: string): Promise<T | null>;

  /** Update a record (full replacement) */
  update<T>(
    table: string,
    id: string,
    data: T
  ): Promise<T & { id: unknown }>;

  /** Merge data into a record (partial update) */
  merge<T>(
    table: string,
    id: string,
    data: Partial<T>
  ): Promise<T & { id: unknown }>;

  /** Delete a record by ID */
  delete(table: string, id: string): Promise<void>;

  /** Delete all records from a table */
  deleteAll(table: string): Promise<void>;
}

/**
 * Union type for any database backend.
 */
export type AnyDatabaseBackend = SqliteBackend | SurrealBackend;

/**
 * Type guard to check if backend is SQLite.
 */
export function isSqliteBackend(
  backend: DatabaseBackend
): backend is SqliteBackend {
  return backend.backendType === "sqlite";
}

/**
 * Type guard to check if backend is SurrealDB.
 */
export function isSurrealBackend(
  backend: DatabaseBackend
): backend is SurrealBackend {
  return backend.backendType === "surreal";
}
