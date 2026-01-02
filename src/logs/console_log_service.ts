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
   * Results are ordered from oldest to newest.
   */
  async getByRouteId(routeId: number, limit?: number): Promise<ConsoleLog[]> {
    const sql = limit
      ? `SELECT id, request_id, route_id, level, message, args, timestamp
         FROM console_logs
         WHERE route_id = ?
         ORDER BY id ASC
         LIMIT ?`
      : `SELECT id, request_id, route_id, level, message, args, timestamp
         FROM console_logs
         WHERE route_id = ?
         ORDER BY id ASC`;

    const params = limit ? [routeId, limit] : [routeId];
    const rows = await this.db.queryAll<ConsoleLogRow>(sql, params);

    return rows.map((row) => this.rowToConsoleLog(row));
  }

  /**
   * Retrieve recent logs across all routes.
   */
  async getRecent(limit = 100): Promise<ConsoleLog[]> {
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
