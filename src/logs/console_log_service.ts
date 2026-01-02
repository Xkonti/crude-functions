import type { DatabaseService } from "../database/database_service.ts";
import type { ConsoleLog, NewConsoleLog } from "./types.ts";

export interface ConsoleLogServiceOptions {
  db: DatabaseService;
}

// Row type for database queries
interface ConsoleLogRow {
  [key: string]: unknown;
  id: number;
  request_id: string;
  route_id: number | null;
  level: string;
  message: string;
  args: string | null;
  timestamp: string;
}

/**
 * Service for storing and retrieving captured console logs.
 *
 * Logs are captured from function handlers during execution and stored
 * in the database for later retrieval and analysis.
 */
export class ConsoleLogService {
  private readonly db: DatabaseService;

  constructor(options: ConsoleLogServiceOptions) {
    this.db = options.db;
  }

  /**
   * Store a console log entry.
   * This is fire-and-forget - failures are logged but don't throw.
   */
  async store(entry: NewConsoleLog): Promise<void> {
    try {
      await this.db.execute(
        `INSERT INTO console_logs (request_id, route_id, level, message, args)
         VALUES (?, ?, ?, ?, ?)`,
        [
          entry.requestId,
          entry.routeId,
          entry.level,
          entry.message,
          entry.args ?? null,
        ]
      );
    } catch (error) {
      // Fail silently - use globalThis.console to avoid recursion
      globalThis.console.error("[ConsoleLogService] Failed to store log:", error);
    }
  }

  /**
   * Retrieve logs for a specific request.
   */
  async getByRequestId(requestId: string): Promise<ConsoleLog[]> {
    const rows = await this.db.queryAll<ConsoleLogRow>(
      `SELECT id, request_id, route_id, level, message, args, timestamp
       FROM console_logs
       WHERE request_id = ?
       ORDER BY id ASC`,
      [requestId]
    );

    return rows.map((row) => this.rowToConsoleLog(row));
  }

  /**
   * Retrieve logs for a specific route.
   * Results are ordered from newest to oldest.
   */
  async getByRouteId(routeId: number, limit?: number): Promise<ConsoleLog[]> {
    // Validate limit if provided
    if (limit !== undefined && limit <= 0) {
      throw new Error(`Invalid limit: ${limit}. Limit must be a positive integer.`);
    }

    const sql = limit
      ? `SELECT id, request_id, route_id, level, message, args, timestamp
         FROM console_logs
         WHERE route_id = ?
         ORDER BY id DESC
         LIMIT ?`
      : `SELECT id, request_id, route_id, level, message, args, timestamp
         FROM console_logs
         WHERE route_id = ?
         ORDER BY id DESC`;

    const params = limit ? [routeId, limit] : [routeId];
    const rows = await this.db.queryAll<ConsoleLogRow>(sql, params);

    return rows.map((row) => this.rowToConsoleLog(row));
  }

  /**
   * Retrieve logs for a specific route before a given log id.
   * Used for pagination (next page).
   * Results are ordered from newest to oldest.
   */
  async getByRouteIdBeforeId(
    routeId: number,
    beforeId: number,
    limit: number
  ): Promise<ConsoleLog[]> {
    if (limit <= 0) {
      throw new Error(`Invalid limit: ${limit}. Limit must be a positive integer.`);
    }

    const rows = await this.db.queryAll<ConsoleLogRow>(
      `SELECT id, request_id, route_id, level, message, args, timestamp
       FROM console_logs
       WHERE route_id = ? AND id < ?
       ORDER BY id DESC
       LIMIT ?`,
      [routeId, beforeId, limit]
    );

    return rows.map((row) => this.rowToConsoleLog(row));
  }

  /**
   * Retrieve recent logs across all routes.
   */
  async getRecent(limit = 100): Promise<ConsoleLog[]> {
    if (limit <= 0) {
      throw new Error(`Invalid limit: ${limit}. Limit must be a positive integer.`);
    }

    const rows = await this.db.queryAll<ConsoleLogRow>(
      `SELECT id, request_id, route_id, level, message, args, timestamp
       FROM console_logs
       ORDER BY id DESC
       LIMIT ?`,
      [limit]
    );

    return rows.map((row) => this.rowToConsoleLog(row));
  }

  /**
   * Delete logs older than the specified date.
   * Returns the number of deleted logs.
   */
  async deleteOlderThan(date: Date): Promise<number> {
    const result = await this.db.execute(
      `DELETE FROM console_logs WHERE timestamp < ?`,
      [date.toISOString()]
    );

    return result.changes;
  }

  /**
   * Delete all logs for a specific route.
   * Returns the number of deleted logs.
   */
  async deleteByRouteId(routeId: number): Promise<number> {
    const result = await this.db.execute(
      `DELETE FROM console_logs WHERE route_id = ?`,
      [routeId]
    );

    return result.changes;
  }

  /**
   * Get all distinct route IDs that have logs.
   */
  async getDistinctRouteIds(): Promise<number[]> {
    const rows = await this.db.queryAll<{ route_id: number }>(
      `SELECT DISTINCT route_id FROM console_logs WHERE route_id IS NOT NULL`
    );
    return rows.map((row) => row.route_id);
  }

  /**
   * Trim logs for a route to keep only the newest N logs.
   * Returns the number of deleted logs.
   *
   * Uses an efficient two-step approach:
   * - Gets the id of the Nth newest log
   * - Deletes all logs with id less than that threshold
   */
  async trimToLimit(routeId: number, maxLogs: number): Promise<number> {
    // Find the id threshold - the id of the (maxLogs)th newest log
    // Logs older than this will be deleted
    const thresholdRow = await this.db.queryOne<{ id: number }>(
      `SELECT id FROM console_logs
       WHERE route_id = ?
       ORDER BY id DESC
       LIMIT 1 OFFSET ?`,
      [routeId, maxLogs - 1]
    );

    // If no threshold found, there are fewer than maxLogs entries
    if (!thresholdRow) {
      return 0;
    }

    // Delete all logs for this route with id less than threshold
    const result = await this.db.execute(
      `DELETE FROM console_logs
       WHERE route_id = ? AND id < ?`,
      [routeId, thresholdRow.id]
    );

    return result.changes;
  }

  private rowToConsoleLog(row: ConsoleLogRow): ConsoleLog {
    return {
      id: row.id,
      requestId: row.request_id,
      routeId: row.route_id ?? 0, // Default to 0 for orphaned logs
      level: row.level as ConsoleLog["level"],
      message: row.message,
      args: row.args ?? undefined,
      timestamp: new Date(row.timestamp),
    };
  }
}
