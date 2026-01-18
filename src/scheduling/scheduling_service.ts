/**
 * Unified scheduling service for background task execution.
 *
 * Supports three schedule types:
 * - one-off: Runs once at a specific datetime
 * - interval: Runs every N seconds
 * - dynamic: Next run determined by callback after each execution
 *
 * And two storage modes:
 * - persisted: Stored in database, survives restarts (for user-configured tasks)
 * - in-memory: Lost on restart, re-registered at startup (for system services)
 *
 * Features:
 * - Handler registration for task types
 * - Task registration (persisted or in-memory)
 * - Dynamic rescheduling when settings change
 * - Orphan detection for persisted tasks
 * - Stuck task recovery
 * - Graceful shutdown with task completion
 */

import { logger } from "../utils/logger.ts";
import { PersistedScheduleStore } from "./persisted_schedule_store.ts";
import { InMemoryScheduleStore } from "./in_memory_schedule_store.ts";
import type {
  ScheduledTask,
  TaskHandlerConfig,
  TaskExecutionResult,
  RegisterPersistedTaskOptions,
  RegisterInMemoryTaskOptions,
  UpdateTaskScheduleOptions,
  SchedulingServiceOptions,
  SchedulingServiceStatus,
} from "./types.ts";
import {
  TaskNotFoundError,
  TaskAlreadyExistsError,
  HandlerNotFoundError,
  HandlerAlreadyExistsError,
  InvalidTaskConfigError,
  ServiceStateError,
  TaskTimeoutError,
} from "./errors.ts";

/**
 * Default values for scheduling configuration.
 */
const DEFAULTS = {
  POLLING_INTERVAL_SECONDS: 1,
  DEFAULT_TIMEOUT_MS: 300000, // 5 minutes
  STUCK_TASK_TIMEOUT_MS: 3600000, // 1 hour
  MAX_CONSECUTIVE_FAILURES: 5,
};

/**
 * Main scheduling service that coordinates task execution.
 */
export class SchedulingService {
  private readonly persistedStore: PersistedScheduleStore;
  private readonly inMemoryStore: InMemoryScheduleStore;
  private readonly handlers = new Map<string, TaskHandlerConfig>();

  private readonly pollingIntervalSeconds: number;
  private readonly defaultTimeoutMs: number;
  private readonly stuckTaskTimeoutMs: number;

  private pollingTimerId: number | null = null;
  private isRunning = false;
  private stopRequested = false;
  private runningTasks = new Set<string>();
  private taskAbortControllers = new Map<string, AbortController>();

  constructor(options: SchedulingServiceOptions) {
    this.persistedStore = new PersistedScheduleStore({
      db: options.db,
      instanceIdService: options.instanceIdService,
    });
    this.inMemoryStore = new InMemoryScheduleStore();

    this.pollingIntervalSeconds = options.pollingIntervalSeconds ?? DEFAULTS.POLLING_INTERVAL_SECONDS;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULTS.DEFAULT_TIMEOUT_MS;
    this.stuckTaskTimeoutMs = options.stuckTaskTimeoutMs ?? DEFAULTS.STUCK_TASK_TIMEOUT_MS;
  }

  // ===========================================================================
  // Handler Registration
  // ===========================================================================

  /**
   * Register a handler for a task type.
   *
   * @throws {HandlerAlreadyExistsError} If a handler for this type already exists
   */
  registerHandler(type: string, config: TaskHandlerConfig): void {
    if (this.handlers.has(type)) {
      throw new HandlerAlreadyExistsError(type);
    }
    this.handlers.set(type, config);
    logger.debug(`[Scheduling] Registered handler for type "${type}"`);
  }

  /**
   * Unregister a handler for a task type.
   *
   * @returns true if handler was removed, false if not found
   */
  unregisterHandler(type: string): boolean {
    const removed = this.handlers.delete(type);
    if (removed) {
      logger.debug(`[Scheduling] Unregistered handler for type "${type}"`);
    }
    return removed;
  }

