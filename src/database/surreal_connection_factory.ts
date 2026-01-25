import { Surreal } from "surrealdb";
import { SurrealDatabaseAccessError } from "./surreal_errors.ts";

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
 * Provides a thin wrapper around the SurrealDB SDK that handles connection
 * configuration and lifecycle, returning raw Surreal instances for full
 * SDK access.
 *
 * @example
 * ```typescript
 * const factory = new SurrealConnectionFactory({
 *   connectionUrl: "ws://127.0.0.1:5173",
 *   username: "root",
 *   password: "root",
 * });
 *
 * // Get a connection to system/system (default)
 * const db = await factory.systemConnection();
 * const users = await db.select("users");
 * await db.close();
 *
 * // Or use auto-close pattern
 * const result = await factory.withConnection({}, async (db) => {
 *   return await db.select("users");
 * });
 * ```
 */
export class SurrealConnectionFactory {
  private readonly connectionUrl: string;
  private readonly username: string;
  private readonly password: string;

  constructor(options: SurrealConnectionFactoryOptions) {
    this.connectionUrl = options.connectionUrl;
    this.username = options.username;
    this.password = options.password;
  }

  /**
   * Creates a connection to the system namespace/database.
   *
   * This is the default for server configuration and data.
   * Caller owns the connection and is responsible for closing it.
   *
   * @returns Raw Surreal SDK instance connected to system/system
   */
  async systemConnection(): Promise<Surreal> {
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
