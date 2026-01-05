import type { ExecutionMetricsService } from "./execution_metrics_service.ts";
import type { MetricsAggregationConfig, ExecutionMetric } from "./types.ts";
import { logger } from "../utils/logger.ts";

export interface MetricsAggregationServiceOptions {
  metricsService: ExecutionMetricsService;
  config: MetricsAggregationConfig;
  /** Maximum minutes to process per aggregation run. Defaults to 60. */
  maxMinutesPerRun?: number;
}

/**
 * Service for aggregating execution metrics into time-based summaries.
 *
 * Runs on a configurable interval to:
 * - Aggregate execution metrics into minute summaries
 * - Aggregate minute summaries into hour summaries (when hour completes)
 * - Aggregate hour summaries into day summaries (when day completes)
 * - Clean up old day metrics based on retention policy
 */
export class MetricsAggregationService {
  private readonly metricsService: ExecutionMetricsService;
  private readonly config: MetricsAggregationConfig;
  private readonly maxMinutesPerRun: number;
  private timerId: number | null = null;
  private isProcessing = false;
  private stopRequested = false;
  private consecutiveFailures = 0;

  private static readonly MAX_CONSECUTIVE_FAILURES = 5;
  private static readonly STOP_TIMEOUT_MS = 30000;
  private static readonly DEFAULT_MAX_MINUTES_PER_RUN = 60;

  constructor(options: MetricsAggregationServiceOptions) {
    this.metricsService = options.metricsService;
    this.config = options.config;
    this.maxMinutesPerRun = options.maxMinutesPerRun ?? MetricsAggregationService.DEFAULT_MAX_MINUTES_PER_RUN;
  }

  /**
   * Start the aggregation timer.
   * Performs catch-up processing on first run.
   */
  start(): void {
    if (this.timerId !== null) {
      logger.warn("[MetricsAggregation] Already running");
      return;
    }

    logger.info(
      `[MetricsAggregation] Starting with interval ${this.config.aggregationIntervalSeconds}s, ` +
      `retention ${this.config.retentionDays} days`
    );

    // Run immediately on start, then schedule interval
    this.runAggregation()
      .then(() => {
        this.consecutiveFailures = 0;
      })
      .catch((error) => {
        this.consecutiveFailures++;
        logger.error("[MetricsAggregation] Initial aggregation failed:", error);
      });

    this.timerId = setInterval(() => {
      this.runAggregation()
        .then(() => {
          this.consecutiveFailures = 0;
        })
        .catch((error) => {
          this.consecutiveFailures++;
          logger.error(
            `[MetricsAggregation] Aggregation failed (${this.consecutiveFailures}/${MetricsAggregationService.MAX_CONSECUTIVE_FAILURES}):`,
            error
          );

          if (this.consecutiveFailures >= MetricsAggregationService.MAX_CONSECUTIVE_FAILURES) {
            logger.error("[MetricsAggregation] Max consecutive failures reached, stopping service");
            if (this.timerId !== null) {
              clearInterval(this.timerId);
              this.timerId = null;
            }
          }
        });
    }, this.config.aggregationIntervalSeconds * 1000);
  }

