import { Mutex } from "@core/asyncutil/mutex";
import { RecordId } from "surrealdb";
import type { SurrealConnectionFactory } from "../database/surreal_connection_factory.ts";
import { recordIdToString } from "../database/surreal_helpers.ts";
import type { SettingsService } from "../settings/settings_service.ts";
import { SettingNames } from "../settings/types.ts";
import type { ConsoleLog, NewConsoleLog, GetPaginatedOptions, PaginatedLogsResult, PaginationCursor } from "./types.ts";

export interface ConsoleLogServiceOptions {
  surrealFactory: SurrealConnectionFactory;
  settingsService: SettingsService;
}

/**
 * Buffered log entry with capture timestamp for ordering.
 */
interface BufferedLogEntry extends NewConsoleLog {
  capturedAt: Date;
  sequenceInBatch: number;
}

/** Database row type for execution logs */
interface ExecutionLogRow {
  id: RecordId;
  requestId: string;
  functionId: RecordId | null;
  level: string;
  message: string;
  args: string | null;
  sequence: number;
  timestamp: Date;
  createdAt: Date;
}

/**
 * Service for storing and retrieving captured console logs.
 *
 * Logs are captured from function handlers during execution and stored
 * in SurrealDB for later retrieval and analysis.
 *
 * Uses batching to reduce database writes - logs are buffered in memory
 * and flushed either when the batch size is reached or after a delay.
 */
export class ConsoleLogService {
  private readonly surrealFactory: SurrealConnectionFactory;
  private readonly settingsService: SettingsService;
  private readonly writeMutex = new Mutex();

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
    this.surrealFactory = options.surrealFactory;
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
   * Execute a batch INSERT into SurrealDB.
   * Uses the sequence field for ordering within the batch.
   */
  private async executeBatchInsert(entries: BufferedLogEntry[]): Promise<void> {
    if (entries.length === 0) return;

    using _lock = await this.writeMutex.acquire();

    await this.surrealFactory.withSystemConnection({}, async (db) => {
      // Insert each log individually to ensure all are inserted
      for (const entry of entries) {
        const log = {
          requestId: entry.requestId,
          functionId: entry.functionId
            ? new RecordId("functionDef", entry.functionId)
            : undefined, // NONE for orphaned logs
          level: entry.level,
          message: entry.message,
          args: entry.args ?? undefined, // NONE instead of NULL
          sequence: entry.sequenceInBatch,
          timestamp: entry.capturedAt,
        };

        await db.query(
          `CREATE executionLog CONTENT $log`,
          { log }
        );
      }
    });
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
    return await this.surrealFactory.withSystemConnection({}, async (db) => {
      const [rows] = await db.query<[ExecutionLogRow[]]>(
        `SELECT *, timestamp as ts, sequence as seq FROM executionLog
         WHERE requestId = $requestId
         ORDER BY ts ASC, seq ASC`,
        { requestId }
      );

      return (rows ?? []).map((row) => this.rowToConsoleLog(row));
    });
  }

  /**
   * Retrieve logs for a specific function.
   * Results are ordered from newest to oldest.
   */
  async getByFunctionId(functionId: string, limit?: number): Promise<ConsoleLog[]> {
    // Validate limit if provided
    if (limit !== undefined && limit <= 0) {
      throw new Error(`Invalid limit: ${limit}. Limit must be a positive integer.`);
    }

    const funcRecordId = new RecordId("functionDef", functionId);

    return await this.surrealFactory.withSystemConnection({}, async (db) => {
      const query = limit
        ? `SELECT *, timestamp as ts, sequence as seq FROM executionLog
           WHERE functionId = $functionId
           ORDER BY ts DESC, seq DESC
           LIMIT $limit`
        : `SELECT *, timestamp as ts, sequence as seq FROM executionLog
           WHERE functionId = $functionId
           ORDER BY ts DESC, seq DESC`;

      const [rows] = await db.query<[ExecutionLogRow[]]>(
        query,
        { functionId: funcRecordId, limit }
      );

      return (rows ?? []).map((row) => this.rowToConsoleLog(row));
    });
  }

