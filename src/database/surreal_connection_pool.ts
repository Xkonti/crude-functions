import { Mutex } from "@core/asyncutil/mutex";
import type { Surreal } from "surrealdb";
import type { SurrealConnectionFactory, ConnectionOptions } from "./surreal_connection_factory.ts";
import { SurrealPoolConnectionError } from "./surreal_errors.ts";

/**
 * Cache key for namespace+database combinations.
 */
type CacheKey = `${string}:${string}`;

/**
 * State of a cached connection.
 */
type ConnectionState = "connecting" | "connected" | "closing" | "closed";

/**
 * Internal representation of a cached connection.
 */
interface CachedConnection {
  /** The Surreal SDK instance */
  db: Surreal;
  /** Namespace this connection is bound to */
  namespace: string;
  /** Database this connection is bound to */
  database: string;
  /** Current number of active users */
  refCount: number;
  /** Timer ID for idle timeout (null if in use or not scheduled) */
  idleTimer: number | null;
  /** Connection state */
  state: ConnectionState;
}

/**
 * Options for the SurrealConnectionPool.
 */
export interface SurrealConnectionPoolOptions {
  /** Connection factory for creating new connections */
  factory: SurrealConnectionFactory;
  /** Idle timeout in ms before closing unused connections (default: 300000 = 5 min) */
  idleTimeoutMs?: number;
}

/**
 * Statistics about the connection pool.
 */
export interface PoolStats {
  /** Number of active (non-closed) connections */
  activeConnections: number;
  /** Total reference count across all connections */
  totalRefCount: number;
  /** Per-connection details */
  connectionsByKey: Map<CacheKey, { refCount: number; state: ConnectionState }>;
}

/**
 * Manages a pool of cached SurrealDB connections with reference counting
 * and automatic idle cleanup.
 *
 * ## Design
 *
 * Connections are cached per namespace+database combination. Multiple concurrent
 * callers accessing the same namespace+database share a single connection.
 *
 * ## Usage Pattern
 *
 * ```typescript
 * const pool = new SurrealConnectionPool({ factory: surrealFactory });
 *
 * // Scoped access - connection auto-released after callback
 * const result = await pool.withConnection({ namespace: "system" }, async (db) => {
 *   return await db.select("users");
 * });
 *
 * // During shutdown
 * await pool.closeAll();
 * ```
 *
 * ## Thread Safety
 *
 * - Connection establishment is mutex-protected per cache key
 * - Multiple concurrent `withConnection` calls for same ns+db share one connection
 * - Reference counting ensures connection stays open while in use
 * - Idle timeout only starts when refCount drops to 0
 */
export class SurrealConnectionPool {
  private readonly factory: SurrealConnectionFactory;
  private readonly idleTimeoutMs: number;
  private readonly cache: Map<CacheKey, CachedConnection> = new Map();
  private readonly connectionMutexes: Map<CacheKey, Mutex> = new Map();

