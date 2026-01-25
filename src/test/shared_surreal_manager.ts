/**
 * Shared SurrealDB manager for test infrastructure.
 *
 * Provides a single SurrealDB process shared across all tests, with
 * namespace isolation for test independence. This dramatically improves
 * test performance by avoiding process startup overhead per test.
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
 */

import { Surreal } from "surrealdb";
import { SurrealProcessManager } from "../database/surreal_process_manager.ts";
import { SurrealConnectionFactory } from "../database/surreal_connection_factory.ts";

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
 * Singleton manager for shared SurrealDB test infrastructure.
 */
export class SharedSurrealManager {
  private static instance: SharedSurrealManager | null = null;

  // Promise-based lock for thread-safe initialization
  private startPromise: Promise<void> | null = null;
  private isStarted = false;

  // SurrealDB components (created on first start)
  // Note: We don't use supervisor/health monitor for tests - simpler is better.
  // If SurrealDB crashes, tests will fail naturally.
  private processManager: SurrealProcessManager | null = null;
  private adminFactory: SurrealConnectionFactory | null = null;
  private adminDb: Surreal | null = null;

  // Fixed port for shared instance (avoid ephemeral port conflicts)
  private readonly port = 54321;
  private readonly username = "root";
  private readonly password = "root";

  private constructor() {
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
   * Ensure the shared SurrealDB process is started.
   *
   * Thread-safe: multiple concurrent calls will all wait for the
   * same initialization to complete.
   */
  async ensureStarted(): Promise<void> {
    // Already started - fast path
    if (this.isStarted && this.processManager?.isRunning) {
      return;
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
      connectionUrl: this.processManager!.connectionUrl,
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
    return this.processManager?.connectionUrl ?? "";
  }

  /**
   * Check if the shared instance is running.
   */
  get isRunning(): boolean {
    return this.isStarted && (this.processManager?.isRunning ?? false);
  }

  /**
   * Stop the shared SurrealDB process.
   * Normally called automatically on process exit.
   */
  async stop(): Promise<void> {
    if (!this.isStarted) {
      return;
    }

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

    this.isStarted = false;
    this.processManager = null;
    this.adminFactory = null;
    this.adminDb = null;
  }

  /**
   * Internal: perform the actual startup.
   */
  private async doStart(): Promise<void> {
    console.log(
      "[SharedSurrealManager] Starting shared SurrealDB instance (memory mode)..."
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

    this.isStarted = true;
    console.log(
      `[SharedSurrealManager] SurrealDB running on ${this.processManager.connectionUrl}`
    );
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
