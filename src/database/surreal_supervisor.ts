import { SurrealProcessManager } from "./surreal_process_manager.ts";
import { SurrealConnectionFactory } from "./surreal_connection_factory.ts";
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
  /** Connection factory for verifying database connectivity */
  connectionFactory: SurrealConnectionFactory;
  /** Health monitor instance (created but not started) */
  healthMonitor: SurrealHealthMonitor;
  /** Maximum restart attempts before giving up (default: 3) */
  maxRestartAttempts?: number;
  /** Cooldown between restart attempts in ms (default: 5000) */
  restartCooldownMs?: number;
  /** Whether to auto-restart on unhealthy status (default: true) */
  autoRestart?: boolean;
  /** Idle timeout for pooled connections in ms (default: 300000 = 5 min) */
  poolIdleTimeoutMs?: number;
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
 * - Start/stop the process and health monitor together
 * - Verify database connectivity after process start
 * - Handle automatic restart on failure
 * - Track restart attempts with backoff
 * - Provide unified health status
 *
 * @example
 * ```typescript
 * const supervisor = new SurrealSupervisor({
 *   processManager,
 *   connectionFactory: surrealFactory,
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
  private readonly connectionFactory: SurrealConnectionFactory;
  private readonly healthMonitor: SurrealHealthMonitor;
  private readonly maxRestartAttempts: number;
  private readonly restartCooldownMs: number;
  private readonly autoRestart: boolean;
  private readonly poolIdleTimeoutMs: number;

  private restartAttempts = 0;
  private isRestarting = false;
  private isRunning = false;
  private unsubscribeHealthMonitor?: () => void;

  constructor(options: SurrealSupervisorOptions) {
    this.processManager = options.processManager;
    this.connectionFactory = options.connectionFactory;
    this.healthMonitor = options.healthMonitor;
    this.maxRestartAttempts = options.maxRestartAttempts ?? 3;
    this.restartCooldownMs = options.restartCooldownMs ?? 5000;
    this.autoRestart = options.autoRestart ?? true;
    this.poolIdleTimeoutMs = options.poolIdleTimeoutMs ?? 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Start the supervisor (starts process, verifies connectivity, starts monitoring).
   *
   * Startup order:
   * 1. Start SurrealDB process
   * 2. Verify database connectivity via factory health check
   * 3. Initialize connection pool
   * 4. Start health monitor
   * 5. Register health status listener for auto-restart
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      return; // Already running
    }

    // 1. Start the process
    await this.processManager.start();

    // 2. Verify database connectivity
    const healthy = await this.connectionFactory.healthCheck();
    if (!healthy) {
      // If connectivity check fails, stop the process
      await this.processManager.stop();
      throw new Error("Failed to verify SurrealDB connectivity after process start");
    }

    // 3. Initialize connection pool
    this.connectionFactory.initializePool({
      idleTimeoutMs: this.poolIdleTimeoutMs,
    });

    // 4. Start health monitoring
    this.healthMonitor.start();

    // 5. Register auto-restart handler
    if (this.autoRestart) {
      this.unsubscribeHealthMonitor = this.healthMonitor.onStatusChange(
        (event) => this.handleHealthChange(event)
      );
    }

    this.isRunning = true;
    this.restartAttempts = 0;
  }

  /**
   * Stop the supervisor (stops monitoring, closes pool, stops process).
   *
   * Shutdown order:
   * 1. Unsubscribe from health events (prevent restart during shutdown)
   * 2. Stop health monitor
   * 3. Close connection pool
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

    // 3. Close connection pool
    await this.connectionFactory.closePool();

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
      // Restart the process
      await this.processManager.restart();

      // Verify connectivity after restart
      const healthy = await this.connectionFactory.healthCheck();
      if (!healthy) {
        throw new Error("Failed to verify SurrealDB connectivity after restart");
      }

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
   * - Health status is healthy or degraded
   */
  isHealthy(): boolean {
    if (!this.isRunning) return false;
    if (!this.processManager.isRunning) return false;

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
