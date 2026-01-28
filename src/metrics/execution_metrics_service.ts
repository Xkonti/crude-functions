import { Mutex } from "@core/asyncutil/mutex";
import { RecordId } from "surrealdb";
import type { SurrealConnectionFactory } from "../database/surreal_connection_factory.ts";
import { toDate } from "../database/surreal_helpers.ts";
import type {
  ExecutionMetric,
  NewExecutionMetric,
  MetricType,
  AggregationResult,
  ExecutionMetricRow,
} from "./types.ts";
import { MetricTypeCode, MetricTypeFromCode } from "./types.ts";

export interface ExecutionMetricsServiceOptions {
  surrealFactory: SurrealConnectionFactory;
}

// Row type for aggregation queries (microseconds)
interface AggregationRow {
  avgTimeUs: number | null;
  maxTimeUs: number | null;
  executionCount: number | null;
}

// Row type for per-function aggregation queries
interface PerFunctionAggregationRow extends AggregationRow {
  functionId: RecordId;
}

/**
 * Service for storing and retrieving execution metrics.
 *
 * Metrics are recorded during function handler execution and stored
 * in SurrealDB for analytics and performance monitoring.
 *
 * Write operations are mutex-protected to prevent transaction conflicts.
 */
export class ExecutionMetricsService {
  private readonly surrealFactory: SurrealConnectionFactory;
  private readonly writeMutex = new Mutex();

  constructor(options: ExecutionMetricsServiceOptions) {
    this.surrealFactory = options.surrealFactory;
  }

  // ============== Write Operations (mutex-protected) ==============

  /**
   * Store an execution metric.
   * This is fire-and-forget - failures are logged but don't throw.
   */
  async store(metric: NewExecutionMetric): Promise<void> {
    try {
      using _lock = await this.writeMutex.acquire();
      await this.surrealFactory.withSystemConnection({}, async (db) => {
        // Use duration::from_micros() to convert microseconds to SurrealDB duration
        // Round to integers since duration::from_micros() requires int (aggregation produces floats)
        await db.query(
          `CREATE executionMetric SET
            functionId = $functionId,
            type = $type,
            avgTime = duration::from_micros($avgTimeUs),
            maxTime = duration::from_micros($maxTimeUs),
            executionCount = $executionCount,
            timestamp = $timestamp`,
          {
            functionId: metric.functionId ?? undefined,
            type: MetricTypeCode[metric.type],
            avgTimeUs: Math.round(metric.avgTimeUs),
            maxTimeUs: Math.round(metric.maxTimeUs),
            executionCount: metric.executionCount,
            timestamp: metric.timestamp ?? new Date(),
          }
        );
      });
    } catch (error) {
      // Fail silently
      globalThis.console.error(
        "[ExecutionMetricsService] Failed to store metric:",
        error
      );
    }
  }

  /**
   * Delete metrics older than the specified date.
   * Returns the number of deleted metrics.
   */
  async deleteOlderThan(date: Date): Promise<number> {
    using _lock = await this.writeMutex.acquire();
    return await this.surrealFactory.withSystemConnection({}, async (db) => {
      const [deleted] = await db.query<[ExecutionMetricRow[]]>(
        `DELETE FROM executionMetric WHERE timestamp < $date RETURN BEFORE`,
        { date }
      );
      return deleted?.length ?? 0;
    });
  }

  /**
   * Delete all metrics for a specific function.
   * Returns the number of deleted metrics.
   */
  async deleteByFunctionId(functionId: RecordId): Promise<number> {
    using _lock = await this.writeMutex.acquire();
    return await this.surrealFactory.withSystemConnection({}, async (db) => {
      const [deleted] = await db.query<[ExecutionMetricRow[]]>(
        `DELETE FROM executionMetric WHERE functionId = $functionId RETURN BEFORE`,
        { functionId }
      );
      return deleted?.length ?? 0;
    });
  }

  /**
   * Delete metrics for a function within a specific time range and type.
   * Start is inclusive, end is exclusive.
   * Returns the number of deleted metrics.
   */
  async deleteByFunctionIdTypeAndTimeRange(
    functionId: RecordId,
    type: MetricType,
    start: Date,
    end: Date
  ): Promise<number> {
    using _lock = await this.writeMutex.acquire();
    return await this.surrealFactory.withSystemConnection({}, async (db) => {
      const [deleted] = await db.query<[ExecutionMetricRow[]]>(
        `DELETE FROM executionMetric
         WHERE functionId = $functionId
           AND type = $type
           AND timestamp >= $start
           AND timestamp < $end
         RETURN BEFORE`,
        { functionId, type: MetricTypeCode[type], start, end }
      );
      return deleted?.length ?? 0;
    });
  }