  /**
   * Stop the aggregation timer.
   * Waits for any in-progress aggregation to complete (with timeout).
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
      if (Date.now() - startTime > MetricsAggregationService.STOP_TIMEOUT_MS) {
        logger.warn("[MetricsAggregation] Stop timeout exceeded, processing may still be running");
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    this.stopRequested = false;
    logger.info("[MetricsAggregation] Stopped");
  }

  /**
   * Main aggregation loop - called by timer.
   * Processes minutes one at a time, cascading to hours and days when complete.
   * Also processes any pending hour and day aggregations independently.
   */
  private async runAggregation(): Promise<void> {
    if (this.isProcessing) {
      logger.debug("[MetricsAggregation] Skipping, already processing");
      return;
    }

    this.isProcessing = true;
    try {
      // Clean up all old metrics first (any type)
      await this.cleanupOldMetrics();

      if (this.stopRequested) return;

      const now = new Date();

      // Process all complete minutes, cascading to hours and days
      await this.processMinutesCascading(now);

      if (this.stopRequested) return;

      // Process any pending hour aggregations (minute → hour)
      // This handles cases where execution→minute processing has stopped
      // but there are still completed hours to aggregate
      await this.processPendingHours(now);

      if (this.stopRequested) return;

      // Process any pending day aggregations (hour → day)
      // This handles cases where hour aggregation has stopped
      // but there are still completed days to aggregate
      await this.processPendingDays(now);

    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Process minutes one at a time, cascading to hours and days when boundaries are crossed.
   */
  private async processMinutesCascading(now: Date): Promise<void> {
    // Find the oldest unprocessed execution
    const oldestExecution = await this.metricsService.getOldestByType("execution");
    if (!oldestExecution) {
      return; // No executions to process
    }

    // Get all routes that have execution metrics
    const routeIds = await this.metricsService.getDistinctRouteIdsByType("execution");
    if (routeIds.length === 0) {
      return;
    }

    let currentMinute = this.floorToMinute(oldestExecution.timestamp);
    const endMinute = this.floorToMinute(now); // Don't process current incomplete minute

    let minutesProcessed = 0;

    while (currentMinute < endMinute) {
      if (this.stopRequested) return;

      // Limit processing per run to avoid long-running operations on startup
      if (minutesProcessed >= this.maxMinutesPerRun) {
        logger.info(
          `[MetricsAggregation] Reached max minutes per run (${this.maxMinutesPerRun}), will continue in next run`
        );
        return;
      }

      const minuteEnd = new Date(currentMinute.getTime() + 60 * 1000);
      const currentHour = this.floorToHour(currentMinute);
      const currentDay = this.floorToDay(currentMinute);

      // Process this minute for all routes
      for (const routeId of routeIds) {
        await this.aggregateMinute(routeId, currentMinute, minuteEnd);
      }

      // Check if we just completed an hour (moving to a new hour)
      const nextMinute = minuteEnd;
      const nextHour = this.floorToHour(nextMinute);

      if (nextHour > currentHour && nextHour <= this.floorToHour(now)) {
        // Hour boundary crossed - aggregate the completed hour
        if (this.stopRequested) return;

        const hourEnd = new Date(currentHour.getTime() + 60 * 60 * 1000);
        const minuteRouteIds = await this.metricsService.getDistinctRouteIdsByType("minute");

        for (const routeId of minuteRouteIds) {
          await this.aggregateHour(routeId, currentHour, hourEnd);
        }

        // Check if we just completed a day
        const nextDay = this.floorToDay(nextHour);
        if (nextDay > currentDay && nextDay <= this.floorToDay(now)) {
          // Day boundary crossed - aggregate the completed day
          if (this.stopRequested) return;

          const dayEnd = new Date(currentDay.getTime() + 24 * 60 * 60 * 1000);
          const hourRouteIds = await this.metricsService.getDistinctRouteIdsByType("hour");

          for (const routeId of hourRouteIds) {
            await this.aggregateDay(routeId, currentDay, dayEnd);
          }
        }
      }

      currentMinute = minuteEnd;
      minutesProcessed++;
    }
  }

  /**
   * Aggregate executions for a specific minute into a minute record.
   */
  private async aggregateMinute(
    routeId: number,
    start: Date,
    end: Date
  ): Promise<void> {
    const metrics = await this.metricsService.getByRouteIdTypeAndTimeRange(
      routeId,
      "execution",
      start,
      end
    );

    if (metrics.length === 0) {
      return; // No executions in this minute for this route
    }

    const aggregated = this.calculateAggregation(metrics);

    // Store minute record and delete executions
    await this.metricsService.store({
      routeId,
      type: "minute",
      avgTimeMs: aggregated.avgTimeMs,
      maxTimeMs: aggregated.maxTimeMs,
      executionCount: aggregated.executionCount,
      timestamp: start,
    });

    await this.metricsService.deleteByRouteIdTypeAndTimeRange(
      routeId,
      "execution",
      start,
      end
    );
  }

  /**
   * Aggregate minutes for a specific hour into an hour record.
   */
  private async aggregateHour(
    routeId: number,
    start: Date,
    end: Date
  ): Promise<void> {
    const metrics = await this.metricsService.getByRouteIdTypeAndTimeRange(
      routeId,
      "minute",
      start,
      end
    );

    if (metrics.length === 0) {
      return; // No minutes in this hour for this route
    }

    const aggregated = this.calculateAggregation(metrics);

    // Store hour record and delete minutes
    await this.metricsService.store({
      routeId,
      type: "hour",
      avgTimeMs: aggregated.avgTimeMs,
      maxTimeMs: aggregated.maxTimeMs,
      executionCount: aggregated.executionCount,
      timestamp: start,
    });

    await this.metricsService.deleteByRouteIdTypeAndTimeRange(
      routeId,
      "minute",
      start,
      end
    );
  }

  /**
   * Aggregate hours for a specific day into a day record.
   */
  private async aggregateDay(
    routeId: number,
    start: Date,
    end: Date
  ): Promise<void> {
    const metrics = await this.metricsService.getByRouteIdTypeAndTimeRange(
      routeId,
      "hour",
      start,
      end
    );

    if (metrics.length === 0) {
      return; // No hours in this day for this route
    }

    const aggregated = this.calculateAggregation(metrics);

    // Store day record and delete hours
    await this.metricsService.store({
      routeId,
      type: "day",
      avgTimeMs: aggregated.avgTimeMs,
      maxTimeMs: aggregated.maxTimeMs,
      executionCount: aggregated.executionCount,
      timestamp: start,
    });

    await this.metricsService.deleteByRouteIdTypeAndTimeRange(
      routeId,
      "hour",
      start,
      end
    );
  }

  /**
   * Process any pending hour aggregations from minute records.
   * This runs independently of the execution processing loop to catch
   * cases where there are no new executions but pending minutes exist.
   */
  private async processPendingHours(now: Date): Promise<void> {
    // Find the oldest minute record
    const oldestMinute = await this.metricsService.getOldestByType("minute");
    if (!oldestMinute) {
      return; // No minute records to process
    }

    // Get the hour this minute belongs to
    const oldestHour = this.floorToHour(oldestMinute.timestamp);
    const currentHour = this.floorToHour(now);

    // Only process if the oldest minute is in a completed hour
    if (oldestHour >= currentHour) {
      return; // All minutes are in the current (incomplete) hour
    }

    // Get all routes that have minute records
    const routeIds = await this.metricsService.getDistinctRouteIdsByType("minute");
    if (routeIds.length === 0) {
      return;
    }

    // Process each completed hour from oldest to current
    let hourStart = oldestHour;
    while (hourStart < currentHour) {
      if (this.stopRequested) return;

      const hourEnd = new Date(hourStart.getTime() + 60 * 60 * 1000);

      for (const routeId of routeIds) {
        await this.aggregateHour(routeId, hourStart, hourEnd);
      }

      hourStart = hourEnd;
    }
  }

  /**
   * Process any pending day aggregations from hour records.
   * This runs independently of the hour processing loop to catch
   * cases where there are no new hours but pending hours exist.
   */
  private async processPendingDays(now: Date): Promise<void> {
    // Find the oldest hour record
    const oldestHour = await this.metricsService.getOldestByType("hour");
    if (!oldestHour) {
      return; // No hour records to process
    }

    // Get the day this hour belongs to
    const oldestDay = this.floorToDay(oldestHour.timestamp);
    const currentDay = this.floorToDay(now);

    // Only process if the oldest hour is in a completed day
    if (oldestDay >= currentDay) {
      return; // All hours are in the current (incomplete) day
    }

    // Get all routes that have hour records
    const routeIds = await this.metricsService.getDistinctRouteIdsByType("hour");
    if (routeIds.length === 0) {
      return;
    }

    // Process each completed day from oldest to current
    let dayStart = oldestDay;
    while (dayStart < currentDay) {
      if (this.stopRequested) return;

      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

      for (const routeId of routeIds) {
        await this.aggregateDay(routeId, dayStart, dayEnd);
      }

      dayStart = dayEnd;
    }
  }

  /**
   * Clean up all metrics older than retention period (any type).
   */
  private async cleanupOldMetrics(): Promise<void> {
    const cutoffDate = new Date(
      Date.now() - this.config.retentionDays * 24 * 60 * 60 * 1000
    );

    const deleted = await this.metricsService.deleteOlderThan(cutoffDate);
    if (deleted > 0) {
      logger.info(`[MetricsAggregation] Cleaned up ${deleted} old metrics`);
    }
  }

  /**
   * Calculate aggregated values from a set of metrics.
   * - avg = weighted average: sum(avg * count) / sum(count)
   * - max = maximum of all max values
   * - count = sum of all counts
   */
  private calculateAggregation(metrics: ExecutionMetric[]): {
    avgTimeMs: number;
    maxTimeMs: number;
    executionCount: number;
  } {
    if (metrics.length === 0) {
      return { avgTimeMs: 0, maxTimeMs: 0, executionCount: 0 };
    }

    let totalWeightedSum = 0;
    let totalCount = 0;
    let maxTime = 0;

    for (const metric of metrics) {
      totalWeightedSum += metric.avgTimeMs * metric.executionCount;
      totalCount += metric.executionCount;
      maxTime = Math.max(maxTime, metric.maxTimeMs);
    }

    // Handle case where all metrics have count 0
    const avgTime = totalCount > 0 ? totalWeightedSum / totalCount : 0;

    return {
      avgTimeMs: avgTime,
      maxTimeMs: maxTime,
      executionCount: totalCount,
    };
  }

  /**
   * Floor a date to the start of its minute (UTC).
   */
  private floorToMinute(date: Date): Date {
    const result = new Date(date);
    result.setUTCSeconds(0, 0);
    return result;
  }

  /**
   * Floor a date to the start of its hour (UTC).
   */
  private floorToHour(date: Date): Date {
    const result = new Date(date);
    result.setUTCMinutes(0, 0, 0);
    return result;
  }

  /**
   * Floor a date to the start of its day (UTC).
   */
  private floorToDay(date: Date): Date {
    const result = new Date(date);
    result.setUTCHours(0, 0, 0, 0);
    return result;
  }
}
