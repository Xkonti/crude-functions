import { Database, type Statement } from "@db/sqlite";
import { Mutex } from "@core/asyncutil/mutex";
import type {
  DatabaseServiceOptions,
  ExecuteResult,
  Row,
  TransactionType,
} from "./types.ts";
import {
  DatabaseAccessError,
  DatabaseNotOpenError,
  NoActiveTransactionError,
  QueryError,
  TransactionAlreadyActiveError,
  TransactionError,
} from "./errors.ts";

/**
 * A thread-safe SQLite database service with mutex-protected write operations.
 *
 * Features:
 * - WAL mode for concurrent read performance
 * - Mutex-protected writes to prevent SQLITE_BUSY errors
 * - Manual transaction control with begin/commit/rollback
 * - Prepared statement support
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
  private transactionLock: { [Symbol.dispose]: () => void } | null = null;

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
    } catch (error) {
      throw new DatabaseAccessError(this.databasePath, error);
    }
  }

  /**
   * Closes the database connection.
   * Rolls back any active transaction before closing.
   * Safe to call multiple times.
   */
  async close(): Promise<void> {
    if (!this.db) return;

    // Rollback any active transaction
    if (this.transactionLock) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // Ignore rollback errors during close
      }
      this.transactionLock[Symbol.dispose]();
      this.transactionLock = null;
    }

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
   * Returns true if a transaction is currently active.
   */
  get inTransaction(): boolean {
    return this.transactionLock !== null;
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
  async execute(sql: string, params?: unknown[]): Promise<ExecuteResult> {
    this.ensureOpen();

    // If in transaction, we already hold the lock
    if (this.transactionLock) {
      return this.executeSync(sql, params);
    }

    // Otherwise, acquire lock for this single operation
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
    params?: unknown[]
  ): Promise<T[]> {
    this.ensureOpen();

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
    params?: unknown[]
  ): Promise<T | null> {
    this.ensureOpen();

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

    // If in transaction, we already hold the lock
    if (this.transactionLock) {
      return this.execSync(sql);
    }

    // Otherwise, acquire lock for this operation
    using _lock = await this.writeMutex.acquire();
    return this.execSync(sql);
  }

  // ============== Transaction Control ==============

  /**
   * Begins a transaction and holds the write mutex until commit/rollback.
   *
   * @param type - Transaction type: "deferred" (default), "immediate", or "exclusive"
   * @throws DatabaseNotOpenError if the connection is not open
   * @throws TransactionAlreadyActiveError if a transaction is already active
   * @throws TransactionError if the BEGIN fails
   */
  async beginTransaction(type: TransactionType = "deferred"): Promise<void> {
    this.ensureOpen();

    if (this.transactionLock) {
      throw new TransactionAlreadyActiveError();
    }

    // Acquire the mutex and hold it for the duration of the transaction
    this.transactionLock = await this.writeMutex.acquire();

    try {
      this.db!.exec(`BEGIN ${type.toUpperCase()}`);
    } catch (error) {
      // Release lock if BEGIN fails
      this.transactionLock[Symbol.dispose]();
      this.transactionLock = null;
      throw new TransactionError("begin", error);
    }
  }

  /**
   * Commits the current transaction and releases the write mutex.
   *
   * @throws DatabaseNotOpenError if the connection is not open
   * @throws NoActiveTransactionError if no transaction is active
   * @throws TransactionError if the COMMIT fails
   */
  async commit(): Promise<void> {
    this.ensureOpen();

    if (!this.transactionLock) {
      throw new NoActiveTransactionError();
    }

    try {
      this.db!.exec("COMMIT");
    } catch (error) {
      throw new TransactionError("commit", error);
    } finally {
      this.transactionLock[Symbol.dispose]();
      this.transactionLock = null;
    }
  }

  /**
   * Rolls back the current transaction and releases the write mutex.
   *
   * @throws DatabaseNotOpenError if the connection is not open
   * @throws NoActiveTransactionError if no transaction is active
   * @throws TransactionError if the ROLLBACK fails
   */
  async rollback(): Promise<void> {
    this.ensureOpen();

    if (!this.transactionLock) {
      throw new NoActiveTransactionError();
    }

    try {
      this.db!.exec("ROLLBACK");
    } catch (error) {
      throw new TransactionError("rollback", error);
    } finally {
      this.transactionLock[Symbol.dispose]();
      this.transactionLock = null;
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
    return new PreparedStatement(
      stmt,
      this.writeMutex,
      () => this.transactionLock
    );
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

  private executeSync(sql: string, params?: unknown[]): ExecuteResult {
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
  private readonly getTransactionLock: () => { [Symbol.dispose]: () => void } | null;

  constructor(
    stmt: Statement,
    writeMutex: Mutex,
    getTransactionLock: () => { [Symbol.dispose]: () => void } | null
  ) {
    this.stmt = stmt;
    this.writeMutex = writeMutex;
    this.getTransactionLock = getTransactionLock;
  }

  /**
   * Executes the statement with given parameters (for INSERT/UPDATE/DELETE).
   * Acquires mutex if not in a transaction.
   */
  async run(params?: unknown[]): Promise<number> {
    // If in transaction, we already hold the lock
    if (this.getTransactionLock()) {
      return this.runSync(params);
    }

    using _lock = await this.writeMutex.acquire();
    return this.runSync(params);
  }

  /**
   * Executes the statement and returns all rows.
   * Does not acquire mutex (reads are safe in WAL mode).
   */
  async all<T extends Row = Row>(params?: unknown[]): Promise<T[]> {
    if (params && params.length > 0) {
      return this.stmt.all<T>(...params);
    }
    return this.stmt.all<T>();
  }

  /**
   * Executes the statement and returns the first row.
   * Does not acquire mutex (reads are safe in WAL mode).
   */
  async get<T extends Row = Row>(params?: unknown[]): Promise<T | null> {
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

  private runSync(params?: unknown[]): number {
    if (params && params.length > 0) {
      return this.stmt.run(...params);
    }
    return this.stmt.run();
  }
}
