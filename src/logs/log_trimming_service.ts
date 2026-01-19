import type { ConsoleLogService } from "./console_log_service.ts";
import type { LogTrimmingConfig } from "./log_trimming_types.ts";
import { logger } from "../utils/logger.ts";

export interface LogTrimmingServiceOptions {
  logService: ConsoleLogService;
  config: LogTrimmingConfig;
}

/**
 * Result of a trimming operation.
 */
export interface LogTrimmingResult {
  /** Number of logs deleted due to age (time-based retention) */
  deletedByAge: number;
  /** Number of logs trimmed due to count limits (per-route) */
  trimmedByCount: number;
}

/**
 * Service for trimming console logs to limit storage per route.
 *
 * Executes log trimming based on:
 * - Time-based retention: Delete logs older than retention period
 * - Count-based limits: Keep only N newest logs per route
 *
 * This service is invoked by the job system via the scheduling service.
 * It does not maintain its own timer - scheduling is handled externally.
 */
export class LogTrimmingService {
  private readonly logService: ConsoleLogService;
  private readonly config: LogTrimmingConfig;

  constructor(options: LogTrimmingServiceOptions) {
    this.logService = options.logService;
    this.config = options.config;
  }

  /**
   * Perform log trimming operation.
   * Called by the job handler when the log-trimming job is executed.
   *
   * @returns Results of the trimming operation
   */
  async performTrimming(): Promise<LogTrimmingResult> {
    let deletedByAge = 0;
    let totalDeleted = 0;

    // STEP 1: Time-based deletion (global)
    if (this.config.retentionSeconds > 0) {
      const cutoffDate = new Date(Date.now() - this.config.retentionSeconds * 1000);
      deletedByAge = await this.logService.deleteOlderThan(cutoffDate);
      if (deletedByAge > 0) {
        logger.info(`[LogTrimming] Deleted ${deletedByAge} logs older than ${cutoffDate.toISOString()}`);
      }
    }

    // STEP 2: Count-based trimming per route
    const routeIds = await this.logService.getDistinctRouteIds();

    for (const routeId of routeIds) {
      const deleted = await this.logService.trimToLimit(
        routeId,
        this.config.maxLogsPerRoute
      );
      totalDeleted += deleted;
    }

    if (totalDeleted > 0) {
      logger.info(`[LogTrimming] Trimmed ${totalDeleted} logs across ${routeIds.length} routes`);
    }

    return { deletedByAge, trimmedByCount: totalDeleted };
  }
}
