import type { SurrealProcessManager } from "./surreal_process_manager.ts";

/**
 * Health status of the SurrealDB process.
 */
export type HealthStatus = "healthy" | "degraded" | "unhealthy" | "stopped";

/**
 * Event emitted when health status changes.
 */
export interface HealthStatusEvent {
  status: HealthStatus;
  previousStatus: HealthStatus;
  consecutiveFailures: number;
  lastError?: Error;
  timestamp: Date;
}

/**
 * Configuration options for the SurrealHealthMonitor.
 */
export interface SurrealHealthMonitorOptions {
  /** Process manager instance to monitor */
  processManager: SurrealProcessManager;
  /** Health check interval in ms (default: 5000) */
  checkIntervalMs?: number;
  /** Number of consecutive failures before considering unhealthy (default: 3) */
  failureThreshold?: number;
  /** Timeout for each health check in ms (default: 5000) */
  healthCheckTimeoutMs?: number;
  /** Number of failures for degraded status (default: 1) */
  degradedThreshold?: number;
}

/**
 * Independent health monitor for SurrealDB process.
 *
 * Uses setInterval-based polling (not job scheduling) to avoid
 * the chicken-and-egg problem with database-dependent services.
 *
 * Features:
 * - Polling-based health checks via HTTP /health endpoint
 * - Configurable failure threshold before declaring unhealthy
 * - Callback-based notifications for status changes
 * - Works independently of EventBus/SchedulingService
 *
 * @example
 * ```typescript
 * const monitor = new SurrealHealthMonitor({
 *   processManager,
 *   checkIntervalMs: 5000,
 *   failureThreshold: 3,
 * });
 *
 * monitor.onStatusChange((event) => {
 *   console.log(`Health changed: ${event.previousStatus} -> ${event.status}`);
 * });
 *
 * monitor.start();
 * // ... later
 * monitor.stop();
 * ```
 */
export class SurrealHealthMonitor {
  private readonly processManager: SurrealProcessManager;
  private readonly checkIntervalMs: number;
  private readonly failureThreshold: number;
  private readonly degradedThreshold: number;
  private readonly healthCheckTimeoutMs: number;

  private timerId: number | null = null;
  private currentStatus: HealthStatus = "stopped";
  private consecutiveFailures = 0;
  private lastError?: Error;
  private isChecking = false;

  private readonly statusListeners: Set<(event: HealthStatusEvent) => void> =
    new Set();

  constructor(options: SurrealHealthMonitorOptions) {
    this.processManager = options.processManager;
    this.checkIntervalMs = options.checkIntervalMs ?? 5000;
    this.failureThreshold = options.failureThreshold ?? 3;
    this.degradedThreshold = options.degradedThreshold ?? 1;
    this.healthCheckTimeoutMs = options.healthCheckTimeoutMs ?? 5000;
  }

  /**
   * Start health monitoring.
   * Uses setInterval (like JobProcessorService pattern).
   */
  start(): void {
    if (this.timerId !== null) {
      return; // Already running
    }

    // Set initial status based on process state
    if (this.processManager.isRunning) {
      this.updateStatus("healthy");
    } else {
      this.updateStatus("stopped");
    }

    // Start periodic health checks
    this.timerId = setInterval(() => {
      this.performHealthCheck();
    }, this.checkIntervalMs);

    // Perform initial check immediately
    this.performHealthCheck();
  }

  /**
   * Stop health monitoring.
   */
  stop(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    this.updateStatus("stopped");
  }

  /**
   * Register a listener for status changes.
   * Returns an unsubscribe function.
   */
  onStatusChange(listener: (event: HealthStatusEvent) => void): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  /**
   * Get current health status.
   */
  getStatus(): HealthStatus {
    return this.currentStatus;
  }

  /**
   * Get consecutive failure count.
   */
  getConsecutiveFailures(): number {
    return this.consecutiveFailures;
  }

  /**
   * Get the last error that occurred during health check.
   */
  getLastError(): Error | undefined {
    return this.lastError;
  }

  /**
   * Perform a single health check (can be called manually).
   * Returns true if healthy, false otherwise.
   */
  async checkHealth(): Promise<boolean> {
    // Check if process is running first
    if (!this.processManager.isRunning) {
      return false;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        this.healthCheckTimeoutMs
      );

      try {
        const response = await fetch(this.processManager.healthUrl, {
          signal: controller.signal,
        });
        return response.ok;
      } finally {
        clearTimeout(timeoutId);
      }
    } catch {
      return false;
    }
  }

  /**
   * Reset failure count (e.g., after a successful restart).
   */
  resetFailures(): void {
    this.consecutiveFailures = 0;
    this.lastError = undefined;
    if (this.processManager.isRunning) {
      this.updateStatus("healthy");
    }
  }

  /**
   * Perform health check and update status.
   */
  private async performHealthCheck(): Promise<void> {
    // Prevent overlapping checks
    if (this.isChecking) {
      return;
    }

    this.isChecking = true;

    try {
      // Check if process is running
      if (!this.processManager.isRunning) {
        this.consecutiveFailures++;
        this.lastError = new Error("SurrealDB process is not running");
        this.updateStatus("stopped");
        return;
      }

      const isHealthy = await this.checkHealth();

      if (isHealthy) {
        this.consecutiveFailures = 0;
        this.lastError = undefined;
        this.updateStatus("healthy");
      } else {
        this.consecutiveFailures++;
        this.lastError = new Error("Health check failed");

        if (this.consecutiveFailures >= this.failureThreshold) {
          this.updateStatus("unhealthy");
        } else if (this.consecutiveFailures >= this.degradedThreshold) {
          this.updateStatus("degraded");
        }
      }
    } catch (error) {
      this.consecutiveFailures++;
      this.lastError =
        error instanceof Error ? error : new Error(String(error));

      if (this.consecutiveFailures >= this.failureThreshold) {
        this.updateStatus("unhealthy");
      } else if (this.consecutiveFailures >= this.degradedThreshold) {
        this.updateStatus("degraded");
      }
    } finally {
      this.isChecking = false;
    }
  }

  /**
   * Update status and notify listeners if changed.
   */
  private updateStatus(newStatus: HealthStatus): void {
    const previousStatus = this.currentStatus;

    if (previousStatus !== newStatus) {
      this.currentStatus = newStatus;

      const event: HealthStatusEvent = {
        status: newStatus,
        previousStatus,
        consecutiveFailures: this.consecutiveFailures,
        lastError: this.lastError,
        timestamp: new Date(),
      };

      // Notify all listeners
      for (const listener of this.statusListeners) {
        try {
          listener(event);
        } catch (error) {
          console.error(
            "[SurrealHealthMonitor] Error in status listener:",
            error
          );
        }
      }
    }
  }
}
