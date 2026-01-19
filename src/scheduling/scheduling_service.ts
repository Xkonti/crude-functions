import { Mutex } from "@core/asyncutil/mutex";
import type { DatabaseService } from "../database/database_service.ts";
import type { JobQueueService } from "../jobs/job_queue_service.ts";
import type { Job } from "../jobs/types.ts";
import type {
  Schedule,
  NewSchedule,
  CancelScheduleOptions,
  SchedulingServiceOptions,
  SchedulingServiceConfig,
  ScheduleRow,
  DynamicScheduleResult,
  ScheduleStatus,
} from "./types.ts";
import {
  ScheduleNotFoundError,
  DuplicateScheduleError,
  InvalidScheduleConfigError,
  ScheduleStateError,
} from "./errors.ts";
import { logger } from "../utils/logger.ts";

/**
 * Service for managing scheduled job execution.
 *
 * Owns all database access to the schedules table. Other code should
 * never query this table directly - always go through this service.
 *
 * Features:
 * - Multiple schedule types (one-off, dynamic, interval-based)
 * - Efficient timeout-based triggering (not polling)
 * - Transient vs persistent schedules
 * - Integration with existing job queue
 *
 * @example
 * ```typescript
 * const schedulingService = new SchedulingService({
 *   db,
 *   jobQueueService,
 * });
 *
 * // Create a one-off schedule
 * await schedulingService.registerSchedule({
 *   name: "send-report",
 *   type: "one_off",
 *   nextRunAt: new Date("2024-12-25T09:00:00Z"),
 *   jobType: "send-email",
 *   jobPayload: { to: "admin@example.com" },
 * });
 *
 * // Create a recurring schedule
 * await schedulingService.registerSchedule({
 *   name: "cleanup-logs",
 *   type: "sequential_interval",
 *   intervalMs: 60 * 60 * 1000, // 1 hour
 *   jobType: "log-cleanup",
 * });
 *
 * schedulingService.start();
 * ```
 */
export class SchedulingService {
  private readonly db: DatabaseService;
  private readonly jobQueueService: JobQueueService;
  private readonly config: Required<SchedulingServiceConfig>;
  private readonly writeMutex = new Mutex();

  // Lifecycle state
  private timerId: number | null = null;
  private completionCheckTimerId: number | null = null;
  private isProcessing = false;
  private stopRequested = false;
  private isStarting = false;
  private nextScheduledTime: Date | null = null;

  private static readonly DEFAULT_CONFIG: Required<SchedulingServiceConfig> = {
    minRecalculationIntervalMs: 100,
    maxTimeoutMs: 2147483647, // Max 32-bit signed int
    completionCheckIntervalMs: 1000,
  };

  constructor(options: SchedulingServiceOptions) {
    this.db = options.db;
    this.jobQueueService = options.jobQueueService;
    this.config = {
      ...SchedulingService.DEFAULT_CONFIG,
      ...options.config,
    };
  }

  // ============== Lifecycle ==============

  /**
   * Start the scheduling service.
   *
   * On startup:
   * 1. Clears transient schedules
   * 2. Resets activeJobId for schedules with stale references
   * 3. Calculates next trigger time and sets timeout
   * 4. Starts completion check interval
   */
  start(): void {
    if (this.isStarting || this.timerId !== null || this.completionCheckTimerId !== null) {
      logger.warn("[Scheduling] Already running");
      return;
    }

    this.isStarting = true;
    logger.info("[Scheduling] Starting service");

    // Startup sequence
    this.clearTransientSchedules()
      .then(() => this.resetStaleActiveJobs())
      .then(() => this.scheduleNextTrigger())
      .then(() => {
        if (this.stopRequested) {
          this.isStarting = false;
          return;
        }

        // Start completion check interval
        this.completionCheckTimerId = setInterval(() => {
          this.checkJobCompletions().catch((error) => {
            logger.error("[Scheduling] Completion check failed:", error);
          });
        }, this.config.completionCheckIntervalMs);

        this.isStarting = false;
        logger.info("[Scheduling] Service started");
      })
      .catch((error) => {
        this.isStarting = false;
        logger.error("[Scheduling] Startup failed:", error);
      });
  }

