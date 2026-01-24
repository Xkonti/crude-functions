import { Surreal, Table, RecordId } from "surrealdb";
import {
  SurrealDatabaseNotOpenError,
  SurrealDatabaseAccessError,
  SurrealQueryError,
} from "./surreal_errors.ts";

/**
 * Configuration options for the SurrealDatabaseService
 */
export interface SurrealDatabaseServiceOptions {
  /** WebSocket connection URL (e.g., "ws://127.0.0.1:5173") */
  connectionUrl: string;
  /** Root username for authentication */
  username?: string;
  /** Root password for authentication */
  password?: string;
  /** Namespace to use (default: "crude") */
  namespace?: string;
  /** Database name to use (default: "main") */
  database?: string;
}

/**
 * A SurrealDB database service that connects via WebSocket to a running SurrealDB server.
 *
 * Runs alongside the existing SQLite DatabaseService for experimental features.
 * The SurrealDB server is managed by SurrealProcessManager as a sidecar process.
 *
 * @example
 * ```typescript
 * const surrealDb = new SurrealDatabaseService({
 *   connectionUrl: "ws://127.0.0.1:5173",
 *   username: "root",
 *   password: "root",
 * });
 * await surrealDb.open();
 *
 * // Create a record
 * const user = await surrealDb.create("user", { name: "Alice", email: "alice@example.com" });
 *
 * // Query records
 * const users = await surrealDb.select("user");
 *
 * // Run SurrealQL query
 * const results = await surrealDb.query("SELECT * FROM user WHERE name = $name", { name: "Alice" });
 *
 * await surrealDb.close();
 * ```
 */
export class SurrealDatabaseService {
  private readonly connectionUrl: string;
  private readonly username: string;
  private readonly password: string;
  private readonly namespace: string;
  private readonly database: string;

  private db: Surreal | null = null;

  constructor(options: SurrealDatabaseServiceOptions) {
    this.connectionUrl = options.connectionUrl;
    this.username = options.username ?? "root";
    this.password = options.password ?? "root";
    this.namespace = options.namespace ?? "crude";
    this.database = options.database ?? "main";
  }

  // ============== Connection Management ==============

  /**
   * Opens the database connection via WebSocket.
   * Authenticates with root credentials and selects namespace/database.
   */
  async open(): Promise<void> {
    if (this.db) return; // Already open

    try {
      // Create Surreal instance (no engines needed for WebSocket connection)
      this.db = new Surreal();

      // Connect to SurrealDB server via WebSocket
      await this.db.connect(this.connectionUrl);

      // Authenticate as root user
      await this.db.signin({
        username: this.username,
        password: this.password,
      });

      // Select namespace and database
      await this.db.use({
        namespace: this.namespace,
        database: this.database,
      });
    } catch (error) {
      this.db = null;
      throw new SurrealDatabaseAccessError(this.connectionUrl, error);
    }
  }

  /**
   * Closes the database connection.
   * Safe to call multiple times.
   */
  async close(): Promise<void> {
    if (!this.db) return;

    await this.db.close();
    this.db = null;
  }

  /**
   * Returns true if the database connection is open.
   */
  get isOpen(): boolean {
    return this.db !== null;
  }

  /**
   * Returns the version of the connected SurrealDB engine.
   *
   * @returns Version info, e.g., { version: "surrealdb-3.0.0-beta.2" }
   */
  async version(): Promise<{ version: string }> {
    this.ensureOpen();
    return await this.db!.version();
  }

  // ============== CRUD Operations ==============

  /**
   * Creates a new record in a table.
   *
   * @param table - The table name
   * @param data - The data to store
   * @returns The created record with its ID
   */
  async create<T>(table: string, data: T): Promise<T & { id: unknown }> {
    this.ensureOpen();

    try {
      // v2 API uses fluent pattern: create(table).content(data)
      const result = await this.db!.create(new Table(table)).content(
        data as Record<string, unknown>
      );
      // create with Table returns an array of created records
      if (Array.isArray(result) && result.length > 0) {
        return result[0] as unknown as T & { id: unknown };
      }
      return result as unknown as T & { id: unknown };
    } catch (error) {
      throw new SurrealQueryError(`CREATE ${table}`, error);
    }
  }

