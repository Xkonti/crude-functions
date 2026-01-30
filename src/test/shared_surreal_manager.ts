/**
 * Shared SurrealDB manager for test infrastructure.
 *
 * Provides a single SurrealDB process shared across all tests, with
 * namespace isolation for test independence. This dramatically improves
 * test performance by avoiding process startup overhead per test.
 *
 * ## External Instance Detection
 *
 * When `ensureStarted()` is called, the manager first tries to connect to
 * an existing SurrealDB instance at the configured port. If successful,
 * it uses the external instance instead of starting a new one. This enables:
 *
 * - Parallel test execution with a shared external SurrealDB
 * - IDE/debugger integration with a manually started instance
 * - CI/CD setups where SurrealDB is started separately
 *
 * ## Configuration
 *
 * Environment variables:
 * - `SURREAL_TEST_PORT` - Port for shared instance (default: 54321)
 * - `SURREAL_TEST_USER` - Username (default: root)
 * - `SURREAL_TEST_PASS` - Password (default: root)
 * - `SURREAL_TEST_TIMEOUT` - Connection timeout in ms (default: 1000)
 *
 * ## Usage Pattern
 *
 * ```typescript
 * // In test setup (via TestSetupBuilder)
 * const manager = SharedSurrealManager.getInstance();
 * await manager.ensureStarted();
 * const ctx = await manager.createTestContext();
 *
 * // ctx.surrealDb is connected to unique namespace
 * // ctx.namespace/ctx.database for reference
 *
 * // In test cleanup
 * await manager.deleteTestContext(ctx.namespace);
 * ```
 *
 * ## Thread Safety
 *
 * Uses Promise-based locking for safe concurrent initialization.
 * Multiple tests calling ensureStarted() simultaneously will all
 * wait for the single initialization to complete.
 *
 * ## Cleanup
 *
 * Process cleanup is registered via `globalThis.addEventListener("unload", ...)`.
 * This ensures the process is stopped when the test runner exits.
 * For external instances, only connections are closed (process is not stopped).
 */

import { Surreal } from "surrealdb";
import { SurrealProcessManager } from "../database/surreal_process_manager.ts";
import { SurrealConnectionFactory } from "../database/surreal_connection_factory.ts";
import type { DedicatedSurrealContext } from "./types.ts";

/**
 * Context returned when creating a test namespace.
 */
export interface SharedSurrealTestContext {
  /** Unique namespace for this test */
  namespace: string;
  /** Database name within the namespace (same as namespace) */
  database: string;
  /** Raw Surreal SDK connection for this namespace */
  db: Surreal;
  /** Connection factory configured for this test's namespace/database */
  factory: SurrealConnectionFactory;
}

/**
 * Checks if the SurrealDB binary is available at .bin/surreal.
 */
async function isSurrealAvailable(): Promise<boolean> {
  try {
    const stat = await Deno.stat(".bin/surreal");
    return stat.isFile;
  } catch {
    return false;
  }
}

/**
 * Find an available port by binding to port 0 and getting the assigned port.
 * This is the safest way to avoid port conflicts.
 */