  /**
   * Check if a handler is registered for a task type.
   */
  hasHandler(type: string): boolean {
    return this.handlers.has(type);
  }

  // ===========================================================================
  // Task Registration
  // ===========================================================================

  /**
   * Register a persisted task (survives restarts).
   *
   * @throws {TaskAlreadyExistsError} If a task with this name already exists
   * @throws {InvalidTaskConfigError} If the task configuration is invalid
   */
  async registerPersistedTask(options: RegisterPersistedTaskOptions): Promise<ScheduledTask> {
    this.validateTaskConfig(options);

    // Check if task already exists in either store
    const existing = await this.getTask(options.name);
    if (existing) {
      throw new TaskAlreadyExistsError(options.name);
    }

    const now = new Date();
    const nextRunAt = this.calculateNextRunAt(options, now, options.runImmediately);

    const task = await this.persistedStore.create({
      name: options.name,
      type: options.type,
      scheduleType: options.scheduleType,
      intervalSeconds: options.intervalSeconds ?? null,
      scheduledAt: options.scheduledAt ?? null,
      enabled: true,
      payload: options.payload ?? null,
      lastRunAt: null,
      nextRunAt,
      lastError: null,
      consecutiveFailures: 0,
      status: "idle",
      runStartedAt: null,
    });

    logger.info(`[Scheduling] Registered persisted task "${task.name}" (type: ${task.type}, next: ${nextRunAt?.toISOString() ?? "immediate"})`);
    return task;
  }

  /**
   * Register an in-memory task (lost on restart).
   *
   * @throws {TaskAlreadyExistsError} If a task with this name already exists
   * @throws {InvalidTaskConfigError} If the task configuration is invalid
   */
  registerInMemoryTask(options: RegisterInMemoryTaskOptions): ScheduledTask {
    this.validateTaskConfig(options);

    // Check if task already exists in either store
    const existingInMemory = this.inMemoryStore.getByName(options.name);
    if (existingInMemory) {
      throw new TaskAlreadyExistsError(options.name);
    }

    const now = new Date();
    const nextRunAt = this.calculateNextRunAt(options, now, options.runImmediately);

    const task = this.inMemoryStore.create({
      name: options.name,
      type: options.type,
      scheduleType: options.scheduleType,
      intervalSeconds: options.intervalSeconds ?? null,
      scheduledAt: options.scheduledAt ?? null,
      enabled: true,
      payload: options.payload ?? null,
      lastRunAt: null,
      nextRunAt,
      lastError: null,
      consecutiveFailures: 0,
      status: "idle",
      runStartedAt: null,
    });

    logger.info(`[Scheduling] Registered in-memory task "${task.name}" (type: ${task.type}, next: ${nextRunAt?.toISOString() ?? "immediate"})`);
    return task;
  }

  /**
   * Unregister a task by name.
   *
   * @returns true if task was removed, false if not found
   */
  async unregisterTask(name: string): Promise<boolean> {
    // Check if task is running
    if (this.runningTasks.has(name)) {
      logger.warn(`[Scheduling] Cannot unregister running task "${name}"`);
      return false;
    }

    // Try in-memory first
    if (this.inMemoryStore.delete(name)) {
      logger.info(`[Scheduling] Unregistered in-memory task "${name}"`);
      return true;
    }

    // Try persisted
    if (await this.persistedStore.delete(name)) {
      logger.info(`[Scheduling] Unregistered persisted task "${name}"`);
      return true;
    }

    return false;
  }

  // ===========================================================================
  // Task Management
  // ===========================================================================

  /**
   * Get a task by name (checks both stores).
   */
  async getTask(name: string): Promise<ScheduledTask | null> {
    // Check in-memory first (faster)
    const inMemory = this.inMemoryStore.getByName(name);
    if (inMemory) return inMemory;

    // Check persisted
    return await this.persistedStore.getByName(name);
  }