  /**
   * Selects all records from a table.
   *
   * @param table - The table name
   * @returns Array of records
   */
  async select<T = Record<string, unknown>>(table: string): Promise<T[]> {
    this.ensureOpen();

    try {
      const result = await this.db!.select(new Table(table));
      return result as unknown as T[];
    } catch (error) {
      throw new SurrealQueryError(`SELECT ${table}`, error);
    }
  }

  /**
   * Selects a single record by ID.
   *
   * @param table - The table name
   * @param id - The record ID
   * @returns The record or null if not found
   */
  async selectOne<T = Record<string, unknown>>(
    table: string,
    id: string
  ): Promise<T | null> {
    this.ensureOpen();

    try {
      const result = await this.db!.select(new RecordId(table, id));
      return (result as unknown as T) ?? null;
    } catch (error) {
      throw new SurrealQueryError(`SELECT ${table}:${id}`, error);
    }
  }

  /**
   * Updates a record by ID (replaces all fields).
   *
   * @param table - The table name
   * @param id - The record ID
   * @param data - The new data
   * @returns The updated record
   */
  async update<T>(
    table: string,
    id: string,
    data: T
  ): Promise<T & { id: unknown }> {
    this.ensureOpen();

    try {
      // v2 API uses fluent pattern: update(recordId).replace(data)
      const result = await this.db!.update(new RecordId(table, id)).replace(
        data as Record<string, unknown>
      );
      return result as unknown as T & { id: unknown };
    } catch (error) {
      throw new SurrealQueryError(`UPDATE ${table}:${id}`, error);
    }
  }

  /**
   * Merges data into an existing record (partial update).
   *
   * @param table - The table name
   * @param id - The record ID
   * @param data - The data to merge
   * @returns The updated record
   */
  async merge<T>(
    table: string,
    id: string,
    data: Partial<T>
  ): Promise<T & { id: unknown }> {
    this.ensureOpen();

    try {
      // v2 API uses fluent pattern: update(recordId).merge(data)
      const result = await this.db!.update(new RecordId(table, id)).merge(
        data as Record<string, unknown>
      );
      return result as unknown as T & { id: unknown };
    } catch (error) {
      throw new SurrealQueryError(`MERGE ${table}:${id}`, error);
    }
  }

  /**
   * Deletes a record by ID.
   *
   * @param table - The table name
   * @param id - The record ID
   */
  async delete(table: string, id: string): Promise<void> {
    this.ensureOpen();

    try {
      await this.db!.delete(new RecordId(table, id));
    } catch (error) {
      throw new SurrealQueryError(`DELETE ${table}:${id}`, error);
    }
  }

  /**
   * Deletes all records from a table.
   *
   * @param table - The table name
   */
  async deleteAll(table: string): Promise<void> {
    this.ensureOpen();

    try {
      await this.db!.delete(new Table(table));
    } catch (error) {
      throw new SurrealQueryError(`DELETE ${table}`, error);
    }
  }

  // ============== Query Operations ==============

  /**
   * Executes a SurrealQL query.
   *
   * @param sql - The SurrealQL query
   * @param vars - Optional variables to bind
   * @returns Query results
   */
  async query<T = unknown>(
    sql: string,
    vars?: Record<string, unknown>
  ): Promise<T[]> {
    this.ensureOpen();

    try {
      const result = await this.db!.query(sql, vars);
      // SurrealDB returns array of result sets, flatten for simple queries
      if (Array.isArray(result) && result.length === 1) {
        return result[0] as unknown as T[];
      }
      return result as unknown as T[];
    } catch (error) {
      throw new SurrealQueryError(sql, error);
    }
  }

  // ============== Private Helpers ==============

  private ensureOpen(): void {
    if (!this.db) {
      throw new SurrealDatabaseNotOpenError();
    }
  }
}
