import type { ExecutionMetricsService } from "./execution_metrics_service.ts";
import type { MetricsStateService } from "./metrics_state_service.ts";
import type { MetricsAggregationConfig, MetricType } from "./types.ts";
import { logger } from "../utils/logger.ts";

export interface MetricsAggregationServiceOptions {
  metricsService: ExecutionMetricsService;
  stateService: MetricsStateService;
  config: MetricsAggregationConfig;
  /** Maximum minutes to process per aggregation run. Defaults to 60. */
  maxMinutesPerRun?: number;
}

/**
 * Service for aggregating execution metrics into time-based summaries.
 *
 * Uses a watermark-based approach with three sequential passes:
 * 1. MINUTES PASS: Aggregate executions → minute records (global + per-route)
 * 2. HOURS PASS: Aggregate minutes → hour records (global + per-route)
 * 3. DAYS PASS: Aggregate hours → day records (global + per-route)
 *
 * Global metrics (routeId=NULL) combine data from all functions.
 * Watermarks track progress to ensure crash recovery with minimal reprocessing.
 * Cleanup happens at the end of all passes.
 */
export class MetricsAggregationService {
  private readonly metricsService: ExecutionMetricsService;
  private readonly stateService: MetricsStateService;
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
    this.stateService = options.stateService;
    this.config = options.config;
    this.maxMinutesPerRun =
      options.maxMinutesPerRun ??
      MetricsAggregationService.DEFAULT_MAX_MINUTES_PER_RUN;
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

