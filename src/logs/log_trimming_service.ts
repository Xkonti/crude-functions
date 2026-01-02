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

    logger.info(
      `[LogTrimming] Starting with interval ${this.config.trimmingIntervalSeconds}s, ` +
      `max ${this.config.maxLogsPerRoute} logs per route`
    );

    // Run immediately on start, then schedule interval
    this.runTrimming().catch((error) => {
      logger.error("[LogTrimming] Initial trimming failed:", error);
    });

    this.timerId = setInterval(() => {
      this.runTrimming().catch((error) => {
        logger.error("[LogTrimming] Trimming failed:", error);
      });
    }, this.config.trimmingIntervalSeconds * 1000);
  }

  /**
   * Stop the trimming timer.
   * Waits for any in-progress trimming to complete.
   */
  async stop(): Promise<void> {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }

    this.stopRequested = true;

    // Wait for any in-progress processing to complete
    while (this.isProcessing) {
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
      // Get all distinct route IDs that have logs
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
