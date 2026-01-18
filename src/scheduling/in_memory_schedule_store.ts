/**
 * In-memory storage for scheduled tasks.
 *
 * Tasks stored here are lost on restart and must be re-registered at startup.
 * This is used for background services like log trimming and metrics aggregation
 * that don't need persistence.
 *
 * Features:
 * - Fast in-memory operations (no database overhead)
 * - Same interface as PersistedScheduleStore for consistency
 * - Auto-incrementing IDs (negative to distinguish from persisted tasks)
 */

import type { ScheduledTask } from "./types.ts";
import { TaskNotFoundError, TaskAlreadyExistsError } from "./errors.ts";

/**
 * Store for in-memory scheduled tasks.
 *
 * Uses a Map for O(1) lookups by name.
 * IDs are negative numbers to distinguish from persisted tasks.
 */
export class InMemoryScheduleStore {
  private readonly tasks = new Map<string, ScheduledTask>();
  private nextId = -1;

  /**
   * Create a new scheduled task.
   *
   * @throws {TaskAlreadyExistsError} If a task with the same name exists
   */
  create(task: Omit<ScheduledTask, "id" | "storageMode">): ScheduledTask {
    if (this.tasks.has(task.name)) {
      throw new TaskAlreadyExistsError(task.name);
    }

    const newTask: ScheduledTask = {
      ...task,
      id: this.nextId--,
      storageMode: "in-memory",
    };

    this.tasks.set(task.name, newTask);
    return newTask;
  }

  /**
   * Get a task by name.
   */
  getByName(name: string): ScheduledTask | null {
    return this.tasks.get(name) ?? null;
  }

  /**
   * Get a task by ID.
   */
  getById(id: number): ScheduledTask | null {
    for (const task of this.tasks.values()) {
      if (task.id === id) {
        return task;
      }
    }
    return null;
  }

  /**
   * Get all tasks.
   */
  getAll(): ScheduledTask[] {
    return Array.from(this.tasks.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }

  /**
   * Get all enabled tasks that are due to run.
   *
   * @param beforeTime - Only return tasks with nextRunAt before this time
   */
  getDueTasks(beforeTime: Date): ScheduledTask[] {
    const result: ScheduledTask[] = [];
    for (const task of this.tasks.values()) {
      if (
        task.enabled &&
        task.status === "idle" &&
        task.nextRunAt !== null &&
        task.nextRunAt <= beforeTime
      ) {
        result.push(task);
      }
    }
    return result.sort((a, b) => {
      const aTime = a.nextRunAt?.getTime() ?? 0;
      const bTime = b.nextRunAt?.getTime() ?? 0;
      return aTime - bTime;
    });
  }

  /**
   * Update a task.
   *
   * @throws {TaskNotFoundError} If the task doesn't exist
   */
  update(
    name: string,
    updates: Partial<Omit<ScheduledTask, "id" | "name" | "storageMode">>,
  ): ScheduledTask {
    const existing = this.tasks.get(name);
    if (!existing) {
      throw new TaskNotFoundError(name);
    }

    const updated: ScheduledTask = {
      ...existing,
      ...updates,
    };

    this.tasks.set(name, updated);
    return updated;
  }

  /**
   * Delete a task by name.
   *
   * @returns true if task was deleted, false if not found
   */
  delete(name: string): boolean {
    return this.tasks.delete(name);
  }

  /**
   * Mark a task as running.
   *
   * @throws {TaskNotFoundError} If the task doesn't exist
   */
  markRunning(name: string): ScheduledTask {
    return this.update(name, {
      status: "running",
      runStartedAt: new Date(),
    });
  }

  /**
   * Mark a task as idle after completion.
   *
   * @throws {TaskNotFoundError} If the task doesn't exist
   */
  markIdle(
    name: string,
    updates: {
      lastRunAt: Date;
      nextRunAt: Date | null;
      lastError: string | null;
      consecutiveFailures: number;
    },
  ): ScheduledTask {
    return this.update(name, {
      status: "idle",
      runStartedAt: null,
      lastRunAt: updates.lastRunAt,
      nextRunAt: updates.nextRunAt,
      lastError: updates.lastError,
      consecutiveFailures: updates.consecutiveFailures,
    });
  }

  /**
   * Find stuck tasks (running for longer than timeout).
   * In-memory tasks don't have orphan detection since they're lost on restart.
   *
   * @param timeoutMs - Maximum allowed run time in milliseconds
   */
  findStuckTasks(timeoutMs: number): ScheduledTask[] {
    const cutoffTime = new Date(Date.now() - timeoutMs);
    const result: ScheduledTask[] = [];
    for (const task of this.tasks.values()) {
      if (
        task.status === "running" &&
        task.runStartedAt !== null &&
        task.runStartedAt < cutoffTime
      ) {
        result.push(task);
      }
    }
    return result;
  }

  /**
   * Reset a stuck task to idle state.
   */
  resetTask(name: string): ScheduledTask {
    return this.update(name, {
      status: "idle",
      runStartedAt: null,
    });
  }

  /**
   * Claim a task for execution.
   * For in-memory tasks, this just marks it as running.
   *
   * @returns The claimed task, or null if already running
   */
  claimTask(name: string): ScheduledTask | null {
    const task = this.tasks.get(name);
    if (!task || task.status !== "idle") {
      return null;
    }
    return this.markRunning(name);
  }

  /**
   * Clear all tasks.
   * Useful for testing.
   */
  clear(): void {
    this.tasks.clear();
    this.nextId = -1;
  }

  /**
   * Get the number of tasks.
   */
  get size(): number {
    return this.tasks.size;
  }
}