  /**
   * Retrieve logs for a specific function before a given cursor.
   * Used for pagination (next page).
   * Results are ordered from newest to oldest.
   */
  async getByFunctionIdBeforeCursor(
    functionId: string,
    cursorTimestamp: Date,
    cursorSequence: number,
    limit: number
  ): Promise<ConsoleLog[]> {
    if (limit <= 0) {
      throw new Error(`Invalid limit: ${limit}. Limit must be a positive integer.`);
    }

    const funcRecordId = new RecordId("functionDef", functionId);

    return await this.surrealFactory.withSystemConnection({}, async (db) => {
      const [rows] = await db.query<[ExecutionLogRow[]]>(
        `SELECT *, timestamp as ts, sequence as seq FROM executionLog
         WHERE functionId = $functionId
           AND (timestamp < $cursorTimestamp
                OR (timestamp = $cursorTimestamp AND sequence < $cursorSeq))
         ORDER BY ts DESC, seq DESC
         LIMIT $limit`,
        { functionId: funcRecordId, cursorTimestamp, cursorSeq: cursorSequence, limit }
      );

      return (rows ?? []).map((row) => this.rowToConsoleLog(row));
    });
  }

  /**
   * Retrieve recent logs across all functions.
   */
  async getRecent(limit = 100): Promise<ConsoleLog[]> {
    if (limit <= 0) {
      throw new Error(`Invalid limit: ${limit}. Limit must be a positive integer.`);
    }

    return await this.surrealFactory.withSystemConnection({}, async (db) => {
      const [rows] = await db.query<[ExecutionLogRow[]]>(
        `SELECT *, timestamp as ts, sequence as seq FROM executionLog
         ORDER BY ts DESC, seq DESC
         LIMIT $limit`,
        { limit }
      );

      return (rows ?? []).map((row) => this.rowToConsoleLog(row));
    });
  }

  /**
   * Retrieve logs with cursor-based pagination.
   * Results are ordered from newest to oldest.
   * Cursor combines timestamp and RecordId to handle same-timestamp ambiguity.
   */
  async getPaginated(options: GetPaginatedOptions): Promise<PaginatedLogsResult> {
    const { functionId, levels, limit, cursor } = options;

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

    return await this.surrealFactory.withSystemConnection({}, async (db) => {
      // Build WHERE clauses dynamically
      const conditions: string[] = [];
      const params: Record<string, unknown> = { limit: limit + 1 };

      // Add functionId filter if provided
      if (functionId !== undefined) {
        conditions.push("functionId = $functionId");
        params.functionId = new RecordId("functionDef", functionId);
      }

      // Add level filter if provided
      if (levels && levels.length > 0) {
        conditions.push("level IN $levels");
        params.levels = levels;
      }

      // Add cursor filter if provided
      if (cursorData) {
        conditions.push(
          "(timestamp < $cursorTimestamp OR (timestamp = $cursorTimestamp AND sequence < $cursorSeq))"
        );
        params.cursorTimestamp = new Date(cursorData.timestamp);
        params.cursorSeq = cursorData.sequence;
      }

      const whereClause = conditions.length > 0
        ? `WHERE ${conditions.join(" AND ")}`
        : "";

      const query = `SELECT *, timestamp as ts, sequence as seq FROM executionLog
         ${whereClause}
         ORDER BY ts DESC, seq DESC
         LIMIT $limit`;

      const [rows] = await db.query<[ExecutionLogRow[]]>(query, params);

      const resultRows = rows ?? [];
      const hasMore = resultRows.length > limit;
      const pagedRows = resultRows.slice(0, limit);
      const logs = pagedRows.map((row) => this.rowToConsoleLog(row));

      // Generate next cursor if there are more results
      let nextCursor: string | undefined;
      if (hasMore && pagedRows.length > 0) {
        const lastRow = pagedRows[pagedRows.length - 1];
        const cursorObj: PaginationCursor = {
          timestamp: lastRow.timestamp.toISOString(),
          sequence: lastRow.sequence,
        };
        nextCursor = btoa(JSON.stringify(cursorObj));
      }

      // Generate previous cursor (first item of current page)
      let prevCursor: string | undefined;
      if (cursor && pagedRows.length > 0) {
        const firstRow = pagedRows[0];
        const cursorObj: PaginationCursor = {
          timestamp: firstRow.timestamp.toISOString(),
          sequence: firstRow.sequence,
        };
        prevCursor = btoa(JSON.stringify(cursorObj));
      }

      return {
        logs,
        hasMore,
        nextCursor,
        prevCursor,
      };
    });
  }

