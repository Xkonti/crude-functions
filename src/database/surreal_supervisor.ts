import { SurrealProcessManager } from "./surreal_process_manager.ts";
import { SurrealDatabaseService } from "./surreal_database_service.ts";
import {
  SurrealHealthMonitor,
  type HealthStatus,
  type HealthStatusEvent,
} from "./surreal_health_monitor.ts";

/**
 * Configuration options for the SurrealSupervisor.
 */
export interface SurrealSupervisorOptions {
  /** Process manager instance */
  processManager: SurrealProcessManager;
  /** Database service instance (created but not opened) */
  databaseService: SurrealDatabaseService;
  /** Health monitor instance (created but not started) */
  healthMonitor: SurrealHealthMonitor;
  /** Maximum restart attempts before giving up (default: 3) */
  maxRestartAttempts?: number;
  /** Cooldown between restart attempts in ms (default: 5000) */
  restartCooldownMs?: number;
  /** Whether to auto-restart on unhealthy status (default: true) */
  autoRestart?: boolean;
}

/**
 * Result of a restart attempt.
 */
export interface RestartResult {
  success: boolean;
  attemptNumber: number;
  error?: Error;
}

/**
 * Supervisor that coordinates SurrealDB process lifecycle with health monitoring.
 *
 * Responsibilities:
 * - Start/stop the process, database connection, and health monitor together
 * - Handle automatic restart on failure
 * - Track restart attempts with backoff
 * - Provide unified health status
 *
 * @example
 * ```typescript
 * const supervisor = new SurrealSupervisor({
 *   processManager,
 *   databaseService: surrealDb,
 *   healthMonitor: new SurrealHealthMonitor({ processManager }),
 * });
 *
 * await supervisor.start();
 *
 * supervisor.onStatusChange((event) => {
 *   console.log(`Health changed: ${event.previousStatus} -> ${event.status}`);
 * });
 *
 * // Later during shutdown
 * await supervisor.stop();
 * ```
 */
export class SurrealSupervisor {
  private readonly processManager: SurrealProcessManager;
  private readonly databaseService: SurrealDatabaseService;
  private readonly healthMonitor: SurrealHealthMonitor;
  private readonly maxRestartAttempts: number;
  private readonly restartCooldownMs: number;
  private readonly autoRestart: boolean;

  private restartAttempts = 0;
  private isRestarting = false;
  private isRunning = false;
  private unsubscribeHealthMonitor?: () => void;

  constructor(options: SurrealSupervisorOptions) {
    this.processManager = options.processManager;
    this.databaseService = options.databaseService;
    this.healthMonitor = options.healthMonitor;
    this.maxRestartAttempts = options.maxRestartAttempts ?? 3;
    this.restartCooldownMs = options.restartCooldownMs ?? 5000;
    this.autoRestart = options.autoRestart ?? true;
  }