  /**
   * Delete metrics of a specific type older than the specified date.
   * Returns the number of deleted metrics.
   */
  async deleteByTypeOlderThan(type: MetricType, date: Date): Promise<number> {
    using _lock = await this.writeMutex.acquire();
    return await this.surrealFactory.withSystemConnection({}, async (db) => {
      const [deleted] = await db.query<[ExecutionMetricRow[]]>(
        `DELETE FROM executionMetric WHERE type = $type AND timestamp < $date RETURN BEFORE`,
        { type: MetricTypeCode[type], date }
      );
      return deleted?.length ?? 0;
    });
  }

  /**
   * Delete all metrics of a specific type before the specified timestamp.
   * Includes both per-function and global metrics.
   *
   * @param type - The metric type to delete
   * @param timestamp - Delete records with timestamp < this value
   * @returns Number of deleted records
   */
  async deleteByTypeBeforeTimestamp(
    type: MetricType,
    timestamp: Date
  ): Promise<number> {
    using _lock = await this.writeMutex.acquire();
    return await this.surrealFactory.withSystemConnection({}, async (db) => {
      const [deleted] = await db.query<[ExecutionMetricRow[]]>(
        `DELETE FROM executionMetric WHERE type = $type AND timestamp < $timestamp RETURN BEFORE`,
        { type: MetricTypeCode[type], timestamp }
      );
      return deleted?.length ?? 0;
    });
  }

  // ============== Read Operations (no mutex) ==============

  /**
   * Retrieve metrics for a specific function.
   * Optionally filter by metric type.
   */
  async getByFunctionId(
    functionId: RecordId,
    type?: MetricType,
    limit?: number
  ): Promise<ExecutionMetric[]> {
    if (limit !== undefined && limit <= 0) {
      throw new Error(
        `Invalid limit: ${limit}. Limit must be a positive integer.`
      );
    }

    return await this.surrealFactory.withSystemConnection({}, async (db) => {
      let query = `SELECT
          id,
          functionId,
          type,
          duration::micros(avgTime) as avgTimeUs,
          duration::micros(maxTime) as maxTimeUs,
          executionCount,
          timestamp,
          createdAt
        FROM executionMetric WHERE functionId = $functionId`;
      const params: Record<string, unknown> = { functionId };

      if (type !== undefined) {
        query += ` AND type = $type`;
        params.type = MetricTypeCode[type];
      }
      query += ` ORDER BY timestamp DESC`;
      if (limit !== undefined && limit > 0) {
        query += ` LIMIT $limit`;
        params.limit = limit;
      }

      const [rows] = await db.query<[ExecutionMetricRow[]]>(query, params);
      return (rows ?? []).map((row) => this.rowToMetric(row));
    });
  }

  /**
   * Retrieve recent metrics across all functions.
   */
  async getRecent(limit = 100): Promise<ExecutionMetric[]> {
    if (limit <= 0) {
      throw new Error(
        `Invalid limit: ${limit}. Limit must be a positive integer.`
      );
    }

    return await this.surrealFactory.withSystemConnection({}, async (db) => {
      const [rows] = await db.query<[ExecutionMetricRow[]]>(
        `SELECT
          id,
          functionId,
          type,
          duration::micros(avgTime) as avgTimeUs,
          duration::micros(maxTime) as maxTimeUs,
          executionCount,
          timestamp,
          createdAt
        FROM executionMetric ORDER BY timestamp DESC LIMIT $limit`,
        { limit }
      );
      return (rows ?? []).map((row) => this.rowToMetric(row));
    });
  }

  /**
   * Get all distinct function IDs that have metrics of any type.
   * Excludes global metrics (functionId IS NONE).
   */
  async getDistinctFunctionIds(): Promise<RecordId[]> {
    return await this.surrealFactory.withSystemConnection({}, async (db) => {
      const [rows] = await db.query<[{ functionId: RecordId }[]]>(
        `SELECT functionId FROM executionMetric WHERE functionId IS NOT NONE GROUP BY functionId`
      );
      return (rows ?? []).map((row) => row.functionId);
    });
  }

  /**
   * Get all distinct function IDs that have metrics of a specific type.
   * Excludes global metrics (functionId IS NONE).
   */
  async getDistinctFunctionIdsByType(type: MetricType): Promise<RecordId[]> {
    return await this.surrealFactory.withSystemConnection({}, async (db) => {
      const [rows] = await db.query<[{ functionId: RecordId }[]]>(
        `SELECT functionId FROM executionMetric
         WHERE type = $type AND functionId IS NOT NONE
         GROUP BY functionId`,
        { type: MetricTypeCode[type] }
      );
      return (rows ?? []).map((row) => row.functionId);
    });
  }

