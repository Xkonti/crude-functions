import { SurrealDatabaseService } from "./surreal_database_service.ts";

/**
 * Configuration options for creating a scoped connection.
 */
export interface SurrealScopedConnectionOptions {
  /** WebSocket connection URL */
  connectionUrl: string;
  /** Username for authentication */
  username: string;
  /** Password for authentication */
  password: string;
  /** Namespace to use */
  namespace: string;
  /** Database name to use */
  database: string;
}

/**
 * A scoped SurrealDB connection that auto-closes via Symbol.dispose.
 *
 * This class provides automatic connection cleanup when used with the
 * `using` statement (TypeScript 5.2+). The connection is automatically
 * closed when the scope exits, even if an error occurs.
 *
 * @example
 * ```typescript
 * // Basic usage with `using` statement
 * using connection = await SurrealScopedConnection.create({
 *   connectionUrl: "ws://127.0.0.1:5173",
 *   username: "root",
 *   password: "root",
 *   namespace: "crude",
 *   database: "main",
 * });
 *
 * const users = await connection.db.select("user");
 * // Connection auto-closes when scope exits
 * ```
 *
 * @example
 * ```typescript
 * // With async disposal
 * await using connection = await SurrealScopedConnection.create(options);
 * await connection.db.create("user", { name: "Alice" });
 * // Connection waits for close() to complete before continuing
 * ```
 *
 * @example
 * ```typescript
 * // Manual cleanup (if not using `using`)
 * const connection = await SurrealScopedConnection.create(options);
 * try {
 *   await connection.db.query("SELECT * FROM user");
 * } finally {
 *   await connection.dispose();
 * }
 * ```
 */
export class SurrealScopedConnection implements Disposable, AsyncDisposable {
  private readonly service: SurrealDatabaseService;
  private disposed = false;

  private constructor(service: SurrealDatabaseService) {
    this.service = service;
  }

  /**
   * Create and open a new scoped connection.
   *
   * @param options - Connection configuration
   * @returns A new scoped connection with an open database connection
   * @throws If the connection fails to open
   */
  static async create(
    options: SurrealScopedConnectionOptions
  ): Promise<SurrealScopedConnection> {
    const service = new SurrealDatabaseService({
      connectionUrl: options.connectionUrl,
      username: options.username,
      password: options.password,
      namespace: options.namespace,
      database: options.database,
    });

    await service.open();
    return new SurrealScopedConnection(service);
  }

  /**
   * Get the underlying database service.
   *
   * @throws If the connection has been disposed
   */
  get db(): SurrealDatabaseService {
    if (this.disposed) {
      throw new Error("SurrealScopedConnection has been disposed");
    }
    return this.service;
  }

  /**
   * Check if the connection is still open (not disposed).
   */
  get isOpen(): boolean {
    return !this.disposed && this.service.isOpen;
  }

  /**
   * Check if the connection has been disposed.
   */
  get isDisposed(): boolean {
    return this.disposed;
  }

  /**
   * Implements Symbol.dispose for synchronous automatic cleanup.
   *
   * This method is called automatically when using the `using` statement.
   * The close operation is fire-and-forget to conform to the synchronous
   * Disposable interface.
   */
  [Symbol.dispose](): void {
    if (!this.disposed) {
      this.disposed = true;
      // Fire-and-forget close - synchronous dispose cannot await
      this.service.close().catch((error) => {
        console.error("[SurrealScopedConnection] Error closing connection:", error);
      });
    }
  }

  /**
   * Implements Symbol.asyncDispose for asynchronous automatic cleanup.
   *
   * This method is called automatically when using the `await using` statement.
   * The close operation is awaited to ensure proper cleanup.
   */
  async [Symbol.asyncDispose](): Promise<void> {
    await this.dispose();
  }

  /**
   * Explicit async dispose for manual cleanup.
   *
   * Use this when not using the `using` statement.
   */
  async dispose(): Promise<void> {
    if (!this.disposed) {
      this.disposed = true;
      await this.service.close();
    }
  }
}