  /**
   * Start the supervisor (starts process, connects DB, starts monitoring).
   *
   * Startup order:
   * 1. Start SurrealDB process
   * 2. Connect database service
   * 3. Start health monitor
   * 4. Register health status listener for auto-restart
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      return; // Already running
    }

    // 1. Start the process
    await this.processManager.start();

    // 2. Connect the database service
    try {
      await this.databaseService.open();
    } catch (error) {
      // If DB connection fails, stop the process
      await this.processManager.stop();
      throw error;
    }

    // 3. Start health monitoring
    this.healthMonitor.start();

    // 4. Register auto-restart handler
    if (this.autoRestart) {
      this.unsubscribeHealthMonitor = this.healthMonitor.onStatusChange(
        (event) => this.handleHealthChange(event)
      );
    }

    this.isRunning = true;
    this.restartAttempts = 0;
  }

  /**
   * Stop the supervisor (stops monitoring, disconnects DB, stops process).
   *
   * Shutdown order:
   * 1. Unsubscribe from health events (prevent restart during shutdown)
   * 2. Stop health monitor
   * 3. Close database connection
   * 4. Stop process
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return; // Not running
    }

    // 1. Unsubscribe from health events first
    if (this.unsubscribeHealthMonitor) {
      this.unsubscribeHealthMonitor();
      this.unsubscribeHealthMonitor = undefined;
    }

    // 2. Stop health monitor
    this.healthMonitor.stop();

    // 3. Close database connection
    if (this.databaseService.isOpen) {
      await this.databaseService.close();
    }

    // 4. Stop process
    if (this.processManager.isRunning) {
      await this.processManager.stop();
    }

    this.isRunning = false;
  }

  /**
   * Attempt to restart the SurrealDB process.
   *
   * @returns RestartResult indicating success/failure and attempt number
   */
  async restart(): Promise<RestartResult> {
    // Prevent concurrent restarts
    if (this.isRestarting) {
      return {
        success: false,
        attemptNumber: this.restartAttempts,
        error: new Error("Restart already in progress"),
      };
    }

    this.isRestarting = true;
    this.restartAttempts++;
    const attemptNumber = this.restartAttempts;

    console.log(
      `[SurrealSupervisor] Restart attempt ${attemptNumber}/${this.maxRestartAttempts}`
    );

    try {
      // Close database connection first
      if (this.databaseService.isOpen) {
        await this.databaseService.close();
      }

      // Restart the process
      await this.processManager.restart();

      // Reconnect the database
      await this.databaseService.open();

      // Reset health monitor failure count
      this.healthMonitor.resetFailures();

      console.log(`[SurrealSupervisor] Restart successful`);

      return {
        success: true,
        attemptNumber,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error(`[SurrealSupervisor] Restart failed:`, err);

      return {
        success: false,
        attemptNumber,
        error: err,
      };
    } finally {
      this.isRestarting = false;
    }
  }

  /**
   * Check if the entire system is healthy.
   *
   * Returns true only if:
   * - Supervisor is running
   * - Process is running
   * - Database is connected
   * - Health status is healthy or degraded
   */
  isHealthy(): boolean {
    if (!this.isRunning) return false;
    if (!this.processManager.isRunning) return false;
    if (!this.databaseService.isOpen) return false;

    const status = this.healthMonitor.getStatus();
    return status === "healthy" || status === "degraded";
  }

  /**
   * Get current health status from the monitor.
   */
  getHealthStatus(): HealthStatus {
    return this.healthMonitor.getStatus();
  }

  /**
   * Get the number of restart attempts made.
   */
  getRestartAttempts(): number {
    return this.restartAttempts;
  }

  /**
   * Reset the restart attempts counter.
   * Call this after a period of stable operation.
   */
  resetRestartAttempts(): void {
    this.restartAttempts = 0;
  }

  /**
   * Register a listener for health status changes.
   * This is a convenience method that delegates to the health monitor.
   */
  onStatusChange(listener: (event: HealthStatusEvent) => void): () => void {
    return this.healthMonitor.onStatusChange(listener);
  }

  /**
   * Handle health status changes - trigger restart if unhealthy.
   */
  private handleHealthChange(event: HealthStatusEvent): void {
    // Only react to transitions TO unhealthy status
    if (event.status !== "unhealthy") {
      return;
    }

    // Check if we've exceeded max restart attempts
    if (this.restartAttempts >= this.maxRestartAttempts) {
      console.error(
        `[SurrealSupervisor] Max restart attempts (${this.maxRestartAttempts}) exceeded. Manual intervention required.`
      );
      return;
    }

    // Don't restart if already restarting
    if (this.isRestarting) {
      return;
    }

    // Schedule restart with cooldown
    console.log(
      `[SurrealSupervisor] Health status unhealthy, scheduling restart in ${this.restartCooldownMs}ms`
    );

    setTimeout(async () => {
      // Double-check we're still unhealthy before restarting
      if (this.healthMonitor.getStatus() === "unhealthy" && !this.isRestarting) {
        await this.restart();
      }
    }, this.restartCooldownMs);
  }
}