  /**
   * Stop the scheduling service gracefully.
   */
  async stop(): Promise<void> {
    this.stopRequested = true;

    // Wait for startup to complete first
    const startupWaitStart = Date.now();
    while (this.isStarting) {
      if (Date.now() - startupWaitStart > 5000) {
        logger.warn("[Scheduling] Startup wait timeout exceeded");
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }

    if (this.completionCheckTimerId !== null) {
      clearInterval(this.completionCheckTimerId);
      this.completionCheckTimerId = null;
    }

    // Wait for any in-progress trigger to complete
    const startTime = Date.now();
    while (this.isProcessing) {
      if (Date.now() - startTime > 30000) {
        logger.warn("[Scheduling] Stop timeout exceeded");
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    this.stopRequested = false;
    this.nextScheduledTime = null;
    logger.info("[Scheduling] Service stopped");
  }

  /**
   * Check if the service is running.
   */
  isRunning(): boolean {
    return this.isStarting || this.timerId !== null || this.completionCheckTimerId !== null;
  }

  /**
   * Get the next scheduled trigger time.
   * Returns null if no schedules are pending.
   */
  getNextScheduledTime(): Date | null {
    return this.nextScheduledTime;
  }

  // ============== Public API ==============

  /**
   * Register a new schedule.
   *
   * @param schedule - Schedule configuration
   * @returns The created schedule
   * @throws {DuplicateScheduleError} If a schedule with the same name exists
   * @throws {InvalidScheduleConfigError} If configuration is invalid
   */
  async registerSchedule(schedule: NewSchedule): Promise<Schedule> {
    using _lock = await this.writeMutex.acquire();

    // Validate configuration
    this.validateNewSchedule(schedule);

    // Check for duplicate
    const existing = await this.getScheduleByNameInternal(schedule.name);
    if (existing) {
      throw new DuplicateScheduleError(schedule.name);
    }

    // Calculate initial nextRunAt
    let nextRunAt: Date | null = null;
    if (schedule.nextRunAt) {
      nextRunAt = schedule.nextRunAt;
    } else if (
      schedule.type === "sequential_interval" ||
      schedule.type === "concurrent_interval"
    ) {
      nextRunAt = new Date(Date.now() + (schedule.intervalMs ?? 0));
    }

    const payloadStr =
      schedule.jobPayload !== undefined
        ? JSON.stringify(schedule.jobPayload)
        : null;

    const result = await this.db.execute(
      `INSERT INTO schedules (
        name, description, type, isPersistent, nextRunAt, intervalMs,
        jobType, jobPayload, jobPriority, jobMaxRetries, jobExecutionMode,
        jobReferenceType, jobReferenceId, maxConsecutiveFailures
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        schedule.name,
        schedule.description ?? null,
        schedule.type,
        schedule.isPersistent !== false ? 1 : 0,
        nextRunAt?.toISOString() ?? null,
        schedule.intervalMs ?? null,
        schedule.jobType,
        payloadStr,
        schedule.jobPriority ?? 0,
        schedule.jobMaxRetries ?? 1,
        schedule.jobExecutionMode ?? "sequential",
        schedule.jobReferenceType ?? null,
        schedule.jobReferenceId ?? null,
        schedule.maxConsecutiveFailures ?? 5,
      ],
    );

    const created = await this.getScheduleInternal(
      Number(result.lastInsertRowId),
    );
    if (!created) {
      throw new Error("Failed to retrieve created schedule");
    }

    // Reschedule if service is running
    if (this.isRunning()) {
      this.scheduleNextTrigger().catch((error) => {
        logger.error(
          "[Scheduling] Failed to reschedule after registration:",
          error,
        );
      });
    }

    logger.info(
      `[Scheduling] Registered schedule '${schedule.name}' (type: ${schedule.type})`,
    );
    return created;
  }

  /**
   * Cancel a schedule.
   *
   * @param name - Schedule name
   * @param options - Cancellation options
   * @returns The cancelled schedule
   * @throws {ScheduleNotFoundError} If schedule doesn't exist
   */
  async cancelSchedule(
    name: string,
    options?: CancelScheduleOptions,
  ): Promise<Schedule> {
    using _lock = await this.writeMutex.acquire();

    const schedule = await this.getScheduleByNameInternal(name);
    if (!schedule) {
      throw new ScheduleNotFoundError(name);
    }

    // Cancel running job if requested
    if (options?.cancelRunningJob && schedule.activeJobId) {
      try {
        await this.jobQueueService.cancelJob(schedule.activeJobId, {
          reason: options.reason ?? `Schedule '${name}' cancelled`,
        });
      } catch {
        // Job may have already completed
        logger.debug(
          `[Scheduling] Could not cancel active job ${schedule.activeJobId}`,
        );
      }
    }

    await this.db.execute(
      `UPDATE schedules
       SET status = 'completed',
           nextRunAt = NULL,
           activeJobId = NULL,
           updatedAt = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [schedule.id],
    );

    const updated = await this.getScheduleInternal(schedule.id);
    if (!updated) {
      throw new Error("Failed to retrieve cancelled schedule");
    }

    // Reschedule
    if (this.isRunning()) {
      this.scheduleNextTrigger().catch(() => {});
    }

    logger.info(`[Scheduling] Cancelled schedule '${name}'`);
    return updated;
  }

  /**
   * Pause a schedule (temporarily disable).
   *
   * @param name - Schedule name
   * @returns The paused schedule
   * @throws {ScheduleNotFoundError} If schedule doesn't exist
   * @throws {ScheduleStateError} If schedule is not active
   */
  async pauseSchedule(name: string): Promise<Schedule> {
    using _lock = await this.writeMutex.acquire();

    const schedule = await this.getScheduleByNameInternal(name);
    if (!schedule) {
      throw new ScheduleNotFoundError(name);
    }

    if (schedule.status !== "active") {
      throw new ScheduleStateError(name, schedule.status, "pause");
    }

    await this.db.execute(
      `UPDATE schedules
       SET status = 'paused',
           updatedAt = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [schedule.id],
    );

    const updated = await this.getScheduleInternal(schedule.id);
    if (!updated) {
      throw new Error("Failed to retrieve paused schedule");
    }

    // Reschedule
    if (this.isRunning()) {
      this.scheduleNextTrigger().catch(() => {});
    }

    logger.info(`[Scheduling] Paused schedule '${name}'`);
    return updated;
  }

  /**
   * Resume a paused schedule.
   *
   * @param name - Schedule name
   * @returns The resumed schedule
   * @throws {ScheduleNotFoundError} If schedule doesn't exist
   * @throws {ScheduleStateError} If schedule is not paused
   */
  async resumeSchedule(name: string): Promise<Schedule> {
    using _lock = await this.writeMutex.acquire();

    const schedule = await this.getScheduleByNameInternal(name);
    if (!schedule) {
      throw new ScheduleNotFoundError(name);
    }

    if (schedule.status !== "paused") {
      throw new ScheduleStateError(name, schedule.status, "resume");
    }

    // Calculate nextRunAt based on schedule type
    let nextRunAt: Date;
    if (schedule.type === "one_off" || schedule.type === "dynamic") {
      // For one-off and dynamic, use stored nextRunAt or now
      nextRunAt = schedule.nextRunAt ?? new Date();
    } else {
      // For interval types, schedule from now
      nextRunAt = new Date(Date.now() + (schedule.intervalMs ?? 0));
    }

    await this.db.execute(
      `UPDATE schedules
       SET status = 'active',
           nextRunAt = ?,
           updatedAt = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [nextRunAt.toISOString(), schedule.id],
    );

    const updated = await this.getScheduleInternal(schedule.id);
    if (!updated) {
      throw new Error("Failed to retrieve resumed schedule");
    }

    // Reschedule
    if (this.isRunning()) {
      this.scheduleNextTrigger().catch(() => {});
    }

    logger.info(`[Scheduling] Resumed schedule '${name}'`);
    return updated;
  }

  /**
   * Get a schedule by name.
   *
   * @param name - Schedule name
   * @returns The schedule, or null if not found
   */
  async getSchedule(name: string): Promise<Schedule | null> {
    return this.getScheduleByNameInternal(name);
  }

  /**
   * Get all schedules.
   *
   * @param status - Optional status filter
   * @returns Array of schedules
   */
  async getSchedules(status?: ScheduleStatus): Promise<Schedule[]> {
    let sql = `SELECT * FROM schedules`;
    const params: string[] = [];

    if (status) {
      sql += ` WHERE status = ?`;
      params.push(status);
    }

    sql += ` ORDER BY createdAt ASC`;

    const rows = await this.db.queryAll<ScheduleRow>(sql, params);
    return rows.map((row) => this.rowToSchedule(row));
  }

  /**
   * Trigger a schedule immediately (manual trigger).
   * Creates a job regardless of the scheduled time.
   *
   * @param name - Schedule name
   * @returns The created job
   * @throws {ScheduleNotFoundError} If schedule doesn't exist
   * @throws {ScheduleStateError} If schedule is completed or in error state
   */
  async triggerNow(name: string): Promise<Job> {
    using _lock = await this.writeMutex.acquire();

    const schedule = await this.getScheduleByNameInternal(name);
    if (!schedule) {
      throw new ScheduleNotFoundError(name);
    }

    if (schedule.status === "completed" || schedule.status === "error") {
      throw new ScheduleStateError(name, schedule.status, "trigger");
    }

    logger.info(`[Scheduling] Manual trigger for schedule '${name}'`);
    return this.triggerScheduleInternal(schedule);
  }

  /**
   * Delete a schedule permanently.
   *
   * @param name - Schedule name
   * @param options - Options (cancelRunningJob)
   * @throws {ScheduleNotFoundError} If schedule doesn't exist
   */
  async deleteSchedule(
    name: string,
    options?: CancelScheduleOptions,
  ): Promise<void> {
    using _lock = await this.writeMutex.acquire();

    const schedule = await this.getScheduleByNameInternal(name);
    if (!schedule) {
      throw new ScheduleNotFoundError(name);
    }

    // Cancel running job if requested
    if (options?.cancelRunningJob && schedule.activeJobId) {
      try {
        await this.jobQueueService.cancelJob(schedule.activeJobId, {
          reason: options.reason ?? `Schedule '${name}' deleted`,
        });
      } catch {
        // Job may have already completed
      }
    }

    await this.db.execute(`DELETE FROM schedules WHERE id = ?`, [schedule.id]);

    // Reschedule
    if (this.isRunning()) {
      this.scheduleNextTrigger().catch(() => {});
    }

    logger.info(`[Scheduling] Deleted schedule '${name}'`);
  }

  // ============== Internal Implementation ==============

  /**
   * Validate new schedule configuration.
   */
  private validateNewSchedule(schedule: NewSchedule): void {
    if (!schedule.name || schedule.name.trim() === "") {
      throw new InvalidScheduleConfigError("Schedule name is required");
    }

    if (!schedule.jobType || schedule.jobType.trim() === "") {
      throw new InvalidScheduleConfigError("Job type is required");
    }

    if (schedule.type === "one_off" && !schedule.nextRunAt) {
      throw new InvalidScheduleConfigError(
        "nextRunAt is required for one_off schedules",
      );
    }

    if (schedule.type === "dynamic" && !schedule.nextRunAt) {
      throw new InvalidScheduleConfigError(
        "nextRunAt is required for dynamic schedules",
      );
    }

    if (
      (schedule.type === "sequential_interval" ||
        schedule.type === "concurrent_interval") &&
      (!schedule.intervalMs || schedule.intervalMs <= 0)
    ) {
      throw new InvalidScheduleConfigError(
        "intervalMs must be positive for interval-based schedules",
      );
    }
  }

  /**
   * Clear transient schedules on startup.
   */
  private async clearTransientSchedules(): Promise<void> {
    const result = await this.db.execute(
      `DELETE FROM schedules WHERE isPersistent = 0`,
    );
    if (result.changes > 0) {
      logger.info(
        `[Scheduling] Cleared ${result.changes} transient schedule(s)`,
      );
    }
  }

  /**
   * Reset activeJobId for schedules where the job no longer exists or is complete.
   * This handles recovery after crash.
   */
  private async resetStaleActiveJobs(): Promise<void> {
    // Find schedules with activeJobId where the job is no longer active
    const staleSchedules = await this.db.queryAll<{
      id: number;
      name: string;
      activeJobId: number;
      [key: string]: unknown;
    }>(
      `SELECT s.id, s.name, s.activeJobId
       FROM schedules s
       LEFT JOIN jobQueue j ON s.activeJobId = j.id
       WHERE s.activeJobId IS NOT NULL
       AND (j.id IS NULL OR j.status NOT IN ('pending', 'running'))`,
    );

    for (const schedule of staleSchedules) {
      logger.info(
        `[Scheduling] Resetting stale activeJobId for schedule '${schedule.name}'`,
      );
      // For interval schedules, recalculate nextRunAt
      const fullSchedule = await this.getScheduleInternal(schedule.id);
      if (!fullSchedule) continue;

      if (
        fullSchedule.type === "sequential_interval" ||
        fullSchedule.type === "concurrent_interval"
      ) {
        const nextRunAt = new Date(Date.now() + (fullSchedule.intervalMs ?? 0));
        await this.db.execute(
          `UPDATE schedules
           SET activeJobId = NULL,
               nextRunAt = ?,
               updatedAt = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [nextRunAt.toISOString(), schedule.id],
        );
      } else {
        await this.db.execute(
          `UPDATE schedules
           SET activeJobId = NULL,
               updatedAt = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [schedule.id],
        );
      }
    }
  }

  /**
   * Schedule the next trigger based on the soonest schedule.
   */
  private async scheduleNextTrigger(): Promise<void> {
    // Clear existing timer
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }

    if (this.stopRequested) {
      return;
    }

    // Find the soonest active schedule
    const nextSchedule = await this.db.queryOne<{
      nextRunAt: string;
      [key: string]: unknown;
    }>(
      `SELECT nextRunAt
       FROM schedules
       WHERE status = 'active' AND nextRunAt IS NOT NULL
       ORDER BY nextRunAt ASC
       LIMIT 1`,
    );

    if (!nextSchedule) {
      logger.debug("[Scheduling] No active schedules to trigger");
      this.nextScheduledTime = null;
      return;
    }

    const nextTime = new Date(nextSchedule.nextRunAt);
    this.nextScheduledTime = nextTime;

    const delay = Math.max(0, nextTime.getTime() - Date.now());
    const clampedDelay = Math.min(delay, this.config.maxTimeoutMs);

    logger.debug(
      `[Scheduling] Next trigger in ${clampedDelay}ms at ${nextTime.toISOString()}`,
    );

    this.timerId = setTimeout(() => {
      this.triggerDueSchedules().catch((error) => {
        logger.error("[Scheduling] Trigger failed:", error);
      });
    }, clampedDelay);
  }

  /**
   * Trigger all schedules that are due.
   */
  private async triggerDueSchedules(): Promise<void> {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;
    try {
      const now = new Date();

      // Find all due schedules
      const dueSchedules = await this.db.queryAll<ScheduleRow>(
        `SELECT * FROM schedules
         WHERE status = 'active'
         AND nextRunAt IS NOT NULL
         AND nextRunAt <= ?`,
        [now.toISOString()],
      );

      for (const row of dueSchedules) {
        if (this.stopRequested) break;

        const schedule = this.rowToSchedule(row);
        try {
          await this.triggerScheduleInternal(schedule);
        } catch (error) {
          logger.error(
            `[Scheduling] Failed to trigger schedule '${schedule.name}':`,
            error,
          );
          await this.handleScheduleError(schedule, error);
        }
      }
    } finally {
      this.isProcessing = false;

      // Schedule next trigger
      if (!this.stopRequested) {
        await this.scheduleNextTrigger();
      }
    }
  }

  /**
   * Trigger a single schedule (internal, called with lock or from triggerDueSchedules).
   */
  private async triggerScheduleInternal(schedule: Schedule): Promise<Job> {
    logger.info(`[Scheduling] Triggering schedule '${schedule.name}'`);

    // Enqueue the job
    const job = await this.jobQueueService.enqueue({
      type: schedule.jobType,
      payload: schedule.jobPayload,
      priority: schedule.jobPriority,
      maxRetries: schedule.jobMaxRetries,
      executionMode: schedule.jobExecutionMode,
      referenceType: schedule.jobReferenceType ?? undefined,
      referenceId: schedule.jobReferenceId ?? undefined,
    });

    // Update schedule based on type
    if (schedule.type === "one_off") {
      // One-off: mark as completed
      await this.db.execute(
        `UPDATE schedules
         SET status = 'completed',
             nextRunAt = NULL,
             activeJobId = ?,
             lastTriggeredAt = CURRENT_TIMESTAMP,
             consecutiveFailures = 0,
             updatedAt = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [job.id, schedule.id],
      );
    } else if (
      schedule.type === "dynamic" ||
      schedule.type === "sequential_interval"
    ) {
      // Dynamic and sequential: wait for job completion before scheduling next
      await this.db.execute(
        `UPDATE schedules
         SET nextRunAt = NULL,
             activeJobId = ?,
             lastTriggeredAt = CURRENT_TIMESTAMP,
             consecutiveFailures = 0,
             updatedAt = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [job.id, schedule.id],
      );
    } else if (schedule.type === "concurrent_interval") {
      // Concurrent: schedule next immediately
      const nextRunAt = new Date(Date.now() + schedule.intervalMs!);
      await this.db.execute(
        `UPDATE schedules
         SET nextRunAt = ?,
             lastTriggeredAt = CURRENT_TIMESTAMP,
             consecutiveFailures = 0,
             updatedAt = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [nextRunAt.toISOString(), schedule.id],
      );
    }

    return job;
  }

  /**
   * Handle schedule error (increment failure count, possibly enter error state).
   */
  private async handleScheduleError(
    schedule: Schedule,
    error: unknown,
  ): Promise<void> {
    const newFailureCount = schedule.consecutiveFailures + 1;
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (newFailureCount >= schedule.maxConsecutiveFailures) {
      await this.db.execute(
        `UPDATE schedules
         SET status = 'error',
             consecutiveFailures = ?,
             lastError = ?,
             updatedAt = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [newFailureCount, errorMessage, schedule.id],
      );
      logger.error(
        `[Scheduling] Schedule '${schedule.name}' entered error state after ${newFailureCount} failures`,
      );
    } else {
      await this.db.execute(
        `UPDATE schedules
         SET consecutiveFailures = ?,
             lastError = ?,
             updatedAt = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [newFailureCount, errorMessage, schedule.id],
      );
    }
  }

  /**
   * Check for job completions and handle dynamic/sequential schedules.
   */
  private async checkJobCompletions(): Promise<void> {
    // Find schedules waiting for job completion
    const waitingSchedules = await this.db.queryAll<ScheduleRow>(
      `SELECT s.* FROM schedules s
       WHERE s.activeJobId IS NOT NULL
       AND s.status = 'active'`,
    );

    for (const row of waitingSchedules) {
      const schedule = this.rowToSchedule(row);
      const job = await this.jobQueueService.getJob(schedule.activeJobId!);

      if (!job) {
        // Job was deleted - reset schedule
        await this.resetScheduleAfterJobGone(schedule);
        continue;
      }

      if (job.status === "completed") {
        await this.handleJobCompletion(schedule, job);
      } else if (job.status === "failed" || job.status === "cancelled") {
        await this.handleJobFailure(schedule, job);
      }
      // If still pending/running, do nothing - wait for next check
    }
  }

  /**
   * Handle job completion for a schedule.
   */
  private async handleJobCompletion(
    schedule: Schedule,
    job: Job,
  ): Promise<void> {
    logger.debug(
      `[Scheduling] Job ${job.id} completed for schedule '${schedule.name}'`,
    );

    let nextRunAt: Date | null = null;

    if (schedule.type === "dynamic") {
      // Extract next time from job result
      const result = job.result as DynamicScheduleResult | null;
      if (result?.nextRunAt) {
        nextRunAt = new Date(result.nextRunAt);
      } else {
        // No next time - mark schedule as completed
        await this.db.execute(
          `UPDATE schedules
           SET status = 'completed',
               activeJobId = NULL,
               lastCompletedAt = CURRENT_TIMESTAMP,
               updatedAt = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [schedule.id],
        );
        logger.info(
          `[Scheduling] Dynamic schedule '${schedule.name}' completed (no next time)`,
        );
        return;
      }
    } else if (schedule.type === "sequential_interval") {
      // Schedule next after interval
      nextRunAt = new Date(Date.now() + schedule.intervalMs!);
    }

    if (nextRunAt) {
      await this.db.execute(
        `UPDATE schedules
         SET nextRunAt = ?,
             activeJobId = NULL,
             lastCompletedAt = CURRENT_TIMESTAMP,
             updatedAt = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [nextRunAt.toISOString(), schedule.id],
      );

      // Reschedule trigger
      await this.scheduleNextTrigger();
    }
  }

  /**
   * Handle job failure/cancellation for a schedule.
   */
  private async handleJobFailure(schedule: Schedule, job: Job): Promise<void> {
    logger.warn(
      `[Scheduling] Job ${job.id} ${job.status} for schedule '${schedule.name}'`,
    );

    const newFailureCount = schedule.consecutiveFailures + 1;
    const errorMessage =
      job.status === "cancelled"
        ? `Job cancelled: ${job.cancelReason ?? "no reason"}`
        : JSON.stringify(job.result);

    if (newFailureCount >= schedule.maxConsecutiveFailures) {
      // Enter error state
      await this.db.execute(
        `UPDATE schedules
         SET status = 'error',
             activeJobId = NULL,
             consecutiveFailures = ?,
             lastError = ?,
             updatedAt = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [newFailureCount, errorMessage, schedule.id],
      );
      logger.error(
        `[Scheduling] Schedule '${schedule.name}' entered error state after ${newFailureCount} job failures`,
      );
    } else {
      // Retry: schedule next run
      let nextRunAt: Date;
      if (schedule.type === "dynamic") {
        // For dynamic, retry after a delay
        nextRunAt = new Date(Date.now() + 60000); // 1 minute retry delay
      } else if (schedule.type === "sequential_interval") {
        nextRunAt = new Date(Date.now() + schedule.intervalMs!);
      } else {
        nextRunAt = new Date();
      }

      await this.db.execute(
        `UPDATE schedules
         SET nextRunAt = ?,
             activeJobId = NULL,
             consecutiveFailures = ?,
             lastError = ?,
             updatedAt = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [nextRunAt.toISOString(), newFailureCount, errorMessage, schedule.id],
      );

      await this.scheduleNextTrigger();
    }
  }

  /**
   * Reset schedule when its job has been deleted.
   */
  private async resetScheduleAfterJobGone(schedule: Schedule): Promise<void> {
    logger.warn(
      `[Scheduling] Job for schedule '${schedule.name}' was deleted, resetting`,
    );

    let nextRunAt: Date;
    if (
      schedule.type === "sequential_interval" ||
      schedule.type === "concurrent_interval"
    ) {
      nextRunAt = new Date(Date.now() + (schedule.intervalMs ?? 0));
    } else {
      nextRunAt = new Date();
    }

    await this.db.execute(
      `UPDATE schedules
       SET nextRunAt = ?,
           activeJobId = NULL,
           updatedAt = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [nextRunAt.toISOString(), schedule.id],
    );

    await this.scheduleNextTrigger();
  }

  // ============== Query Helpers ==============

  private async getScheduleInternal(id: number): Promise<Schedule | null> {
    const row = await this.db.queryOne<ScheduleRow>(
      `SELECT * FROM schedules WHERE id = ?`,
      [id],
    );
    return row ? this.rowToSchedule(row) : null;
  }

  private async getScheduleByNameInternal(
    name: string,
  ): Promise<Schedule | null> {
    const row = await this.db.queryOne<ScheduleRow>(
      `SELECT * FROM schedules WHERE name = ?`,
      [name],
    );
    return row ? this.rowToSchedule(row) : null;
  }

  private rowToSchedule(row: ScheduleRow): Schedule {
    let payload: unknown = null;
    if (row.jobPayload) {
      try {
        payload = JSON.parse(row.jobPayload);
      } catch {
        payload = row.jobPayload;
      }
    }

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      type: row.type as Schedule["type"],
      status: row.status as Schedule["status"],
      isPersistent: row.isPersistent === 1,
      nextRunAt: row.nextRunAt ? new Date(row.nextRunAt) : null,
      intervalMs: row.intervalMs,
      jobType: row.jobType,
      jobPayload: payload,
      jobPriority: row.jobPriority,
      jobMaxRetries: row.jobMaxRetries,
      jobExecutionMode: row.jobExecutionMode as Schedule["jobExecutionMode"],
      jobReferenceType: row.jobReferenceType,
      jobReferenceId: row.jobReferenceId,
      activeJobId: row.activeJobId,
      consecutiveFailures: row.consecutiveFailures,
      maxConsecutiveFailures: row.maxConsecutiveFailures,
      lastError: row.lastError,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
      lastTriggeredAt: row.lastTriggeredAt
        ? new Date(row.lastTriggeredAt)
        : null,
      lastCompletedAt: row.lastCompletedAt
        ? new Date(row.lastCompletedAt)
        : null,
    };
  }
}
