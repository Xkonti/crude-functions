import type { ConsoleLogService } from "./console_log_service.ts";
import type { LogTrimmingConfig } from "./log_trimming_types.ts";
import { logger } from "../utils/logger.ts";

export interface LogTrimmingServiceOptions {
  logService: ConsoleLogService;
  config: LogTrimmingConfig;
}

/**
 * Service for trimming console logs to limit storage per route.
 *
 * Runs on a configurable interval to:
 * - For each route with logs, keep only the N newest logs
 * - Delete oldest logs when count exceeds the limit
 */
export class LogTrimmingService {
  private readonly logService: ConsoleLogService;
  private readonly config: LogTrimmingConfig;
  private timerId: number | null = null;
  private isProcessing = false;
  private stopRequested = false;
  private consecutiveFailures = 0;

  private static readonly MAX_CONSECUTIVE_FAILURES = 5;
  private static readonly STOP_TIMEOUT_MS = 30000;

  constructor(options: LogTrimmingServiceOptions) {
    this.logService = options.logService;
    this.config = options.config;
  }

  /**
   * Start the trimming timer.
   * Runs immediately on start, then on interval.
   */
  start(): void {
    if (this.timerId !== null) {
      logger.warn("[LogTrimming] Already running");
      return;
    }

    const retentionInfo = this.config.retentionSeconds > 0
      ? `${this.config.retentionSeconds}s retention`
      : "time-based retention disabled";

    logger.info(
      `[LogTrimming] Starting with interval ${this.config.trimmingIntervalSeconds}s, ` +
      `max ${this.config.maxLogsPerRoute} logs per route, ${retentionInfo}`
    );

    // Run immediately on start, then schedule interval
    this.runTrimming()
      .then(() => {
        this.consecutiveFailures = 0;
      })
      .catch((error) => {
        this.consecutiveFailures++;
        logger.error("[LogTrimming] Initial trimming failed:", error);
      });

    this.timerId = setInterval(() => {
      this.runTrimming()
        .then(() => {
          this.consecutiveFailures = 0;
        })
        .catch((error) => {
          this.consecutiveFailures++;
          logger.error(
            `[LogTrimming] Trimming failed (${this.consecutiveFailures}/${LogTrimmingService.MAX_CONSECUTIVE_FAILURES}):`,
            error
          );

          if (this.consecutiveFailures >= LogTrimmingService.MAX_CONSECUTIVE_FAILURES) {
            logger.error("[LogTrimming] Max consecutive failures reached, stopping service");
            if (this.timerId !== null) {
              clearInterval(this.timerId);
              this.timerId = null;
            }
          }
        });
    }, this.config.trimmingIntervalSeconds * 1000);
  }

  /**
   * Stop the trimming timer.
   * Waits for any in-progress trimming to complete (with timeout).
   */
  async stop(): Promise<void> {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }

    this.stopRequested = true;

    // Wait for any in-progress processing to complete with timeout
    const startTime = Date.now();
    while (this.isProcessing) {
      if (Date.now() - startTime > LogTrimmingService.STOP_TIMEOUT_MS) {
        logger.warn("[LogTrimming] Stop timeout exceeded, processing may still be running");
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    this.stopRequested = false;
    logger.info("[LogTrimming] Stopped");
  }

  /**
   * Main trimming loop - called by timer.
   */
  private async runTrimming(): Promise<void> {
    if (this.isProcessing) {
      logger.debug("[LogTrimming] Skipping, already processing");
      return;
    }

    this.isProcessing = true;
    try {
      // STEP 1: Time-based deletion (global)
      if (this.config.retentionSeconds > 0) {
        const cutoffDate = new Date(Date.now() - this.config.retentionSeconds * 1000);
        const deletedByAge = await this.logService.deleteOlderThan(cutoffDate);
        if (deletedByAge > 0) {
          logger.info(`[LogTrimming] Deleted ${deletedByAge} logs older than ${cutoffDate.toISOString()}`);
        }
      }

      if (this.stopRequested) return;

      // STEP 2: Count-based trimming per route
      const routeIds = await this.logService.getDistinctRouteIds();

      let totalDeleted = 0;
      for (const routeId of routeIds) {
        if (this.stopRequested) return;

        const deleted = await this.logService.trimToLimit(
          routeId,
          this.config.maxLogsPerRoute
        );
        totalDeleted += deleted;
      }

      if (totalDeleted > 0) {
        logger.info(`[LogTrimming] Trimmed ${totalDeleted} logs across ${routeIds.length} routes`);
      }
    } finally {
      this.isProcessing = false;
    }
  }
}
