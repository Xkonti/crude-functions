/**
 * Database operations for persisted scheduled tasks.
 *
 * Owns all database access to the scheduledTasks table. Other code should
 * never query this table directly - always go through this service.
 *
 * Features:
 * - CRUD operations for scheduled tasks
 * - Orphan detection via process instance ID
 * - Stuck task recovery
 */

import { Mutex } from "@core/asyncutil/mutex";
import type { BindValue } from "@db/sqlite";
import type { DatabaseService } from "../database/database_service.ts";
import type { InstanceIdService } from "../instance/instance_id_service.ts";
import type {
  ScheduledTask,
  ScheduledTaskRow,
  ScheduleType,
  TaskStatus,
} from "./types.ts";
import { TaskNotFoundError, TaskAlreadyExistsError } from "./errors.ts";

/**
 * Options for creating a PersistedScheduleStore.
 */
export interface PersistedScheduleStoreOptions {
  db: DatabaseService;
  instanceIdService: InstanceIdService;
}

/**
 * Store for persisted scheduled tasks in SQLite database.
 */
export class PersistedScheduleStore {
  private readonly db: DatabaseService;
  private readonly instanceIdService: InstanceIdService;
  private readonly writeMutex = new Mutex();

  constructor(options: PersistedScheduleStoreOptions) {
    this.db = options.db;
    this.instanceIdService = options.instanceIdService;
  }