  /**
   * Get all tasks from both stores.
   */
  async getAllTasks(): Promise<ScheduledTask[]> {
    const inMemory = this.inMemoryStore.getAll();
    const persisted = await this.persistedStore.getAll();
    return [...inMemory, ...persisted].sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Trigger immediate execution of a task.
   *
   * @throws {TaskNotFoundError} If the task doesn't exist
   */
  async triggerTask(name: string): Promise<void> {
    const task = await this.getTask(name);
    if (!task) {
      throw new TaskNotFoundError(name);
    }

    // Update nextRunAt to now to trigger on next poll
    if (task.storageMode === "in-memory") {
      this.inMemoryStore.update(name, { nextRunAt: new Date() });
    } else {
      await this.persistedStore.update(name, { nextRunAt: new Date() });
    }

    logger.info(`[Scheduling] Triggered task "${name}"`);
  }

  /**
   * Enable a task.
   *
   * @throws {TaskNotFoundError} If the task doesn't exist
   */
  async enableTask(name: string): Promise<ScheduledTask> {
    const task = await this.getTask(name);
    if (!task) {
      throw new TaskNotFoundError(name);
    }

    if (task.storageMode === "in-memory") {
      return this.inMemoryStore.update(name, { enabled: true, status: "idle" });
    } else {
      return await this.persistedStore.update(name, { enabled: true, status: "idle" });
    }
  }

  /**
   * Disable a task.
   *
   * @throws {TaskNotFoundError} If the task doesn't exist
   */
  async disableTask(name: string): Promise<ScheduledTask> {
    const task = await this.getTask(name);
    if (!task) {
      throw new TaskNotFoundError(name);
    }

    if (task.storageMode === "in-memory") {
      return this.inMemoryStore.update(name, { enabled: false, status: "disabled" });
    } else {
      return await this.persistedStore.update(name, { enabled: false, status: "disabled" });
    }
  }

  // ===========================================================================
  // Dynamic Rescheduling
  // ===========================================================================

  /**
   * Update a task's schedule configuration.
   * Use this when settings change (e.g., log trimming interval).
   *
   * @throws {TaskNotFoundError} If the task doesn't exist
   */
  async updateTaskSchedule(
    name: string,
    options: UpdateTaskScheduleOptions,
  ): Promise<ScheduledTask> {
    const task = await this.getTask(name);
    if (!task) {
      throw new TaskNotFoundError(name);
    }

    const updates: Partial<ScheduledTask> = {};

    if (options.intervalSeconds !== undefined) {
      updates.intervalSeconds = options.intervalSeconds;
    }
    if (options.scheduledAt !== undefined) {
      updates.scheduledAt = options.scheduledAt;
    }

    // Recalculate next run time
    const now = new Date();
    if (options.runImmediately) {
      updates.nextRunAt = now;
    } else if (options.intervalSeconds !== undefined) {
      // For interval tasks, schedule from now
      updates.nextRunAt = new Date(now.getTime() + options.intervalSeconds * 1000);
    } else if (options.scheduledAt !== undefined) {
      updates.nextRunAt = options.scheduledAt;
    }

    let updated: ScheduledTask;
    if (task.storageMode === "in-memory") {
      updated = this.inMemoryStore.update(name, updates);
    } else {
      updated = await this.persistedStore.update(name, updates);
    }

    logger.info(`[Scheduling] Updated schedule for task "${name}" (next: ${updated.nextRunAt?.toISOString() ?? "none"})`);
    return updated;
  }

  /**
   * Reschedule a task to run at a specific time.
   * Use this after task completion to set the next run time.
   *
   * @throws {TaskNotFoundError} If the task doesn't exist
   */
  async rescheduleTask(name: string, nextRunAt: Date): Promise<ScheduledTask> {
    const task = await this.getTask(name);
    if (!task) {
      throw new TaskNotFoundError(name);
    }

    let updated: ScheduledTask;
    if (task.storageMode === "in-memory") {
      updated = this.inMemoryStore.update(name, { nextRunAt });
    } else {
      updated = await this.persistedStore.update(name, { nextRunAt });
    }

    logger.debug(`[Scheduling] Rescheduled task "${name}" to ${nextRunAt.toISOString()}`);
    return updated;
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Start the scheduling service.
   * Begins polling for due tasks and executing them.
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn("[Scheduling] Service already running");
      return;
    }

    this.isRunning = true;
    this.stopRequested = false;

    logger.info(`[Scheduling] Starting with polling interval ${this.pollingIntervalSeconds}s`);

    // Recover orphaned persisted tasks
    await this.recoverOrphanedTasks();

    // Start polling loop
    this.pollingTimerId = setInterval(() => {
      this.pollAndExecute().catch((error) => {
        logger.error("[Scheduling] Poll cycle failed:", error);
      });
    }, this.pollingIntervalSeconds * 1000);

    // Run first poll immediately
    await this.pollAndExecute();
  }

