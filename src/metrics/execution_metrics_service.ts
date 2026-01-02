import type { DatabaseService } from "../database/database_service.ts";
import type { ExecutionMetric, NewExecutionMetric, MetricType } from "./types.ts";

export interface ExecutionMetricsServiceOptions {
  db: DatabaseService;
}

// Row type for database queries
interface ExecutionMetricRow {
  [key: string]: unknown;
  id: number;
  route_id: number;
  type: string;
  time_value_ms: number;
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
      await this.db.execute(
        `INSERT INTO execution_metrics (route_id, type, time_value_ms)
         VALUES (?, ?, ?)`,
        [metric.routeId, metric.type, metric.timeValueMs]
      );
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
    let rows: ExecutionMetricRow[];

    if (type && limit) {
      rows = await this.db.queryAll<ExecutionMetricRow>(
        `SELECT id, route_id, type, time_value_ms, timestamp
         FROM execution_metrics
         WHERE route_id = ? AND type = ?
         ORDER BY id DESC
         LIMIT ?`,
        [routeId, type, limit]
      );
    } else if (type) {
      rows = await this.db.queryAll<ExecutionMetricRow>(
        `SELECT id, route_id, type, time_value_ms, timestamp
         FROM execution_metrics
         WHERE route_id = ? AND type = ?
         ORDER BY id DESC`,
        [routeId, type]
      );
    } else if (limit) {
      rows = await this.db.queryAll<ExecutionMetricRow>(
        `SELECT id, route_id, type, time_value_ms, timestamp
         FROM execution_metrics
         WHERE route_id = ?
         ORDER BY id DESC
         LIMIT ?`,
        [routeId, limit]
      );
    } else {
      rows = await this.db.queryAll<ExecutionMetricRow>(
        `SELECT id, route_id, type, time_value_ms, timestamp
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
    const rows = await this.db.queryAll<ExecutionMetricRow>(
      `SELECT id, route_id, type, time_value_ms, timestamp
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
      [date.toISOString()]
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

  private rowToMetric(row: ExecutionMetricRow): ExecutionMetric {
    return {
      id: row.id,
      routeId: row.route_id,
      type: row.type as MetricType,
      timeValueMs: row.time_value_ms,
      timestamp: new Date(row.timestamp),
    };
  }
}
