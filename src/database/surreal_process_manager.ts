import {
  SurrealProcessStartError,
  SurrealProcessReadinessError,
  SurrealProcessExitError,
} from "./surreal_errors.ts";

/**
 * Configuration options for the SurrealProcessManager
 */
/**
 * Callback invoked when the SurrealDB process exits unexpectedly.
 */
export type UnexpectedExitCallback = (exitCode: number | null) => void;

export interface SurrealProcessManagerOptions {
  /** Path to the SurrealDB binary (default: "/surreal" for Docker, "surreal" for local) */
  binaryPath?: string;
  /** Port to bind SurrealDB to (default: 5173) */
  port?: number;
  /** Storage path for SurrealKV (default: "./data/surreal") */
  storagePath?: string;
  /** Storage mode: "memory" for in-memory (fast, ephemeral), "surrealkv" for persistent (default: "surrealkv") */
  storageMode?: "memory" | "surrealkv";
  /** Root username (default: "root") */
  username?: string;
  /** Root password (default: "root") */
  password?: string;
  /** Readiness check timeout in ms (default: 30000) */
  readinessTimeoutMs?: number;
  /** Interval between readiness checks in ms (default: 100) */
  readinessIntervalMs?: number;
  /** Callback for unexpected process exits */
  onUnexpectedExit?: UnexpectedExitCallback;
}

/**
 * Manages a SurrealDB server process as a sidecar within the same container.
 *
 * Uses Deno.Command to spawn and manage the process lifecycle.
 * Works in both standard and hardened (no-shell) Docker images.
 *
 * @example
 * ```typescript
 * const manager = new SurrealProcessManager({
 *   binaryPath: "/surreal",
 *   port: 5173,
 *   storagePath: "./data/surreal",
 * });
 *
 * await manager.start();
 * console.log("SurrealDB running at:", manager.connectionUrl);
 *
 * // ... use SurrealDB via WebSocket connection ...
 *
 * await manager.stop();
 * ```
 */
export class SurrealProcessManager {
  private readonly binaryPath: string;
  private readonly port: number;
  private readonly storagePath: string;
  private readonly storageMode: "memory" | "surrealkv";
  private readonly username: string;
  private readonly password: string;
  private readonly readinessTimeoutMs: number;
  private readonly readinessIntervalMs: number;
  private readonly onUnexpectedExit?: UnexpectedExitCallback;

  private process: Deno.ChildProcess | null = null;
  private processExitPromise: Promise<Deno.CommandStatus> | null = null;
  private isStopping = false;

  constructor(options: SurrealProcessManagerOptions = {}) {
    this.binaryPath = options.binaryPath ?? "/surreal";
    this.port = options.port ?? 5173;
    this.storagePath = options.storagePath ?? "./data/surreal";
    this.storageMode = options.storageMode ?? "surrealkv";
    this.username = options.username ?? "root";
    this.password = options.password ?? "root";
    this.readinessTimeoutMs = options.readinessTimeoutMs ?? 30000;
    this.readinessIntervalMs = options.readinessIntervalMs ?? 100;
    this.onUnexpectedExit = options.onUnexpectedExit;
  }

  /**
   * Starts the SurrealDB process and waits for it to be ready.
   * Throws if the process fails to start or doesn't become ready within timeout.
   */
  async start(): Promise<void> {
    if (this.process) {
      return; // Already running
    }

    // Only ensure storage directory for surrealkv mode
    if (this.storageMode === "surrealkv") {
      await this.ensureStorageDirectory();
    }

    // Build storage URL based on mode
    const storageUrl = this.storageMode === "memory"
      ? "memory"
      : `surrealkv://${this.storagePath}`;

    const args = [
      "start",
      "--bind",
      `127.0.0.1:${this.port}`,
      "--user",
      this.username,
      "--pass",
      this.password,
      "--log",
      "info",
      storageUrl,
    ];

    try {
      const command = new Deno.Command(this.binaryPath, {
        args,
        stdout: "piped",
        stderr: "piped",
      });

      this.process = command.spawn();
      this.processExitPromise = this.process.status;

      // Start streaming stdout/stderr to console
      this.streamOutput(this.process.stdout, "[SurrealDB]");
      this.streamOutput(this.process.stderr, "[SurrealDB:err]");

      // Monitor for unexpected exit
      this.monitorProcess();

      // Wait for the process to be ready
      await this.waitForReady();
    } catch (error) {
      this.process = null;
      this.processExitPromise = null;
      throw new SurrealProcessStartError(this.binaryPath, error);
    }
  }