  /**
   * Stop the scheduling service.
   * Waits for running tasks to complete (with timeout).
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    logger.info("[Scheduling] Stopping...");
    this.stopRequested = true;

    // Stop polling
    if (this.pollingTimerId !== null) {
      clearInterval(this.pollingTimerId);
      this.pollingTimerId = null;
    }

    // Signal all running tasks to abort
    for (const controller of this.taskAbortControllers.values()) {
      controller.abort();
    }

    // Wait for running tasks with timeout
    const startTime = Date.now();
    const stopTimeoutMs = 30000;
    while (this.runningTasks.size > 0) {
      if (Date.now() - startTime > stopTimeoutMs) {
        logger.warn(`[Scheduling] Stop timeout exceeded, ${this.runningTasks.size} tasks still running`);
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    this.isRunning = false;
    logger.info("[Scheduling] Stopped");
  }

  /**
   * Check if the service is running.
   */
  getIsRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Get service status information.
   */
  async getStatus(): Promise<SchedulingServiceStatus> {
    const persisted = await this.persistedStore.getAll();
    return {
      isRunning: this.isRunning,
      handlerCount: this.handlers.size,
      inMemoryTaskCount: this.inMemoryStore.size,
      persistedTaskCount: persisted.length,
      runningTaskCount: this.runningTasks.size,
    };
  }

  // ===========================================================================
  // Internal: Polling and Execution
  // ===========================================================================

  /**
   * Poll for due tasks and execute them.
   */
  private async pollAndExecute(): Promise<void> {
    if (this.stopRequested) return;

    const now = new Date();

    // Check for stuck tasks
    await this.recoverStuckTasks();

    // Get due tasks from both stores
    const inMemoryDue = this.inMemoryStore.getDueTasks(now);
    const persistedDue = await this.persistedStore.getDueTasks(now);
    const dueTasks = [...inMemoryDue, ...persistedDue];

    // Execute due tasks (non-blocking)
    for (const task of dueTasks) {
      if (this.stopRequested) break;
      if (this.runningTasks.has(task.name)) continue; // Already running

      // Check if handler exists
      if (!this.handlers.has(task.type)) {
        logger.warn(`[Scheduling] No handler for task type "${task.type}", skipping "${task.name}"`);
        continue;
      }

      // Execute task in background
      this.executeTask(task).catch((error) => {
        logger.error(`[Scheduling] Task "${task.name}" execution failed:`, error);
      });
    }
  }