  /**
   * Get metrics for a function within a specific time range.
   * Start is inclusive, end is exclusive.
   */
  async getByFunctionIdTypeAndTimeRange(
    functionId: RecordId,
    type: MetricType,
    start: Date,
    end: Date
  ): Promise<ExecutionMetric[]> {
    return await this.surrealFactory.withSystemConnection({}, async (db) => {
      const [rows] = await db.query<[ExecutionMetricRow[]]>(
        `SELECT
          id,
          functionId,
          type,
          duration::micros(avgTime) as avgTimeUs,
          duration::micros(maxTime) as maxTimeUs,
          executionCount,
          timestamp,
          createdAt
        FROM executionMetric
         WHERE functionId = $functionId
           AND type = $type
           AND timestamp >= $start
           AND timestamp < $end
         ORDER BY timestamp ASC`,
        { functionId, type: MetricTypeCode[type], start, end }
      );
      return (rows ?? []).map((row) => this.rowToMetric(row));
    });
  }

  /**
   * Get global metrics (functionId IS NONE) within a specific time range.
   * Start is inclusive, end is exclusive.
   */
  async getGlobalMetricsByTypeAndTimeRange(
    type: MetricType,
    start: Date,
    end: Date
  ): Promise<ExecutionMetric[]> {
    return await this.surrealFactory.withSystemConnection({}, async (db) => {
      const [rows] = await db.query<[ExecutionMetricRow[]]>(
        `SELECT
          id,
          functionId,
          type,
          duration::micros(avgTime) as avgTimeUs,
          duration::micros(maxTime) as maxTimeUs,
          executionCount,
          timestamp,
          createdAt
        FROM executionMetric
         WHERE functionId IS NONE
           AND type = $type
           AND timestamp >= $start
           AND timestamp < $end
         ORDER BY timestamp ASC`,
        { type: MetricTypeCode[type], start, end }
      );
      return (rows ?? []).map((row) => this.rowToMetric(row));
    });
  }

  /**
   * Get all per-function metrics (functionId IS NOT NONE) within a specific time range.
   * Used for calculating global current period by aggregating all function data.
   * Start is inclusive, end is exclusive.
   */
  async getAllPerFunctionMetricsByTypeAndTimeRange(
    type: MetricType,
    start: Date,
    end: Date
  ): Promise<ExecutionMetric[]> {
    return await this.surrealFactory.withSystemConnection({}, async (db) => {
      const [rows] = await db.query<[ExecutionMetricRow[]]>(
        `SELECT
          id,
          functionId,
          type,
          duration::micros(avgTime) as avgTimeUs,
          duration::micros(maxTime) as maxTimeUs,
          executionCount,
          timestamp,
          createdAt
        FROM executionMetric
         WHERE functionId IS NOT NONE
           AND type = $type
           AND timestamp >= $start
           AND timestamp < $end
         ORDER BY timestamp ASC`,
        { type: MetricTypeCode[type], start, end }
      );
      return (rows ?? []).map((row) => this.rowToMetric(row));
    });
  }

  /**
   * Get the most recent metric of a specific type.
   * Returns null if no metrics exist for that type.
   */
  async getMostRecentByType(type: MetricType): Promise<ExecutionMetric | null> {
    return await this.surrealFactory.withSystemConnection({}, async (db) => {
      const [rows] = await db.query<[ExecutionMetricRow[]]>(
        `SELECT
          id,
          functionId,
          type,
          duration::micros(avgTime) as avgTimeUs,
          duration::micros(maxTime) as maxTimeUs,
          executionCount,
          timestamp,
          createdAt
        FROM executionMetric
         WHERE type = $type
         ORDER BY timestamp DESC
         LIMIT 1`,
        { type: MetricTypeCode[type] }
      );
      const row = rows?.[0];
      return row ? this.rowToMetric(row) : null;
    });
  }

  /**
   * Get the oldest metric of a specific type.
   * Returns null if no metrics exist for that type.
   */
  async getOldestByType(type: MetricType): Promise<ExecutionMetric | null> {
    return await this.surrealFactory.withSystemConnection({}, async (db) => {
      const [rows] = await db.query<[ExecutionMetricRow[]]>(
        `SELECT
          id,
          functionId,
          type,
          duration::micros(avgTime) as avgTimeUs,
          duration::micros(maxTime) as maxTimeUs,
          executionCount,
          timestamp,
          createdAt
        FROM executionMetric
         WHERE type = $type
         ORDER BY timestamp ASC
         LIMIT 1`,
        { type: MetricTypeCode[type] }
      );
      const row = rows?.[0];
      return row ? this.rowToMetric(row) : null;
    });
  }

