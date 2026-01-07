import { Database, type Statement, type BindValue } from "@db/sqlite";
import { Mutex } from "@core/asyncutil/mutex";
import type {
  DatabaseServiceOptions,
  ExecuteResult,
  Row,
} from "./types.ts";
import {
  DatabaseAccessError,
  DatabaseNotOpenError,
  QueryError,
  NestedTransactionError,
  TransactionError,
} from "./errors.ts";
import { TransactionContext } from "./transaction_context.ts";

/**
 * A thread-safe SQLite database service with mutex-protected write operations.
 *
 * Features:
 * - WAL mode for concurrent read performance
 * - Mutex-protected writes to prevent SQLITE_BUSY errors
 * - Prepared statement support
 *
 * Usage Pattern:
 * In production, the database should be opened once at application startup and
 * remain open for the application's lifetime. The close() method should only be
 * called during graceful shutdown. Services that depend on DatabaseService can
 * assume the connection is always open after initialization. The ensureOpen()
 * internal check provides a safety net and will throw DatabaseNotOpenError if
 * operations are attempted on a closed connection.
 *
 * @example
 * ```typescript
 * const db = new DatabaseService({ databasePath: "data/database.db" });
 * await db.open();
 *
 * // Write (mutex-protected)
 * await db.execute("INSERT INTO users (name) VALUES (?)", ["Alice"]);
 *
 * // Read (no mutex needed)
 * const users = await db.queryAll("SELECT * FROM users");
 *
 * await db.close();
 * ```
 */
export class DatabaseService {
  private readonly databasePath: string;
  private readonly enableWal: boolean;
  private readonly createIfNotExists: boolean;
  private readonly writeMutex = new Mutex();

  private db: Database | null = null;
  private inTransaction = false;

  constructor(options: DatabaseServiceOptions) {
    this.databasePath = options.databasePath;
    this.enableWal = options.enableWal ?? true;
    this.createIfNotExists = options.createIfNotExists ?? true;
  }

  // ============== Connection Management ==============

  /**
   * Opens the database connection.
   * Creates the parent directory if it doesn't exist.
   * Enables WAL mode if configured (default: true).
   */
  async open(): Promise<void> {
    if (this.db) return; // Already open

    // Ensure parent directory exists
    await this.ensureParentDirectory();

    try {
      this.db = new Database(this.databasePath, {
        create: this.createIfNotExists,
      });

      if (this.enableWal) {
        this.db.exec("PRAGMA journal_mode = WAL");
        this.db.exec("PRAGMA synchronous = NORMAL");
      }

      // Enable foreign key constraints (required for CASCADE DELETE)
      this.db.exec("PRAGMA foreign_keys = ON");
    } catch (error) {
      throw new DatabaseAccessError(this.databasePath, error);
    }
  }

  /**
   * Closes the database connection.
   * Safe to call multiple times.
   */
  async close(): Promise<void> {
    if (!this.db) return;

    // Synchronous operation, but kept async for API consistency
    await Promise.resolve();
    this.db.close();
    this.db = null;
  }

  /**
   * Returns true if the database connection is open.
   */
  get isOpen(): boolean {
    return this.db !== null;
  }

  /**
   * Returns the raw SQLite database instance.
   * Used by external libraries (e.g., Better Auth via Kysely) that need direct access.
   * Returns null if the connection is not open.
   */
  get rawDb(): Database | null {
    return this.db;
  }

  // ============== Query Execution ==============

  /**
   * Executes a SQL statement that modifies data (INSERT, UPDATE, DELETE).
   * Acquires write mutex automatically to prevent concurrent write conflicts.
   *
   * @param sql - The SQL statement to execute
   * @param params - Optional parameters to bind to the statement
   * @returns ExecuteResult with changes count and lastInsertRowId
   * @throws DatabaseNotOpenError if the connection is not open
   * @throws QueryError if the query fails
   */
  async execute(sql: string, params?: BindValue[]): Promise<ExecuteResult> {
    this.ensureOpen();

    using _lock = await this.writeMutex.acquire();
    return this.executeSync(sql, params);
  }

