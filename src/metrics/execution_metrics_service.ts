import type { DatabaseService } from "../database/database_service.ts";
import type { ExecutionMetric, NewExecutionMetric, MetricType } from "./types.ts";
import { formatForSqlite, parseSqliteTimestamp } from "../utils/datetime.ts";

export interface ExecutionMetricsServiceOptions {
  db: DatabaseService;
}

// Row type for database queries
interface ExecutionMetricRow {
  [key: string]: unknown;
  id: number;
  route_id: number;
  type: string;
  avg_time_ms: number;
  max_time_ms: number;
  execution_count: number;
  timestamp: string;
}

/**
 * Service for storing and retrieving execution metrics.
 *
 * Metrics are recorded during function handler execution and stored
 * in the database for analytics and performance monitoring.
 */
export class ExecutionMetricsService {
  private readonly db: DatabaseService;

  constructor(options: ExecutionMetricsServiceOptions) {
    this.db = options.db;
  }

  /**
   * Store an execution metric.
   * This is fire-and-forget - failures are logged but don't throw.
   */
  async store(metric: NewExecutionMetric): Promise<void> {
    try {
      if (metric.timestamp) {
        await this.db.execute(
          `INSERT INTO execution_metrics (route_id, type, avg_time_ms, max_time_ms, execution_count, timestamp)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            metric.routeId,
            metric.type,
            metric.avgTimeMs,
            metric.maxTimeMs,
            metric.executionCount,
            formatForSqlite(metric.timestamp),
          ]
        );
      } else {
        await this.db.execute(
          `INSERT INTO execution_metrics (route_id, type, avg_time_ms, max_time_ms, execution_count)
           VALUES (?, ?, ?, ?, ?)`,
          [
            metric.routeId,
            metric.type,
            metric.avgTimeMs,
            metric.maxTimeMs,
            metric.executionCount,
          ]
        );
      }
    } catch (error) {
      // Fail silently
      globalThis.console.error("[ExecutionMetricsService] Failed to store metric:", error);
    }
  }

  /**
   * Retrieve metrics for a specific route.
   * Optionally filter by metric type.
   */
  async getByRouteId(
    routeId: number,
    type?: MetricType,
    limit?: number
  ): Promise<ExecutionMetric[]> {
    // Validate limit if provided
    if (limit !== undefined && limit <= 0) {
      throw new Error(`Invalid limit: ${limit}. Limit must be a positive integer.`);
    }

    let rows: ExecutionMetricRow[];

    if (type && limit) {
      rows = await this.db.queryAll<ExecutionMetricRow>(
        `SELECT id, route_id, type, avg_time_ms, max_time_ms, execution_count, timestamp
         FROM execution_metrics
         WHERE route_id = ? AND type = ?
         ORDER BY id DESC
         LIMIT ?`,
        [routeId, type, limit]
      );
    } else if (type) {
      rows = await this.db.queryAll<ExecutionMetricRow>(
        `SELECT id, route_id, type, avg_time_ms, max_time_ms, execution_count, timestamp
         FROM execution_metrics
         WHERE route_id = ? AND type = ?
         ORDER BY id DESC`,
        [routeId, type]
      );
    } else if (limit) {
      rows = await this.db.queryAll<ExecutionMetricRow>(
        `SELECT id, route_id, type, avg_time_ms, max_time_ms, execution_count, timestamp
         FROM execution_metrics
         WHERE route_id = ?
         ORDER BY id DESC
         LIMIT ?`,
        [routeId, limit]
      );
    } else {
      rows = await this.db.queryAll<ExecutionMetricRow>(
        `SELECT id, route_id, type, avg_time_ms, max_time_ms, execution_count, timestamp
         FROM execution_metrics
         WHERE route_id = ?
         ORDER BY id DESC`,
        [routeId]
      );
    }

    return rows.map((row) => this.rowToMetric(row));
  }

  /**
   * Retrieve recent metrics across all routes.
   */
  async getRecent(limit = 100): Promise<ExecutionMetric[]> {
    if (limit <= 0) {
      throw new Error(`Invalid limit: ${limit}. Limit must be a positive integer.`);
    }

    const rows = await this.db.queryAll<ExecutionMetricRow>(
      `SELECT id, route_id, type, avg_time_ms, max_time_ms, execution_count, timestamp
       FROM execution_metrics
       ORDER BY id DESC
       LIMIT ?`,
      [limit]
    );

    return rows.map((row) => this.rowToMetric(row));
  }

  /**
   * Delete metrics older than the specified date.
   * Returns the number of deleted metrics.
   */
  async deleteOlderThan(date: Date): Promise<number> {
    const result = await this.db.execute(
      `DELETE FROM execution_metrics WHERE timestamp < ?`,
      [formatForSqlite(date)]
    );

    return result.changes;
  }

  /**
   * Delete all metrics for a specific route.
   * Returns the number of deleted metrics.
   */
  async deleteByRouteId(routeId: number): Promise<number> {
    const result = await this.db.execute(
      `DELETE FROM execution_metrics WHERE route_id = ?`,
      [routeId]
    );

    return result.changes;
  }

  /**
   * Get all distinct route IDs that have metrics of any type.
   */
  async getDistinctRouteIds(): Promise<number[]> {
    const rows = await this.db.queryAll<{ route_id: number }>(
      `SELECT DISTINCT route_id FROM execution_metrics`
    );
    return rows.map((row) => row.route_id);
  }

  /**
   * Get all distinct route IDs that have metrics of a specific type.
   */
  async getDistinctRouteIdsByType(type: MetricType): Promise<number[]> {
    const rows = await this.db.queryAll<{ route_id: number }>(
      `SELECT DISTINCT route_id FROM execution_metrics WHERE type = ?`,
      [type]
    );
    return rows.map((row) => row.route_id);
  }

  /**
   * Get metrics for a route within a specific time range.
   * Start is inclusive, end is exclusive.
   */
  async getByRouteIdTypeAndTimeRange(
    routeId: number,
    type: MetricType,
    start: Date,
    end: Date
  ): Promise<ExecutionMetric[]> {
    const rows = await this.db.queryAll<ExecutionMetricRow>(
      `SELECT id, route_id, type, avg_time_ms, max_time_ms, execution_count, timestamp
       FROM execution_metrics
       WHERE route_id = ? AND type = ? AND timestamp >= ? AND timestamp < ?
       ORDER BY timestamp ASC`,
      [routeId, type, formatForSqlite(start), formatForSqlite(end)]
    );

    return rows.map((row) => this.rowToMetric(row));
  }

  /**
   * Delete metrics for a route within a specific time range and type.
   * Start is inclusive, end is exclusive.
   * Returns the number of deleted metrics.
   */
  async deleteByRouteIdTypeAndTimeRange(
    routeId: number,
    type: MetricType,
    start: Date,
    end: Date
  ): Promise<number> {
    const result = await this.db.execute(
      `DELETE FROM execution_metrics
       WHERE route_id = ? AND type = ? AND timestamp >= ? AND timestamp < ?`,
      [routeId, type, formatForSqlite(start), formatForSqlite(end)]
    );

    return result.changes;
  }

  /**
   * Get the most recent metric of a specific type.
   * Returns null if no metrics exist for that type.
   */
  async getMostRecentByType(type: MetricType): Promise<ExecutionMetric | null> {
    const row = await this.db.queryOne<ExecutionMetricRow>(
      `SELECT id, route_id, type, avg_time_ms, max_time_ms, execution_count, timestamp
       FROM execution_metrics
       WHERE type = ?
       ORDER BY timestamp DESC
       LIMIT 1`,
      [type]
    );

    return row ? this.rowToMetric(row) : null;
  }

  /**
   * Get the oldest metric of a specific type.
   * Returns null if no metrics exist for that type.
   */
  async getOldestByType(type: MetricType): Promise<ExecutionMetric | null> {
    const row = await this.db.queryOne<ExecutionMetricRow>(
      `SELECT id, route_id, type, avg_time_ms, max_time_ms, execution_count, timestamp
       FROM execution_metrics
       WHERE type = ?
       ORDER BY timestamp ASC
       LIMIT 1`,
      [type]
    );

    return row ? this.rowToMetric(row) : null;
  }

  /**
   * Delete metrics of a specific type older than the specified date.
   * Returns the number of deleted metrics.
   */
  async deleteByTypeOlderThan(type: MetricType, date: Date): Promise<number> {
    const result = await this.db.execute(
      `DELETE FROM execution_metrics WHERE type = ? AND timestamp < ?`,
      [type, formatForSqlite(date)]
    );

    return result.changes;
  }

  private rowToMetric(row: ExecutionMetricRow): ExecutionMetric {
    return {
      id: row.id,
      routeId: row.route_id,
      type: row.type as MetricType,
      avgTimeMs: row.avg_time_ms,
      maxTimeMs: row.max_time_ms,
      executionCount: row.execution_count,
      timestamp: parseSqliteTimestamp(row.timestamp),
    };
  }
}