  constructor(options: SurrealConnectionPoolOptions) {
    this.factory = options.factory;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Execute a callback with a pooled connection.
   *
   * The connection is acquired from cache (or created if needed),
   * the callback is executed, and the connection is released back
   * to the pool. The caller cannot hold onto the connection beyond
   * the callback scope.
   *
   * @param options - Namespace and database to connect to
   * @param callback - Function to execute with the connection
   * @returns Result of the callback
   * @throws SurrealPoolConnectionError if connection cannot be established
   */
  async withConnection<T>(
    options: ConnectionOptions,
    callback: (db: Surreal) => Promise<T>
  ): Promise<T> {
    const namespace = options.namespace ?? this.factory.namespace;
    const database = options.database ?? this.factory.database;
    const key = this.cacheKey(namespace, database);

    // Fast path: existing connected connection
    const existing = this.cache.get(key);
    if (existing?.state === "connected") {
      return this.useConnection(existing, key, callback);
    }

    // Slow path: need mutex to establish connection
    const mutex = this.getOrCreateMutex(key);
    using _lock = await mutex.acquire();

    // Double-check after acquiring lock (another caller may have established it)
    const afterLock = this.cache.get(key);
    if (afterLock?.state === "connected") {
      return this.useConnection(afterLock, key, callback);
    }

    // Handle connection in transitional state
    if (afterLock?.state === "closing") {
      // Wait for close to complete, then establish new connection
      // This is rare but can happen during shutdown race
      await this.waitForClose(afterLock);
    }

    // Establish new connection
    const cached = await this.establishConnection(namespace, database, key);
    return this.useConnection(cached, key, callback);
  }

  /**
   * Get current stats for monitoring/debugging.
   */
  getStats(): PoolStats {
    let totalRefCount = 0;
    const connectionsByKey = new Map<CacheKey, { refCount: number; state: ConnectionState }>();

    for (const [key, cached] of this.cache.entries()) {
      totalRefCount += cached.refCount;
      connectionsByKey.set(key, {
        refCount: cached.refCount,
        state: cached.state,
      });
    }

    return {
      activeConnections: this.cache.size,
      totalRefCount,
      connectionsByKey,
    };
  }

  /**
   * Close all cached connections immediately.
   * Called during application shutdown.
   */
  async closeAll(): Promise<void> {
    const closePromises: Promise<void>[] = [];

    for (const [key, cached] of this.cache.entries()) {
      // Cancel any idle timer
      if (cached.idleTimer !== null) {
        clearTimeout(cached.idleTimer);
        cached.idleTimer = null;
      }

      // Mark as closing
      cached.state = "closing";

      // Close the connection
      closePromises.push(
        (async () => {
          if (cached.refCount > 0) {
            console.warn(
              `[SurrealConnectionPool] Closing connection ${key} with ${cached.refCount} active users`
            );
          }
          try {
            await cached.db.close();
          } catch (error) {
            console.error(`[SurrealConnectionPool] Error closing ${key}:`, error);
          }
          cached.state = "closed";
        })()
      );
    }

    await Promise.all(closePromises);
    this.cache.clear();
    this.connectionMutexes.clear();
  }

  /**
   * Close a specific cached connection.
   * Mainly for testing - normally connections are closed via idle timeout or closeAll().
   */
  async closeConnection(options: ConnectionOptions): Promise<void> {
    const namespace = options.namespace ?? "system";
    const database = options.database ?? "system";
    const key = this.cacheKey(namespace, database);

    const cached = this.cache.get(key);
    if (!cached) {
      return; // Nothing to close
    }

    // Cancel idle timer
    if (cached.idleTimer !== null) {
      clearTimeout(cached.idleTimer);
      cached.idleTimer = null;
    }

    // Close and remove
    cached.state = "closing";
    try {
      await cached.db.close();
    } catch (error) {
      console.error(`[SurrealConnectionPool] Error closing ${key}:`, error);
    }
    cached.state = "closed";
    this.cache.delete(key);
    this.connectionMutexes.delete(key);
  }

  /**
   * Create cache key from namespace and database.
   */
  private cacheKey(namespace: string, database: string): CacheKey {
    return `${namespace}:${database}`;
  }

  /**
   * Get or create mutex for a cache key.
   */
  private getOrCreateMutex(key: CacheKey): Mutex {
    let mutex = this.connectionMutexes.get(key);
    if (!mutex) {
      mutex = new Mutex();
      this.connectionMutexes.set(key, mutex);
    }
    return mutex;
  }

  /**
   * Establish a new connection and add it to the cache.
   */
  private async establishConnection(
    namespace: string,
    database: string,
    key: CacheKey
  ): Promise<CachedConnection> {
    // Remove any existing closed entry
    this.cache.delete(key);

    try {
      const db = await this.factory.connect({ namespace, database });

      const cached: CachedConnection = {
        db,
        namespace,
        database,
        refCount: 0, // Will be incremented by useConnection
        idleTimer: null,
        state: "connected",
      };

      this.cache.set(key, cached);
      return cached;
    } catch (error) {
      throw new SurrealPoolConnectionError(namespace, database, error);
    }
  }

  /**
   * Use a cached connection for a callback, managing ref count and idle timer.
   */
  private async useConnection<T>(
    cached: CachedConnection,
    key: CacheKey,
    callback: (db: Surreal) => Promise<T>
  ): Promise<T> {
    // Cancel idle timer if running
    if (cached.idleTimer !== null) {
      clearTimeout(cached.idleTimer);
      cached.idleTimer = null;
    }

    cached.refCount++;

    try {
      return await callback(cached.db);
    } catch (error) {
      // Check if this looks like a connection error
      if (this.isConnectionError(error)) {
        // Mark connection for removal on release
        cached.state = "closed";
      }
      throw error;
    } finally {
      cached.refCount--;

      if (cached.refCount === 0) {
        if (cached.state === "closed") {
          // Connection died during use - clean up
          this.cache.delete(key);
          this.connectionMutexes.delete(key);
          // Try to close, but don't wait or throw
          cached.db.close().catch(() => {});
        } else if (cached.state === "connected") {
          // Start idle timer
          this.startIdleTimer(cached, key);
        }
      }
    }
  }

  /**
   * Start the idle timeout timer for a connection.
   */
  private startIdleTimer(cached: CachedConnection, key: CacheKey): void {
    cached.idleTimer = setTimeout(async () => {
      // Only close if still idle and connected
      if (cached.refCount === 0 && cached.state === "connected") {
        cached.state = "closing";
        try {
          await cached.db.close();
        } catch (error) {
          console.error(`[SurrealConnectionPool] Error closing idle connection ${key}:`, error);
        } finally {
          cached.state = "closed";
          this.cache.delete(key);
          this.connectionMutexes.delete(key);
        }
      }
    }, this.idleTimeoutMs);
  }

  /**
   * Wait for a connection that's closing to finish closing.
   */
  private async waitForClose(cached: CachedConnection): Promise<void> {
    // Simple polling - connection should close quickly
    const maxWaitMs = 5000;
    const pollIntervalMs = 50;
    let waited = 0;

    while (cached.state === "closing" && waited < maxWaitMs) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      waited += pollIntervalMs;
    }

    if (cached.state === "closing") {
      console.warn("[SurrealConnectionPool] Timed out waiting for connection to close");
    }
  }

  /**
   * Check if an error looks like a connection failure.
   */
  private isConnectionError(error: unknown): boolean {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    return (
      message.includes("connection") ||
      message.includes("closed") ||
      message.includes("disconnected") ||
      message.includes("websocket") ||
      message.includes("econnrefused") ||
      message.includes("econnreset")
    );
  }
}