function findAvailablePort(): number {
  const listener = Deno.listen({ port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();
  return port;
}

/**
 * Singleton manager for shared SurrealDB test infrastructure.
 */
export class SharedSurrealManager {
  private static instance: SharedSurrealManager | null = null;

  // Promise-based lock for thread-safe initialization
  private startPromise: Promise<void> | null = null;
  private isStarted = false;

  // Track whether we're using an external instance vs managing our own process
  private isExternalInstance = false;

  // SurrealDB components (created on first start)
  // Note: We don't use supervisor/health monitor for tests - simpler is better.
  // If SurrealDB crashes, tests will fail naturally.
  private processManager: SurrealProcessManager | null = null;
  private adminFactory: SurrealConnectionFactory | null = null;
  private adminDb: Surreal | null = null;

  // Configuration from environment variables with defaults
  private readonly port: number;
  private readonly username: string;
  private readonly password: string;
  private readonly connectionTimeoutMs: number;

  private constructor() {
    // Load configuration from environment variables
    this.port = parseInt(Deno.env.get("SURREAL_TEST_PORT") ?? "54321");
    this.username = Deno.env.get("SURREAL_TEST_USER") ?? "root";
    this.password = Deno.env.get("SURREAL_TEST_PASS") ?? "root";
    this.connectionTimeoutMs = parseInt(Deno.env.get("SURREAL_TEST_TIMEOUT") ?? "1000");

    // Register cleanup on process exit
    this.registerCleanup();
  }

  /**
   * Get the singleton instance.
   */
  static getInstance(): SharedSurrealManager {
    if (!SharedSurrealManager.instance) {
      SharedSurrealManager.instance = new SharedSurrealManager();
    }
    return SharedSurrealManager.instance;
  }

  /**
   * Reset the singleton (for testing the manager itself).
   * Should only be called from tests.
   */
  static resetInstance(): void {
    if (SharedSurrealManager.instance?.isStarted) {
      console.warn(
        "[SharedSurrealManager] Resetting while started - call stop() first"
      );
    }
    SharedSurrealManager.instance = null;
  }

  /**
   * Create a dedicated SurrealDB instance for a single test.
   *
   * Use this for tests that need complete isolation from other tests,
   * such as tests that:
   * - Modify namespaces or databases
   * - Test custom database users
   * - Test error handling when the database is unavailable
   * - Need to restart SurrealDB during the test
   *
   * The returned context includes a cleanup function that MUST be called
   * to stop the SurrealDB process and prevent resource leaks.
   *
   * @returns Context with dedicated SurrealDB process
   * @throws Error if SurrealDB binary is not available
   *
   * @example
   * ```typescript
   * const dedicated = await SharedSurrealManager.createDedicatedInstance();
   * try {
   *   // Use dedicated.db, dedicated.factory, etc.
   *   await dedicated.db.query("CREATE test:1 SET name = 'test'");
   * } finally {
   *   await dedicated.cleanup();
   * }
   * ```
   */
  static async createDedicatedInstance(): Promise<DedicatedSurrealContext> {
    // Check if surreal binary is available
    if (!(await isSurrealAvailable())) {
      throw new Error(
        "SurrealDB binary not found at .bin/surreal. Run 'deno task setup' first."
      );
    }

    // Find an available port using ephemeral port discovery
    const port = findAvailablePort();

    console.log(
      `[SharedSurrealManager] Starting dedicated SurrealDB instance on port ${port}...`
    );

    // Create process manager
    const processManager = new SurrealProcessManager({
      binaryPath: ".bin/surreal",
      port,
      storagePath: "/tmp/surreal-dedicated", // Not used in memory mode
      storageMode: "memory",
      username: "root",
      password: "root",
      readinessTimeoutMs: 30000,
    });

    // Start the process
    await processManager.start();

    // Create connection factory
    const factory = new SurrealConnectionFactory({
      connectionUrl: processManager.connectionUrl,
      username: "root",
      password: "root",
    });

    // Create a connection
    const db = await factory.connect({
      namespace: "test",
      database: "test",
    });

    console.log(
      `[SharedSurrealManager] Dedicated instance running at ${processManager.connectionUrl}`
    );

    return {
      processManager,
      factory,
      db,
      connectionUrl: processManager.connectionUrl,
      port,
      async cleanup() {
        console.log(
          `[SharedSurrealManager] Stopping dedicated instance on port ${port}...`
        );
        try {
          await db.close();
        } catch {
          // Ignore close errors
        }
        await processManager.stop();
      },
    };
  }

  /**
   * Ensure the shared SurrealDB process is started or connected to external instance.
   *
   * First attempts to connect to an existing SurrealDB at the configured port.
   * If successful, uses that instance. If not, starts a new local process.
   *
   * Thread-safe: multiple concurrent calls will all wait for the
   * same initialization to complete.
   */
  async ensureStarted(): Promise<void> {
    // Already started - fast path (works for both external and local)
    if (this.isStarted) {
      // For local instance, verify it's still running
      if (!this.isExternalInstance && !this.processManager?.isRunning) {
        // Local process died, reset and try again
        this.isStarted = false;
      } else {
        return;
      }
    }

    // Promise-based lock: if starting, wait for that promise
    if (this.startPromise) {
      return this.startPromise;
    }

    // Start initialization (first caller wins)
    this.startPromise = this.doStart();

    try {
      await this.startPromise;
    } finally {
      // Clear the promise after completion (success or failure)
      // This allows retry on failure
      this.startPromise = null;
    }
  }

  /**
   * Create an isolated test context with unique namespace.
   *
   * @returns Context with raw Surreal connection and factory
   */
  async createTestContext(): Promise<SharedSurrealTestContext> {
    await this.ensureStarted();

    // Generate unique namespace using UUID (replace hyphens for valid identifier)
    const namespace = `test_${crypto.randomUUID().replace(/-/g, "_")}`;
    const database = namespace; // Use same name for simplicity

    // Create namespace and database using admin connection
    // SurrealDB auto-creates namespace/database when you USE them, but we define explicitly
    await this.adminDb!.query(`DEFINE NAMESPACE ${namespace}`);
    await this.adminDb!.query(
      `USE NAMESPACE ${namespace}; DEFINE DATABASE ${database}`
    );

    // Create a factory for this test's namespace with defaults set
    const factory = new SurrealConnectionFactory({
      connectionUrl: this.connectionUrl,
      username: this.username,
      password: this.password,
      defaultNamespace: namespace,
      defaultDatabase: database,
    });

    // Create a pre-opened connection for convenience (uses factory defaults)
    const db = await factory.connect();

    return {
      namespace,
      database,
      db,
      factory,
    };
  }

  /**
   * Delete a test context (removes the namespace and all data).
   *
   * @param namespace - The namespace to remove
   * @param db - The Surreal connection to close
   */
  async deleteTestContext(namespace: string, db?: Surreal): Promise<void> {
    // Close the test's database connection first
    if (db) {
      try {
        await db.close();
      } catch {
        // Ignore close errors
      }
    }

    if (!this.adminDb) {
      return; // Nothing to clean up if not running
    }

    try {
      await this.adminDb.query(`REMOVE NAMESPACE ${namespace}`);
    } catch (error) {
      // Log but don't throw - namespace might already be gone
      console.warn(
        `[SharedSurrealManager] Failed to remove namespace ${namespace}:`,
        error
      );
    }
  }

  /**
   * Get the connection URL (for tests that need it).
   */
  get connectionUrl(): string {
    if (this.isExternalInstance) {
      return `ws://127.0.0.1:${this.port}`;
    }
    return this.processManager?.connectionUrl ?? "";
  }

  /**
   * Check if the shared instance is running.
   */
  get isRunning(): boolean {
    if (this.isExternalInstance) {
      return this.isStarted;
    }
    return this.isStarted && (this.processManager?.isRunning ?? false);
  }

  /**
   * Check if we're using an external SurrealDB instance.
   */
  get usingExternalInstance(): boolean {
    return this.isExternalInstance;
  }

  /**
   * Stop the shared SurrealDB process.
   * Normally called automatically on process exit.
   *
   * For external instances, only closes connections (doesn't stop the process).
   */
  async stop(): Promise<void> {
    if (!this.isStarted) {
      return;
    }

    if (this.isExternalInstance) {
      console.log("[SharedSurrealManager] Closing connections to external SurrealDB...");
      try {
        if (this.adminDb) {
          await this.adminDb.close();
        }
      } catch (error) {
        console.error("[SharedSurrealManager] Error closing connections:", error);
      }
    } else {
      console.log("[SharedSurrealManager] Stopping shared SurrealDB instance...");
      try {
        // Close admin DB connection first
        if (this.adminDb) {
          await this.adminDb.close();
        }

        // Stop the process
        if (this.processManager?.isRunning) {
          await this.processManager.stop();
        }
      } catch (error) {
        console.error("[SharedSurrealManager] Error during stop:", error);
      }
    }

    this.isStarted = false;
    this.isExternalInstance = false;
    this.processManager = null;
    this.adminFactory = null;
    this.adminDb = null;
  }

  /**
   * Internal: perform the actual startup.
   *
   * First tries to connect to an existing SurrealDB instance.
   * If that fails, starts a local process.
   */
  private async doStart(): Promise<void> {
    const externalUrl = `ws://127.0.0.1:${this.port}`;

    // Step 1: Try connecting to external instance first
    if (await this.tryConnectExternal()) {
      console.log(
        `[SharedSurrealManager] Connected to external SurrealDB at ${externalUrl}`
      );

      // Set up admin connection to external instance
      this.adminFactory = new SurrealConnectionFactory({
        connectionUrl: externalUrl,
        username: this.username,
        password: this.password,
      });

      this.adminDb = await this.adminFactory.connect({
        namespace: "test",
        database: "admin",
      });

      this.isExternalInstance = true;
      this.isStarted = true;
      return;
    }

    // Step 2: No external instance - start our own
    console.log(
      "[SharedSurrealManager] No external instance found, starting local process (memory mode)..."
    );

    // Check if surreal binary is available
    if (!(await isSurrealAvailable())) {
      throw new Error(
        "SurrealDB binary not found at .bin/surreal. Run 'deno task setup' first."
      );
    }

    // Create process manager with memory mode
    this.processManager = new SurrealProcessManager({
      binaryPath: ".bin/surreal",
      port: this.port,
      storagePath: "/tmp/surreal-test", // Only used if mode is surrealkv
      storageMode: "memory", // Key: use memory mode for speed
      username: this.username,
      password: this.password,
      readinessTimeoutMs: 30000,
    });

    // Start the process directly (no supervisor/health monitor for tests)
    await this.processManager.start();

    // Create admin factory
    this.adminFactory = new SurrealConnectionFactory({
      connectionUrl: this.processManager.connectionUrl,
      username: this.username,
      password: this.password,
    });

    // Create admin connection (for namespace management)
    this.adminDb = await this.adminFactory.connect({
      namespace: "test",
      database: "admin",
    });

    this.isExternalInstance = false;
    this.isStarted = true;
    console.log(
      `[SharedSurrealManager] SurrealDB running on ${this.processManager.connectionUrl}`
    );
  }

  /**
   * Try to connect to an external SurrealDB instance.
   *
   * @returns true if successfully connected, false otherwise
   */
  private async tryConnectExternal(): Promise<boolean> {
    const healthUrl = `http://127.0.0.1:${this.port}/health`;
    const wsUrl = `ws://127.0.0.1:${this.port}`;

    try {
      // Quick health check via HTTP
      const response = await fetch(healthUrl, {
        signal: AbortSignal.timeout(this.connectionTimeoutMs),
      });
      if (!response.ok) {
        return false;
      }

      // Verify we can authenticate via WebSocket
      const testDb = new Surreal();
      await testDb.connect(wsUrl);
      await testDb.signin({ username: this.username, password: this.password });
      await testDb.close();

      return true;
    } catch {
      // Connection failed - no external instance available
      return false;
    }
  }

  /**
   * Register cleanup handler for process exit.
   */
  private registerCleanup(): void {
    // Use unload event to clean up on test runner exit
    globalThis.addEventListener("unload", () => {
      if (this.isStarted) {
        // Synchronous cleanup best effort
        console.log(
          "[SharedSurrealManager] Process exit - stopping SurrealDB..."
        );
        // Note: Can't await in unload handler, but stop() handles this gracefully
        this.stop().catch((e) =>
          console.error("[SharedSurrealManager] Cleanup error:", e)
        );
      }
    });
  }
}
