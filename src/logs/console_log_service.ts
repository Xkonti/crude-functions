import type { DatabaseService } from "../database/database_service.ts";
import type { SettingsService } from "../settings/settings_service.ts";
import { SettingNames } from "../settings/types.ts";
import type { ConsoleLog, NewConsoleLog, GetPaginatedOptions, PaginatedLogsResult, PaginationCursor } from "./types.ts";
import { formatForSqlite, parseSqliteTimestamp } from "../utils/datetime.ts";

export interface ConsoleLogServiceOptions {
  db: DatabaseService;
  settingsService: SettingsService;
}

/**
 * Buffered log entry with capture timestamp for ordering.
 */
interface BufferedLogEntry extends NewConsoleLog {
  capturedAt: Date;
  sequenceInBatch: number;
}

// Row type for database queries
interface ConsoleLogRow {
  [key: string]: unknown;
  id: number;
  requestId: string;
  routeId: number | null;
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
 *
 * Uses batching to reduce database writes - logs are buffered in memory
 * and flushed either when the batch size is reached or after a delay.
 */
export class ConsoleLogService {
  private readonly db: DatabaseService;
  private readonly settingsService: SettingsService;

  // Buffer management
  private buffer: BufferedLogEntry[] = [];
  private flushTimer: number | null = null;
  private isFlushing = false;
  private isShutdown = false;

  // Settings (refreshed periodically)
  private maxBatchSize = 50;
  private maxDelayMs = 50;
  private lastSettingsRefresh = 0;
  private readonly settingsRefreshIntervalMs = 5000;

  constructor(options: ConsoleLogServiceOptions) {
    this.db = options.db;
    this.settingsService = options.settingsService;
  }

  /**
   * Store a console log entry.
   * Buffers the entry and schedules a flush. Fire-and-forget pattern.
   */
  store(entry: NewConsoleLog): void {
    if (this.isShutdown) return;

    const bufferedEntry: BufferedLogEntry = {
      ...entry,
      capturedAt: new Date(),
      sequenceInBatch: this.buffer.length,
    };
    this.buffer.push(bufferedEntry);

    if (this.buffer.length >= this.maxBatchSize) {
      this.scheduleFlush(true); // immediate flush
    } else if (!this.flushTimer) {
      this.scheduleFlush(false); // delayed flush
    }
  }

  /**
   * Flush any remaining buffered logs and stop the service.
   * Should be called during graceful shutdown before closing the database.
   */
  async shutdown(): Promise<void> {
    this.isShutdown = true;

    // Clear any pending timer
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    // Wait for any in-progress flush to complete
    const maxWait = 5000;
    const startTime = Date.now();
    while (this.isFlushing && Date.now() - startTime < maxWait) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    // Final flush of remaining buffer
    await this.flush();
    globalThis.console.log("[ConsoleLogService] Shutdown complete");
  }