          if (
            this.consecutiveFailures >=
            MetricsAggregationService.MAX_CONSECUTIVE_FAILURES
          ) {
            logger.error(
              "[MetricsAggregation] Max consecutive failures reached, stopping service"
            );
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

    // Wait for any in-progress processing to complete with timeout.
    // IMPORTANT: Don't set stopRequested until AFTER waiting, otherwise
    // runAggregation() will see the flag and abort early, causing race
    // conditions in tests and potential data loss.
    const startTime = Date.now();
    while (this.isProcessing) {
      if (Date.now() - startTime > MetricsAggregationService.STOP_TIMEOUT_MS) {
        logger.warn(
          "[MetricsAggregation] Stop timeout exceeded, signaling stop request"
        );
        this.stopRequested = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // Reset for potential future restart
    this.stopRequested = false;
    logger.info("[MetricsAggregation] Stopped");
  }

  /**
   * Main aggregation loop - called by timer.
   * Runs three passes (minutes, hours, days) then cleans up old records.
   */
  private async runAggregation(): Promise<void> {
    if (this.isProcessing) {
      logger.debug("[MetricsAggregation] Skipping, already processing");
      return;
    }

    this.isProcessing = true;
    try {
      const now = new Date();

      // Clean up all old metrics first (any type)
      await this.cleanupOldMetrics();

      if (this.stopRequested) return;

      // PASS 1: Process minutes (execution → minute)
      await this.processMinutesPass(now);

      if (this.stopRequested) return;

      // PASS 2: Process hours (minute → hour)
      await this.processHoursPass(now);

      if (this.stopRequested) return;

      // PASS 3: Process days (hour → day)
      await this.processDaysPass(now);

      if (this.stopRequested) return;

      // CLEANUP: Delete processed source records
      await this.cleanupProcessedRecords();
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * MINUTES PASS: Aggregate execution records into minute records.
   * Creates both global (routeId=NULL) and per-route records.
   */
  private async processMinutesPass(now: Date): Promise<void> {
    const currentMinute = this.floorToMinute(now);

    // Get or initialize marker
    const startMarker = await this.getOrInitializeMinuteMarker(currentMinute);
    if (!startMarker) return; // No data to process

    let marker = startMarker;
    let minutesProcessed = 0;

    // Process each complete minute
    while (marker < currentMinute) {
      if (this.stopRequested) return;

      // Limit processing per run
      if (minutesProcessed >= this.maxMinutesPerRun) {
        logger.info(
          `[MetricsAggregation] Reached max minutes per run (${this.maxMinutesPerRun}), will continue in next run`
        );
        return;
      }

      const windowStart = marker;
      const windowEnd = new Date(marker.getTime() + 60 * 1000);

      // Check if any records exist in this window
      const hasRecords = await this.metricsService.hasRecordsInTimeWindow(
        "execution",
        windowStart,
        windowEnd
      );

      if (hasRecords) {
        // Aggregate global metrics
        const globalResult = await this.metricsService.aggregateGlobalInTimeWindow(
          "execution",
          windowStart,
          windowEnd
        );

        if (globalResult) {
          await this.metricsService.store({
            routeId: null,
            type: "minute",
            avgTimeMs: globalResult.avgTimeMs,
            maxTimeMs: globalResult.maxTimeMs,
            executionCount: globalResult.executionCount,
            timestamp: windowStart,
          });
        }

        // Aggregate per-route metrics
        const perRouteResults =
          await this.metricsService.aggregatePerRouteInTimeWindow(
            "execution",
            windowStart,
            windowEnd
          );

        for (const [routeId, result] of perRouteResults) {
          await this.metricsService.store({
            routeId,
            type: "minute",
            avgTimeMs: result.avgTimeMs,
            maxTimeMs: result.maxTimeMs,
            executionCount: result.executionCount,
            timestamp: windowStart,
          });
        }
      }

      // Advance marker
      marker = windowEnd;
      await this.stateService.setMarker("lastProcessedMinute", marker);
      minutesProcessed++;
    }
  }

  /**
   * Get or initialize the minute marker.
   * Returns null if no data to process and marker was set to current time.
   */
  private async getOrInitializeMinuteMarker(currentMinute: Date): Promise<Date | null> {
    const existingMarker = await this.stateService.getMarker("lastProcessedMinute");
    if (existingMarker) return existingMarker;

    // Bootstrap based on oldest execution record
    const oldestExecution = await this.metricsService.getOldestByType("execution");
    if (oldestExecution) {
      return this.floorToMinute(oldestExecution.timestamp);
    }

    // No data to process - set marker to current minute and return null
    await this.stateService.setMarker("lastProcessedMinute", currentMinute);
    return null;
  }

  /**
   * Get or initialize the hour marker.
   * Returns null if no data to process and marker was set to current time.
   */
  private async getOrInitializeHourMarker(currentHour: Date): Promise<Date | null> {
    const existingMarker = await this.stateService.getMarker("lastProcessedHour");
    if (existingMarker) return existingMarker;

    // Bootstrap based on oldest minute record
    const oldestMinute = await this.metricsService.getOldestByType("minute");
    if (oldestMinute) {
      return this.floorToHour(oldestMinute.timestamp);
    }

    // No data to process - set marker to current hour and return null
    await this.stateService.setMarker("lastProcessedHour", currentHour);
    return null;
  }

  /**
   * HOURS PASS: Aggregate minute records into hour records.
   * Creates both global (routeId=NULL) and per-route records.
   */
  private async processHoursPass(now: Date): Promise<void> {
    const currentHour = this.floorToHour(now);

    // Get or initialize marker
    const startMarker = await this.getOrInitializeHourMarker(currentHour);
    if (!startMarker) return; // No data to process

    let marker = startMarker;

    // Process each complete hour
    while (marker < currentHour) {
      if (this.stopRequested) return;

      const windowStart = marker;
      const windowEnd = new Date(marker.getTime() + 60 * 60 * 1000);

      // Check if any records exist in this window
      const hasRecords = await this.metricsService.hasRecordsInTimeWindow(
        "minute",
        windowStart,
        windowEnd
      );

      if (hasRecords) {
        // Aggregate global metrics
        const globalResult = await this.metricsService.aggregateGlobalInTimeWindow(
          "minute",
          windowStart,
          windowEnd
        );

        if (globalResult) {
          await this.metricsService.store({
            routeId: null,
            type: "hour",
            avgTimeMs: globalResult.avgTimeMs,
            maxTimeMs: globalResult.maxTimeMs,
            executionCount: globalResult.executionCount,
            timestamp: windowStart,
          });
        }

        // Aggregate per-route metrics
        const perRouteResults =
          await this.metricsService.aggregatePerRouteInTimeWindow(
            "minute",
            windowStart,
            windowEnd
          );

        for (const [routeId, result] of perRouteResults) {
          await this.metricsService.store({
            routeId,
            type: "hour",
            avgTimeMs: result.avgTimeMs,
            maxTimeMs: result.maxTimeMs,
            executionCount: result.executionCount,
            timestamp: windowStart,
          });
        }
      }

      // Advance marker
      marker = windowEnd;
      await this.stateService.setMarker("lastProcessedHour", marker);
    }
  }

  /**
   * Get or initialize the day marker.
   * Returns null if no data to process and marker was set to current time.
   */
  private async getOrInitializeDayMarker(currentDay: Date): Promise<Date | null> {
    const existingMarker = await this.stateService.getMarker("lastProcessedDay");
    if (existingMarker) return existingMarker;

    // Bootstrap based on oldest hour record
    const oldestHour = await this.metricsService.getOldestByType("hour");
    if (oldestHour) {
      return this.floorToDay(oldestHour.timestamp);
    }

    // No data to process - set marker to current day and return null
    await this.stateService.setMarker("lastProcessedDay", currentDay);
    return null;
  }

  /**
   * DAYS PASS: Aggregate hour records into day records.
   * Creates both global (routeId=NULL) and per-route records.
   */
  private async processDaysPass(now: Date): Promise<void> {
    const currentDay = this.floorToDay(now);

    // Get or initialize marker
    const startMarker = await this.getOrInitializeDayMarker(currentDay);
    if (!startMarker) return; // No data to process

    let marker = startMarker;

    // Process each complete day
    while (marker < currentDay) {
      if (this.stopRequested) return;

      const windowStart = marker;
      const windowEnd = new Date(marker.getTime() + 24 * 60 * 60 * 1000);

      // Check if any records exist in this window
      const hasRecords = await this.metricsService.hasRecordsInTimeWindow(
        "hour",
        windowStart,
        windowEnd
      );

      if (hasRecords) {
        // Aggregate global metrics
        const globalResult = await this.metricsService.aggregateGlobalInTimeWindow(
          "hour",
          windowStart,
          windowEnd
        );

        if (globalResult) {
          await this.metricsService.store({
            routeId: null,
            type: "day",
            avgTimeMs: globalResult.avgTimeMs,
            maxTimeMs: globalResult.maxTimeMs,
            executionCount: globalResult.executionCount,
            timestamp: windowStart,
          });
        }

        // Aggregate per-route metrics
        const perRouteResults =
          await this.metricsService.aggregatePerRouteInTimeWindow(
            "hour",
            windowStart,
            windowEnd
          );

        for (const [routeId, result] of perRouteResults) {
          await this.metricsService.store({
            routeId,
            type: "day",
            avgTimeMs: result.avgTimeMs,
            maxTimeMs: result.maxTimeMs,
            executionCount: result.executionCount,
            timestamp: windowStart,
          });
        }
      }

      // Advance marker
      marker = windowEnd;
      await this.stateService.setMarker("lastProcessedDay", marker);
    }
  }

  /**
   * Clean up processed source records based on markers.
   * Called at the end of all passes.
   */
  private async cleanupProcessedRecords(): Promise<void> {
    const minuteMarker = await this.stateService.getMarker("lastProcessedMinute");
    const hourMarker = await this.stateService.getMarker("lastProcessedHour");
    const dayMarker = await this.stateService.getMarker("lastProcessedDay");

    let totalDeleted = 0;

    // Delete execution records up to minute marker
    if (minuteMarker) {
      const deleted = await this.metricsService.deleteByTypeBeforeTimestamp(
        "execution",
        minuteMarker
      );
      totalDeleted += deleted;
    }

    // Delete minute records up to hour marker
    if (hourMarker) {
      const deleted = await this.metricsService.deleteByTypeBeforeTimestamp(
        "minute",
        hourMarker
      );
      totalDeleted += deleted;
    }

    // Delete hour records up to day marker
    if (dayMarker) {
      const deleted = await this.metricsService.deleteByTypeBeforeTimestamp(
        "hour",
        dayMarker
      );
      totalDeleted += deleted;
    }

    if (totalDeleted > 0) {
      logger.debug(
        `[MetricsAggregation] Cleaned up ${totalDeleted} processed records`
      );
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