  /**
   * Stops the SurrealDB process gracefully.
   * Sends SIGTERM and waits for the process to exit.
   */
  async stop(): Promise<void> {
    if (!this.process) {
      return; // Not running
    }

    this.isStopping = true;

    try {
      // Send SIGTERM for graceful shutdown
      this.process.kill("SIGTERM");

      // Wait for the process to exit (with timeout)
      const timeoutMs = 10000;
      const exitPromise = this.processExitPromise;

      if (exitPromise) {
        const timeoutPromise = new Promise<null>((resolve) =>
          setTimeout(() => resolve(null), timeoutMs)
        );

        const result = await Promise.race([exitPromise, timeoutPromise]);

        if (result === null) {
          // Timeout - force kill
          console.warn("[SurrealDB] Process did not exit gracefully, forcing kill");
          this.process.kill("SIGKILL");
        }
      }
    } catch (_error) {
      // Process may have already exited, ignore errors
    } finally {
      this.process = null;
      this.processExitPromise = null;
      this.isStopping = false;
    }
  }

  /**
   * Restarts the SurrealDB process.
   * Stops the current process (if running) and starts a new one.
   */
  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  /**
   * Returns true if the SurrealDB process is running.
   */
  get isRunning(): boolean {
    return this.process !== null;
  }

  /**
   * Returns the WebSocket connection URL for SurrealDB.
   */
  get connectionUrl(): string {
    return `ws://127.0.0.1:${this.port}`;
  }

  /**
   * Returns the HTTP health check URL for SurrealDB.
   */
  get healthUrl(): string {
    return `http://127.0.0.1:${this.port}/health`;
  }

  /**
   * Returns the configured port number.
   */
  get portNumber(): number {
    return this.port;
  }

  /**
   * Returns the configured storage path.
   */
  get storagePathValue(): string {
    return this.storagePath;
  }

  /**
   * Waits for SurrealDB to become ready by polling the health endpoint.
   */
  private async waitForReady(): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < this.readinessTimeoutMs) {
      try {
        const response = await fetch(this.healthUrl);
        if (response.ok) {
          return; // Ready!
        }
      } catch {
        // Connection refused or other error - keep trying
      }

      // Check if process exited
      if (!this.process) {
        throw new SurrealProcessExitError(null);
      }

      await new Promise((resolve) =>
        setTimeout(resolve, this.readinessIntervalMs)
      );
    }

    throw new SurrealProcessReadinessError(this.readinessTimeoutMs);
  }

  /**
   * Monitors the process for unexpected exits.
   */
  private monitorProcess(): void {
    if (!this.processExitPromise) return;

    this.processExitPromise
      .then((status) => {
        // Only handle if process reference still exists and we're not intentionally stopping
        if (this.process && !this.isStopping) {
          const exitCode = status.code;
          console.error(
            `[SurrealDB] Process exited unexpectedly with code: ${exitCode}`
          );
          this.process = null;
          this.processExitPromise = null;

          // Notify callback if registered
          if (this.onUnexpectedExit) {
            try {
              this.onUnexpectedExit(exitCode);
            } catch (error) {
              console.error(
                "[SurrealDB] Error in unexpected exit callback:",
                error
              );
            }
          }
        }
      })
      .catch((error) => {
        // Handle any errors from the status promise
        if (this.process && !this.isStopping) {
          console.error("[SurrealDB] Error monitoring process:", error);
          this.process = null;
          this.processExitPromise = null;
        }
      });
  }

  /**
   * Streams process output to console with a prefix.
   */
  private async streamOutput(
    stream: ReadableStream<Uint8Array>,
    prefix: string
  ): Promise<void> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value);
        for (const line of text.split("\n")) {
          if (line.trim()) {
            console.log(`${prefix} ${line}`);
          }
        }
      }
    } catch {
      // Stream closed, ignore
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Ensures the storage directory exists.
   */
  private async ensureStorageDirectory(): Promise<void> {
    try {
      await Deno.mkdir(this.storagePath, { recursive: true });
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) {
        throw error;
      }
    }
  }
}