  /**
   * Schedule a flush of the buffer.
   */
  private scheduleFlush(immediate: boolean): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (immediate) {
      // Use queueMicrotask to not block the current store() call
      queueMicrotask(() => this.flush());
    } else {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.flush();
      }, this.maxDelayMs);
    }
  }

  /**
   * Flush the current buffer to the database.
   * Call this when you need to ensure logs are written immediately.
   */
  async flush(): Promise<void> {
    // Prevent concurrent flushes
    if (this.isFlushing) return;

    // Atomically swap buffer
    const toFlush = this.buffer;
    this.buffer = [];

    if (toFlush.length === 0) return;

    this.isFlushing = true;
    try {
      await this.flushBatch(toFlush);
      // Refresh settings after successful flush (if interval elapsed)
      await this.maybeRefreshSettings();
    } finally {
      this.isFlushing = false;
    }
  }

  /**
   * Write a batch of entries to the database with retry on failure.
   */
  private async flushBatch(entries: BufferedLogEntry[]): Promise<void> {
    try {
      await this.executeBatchInsert(entries);
    } catch (error) {
      globalThis.console.error("[ConsoleLogService] Batch flush failed, retrying:", error);
      try {
        await this.executeBatchInsert(entries);
      } catch (retryError) {
        globalThis.console.error("[ConsoleLogService] Retry failed, logs lost:", retryError);
        // Logs are lost - acceptable for fire-and-forget pattern
      }
    }
  }

  /**
   * Execute a batch INSERT with timestamp ordering.
   * Applies microsecond offsets to preserve ordering within the batch.
   */
  private async executeBatchInsert(entries: BufferedLogEntry[]): Promise<void> {
    if (entries.length === 0) return;

    // Build multi-row INSERT with explicit timestamps
    const placeholders = entries.map(() => "(?, ?, ?, ?, ?, ?)").join(", ");
    const sql = `INSERT INTO executionLogs (requestId, routeId, level, message, args, timestamp)
                 VALUES ${placeholders}`;

    // Flatten parameters with timestamp offsets for ordering
    const params: (string | number | null)[] = [];
    for (const entry of entries) {
      // Add microsecond offset based on sequence to preserve order
      const timestamp = new Date(entry.capturedAt.getTime());
      // Add sequence * 1ms offset to ensure ordering (SQLite timestamp has ms precision)
      timestamp.setTime(timestamp.getTime() + entry.sequenceInBatch);

      params.push(
        entry.requestId,
        entry.routeId,
        entry.level,
        entry.message,
        entry.args ?? null,
        formatForSqlite(timestamp)
      );
    }

    await this.db.execute(sql, params);
  }

  /**
   * Refresh settings from database if the refresh interval has elapsed.
   */
  private async maybeRefreshSettings(): Promise<void> {
    const now = Date.now();
    if (now - this.lastSettingsRefresh < this.settingsRefreshIntervalMs) return;

    this.lastSettingsRefresh = now;
    try {
      const batchSizeStr = await this.settingsService.getGlobalSetting(
        SettingNames.LOG_BATCHING_MAX_BATCH_SIZE
      );
      const delayStr = await this.settingsService.getGlobalSetting(
        SettingNames.LOG_BATCHING_MAX_DELAY_MS
      );

      if (batchSizeStr) {
        const parsed = parseInt(batchSizeStr, 10);
        if (!isNaN(parsed) && parsed > 0) {
          this.maxBatchSize = parsed;
        }
      }

      if (delayStr) {
        const parsed = parseInt(delayStr, 10);
        if (!isNaN(parsed) && parsed > 0) {
          this.maxDelayMs = parsed;
        }
      }
    } catch (error) {
      globalThis.console.error("[ConsoleLogService] Failed to refresh settings:", error);
    }
  }

  /**
   * Retrieve logs for a specific request.
   */
  async getByRequestId(requestId: string): Promise<ConsoleLog[]> {
    const rows = await this.db.queryAll<ConsoleLogRow>(
      `SELECT id, requestId, routeId, level, message, args, timestamp
       FROM executionLogs
       WHERE requestId = ?
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
      ? `SELECT id, requestId, routeId, level, message, args, timestamp
         FROM executionLogs
         WHERE routeId = ?
         ORDER BY id DESC
         LIMIT ?`
      : `SELECT id, requestId, routeId, level, message, args, timestamp
         FROM executionLogs
         WHERE routeId = ?
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
      `SELECT id, requestId, routeId, level, message, args, timestamp
       FROM executionLogs
       WHERE routeId = ? AND id < ?
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
      `SELECT id, requestId, routeId, level, message, args, timestamp
       FROM executionLogs
       ORDER BY id DESC
       LIMIT ?`,
      [limit]
    );

    return rows.map((row) => this.rowToConsoleLog(row));
  }

  /**
   * Retrieve logs with cursor-based pagination.
   * Results are ordered from newest to oldest.
   * Cursor combines timestamp and ID to handle same-timestamp ambiguity.
   */
  async getPaginated(options: GetPaginatedOptions): Promise<PaginatedLogsResult> {
    const { routeId, limit, cursor } = options;

    // Validate limit
    if (limit < 1 || limit > 1000) {
      throw new Error(`Invalid limit: ${limit}. Limit must be between 1 and 1000.`);
    }

    // Decode cursor if provided
    let cursorData: PaginationCursor | null = null;
    if (cursor) {
      try {
        const decoded = atob(cursor);
        cursorData = JSON.parse(decoded);
      } catch {
        throw new Error("Invalid cursor format");
      }
    }

    // Build query with cursor filtering
    let sql: string;
    const params: (string | number)[] = [];

    if (routeId !== undefined) {
      if (cursorData) {
        sql = `SELECT id, requestId, routeId, level, message, args, timestamp
               FROM executionLogs
               WHERE routeId = ?
                 AND (timestamp < ? OR (timestamp = ? AND id < ?))
               ORDER BY timestamp DESC, id DESC
               LIMIT ?`;
        params.push(routeId, cursorData.timestamp, cursorData.timestamp, cursorData.id, limit + 1);
      } else {
        sql = `SELECT id, requestId, routeId, level, message, args, timestamp
               FROM executionLogs
               WHERE routeId = ?
               ORDER BY timestamp DESC, id DESC
               LIMIT ?`;
        params.push(routeId, limit + 1);
      }
    } else {
      if (cursorData) {
        sql = `SELECT id, requestId, routeId, level, message, args, timestamp
               FROM executionLogs
               WHERE (timestamp < ? OR (timestamp = ? AND id < ?))
               ORDER BY timestamp DESC, id DESC
               LIMIT ?`;
        params.push(cursorData.timestamp, cursorData.timestamp, cursorData.id, limit + 1);
      } else {
        sql = `SELECT id, requestId, routeId, level, message, args, timestamp
               FROM executionLogs
               ORDER BY timestamp DESC, id DESC
               LIMIT ?`;
        params.push(limit + 1);
      }
    }

    const rows = await this.db.queryAll<ConsoleLogRow>(sql, params);

    // Check if there are more results
    const hasMore = rows.length > limit;
    const resultRows = rows.slice(0, limit);
    const logs = resultRows.map(row => this.rowToConsoleLog(row));

    // Generate next cursor if there are more results
    // Use raw timestamp from database row to preserve exact format
    let nextCursor: string | undefined;
    if (hasMore && resultRows.length > 0) {
      const lastRow = resultRows[resultRows.length - 1];
      const cursorObj: PaginationCursor = {
        timestamp: lastRow.timestamp,
        id: lastRow.id,
      };
      nextCursor = btoa(JSON.stringify(cursorObj));
    }

    // Generate previous cursor (first item of current page)
    // Use raw timestamp from database row to preserve exact format
    let prevCursor: string | undefined;
    if (cursor && resultRows.length > 0) {
      const firstRow = resultRows[0];
      const cursorObj: PaginationCursor = {
        timestamp: firstRow.timestamp,
        id: firstRow.id,
      };
      prevCursor = btoa(JSON.stringify(cursorObj));
    }

    return {
      logs,
      hasMore,
      nextCursor,
      prevCursor,
    };
  }

  /**
   * Delete logs older than the specified date.
   * Returns the number of deleted logs.
   */
  async deleteOlderThan(date: Date): Promise<number> {
    const result = await this.db.execute(
      `DELETE FROM executionLogs WHERE timestamp < ?`,
      [formatForSqlite(date)]
    );

    return result.changes;
  }

  /**
   * Delete all logs for a specific route.
   * Returns the number of deleted logs.
   */
  async deleteByRouteId(routeId: number): Promise<number> {
    const result = await this.db.execute(
      `DELETE FROM executionLogs WHERE routeId = ?`,
      [routeId]
    );

    return result.changes;
  }

  /**
   * Get all distinct route IDs that have logs.
   */
  async getDistinctRouteIds(): Promise<number[]> {
    const rows = await this.db.queryAll<{ routeId: number }>(
      `SELECT DISTINCT routeId FROM executionLogs WHERE routeId IS NOT NULL`
    );
    return rows.map((row) => row.routeId);
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
      `SELECT id FROM executionLogs
       WHERE routeId = ?
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
      `DELETE FROM executionLogs
       WHERE routeId = ? AND id < ?`,
      [routeId, thresholdRow.id]
    );

    return result.changes;
  }

  private rowToConsoleLog(row: ConsoleLogRow): ConsoleLog {
    return {
      id: row.id,
      requestId: row.requestId,
      routeId: row.routeId ?? 0, // Default to 0 for orphaned logs
      level: row.level as ConsoleLog["level"],
      message: row.message,
      args: row.args ?? undefined,
      timestamp: parseSqliteTimestamp(row.timestamp),
    };
  }
}