  /**
   * Executes a SQL query and returns all matching rows.
   * Does not acquire mutex (reads are safe in WAL mode).
   *
   * @param sql - The SQL query to execute
   * @param params - Optional parameters to bind to the query
   * @returns Array of row objects, empty array if no matches
   * @throws DatabaseNotOpenError if the connection is not open
   * @throws QueryError if the query fails
   */
  async queryAll<T extends Row = Row>(
    sql: string,
    params?: BindValue[]
  ): Promise<T[]> {
    this.ensureOpen();

    // Synchronous operation, but kept async for API consistency
    await Promise.resolve();

    try {
      const stmt = this.db!.prepare(sql);
      try {
        if (params && params.length > 0) {
          return stmt.all<T>(...params);
        }
        return stmt.all<T>();
      } finally {
        stmt.finalize();
      }
    } catch (error) {
      throw new QueryError(sql, error);
    }
  }

  /**
   * Executes a SQL query and returns the first matching row.
   * Does not acquire mutex (reads are safe in WAL mode).
   *
   * @param sql - The SQL query to execute
   * @param params - Optional parameters to bind to the query
   * @returns Single row object or null if no match
   * @throws DatabaseNotOpenError if the connection is not open
   * @throws QueryError if the query fails
   */
  async queryOne<T extends Row = Row>(
    sql: string,
    params?: BindValue[]
  ): Promise<T | null> {
    this.ensureOpen();

    // Synchronous operation, but kept async for API consistency
    await Promise.resolve();

    try {
      const stmt = this.db!.prepare(sql);
      try {
        let result: T | undefined;
        if (params && params.length > 0) {
          result = stmt.get<T>(...params);
        } else {
          result = stmt.get<T>();
        }
        return result ?? null;
      } finally {
        stmt.finalize();
      }
    } catch (error) {
      throw new QueryError(sql, error);
    }
  }

  /**
   * Executes a SQL statement for DDL or pragma operations.
   * Acquires write mutex automatically.
   *
   * @param sql - The SQL statement(s) to execute
   * @returns Number of changes made by the last statement
   * @throws DatabaseNotOpenError if the connection is not open
   * @throws QueryError if the execution fails
   */
  async exec(sql: string): Promise<number> {
    this.ensureOpen();

    using _lock = await this.writeMutex.acquire();
    return this.execSync(sql);
  }

  // ============== Transactions ==============

  /**
   * Executes a callback within a database transaction.
   * Automatically commits on success, rolls back on error.
   *
   * Transactions are serialized - concurrent calls will queue via mutex.
   *
   * IMPORTANT: Nested transactions are not supported. This is a SQLite limitation.
   * When adding support for other databases (PostgreSQL, MySQL, etc.), this behavior
   * may need to be revisited as those databases support nested transactions via
   * savepoints differently than SQLite.
   *
   * @param callback - Async function that receives transaction context
   * @returns Promise resolving to callback's return value
   * @throws NestedTransactionError if called within another transaction
   * @throws TransactionError if BEGIN/COMMIT/ROLLBACK fails
   * @throws Original error from callback (after rollback)
   *
   * @example
   * ```typescript
   * // All operations commit together, or roll back together
   * await db.transaction(async (tx) => {
   *   await tx.execute("INSERT INTO users (name) VALUES (?)", ["Alice"]);
   *   await tx.execute("INSERT INTO posts (user_id) VALUES (?)", [1]);
   * });
   * ```
   */
  async transaction<T>(
    callback: (tx: TransactionContext) => Promise<T>
  ): Promise<T> {
    // Check for nested transaction - SQLite limitation
    // NOTE: This check is SQLite-specific. Other databases (PostgreSQL, MySQL) handle
    // nested transactions differently via savepoints. When adding multi-DB support,
    // this behavior will need to be database-specific.
    if (this.inTransaction) {
      throw new NestedTransactionError(
        "Nested transactions are not supported. SQLite does not support true nested transactions."
      );
    }

    this.ensureOpen();

    // Acquire mutex - queues concurrent transactions
    using _lock = await this.writeMutex.acquire();

    this.inTransaction = true;
    try {
      // Begin transaction with IMMEDIATE lock (prevents SQLITE_BUSY)
      this.db!.exec("BEGIN IMMEDIATE");

      // Create transaction context
      const tx = new TransactionContext(this.db!);

      // Execute callback
      const result = await callback(tx);

      // Success - commit
      this.db!.exec("COMMIT");
      return result;

    } catch (error) {
      // Error - rollback and re-throw
      try {
        this.db!.exec("ROLLBACK");
      } catch (rollbackError) {
        // Best effort rollback - still throw original error
        throw new TransactionError(
          "Transaction rollback failed after error",
          rollbackError
        );
      }
      throw error;

    } finally {
      this.inTransaction = false;
      // Mutex auto-released via 'using'
    }
  }