  // ============== Aggregation Methods ==============

  /**
   * Aggregate all metrics of a specific type within a time window into a global result.
   * Uses weighted average for avgTimeMs.
   * Excludes existing global metrics (functionId IS NONE).
   *
   * @param type - The metric type to aggregate
   * @param start - Start of time window (inclusive)
   * @param end - End of time window (exclusive)
   * @returns Aggregation result, or null if no records exist in the window
   */
  async aggregateGlobalInTimeWindow(
    type: MetricType,
    start: Date,
    end: Date
  ): Promise<AggregationResult | null> {
    return await this.surrealFactory.withSystemConnection({}, async (db) => {
      // Weighted average: sum(avg * count) / sum(count), using microseconds
      const [rows] = await db.query<[AggregationRow[]]>(
        `SELECT
          math::sum(duration::micros(avgTime) * executionCount) / math::sum(executionCount) as avgTimeUs,
          math::max(duration::micros(maxTime)) as maxTimeUs,
          math::sum(executionCount) as executionCount
         FROM executionMetric
         WHERE type = $type
           AND functionId IS NOT NONE
           AND timestamp >= $start
           AND timestamp < $end
         GROUP ALL`,
        { type: MetricTypeCode[type], start, end }
      );

      const result = rows?.[0];
      if (!result || !result.executionCount || result.executionCount === 0) {
        return null;
      }

      return {
        avgTimeUs: result.avgTimeUs ?? 0,
        maxTimeUs: result.maxTimeUs ?? 0,
        executionCount: result.executionCount,
      };
    });
  }

  /**
   * Aggregate metrics of a specific type within a time window, grouped by function.
   * Uses weighted average for avgTimeMs.
   * Excludes global metrics (functionId IS NONE).
   *
   * @param type - The metric type to aggregate
   * @param start - Start of time window (inclusive)
   * @param end - End of time window (exclusive)
   * @returns Map of functionId string to aggregation result
   */
  async aggregatePerFunctionInTimeWindow(
    type: MetricType,
    start: Date,
    end: Date
  ): Promise<Map<string, AggregationResult>> {
    return await this.surrealFactory.withSystemConnection({}, async (db) => {
      const [rows] = await db.query<[PerFunctionAggregationRow[]]>(
        `SELECT
          functionId,
          math::sum(duration::micros(avgTime) * executionCount) / math::sum(executionCount) as avgTimeUs,
          math::max(duration::micros(maxTime)) as maxTimeUs,
          math::sum(executionCount) as executionCount
         FROM executionMetric
         WHERE type = $type
           AND functionId IS NOT NONE
           AND timestamp >= $start
           AND timestamp < $end
         GROUP BY functionId`,
        { type: MetricTypeCode[type], start, end }
      );

      const result = new Map<string, AggregationResult>();
      for (const row of rows ?? []) {
        if (row.executionCount !== null && row.executionCount > 0) {
          // Use RecordId's string representation as map key
          const key = row.functionId.id as string;
          result.set(key, {
            avgTimeUs: row.avgTimeUs ?? 0,
            maxTimeUs: row.maxTimeUs ?? 0,
            executionCount: row.executionCount,
          });
        }
      }

      return result;
    });
  }

  /**
   * Check if any records of a specific type exist within a time window.
   * Excludes global metrics (functionId IS NONE).
   *
   * @param type - The metric type to check
   * @param start - Start of time window (inclusive)
   * @param end - End of time window (exclusive)
   * @returns True if records exist, false otherwise
   */
  async hasRecordsInTimeWindow(
    type: MetricType,
    start: Date,
    end: Date
  ): Promise<boolean> {
    return await this.surrealFactory.withSystemConnection({}, async (db) => {
      const [rows] = await db.query<[{ id: RecordId }[]]>(
        `SELECT id FROM executionMetric
         WHERE type = $type
           AND functionId IS NOT NONE
           AND timestamp >= $start
           AND timestamp < $end
         LIMIT 1`,
        { type: MetricTypeCode[type], start, end }
      );
      return (rows?.length ?? 0) > 0;
    });
  }

  // ============== Helper Methods ==============

  /**
   * Convert a database row to an ExecutionMetric model.
   * Row fields avgTimeUs and maxTimeUs are already numeric from duration::micros() conversion in query.
   */
  private rowToMetric(row: ExecutionMetricRow): ExecutionMetric {
    return {
      id: row.id,
      functionId: row.functionId ?? null,
      type: MetricTypeFromCode[row.type],
      avgTimeUs: row.avgTimeUs,
      maxTimeUs: row.maxTimeUs,
      executionCount: row.executionCount,
      timestamp: toDate(row.timestamp),
    };
  }
}