  /**
   * Delete logs older than the specified date.
   * Returns the number of deleted logs.
   */
  async deleteOlderThan(date: Date): Promise<number> {
    using _lock = await this.writeMutex.acquire();

    return await this.surrealFactory.withSystemConnection({}, async (db) => {
      // Get count first
      const [countResult] = await db.query<[{ count: number }[]]>(
        `SELECT count() as count FROM executionLog WHERE timestamp < $date GROUP ALL`,
        { date }
      );
      const count = countResult?.[0]?.count ?? 0;

      // Delete logs
      await db.query(
        `DELETE FROM executionLog WHERE timestamp < $date`,
        { date }
      );

      return count;
    });
  }

  /**
   * Delete all logs for a specific function.
   * Returns the number of deleted logs.
   */
  async deleteByFunctionId(functionId: string): Promise<number> {
    using _lock = await this.writeMutex.acquire();

    const funcRecordId = new RecordId("functionDef", functionId);

    return await this.surrealFactory.withSystemConnection({}, async (db) => {
      // Get count first
      const [countResult] = await db.query<[{ count: number }[]]>(
        `SELECT count() as count FROM executionLog WHERE functionId = $functionId GROUP ALL`,
        { functionId: funcRecordId }
      );
      const count = countResult?.[0]?.count ?? 0;

      // Delete logs
      await db.query(
        `DELETE FROM executionLog WHERE functionId = $functionId`,
        { functionId: funcRecordId }
      );

      return count;
    });
  }

  /**
   * Get all distinct function IDs that have logs.
   */
  async getDistinctFunctionIds(): Promise<string[]> {
    return await this.surrealFactory.withSystemConnection({}, async (db) => {
      // Use GROUP BY to get distinct values in SurrealDB
      const [rows] = await db.query<[{ functionId: RecordId }[]]>(
        `SELECT functionId FROM executionLog WHERE functionId IS NOT NONE GROUP BY functionId`
      );

      return (rows ?? []).map((row) => recordIdToString(row.functionId));
    });
  }

  /**
   * Trim logs for a function to keep only the newest N logs.
   * Returns the number of deleted logs.
   *
   * Uses an efficient two-step approach:
   * - Gets the id of the Nth newest log
   * - Deletes all logs older than that threshold
   */
  async trimToLimit(functionId: string, maxLogs: number): Promise<number> {
    using _lock = await this.writeMutex.acquire();

    const funcRecordId = new RecordId("functionDef", functionId);

    return await this.surrealFactory.withSystemConnection({}, async (db) => {
      // Get the threshold (the maxLogs-th newest log)
      const [thresholdResult] = await db.query<[{ id: RecordId; timestamp: Date; sequence: number }[]]>(
        `SELECT id, timestamp, sequence, timestamp as ts, sequence as seq FROM executionLog
         WHERE functionId = $functionId
         ORDER BY ts DESC, seq DESC
         LIMIT 1 START $offset`,
        { functionId: funcRecordId, offset: maxLogs - 1 }
      );

      const threshold = thresholdResult?.[0];
      if (!threshold) {
        return 0; // Fewer than maxLogs entries
      }

      // Count logs to delete (older than threshold)
      const [countResult] = await db.query<[{ count: number }[]]>(
        `SELECT count() as count FROM executionLog
         WHERE functionId = $functionId
           AND (timestamp < $thresholdTime
                OR (timestamp = $thresholdTime AND sequence < $thresholdSeq))
         GROUP ALL`,
        {
          functionId: funcRecordId,
          thresholdTime: threshold.timestamp,
          thresholdSeq: threshold.sequence,
        }
      );
      const count = countResult?.[0]?.count ?? 0;

      // Delete logs older than threshold
      await db.query(
        `DELETE FROM executionLog
         WHERE functionId = $functionId
           AND (timestamp < $thresholdTime
                OR (timestamp = $thresholdTime AND sequence < $thresholdSeq))`,
        {
          functionId: funcRecordId,
          thresholdTime: threshold.timestamp,
          thresholdSeq: threshold.sequence,
        }
      );

      return count;
    });
  }

  private rowToConsoleLog(row: ExecutionLogRow): ConsoleLog {
    return {
      id: recordIdToString(row.id),
      requestId: row.requestId,
      functionId: row.functionId ? recordIdToString(row.functionId) : "",
      level: row.level as ConsoleLog["level"],
      message: row.message,
      args: row.args ?? undefined,
      sequence: row.sequence,
      timestamp: new Date(row.timestamp),
    };
  }
}