  // ============== Prepared Statements ==============

  /**
   * Creates a prepared statement for repeated execution.
   * The caller is responsible for calling finalize() when done.
   *
   * @param sql - The SQL statement to prepare
   * @returns PreparedStatement wrapper
   * @throws DatabaseNotOpenError if the connection is not open
   */
  prepare(sql: string): PreparedStatement {
    this.ensureOpen();

    const stmt = this.db!.prepare(sql);
    return new PreparedStatement(stmt, this.writeMutex);
  }

  // ============== Private Helpers ==============

  private ensureOpen(): void {
    if (!this.db) {
      throw new DatabaseNotOpenError();
    }
  }

  private async ensureParentDirectory(): Promise<void> {
    const lastSlash = this.databasePath.lastIndexOf("/");
    if (lastSlash > 0) {
      const parentDir = this.databasePath.substring(0, lastSlash);
      try {
        await Deno.mkdir(parentDir, { recursive: true });
      } catch (error) {
        if (!(error instanceof Deno.errors.AlreadyExists)) {
          throw new DatabaseAccessError(parentDir, error);
        }
      }
    }
  }

  private executeSync(sql: string, params?: BindValue[]): ExecuteResult {
    try {
      const stmt = this.db!.prepare(sql);
      try {
        let changes: number;
        if (params && params.length > 0) {
          changes = stmt.run(...params);
        } else {
          changes = stmt.run();
        }
        return {
          changes,
          lastInsertRowId: this.db!.lastInsertRowId,
        };
      } finally {
        stmt.finalize();
      }
    } catch (error) {
      throw new QueryError(sql, error);
    }
  }

  private execSync(sql: string): number {
    try {
      return this.db!.exec(sql);
    } catch (error) {
      throw new QueryError(sql, error);
    }
  }
}

/**
 * Wrapper around SQLite prepared statement with async-friendly API.
 * Automatically handles mutex acquisition for write operations.
 */
export class PreparedStatement {
  private readonly stmt: Statement;
  private readonly writeMutex: Mutex;

  constructor(stmt: Statement, writeMutex: Mutex) {
    this.stmt = stmt;
    this.writeMutex = writeMutex;
  }

  /**
   * Executes the statement with given parameters (for INSERT/UPDATE/DELETE).
   * Acquires write mutex automatically.
   */
  async run(params?: BindValue[]): Promise<number> {
    using _lock = await this.writeMutex.acquire();
    return this.runSync(params);
  }

  /**
   * Executes the statement and returns all rows.
   * Does not acquire mutex (reads are safe in WAL mode).
   */
  async all<T extends Row = Row>(params?: BindValue[]): Promise<T[]> {
    // Synchronous operation, but kept async for API consistency
    await Promise.resolve();

    if (params && params.length > 0) {
      return this.stmt.all<T>(...params);
    }
    return this.stmt.all<T>();
  }

  /**
   * Executes the statement and returns the first row.
   * Does not acquire mutex (reads are safe in WAL mode).
   */
  async get<T extends Row = Row>(params?: BindValue[]): Promise<T | null> {
    // Synchronous operation, but kept async for API consistency
    await Promise.resolve();

    let result: T | undefined;
    if (params && params.length > 0) {
      result = this.stmt.get<T>(...params);
    } else {
      result = this.stmt.get<T>();
    }
    return result ?? null;
  }

  /**
   * Finalizes (closes) the prepared statement.
   * Must be called when done using the statement.
   */
  finalize(): void {
    this.stmt.finalize();
  }

  private runSync(params?: BindValue[]): number {
    if (params && params.length > 0) {
      return this.stmt.run(...params);
    }
    return this.stmt.run();
  }
}
