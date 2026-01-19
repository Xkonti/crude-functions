import type { ExecutionMetricsService } from "./execution_metrics_service.ts";
import type { MetricsStateService } from "./metrics_state_service.ts";
import type { MetricsAggregationConfig } from "./types.ts";
import type { CancellationToken } from "../jobs/types.ts";
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
 *
 * This service is invoked by the job system via the scheduling service.
 * It does not maintain its own timer - scheduling is handled externally.
 */
export class MetricsAggregationService {
  private readonly metricsService: ExecutionMetricsService;
  private readonly stateService: MetricsStateService;
  private readonly config: MetricsAggregationConfig;
  private readonly maxMinutesPerRun: number;

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
   * Run aggregation once and wait for completion.
   * Useful for testing and one-off catch-up processing.
   */
  async runOnce(): Promise<void> {
    await this.performAggregation();
  }

  /**
   * Perform the aggregation operation.
   * Called by the job handler when the metrics-aggregation job is executed.
   *
   * @param token - Optional cancellation token for graceful cancellation
   */
  async performAggregation(token?: CancellationToken): Promise<void> {
    const now = new Date();

    // Clean up all old metrics first (any type)
    await this.cleanupOldMetrics();

    token?.throwIfCancelled();

    // PASS 1: Process minutes (execution → minute)
    await this.processMinutesPass(now, token);

    token?.throwIfCancelled();

    // PASS 2: Process hours (minute → hour)
    await this.processHoursPass(now, token);

    token?.throwIfCancelled();

    // PASS 3: Process days (hour → day)
    await this.processDaysPass(now, token);

    token?.throwIfCancelled();

    // CLEANUP: Delete processed source records
    await this.cleanupProcessedRecords();
  }

  /**
   * MINUTES PASS: Aggregate execution records into minute records.
   * Creates both global (routeId=NULL) and per-route records.
   */
  private async processMinutesPass(now: Date, token?: CancellationToken): Promise<void> {
    const currentMinute = this.floorToMinute(now);

    // Get or initialize marker
    const startMarker = await this.getOrInitializeMinuteMarker(currentMinute);
    if (!startMarker) return; // No data to process

    let marker = startMarker;
    let minutesProcessed = 0;

    // Process each complete minute
    while (marker < currentMinute) {
      token?.throwIfCancelled();

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
  private async processHoursPass(now: Date, token?: CancellationToken): Promise<void> {
    const currentHour = this.floorToHour(now);

    // Get or initialize marker
    const startMarker = await this.getOrInitializeHourMarker(currentHour);
    if (!startMarker) return; // No data to process

    let marker = startMarker;

    // Process each complete hour
    while (marker < currentHour) {
      token?.throwIfCancelled();

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
  private async processDaysPass(now: Date, token?: CancellationToken): Promise<void> {
    const currentDay = this.floorToDay(now);

    // Get or initialize marker
    const startMarker = await this.getOrInitializeDayMarker(currentDay);
    if (!startMarker) return; // No data to process

    let marker = startMarker;

    // Process each complete day
    while (marker < currentDay) {
      token?.throwIfCancelled();

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
