import { Surreal } from "surrealdb";
import { SurrealDatabaseAccessError, SurrealPoolNotInitializedError } from "./surreal_errors.ts";
import { SurrealConnectionPool, type PoolStats } from "./surreal_connection_pool.ts";

/**
 * Configuration for the SurrealDB connection factory.
 */
export interface SurrealConnectionFactoryOptions {
  /** WebSocket connection URL (e.g., "ws://127.0.0.1:5173") */
  connectionUrl: string;
  /** Root username for authentication */
  username: string;
  /** Root password for authentication */
  password: string;
}

/**
 * Options for creating a connection to a specific namespace/database.
 */
export interface ConnectionOptions {
  /** Target namespace (default: "system") */
  namespace?: string;
  /** Target database (default: "system") */
  database?: string;
}

/**
 * Factory for creating SurrealDB connections.
 *
 * Provides two connection modes:
 *
 * 1. **Pooled connections** (recommended for services):
 *    Use `initializePool()` at startup, then `withSystemConnection()`.
 *    Connections are cached per namespace+database and reused.
 *
 * 2. **Unique connections** (for migrations, special cases):
 *    Use `connect()` or `withConnection()` directly.
 *    Caller owns the connection and must close it.
 *
 * @example
 * ```typescript
 * const factory = new SurrealConnectionFactory({
 *   connectionUrl: "ws://127.0.0.1:5173",
 *   username: "root",
 *   password: "root",
 * });
 *
 * // Initialize pool at startup
 * factory.initializePool();
 *
 * // Use pooled connection (preferred for services)
 * const users = await factory.withSystemConnection({}, async (db) => {
 *   return await db.select("users");
 * });
 *
 * // Use unique connection (for migrations, isolated operations)
 * const db = await factory.connect();
 * try {
 *   await db.query("DEFINE TABLE ...");
 * } finally {
 *   await db.close();
 * }
 *
 * // Shutdown
 * await factory.closePool();
 * ```
 */
export class SurrealConnectionFactory {
  private readonly connectionUrl: string;
  private readonly username: string;
  private readonly password: string;
  private pool: SurrealConnectionPool | null = null;

  constructor(options: SurrealConnectionFactoryOptions) {
    this.connectionUrl = options.connectionUrl;
    this.username = options.username;
    this.password = options.password;
  }

  // ============== Pool Management ==============

  /**
   * Initialize the connection pool for cached system connections.
   *
   * Should be called during application startup after SurrealDB is ready.
   * Once initialized, use `withSystemConnection()` for pooled access.
   *
   * @param options - Pool configuration
   */
  initializePool(options?: { idleTimeoutMs?: number }): void {
    if (this.pool) {
      console.warn("[SurrealConnectionFactory] Pool already initialized");
      return;
    }
    this.pool = new SurrealConnectionPool({
      factory: this,
      idleTimeoutMs: options?.idleTimeoutMs,
    });
  }

  /**
   * Execute callback with a pooled system connection.
   *
   * This is the preferred method for most service operations.
   * The connection is cached and reused across calls, with automatic
   * cleanup after 5 minutes of inactivity.
   *
   * @param options - Namespace and database to connect to
   * @param callback - Function to execute with the connection
   * @returns Result of the callback
   * @throws SurrealPoolNotInitializedError if pool is not initialized
   * @throws SurrealPoolConnectionError if connection cannot be established
   */
  withSystemConnection<T>(
    options: ConnectionOptions,
    callback: (db: Surreal) => Promise<T>
  ): Promise<T> {
    if (!this.pool) {
      throw new SurrealPoolNotInitializedError();
    }
    return this.pool.withConnection(options, callback);
  }

  /**
   * Close the connection pool and all cached connections.
   * Called during application shutdown.
   */
  async closePool(): Promise<void> {
    if (this.pool) {
      await this.pool.closeAll();
      this.pool = null;
    }
  }

  /**
   * Get pool statistics for monitoring.
   * Returns null if pool is not initialized.
   */
  getPoolStats(): PoolStats | null {
    return this.pool?.getStats() ?? null;
  }

  /**
   * Check if the pool is initialized.
   */
  get isPoolInitialized(): boolean {
    return this.pool !== null;
  }

  // ============== Unique Connections ==============

  /**
   * Creates a connection to the system namespace/database.
   *
   * This is the default for server configuration and data.
   * Caller owns the connection and is responsible for closing it.
   *
   * @returns Raw Surreal SDK instance connected to system/system
   */
  systemConnection(): Promise<Surreal> {
    return this.connect({ namespace: "system", database: "system" });
  }

  /**
   * Creates a connection to a specific namespace/database.
   *
   * Caller owns the connection and is responsible for closing it.
   *
   * @param options - Namespace and database to connect to (defaults to system/system)
   * @returns Raw Surreal SDK instance
   * @throws SurrealDatabaseAccessError if connection fails
   */
  async connect(options: ConnectionOptions = {}): Promise<Surreal> {
    const namespace = options.namespace ?? "system";
    const database = options.database ?? "system";

    const db = new Surreal();

    try {
      await db.connect(this.connectionUrl);

      await db.signin({
        username: this.username,
        password: this.password,
      });

      await db.use({
        namespace,
        database,
      });

      return db;
    } catch (error) {
      // Clean up on failure
      try {
        await db.close();
      } catch {
        // Ignore close errors during cleanup
      }
      throw new SurrealDatabaseAccessError(this.connectionUrl, error);
    }
  }

  /**
   * Executes a callback with an auto-closing connection.
   *
   * Opens a connection, runs the callback, and closes the connection
   * in a finally block. Ideal for short-lived operations like function
   * handler requests.
   *
   * @param options - Namespace and database to connect to
   * @param callback - Function to execute with the connection
   * @returns Result of the callback
   * @throws SurrealDatabaseAccessError if connection fails
   * @throws Any error thrown by the callback
   *
   * @example
   * ```typescript
   * const users = await factory.withConnection(
   *   { namespace: "tenant_123", database: "main" },
   *   async (db) => {
   *     return await db.select("users");
   *   }
   * );
   * ```
   */
  async withConnection<T>(
    options: ConnectionOptions,
    callback: (db: Surreal) => Promise<T>
  ): Promise<T> {
    const db = await this.connect(options);
    try {
      return await callback(db);
    } finally {
      await db.close();
    }
  }

  /**
   * Performs a health check on the SurrealDB server.
   *
   * Opens a connection, checks if the server is responsive, and closes
   * the connection. Returns true if healthy, false otherwise.
   */
  async healthCheck(): Promise<boolean> {
    try {
      const db = await this.connect();
      try {
        await db.version();
        return true;
      } finally {
        await db.close();
      }
    } catch {
      return false;
    }
  }

  /**
   * Returns the WebSocket connection URL.
   */
  get url(): string {
    return this.connectionUrl;
  }
}