  /**
   * Execute a single task.
   */
  private async executeTask(task: ScheduledTask): Promise<void> {
    const handlerConfig = this.handlers.get(task.type);
    if (!handlerConfig) {
      throw new HandlerNotFoundError(task.type);
    }

    // Check shouldRun callback
    if (handlerConfig.shouldRun) {
      const shouldRun = await handlerConfig.shouldRun(task);
      if (!shouldRun) {
        logger.debug(`[Scheduling] Task "${task.name}" skipped by shouldRun callback`);
        // Reschedule for next interval
        await this.completeTask(task, { success: true }, false);
        return;
      }
    }

    // Claim the task
    let claimedTask: ScheduledTask | null;
    if (task.storageMode === "in-memory") {
      claimedTask = this.inMemoryStore.claimTask(task.name);
    } else {
      claimedTask = await this.persistedStore.claimTask(task.name);
    }

    if (!claimedTask) {
      logger.debug(`[Scheduling] Task "${task.name}" already claimed, skipping`);
      return;
    }

    this.runningTasks.add(task.name);
    const abortController = new AbortController();
    this.taskAbortControllers.set(task.name, abortController);

    const timeoutMs = handlerConfig.timeoutMs ?? this.defaultTimeoutMs;
    const startTime = Date.now();

    logger.debug(`[Scheduling] Executing task "${task.name}"`);

    let result: TaskExecutionResult;
    try {
      // Set up timeout
      const timeoutId = setTimeout(() => {
        abortController.abort();
      }, timeoutMs);

      try {
        result = await handlerConfig.handler(claimedTask, abortController.signal);
      } finally {
        clearTimeout(timeoutId);
      }

      // Check if aborted due to timeout
      if (abortController.signal.aborted && !this.stopRequested) {
        throw new TaskTimeoutError(task.name, timeoutMs);
      }
    } catch (error) {
      result = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    const durationMs = Date.now() - startTime;
    this.runningTasks.delete(task.name);
    this.taskAbortControllers.delete(task.name);

    // Complete the task
    await this.completeTask(claimedTask, result, true);

    if (result.success) {
      logger.debug(`[Scheduling] Task "${task.name}" completed in ${durationMs}ms`);
    } else {
      logger.warn(`[Scheduling] Task "${task.name}" failed after ${durationMs}ms: ${result.error}`);
    }
  }

  /**
   * Complete a task execution and update its state.
   */
  private async completeTask(
    task: ScheduledTask,
    result: TaskExecutionResult,
    wasExecuted: boolean,
  ): Promise<void> {
    const now = new Date();
    const consecutiveFailures = result.success ? 0 : task.consecutiveFailures + 1;
    const maxFailures = this.handlers.get(task.type)?.maxConsecutiveFailures ?? DEFAULTS.MAX_CONSECUTIVE_FAILURES;

    // Calculate next run time
    let nextRunAt: Date | null;
    if (result.nextRunAt !== undefined) {
      // Dynamic schedule: use handler-provided next run time
      nextRunAt = result.nextRunAt;
    } else if (task.scheduleType === "one-off") {
      // One-off: no next run
      nextRunAt = null;
    } else if (task.scheduleType === "interval" && task.intervalSeconds) {
      // Interval: schedule from now
      nextRunAt = new Date(now.getTime() + task.intervalSeconds * 1000);
    } else {
      // Dynamic with no override: keep current (will be set by next trigger)
      nextRunAt = null;
    }

    // Check if we should disable due to failures
    if (consecutiveFailures >= maxFailures) {
      logger.error(`[Scheduling] Task "${task.name}" disabled after ${maxFailures} consecutive failures`);
      if (task.storageMode === "in-memory") {
        this.inMemoryStore.update(task.name, {
          status: "disabled",
          lastRunAt: wasExecuted ? now : task.lastRunAt,
          nextRunAt: null,
          lastError: result.error ?? null,
          consecutiveFailures,
        });
      } else {
        await this.persistedStore.update(task.name, {
          status: "disabled",
          lastRunAt: wasExecuted ? now : task.lastRunAt,
          nextRunAt: null,
          lastError: result.error ?? null,
          consecutiveFailures,
        });
      }
      return;
    }

    // Update task state
    const updates = {
      lastRunAt: wasExecuted ? now : task.lastRunAt ?? now,
      nextRunAt,
      lastError: result.error ?? null,
      consecutiveFailures,
    };

    if (task.storageMode === "in-memory") {
      this.inMemoryStore.markIdle(task.name, updates);
    } else {
      await this.persistedStore.markIdle(task.name, updates);
    }
  }

  // ===========================================================================
  // Internal: Recovery
  // ===========================================================================

  /**
   * Recover orphaned persisted tasks from a previous instance.
   */
  private async recoverOrphanedTasks(): Promise<void> {
    const orphaned = await this.persistedStore.findOrphanedTasks();
    if (orphaned.length === 0) return;

    logger.info(`[Scheduling] Recovering ${orphaned.length} orphaned task(s)`);
    for (const task of orphaned) {
      await this.persistedStore.resetTask(task.name);
      logger.info(`[Scheduling] Reset orphaned task "${task.name}"`);
    }
  }

  /**
   * Recover stuck tasks (running too long).
   */
  private async recoverStuckTasks(): Promise<void> {
    // Check in-memory stuck tasks
    const inMemoryStuck = this.inMemoryStore.findStuckTasks(this.stuckTaskTimeoutMs);
    for (const task of inMemoryStuck) {
      // Only reset if not in our running set (could be stuck from before restart)
      if (!this.runningTasks.has(task.name)) {
        this.inMemoryStore.resetTask(task.name);
        logger.warn(`[Scheduling] Reset stuck in-memory task "${task.name}"`);
      }
    }

    // Check persisted stuck tasks
    const persistedStuck = await this.persistedStore.findStuckTasks(this.stuckTaskTimeoutMs);
    for (const task of persistedStuck) {
      if (!this.runningTasks.has(task.name)) {
        await this.persistedStore.resetTask(task.name);
        logger.warn(`[Scheduling] Reset stuck persisted task "${task.name}"`);
      }
    }
  }

  // ===========================================================================
  // Internal: Validation
  // ===========================================================================

  /**
   * Validate task configuration.
   */
  private validateTaskConfig(
    options: RegisterPersistedTaskOptions | RegisterInMemoryTaskOptions,
  ): void {
    if (!options.name || options.name.trim() === "") {
      throw new InvalidTaskConfigError("Task name is required");
    }
    if (!options.type || options.type.trim() === "") {
      throw new InvalidTaskConfigError("Task type is required");
    }

    if (options.scheduleType === "interval") {
      if (!options.intervalSeconds || options.intervalSeconds <= 0) {
        throw new InvalidTaskConfigError("intervalSeconds is required and must be positive for interval tasks");
      }
    }

    if (options.scheduleType === "one-off") {
      if (!options.scheduledAt && !options.runImmediately) {
        throw new InvalidTaskConfigError("scheduledAt or runImmediately is required for one-off tasks");
      }
    }
  }

  /**
   * Calculate initial nextRunAt for a new task.
   */
  private calculateNextRunAt(
    options: RegisterPersistedTaskOptions | RegisterInMemoryTaskOptions,
    now: Date,
    runImmediately?: boolean,
  ): Date | null {
    if (runImmediately) {
      return now;
    }

    if (options.scheduleType === "one-off" && options.scheduledAt) {
      return options.scheduledAt;
    }

    if (options.scheduleType === "interval" && options.intervalSeconds) {
      return new Date(now.getTime() + options.intervalSeconds * 1000);
    }

    // Dynamic tasks start with no next run time (set by handler)
    return null;
  }
}

// Re-export errors for convenience
export {
  TaskNotFoundError,
  TaskAlreadyExistsError,
  HandlerNotFoundError,
  HandlerAlreadyExistsError,
  InvalidTaskConfigError,
  ServiceStateError,
  TaskTimeoutError,
};