  /**
   * Create a new scheduled task.
   *
   * @throws {TaskAlreadyExistsError} If a task with the same name exists
   */
  async create(task: Omit<ScheduledTask, "id" | "storageMode">): Promise<ScheduledTask> {
    using _lock = await this.writeMutex.acquire();

    // Check for existing task
    const existing = await this.db.queryOne<{ id: number }>(
      "SELECT id FROM scheduledTasks WHERE name = ?",
      [task.name],
    );
    if (existing) {
      throw new TaskAlreadyExistsError(task.name);
    }

    const result = await this.db.execute(
      `INSERT INTO scheduledTasks (
        name, type, scheduleType, intervalSeconds, scheduledAt,
        enabled, payload, lastRunAt, nextRunAt, lastError,
        consecutiveFailures, status, runStartedAt, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        task.name,
        task.type,
        task.scheduleType,
        task.intervalSeconds,
        task.scheduledAt?.toISOString() ?? null,
        task.enabled ? 1 : 0,
        task.payload !== null ? JSON.stringify(task.payload) : null,
        task.lastRunAt?.toISOString() ?? null,
        task.nextRunAt?.toISOString() ?? null,
        task.lastError,
        task.consecutiveFailures,
        task.status,
        task.runStartedAt?.toISOString() ?? null,
      ],
    );

    return {
      ...task,
      id: result.lastInsertRowId as number,
      storageMode: "persisted",
    };
  }

  /**
   * Get a task by name.
   */
  async getByName(name: string): Promise<ScheduledTask | null> {
    const row = await this.db.queryOne<ScheduledTaskRow>(
      "SELECT * FROM scheduledTasks WHERE name = ?",
      [name],
    );
    return row ? this.rowToTask(row) : null;
  }

  /**
   * Get a task by ID.
   */
  async getById(id: number): Promise<ScheduledTask | null> {
    const row = await this.db.queryOne<ScheduledTaskRow>(
      "SELECT * FROM scheduledTasks WHERE id = ?",
      [id],
    );
    return row ? this.rowToTask(row) : null;
  }

  /**
   * Get all tasks.
   */
  async getAll(): Promise<ScheduledTask[]> {
    const rows = await this.db.queryAll<ScheduledTaskRow>(
      "SELECT * FROM scheduledTasks ORDER BY name",
    );
    return rows.map((row) => this.rowToTask(row));
  }

  /**
   * Get all enabled tasks that are due to run.
   *
   * @param beforeTime - Only return tasks with nextRunAt before this time
   */
  async getDueTasks(beforeTime: Date): Promise<ScheduledTask[]> {
    const rows = await this.db.queryAll<ScheduledTaskRow>(
      `SELECT * FROM scheduledTasks
       WHERE enabled = 1 AND status = 'idle' AND nextRunAt IS NOT NULL AND nextRunAt <= ?
       ORDER BY nextRunAt ASC`,
      [beforeTime.toISOString()],
    );
    return rows.map((row) => this.rowToTask(row));
  }

  /**
   * Update a task.
   *
   * @throws {TaskNotFoundError} If the task doesn't exist
   */
  async update(
    name: string,
    updates: Partial<Omit<ScheduledTask, "id" | "name" | "storageMode">>,
  ): Promise<ScheduledTask> {
    using _lock = await this.writeMutex.acquire();

    const existing = await this.db.queryOne<ScheduledTaskRow>(
      "SELECT * FROM scheduledTasks WHERE name = ?",
      [name],
    );
    if (!existing) {
      throw new TaskNotFoundError(name);
    }

    const setClauses: string[] = ["updatedAt = CURRENT_TIMESTAMP"];
    const values: BindValue[] = [];

    if (updates.type !== undefined) {
      setClauses.push("type = ?");
      values.push(updates.type);
    }
    if (updates.scheduleType !== undefined) {
      setClauses.push("scheduleType = ?");
      values.push(updates.scheduleType);
    }
    if (updates.intervalSeconds !== undefined) {
      setClauses.push("intervalSeconds = ?");
      values.push(updates.intervalSeconds);
    }
    if (updates.scheduledAt !== undefined) {
      setClauses.push("scheduledAt = ?");
      values.push(updates.scheduledAt?.toISOString() ?? null);
    }
    if (updates.enabled !== undefined) {
      setClauses.push("enabled = ?");
      values.push(updates.enabled ? 1 : 0);
    }
    if (updates.payload !== undefined) {
      setClauses.push("payload = ?");
      values.push(updates.payload !== null ? JSON.stringify(updates.payload) : null);
    }
    if (updates.lastRunAt !== undefined) {
      setClauses.push("lastRunAt = ?");
      values.push(updates.lastRunAt?.toISOString() ?? null);
    }
    if (updates.nextRunAt !== undefined) {
      setClauses.push("nextRunAt = ?");
      values.push(updates.nextRunAt?.toISOString() ?? null);
    }
    if (updates.lastError !== undefined) {
      setClauses.push("lastError = ?");
      values.push(updates.lastError);
    }
    if (updates.consecutiveFailures !== undefined) {
      setClauses.push("consecutiveFailures = ?");
      values.push(updates.consecutiveFailures);
    }
    if (updates.status !== undefined) {
      setClauses.push("status = ?");
      values.push(updates.status);
    }
    if (updates.runStartedAt !== undefined) {
      setClauses.push("runStartedAt = ?");
      values.push(updates.runStartedAt?.toISOString() ?? null);
    }

    values.push(name);

    await this.db.execute(
      `UPDATE scheduledTasks SET ${setClauses.join(", ")} WHERE name = ?`,
      values,
    );

    const updated = await this.db.queryOne<ScheduledTaskRow>(
      "SELECT * FROM scheduledTasks WHERE name = ?",
      [name],
    );
    return this.rowToTask(updated!);
  }

  /**
   * Delete a task by name.
   *
   * @returns true if task was deleted, false if not found
   */
  async delete(name: string): Promise<boolean> {
    using _lock = await this.writeMutex.acquire();

    const result = await this.db.execute(
      "DELETE FROM scheduledTasks WHERE name = ?",
      [name],
    );
    return (result.changes ?? 0) > 0;
  }

  /**
   * Mark a task as running.
   * Sets processInstanceId to current instance for orphan detection.
   *
   * @throws {TaskNotFoundError} If the task doesn't exist
   */
  async markRunning(name: string): Promise<ScheduledTask> {
    return await this.update(name, {
      status: "running",
      runStartedAt: new Date(),
    });
  }

  /**
   * Mark a task as idle after completion.
   * Clears processInstanceId and runStartedAt.
   *
   * @throws {TaskNotFoundError} If the task doesn't exist
   */
  async markIdle(
    name: string,
    updates: {
      lastRunAt: Date;
      nextRunAt: Date | null;
      lastError: string | null;
      consecutiveFailures: number;
    },
  ): Promise<ScheduledTask> {
    using _lock = await this.writeMutex.acquire();

    const existing = await this.db.queryOne<ScheduledTaskRow>(
      "SELECT * FROM scheduledTasks WHERE name = ?",
      [name],
    );
    if (!existing) {
      throw new TaskNotFoundError(name);
    }

    await this.db.execute(
      `UPDATE scheduledTasks SET
        status = 'idle',
        runStartedAt = NULL,
        processInstanceId = NULL,
        lastRunAt = ?,
        nextRunAt = ?,
        lastError = ?,
        consecutiveFailures = ?,
        updatedAt = CURRENT_TIMESTAMP
       WHERE name = ?`,
      [
        updates.lastRunAt.toISOString(),
        updates.nextRunAt?.toISOString() ?? null,
        updates.lastError,
        updates.consecutiveFailures,
        name,
      ],
    );

    const updated = await this.db.queryOne<ScheduledTaskRow>(
      "SELECT * FROM scheduledTasks WHERE name = ?",
      [name],
    );
    return this.rowToTask(updated!);
  }

  /**
   * Find orphaned tasks (running tasks from a different process instance).
   * These are tasks that were running when a previous instance crashed.
   */
  async findOrphanedTasks(): Promise<ScheduledTask[]> {
    const currentInstanceId = this.instanceIdService.getId();
    const rows = await this.db.queryAll<ScheduledTaskRow>(
      `SELECT * FROM scheduledTasks
       WHERE status = 'running'
       AND processInstanceId IS NOT NULL
       AND processInstanceId != ?`,
      [currentInstanceId],
    );
    return rows.map((row) => this.rowToTask(row));
  }

  /**
   * Find stuck tasks (running for longer than timeout).
   *
   * @param timeoutMs - Maximum allowed run time in milliseconds
   */
  async findStuckTasks(timeoutMs: number): Promise<ScheduledTask[]> {
    const cutoffTime = new Date(Date.now() - timeoutMs);
    const rows = await this.db.queryAll<ScheduledTaskRow>(
      `SELECT * FROM scheduledTasks
       WHERE status = 'running'
       AND runStartedAt IS NOT NULL
       AND runStartedAt < ?`,
      [cutoffTime.toISOString()],
    );
    return rows.map((row) => this.rowToTask(row));
  }

  /**
   * Reset orphaned or stuck tasks to idle state.
   * This allows them to be picked up and retried.
   */
  async resetTask(name: string): Promise<ScheduledTask> {
    return await this.update(name, {
      status: "idle",
      runStartedAt: null,
    });
  }

  /**
   * Claim a task for execution by setting the process instance ID.
   * Uses optimistic locking to prevent race conditions.
   *
   * @returns The claimed task, or null if already claimed by another process
   */
  async claimTask(name: string): Promise<ScheduledTask | null> {
    using _lock = await this.writeMutex.acquire();

    const instanceId = this.instanceIdService.getId();

    // Optimistic lock: only update if status is still 'idle'
    const result = await this.db.execute(
      `UPDATE scheduledTasks SET
        status = 'running',
        processInstanceId = ?,
        runStartedAt = CURRENT_TIMESTAMP,
        updatedAt = CURRENT_TIMESTAMP
       WHERE name = ? AND status = 'idle'`,
      [instanceId, name],
    );

    if ((result.changes ?? 0) === 0) {
      return null; // Task already claimed or doesn't exist
    }

    const updated = await this.db.queryOne<ScheduledTaskRow>(
      "SELECT * FROM scheduledTasks WHERE name = ?",
      [name],
    );
    return updated ? this.rowToTask(updated) : null;
  }

  /**
   * Convert a database row to a ScheduledTask object.
   */
  private rowToTask(row: ScheduledTaskRow): ScheduledTask {
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      scheduleType: row.scheduleType as ScheduleType,
      storageMode: "persisted",
      intervalSeconds: row.intervalSeconds,
      scheduledAt: row.scheduledAt ? new Date(row.scheduledAt) : null,
      enabled: row.enabled === 1,
      payload: row.payload ? JSON.parse(row.payload) : null,
      lastRunAt: row.lastRunAt ? new Date(row.lastRunAt) : null,
      nextRunAt: row.nextRunAt ? new Date(row.nextRunAt) : null,
      lastError: row.lastError,
      consecutiveFailures: row.consecutiveFailures,
      status: row.status as TaskStatus,
      runStartedAt: row.runStartedAt ? new Date(row.runStartedAt) : null,
    };
  }
}
