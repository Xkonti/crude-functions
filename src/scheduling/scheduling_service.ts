import { Mutex } from "@core/asyncutil/mutex";
import { RecordId } from "surrealdb";
import type { SurrealConnectionFactory } from "../database/surreal_connection_factory.ts";
import { recordIdToString, toDate } from "../database/surreal_helpers.ts";
import type { JobQueueService } from "../jobs/job_queue_service.ts";
import type { Job, JobCompletionEvent } from "../jobs/types.ts";
import {
  isScheduleType,
  isScheduleStatus,
  type Schedule,
  type NewSchedule,
  type CancelScheduleOptions,
  type ScheduleUpdate,
  type UpdateScheduleOptions,
  type SchedulingServiceOptions,
  type SchedulingServiceConfig,
  type ScheduleRow,
  type DynamicScheduleResult,
  type ScheduleStatus,
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
 * Owns all database access to the schedule table. Other code should
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
 *   surrealFactory,
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
  private readonly surrealFactory: SurrealConnectionFactory;
  private readonly jobQueueService: JobQueueService;
  private readonly config: Required<SchedulingServiceConfig>;
  private readonly writeMutex = new Mutex();

  // Lifecycle state
  private timerId: number | null = null;
  private rescheduleDebounceTimer: number | null = null;
  private isProcessing = false;
  private stopRequested = false;
  private isStarting = false;
  private isRunningState = false;
  private nextScheduledTime: Date | null = null;

  private static readonly DEFAULT_CONFIG: Required<SchedulingServiceConfig> = {
    minRecalculationIntervalMs: 100,
    maxTimeoutMs: 2147483647, // Max 32-bit signed int
  };

  constructor(options: SchedulingServiceOptions) {
    this.surrealFactory = options.surrealFactory;
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
   * 3. Re-subscribes to active jobs that may have been orphaned
   * 4. Calculates next trigger time and sets timeout
   */
  async start(): Promise<void> {
    if (this.isStarting || this.isRunningState) {
      logger.warn("[Scheduling] Already running");
      return;
    }

    this.isStarting = true;
    logger.info("[Scheduling] Starting service");

    try {
      await this.clearTransientSchedules();
      if (this.stopRequested) return;

      await this.resetStaleActiveJobs();
      if (this.stopRequested) return;

      // Re-subscribe to active jobs (orphaned subscriptions from crash)
      await this.resubscribeToActiveJobs();
      if (this.stopRequested) return;

      await this.scheduleNextTrigger();
      if (this.stopRequested) return;

      this.isRunningState = true;
      logger.info("[Scheduling] Service started");
    } catch (error) {
      logger.error("[Scheduling] Startup failed:", error);
      throw error;
    } finally {
      this.isStarting = false;
    }
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

    if (this.rescheduleDebounceTimer !== null) {
      clearTimeout(this.rescheduleDebounceTimer);
      this.rescheduleDebounceTimer = null;
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
    this.isRunningState = false;
    this.nextScheduledTime = null;
    logger.info("[Scheduling] Service stopped");
  }

  /**
   * Check if the service is running.
   */
  isRunning(): boolean {
    return this.isStarting || this.isRunningState;
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
    // Use undefined (not null) to map to SurrealDB NONE
    let nextRunAt: Date | undefined = undefined;
    if (schedule.nextRunAt) {
      nextRunAt = schedule.nextRunAt;
    } else if (
      schedule.type === "sequential_interval" ||
      schedule.type === "concurrent_interval"
    ) {
      nextRunAt = new Date(Date.now() + (schedule.intervalMs ?? 0));
    }

    // Return undefined (not null) to map to SurrealDB NONE instead of NULL
    // SurrealDB's option<string> accepts NONE but not NULL
    const payloadStr =
      schedule.jobPayload !== undefined
        ? JSON.stringify(schedule.jobPayload)
        : undefined;

    // Convert referenceId to string if provided
    const jobReferenceId = schedule.jobReferenceId !== undefined && schedule.jobReferenceId !== null
      ? String(schedule.jobReferenceId)
      : undefined;

    const created = await this.surrealFactory.withSystemConnection({}, async (db) => {
      const result = await db.query<[ScheduleRow | undefined]>(
        `CREATE schedule SET
           name = $name,
           description = $description,
           type = $type,
           status = 'active',
           isPersistent = $isPersistent,
           nextRunAt = $nextRunAt,
           intervalMs = $intervalMs,
           jobType = $jobType,
           jobPayload = $jobPayload,
           jobPriority = $jobPriority,
           jobMaxRetries = $jobMaxRetries,
           jobExecutionMode = $jobExecutionMode,
           jobReferenceType = $jobReferenceType,
           jobReferenceId = $jobReferenceId,
           activeJobId = NONE,
           consecutiveFailures = 0,
           maxConsecutiveFailures = $maxConsecutiveFailures,
           lastError = NONE,
           createdAt = time::now(),
           updatedAt = time::now(),
           lastTriggeredAt = NONE,
           lastCompletedAt = NONE
         RETURN AFTER`,
        {
          name: schedule.name,
          description: schedule.description ?? undefined,
          type: schedule.type,
          isPersistent: schedule.isPersistent ?? true,
          nextRunAt: nextRunAt,
          intervalMs: schedule.intervalMs ?? undefined,
          jobType: schedule.jobType,
          jobPayload: payloadStr,
          jobPriority: schedule.jobPriority ?? 0,
          jobMaxRetries: schedule.jobMaxRetries ?? 1,
          jobExecutionMode: schedule.jobExecutionMode ?? "sequential",
          jobReferenceType: schedule.jobReferenceType ?? undefined,
          jobReferenceId,
          maxConsecutiveFailures: schedule.maxConsecutiveFailures ?? 5,
        },
      );

      // CREATE returns an array with a single element
      const row = Array.isArray(result[0]) ? result[0][0] : result[0];
      if (!row) {
        throw new Error("Failed to create schedule");
      }
      return row;
    });

    const createdSchedule = this.rowToSchedule(created);

    // Reschedule if service is running
    if (this.isRunning()) {
      this.requestReschedule();
    }

    logger.info(
      `[Scheduling] Registered schedule '${schedule.name}' (type: ${schedule.type})`,
    );
    return createdSchedule;
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
          `[Scheduling] Could not cancel active job ${recordIdToString(schedule.activeJobId)}`,
        );
      }
    }

    const updated = await this.surrealFactory.withSystemConnection({}, async (db) => {
      const result = await db.query<[ScheduleRow[]]>(
        `UPDATE $scheduleId SET
           status = 'completed',
           nextRunAt = NONE,
           activeJobId = NONE,
           updatedAt = time::now()
         RETURN AFTER`,
        { scheduleId: schedule.id },
      );
      return result[0]?.[0];
    });

    if (!updated) {
      throw new Error("Failed to retrieve cancelled schedule");
    }

    const updatedSchedule = this.rowToSchedule(updated);

    // Reschedule
    if (this.isRunning()) {
      this.requestReschedule();
    }

    logger.info(`[Scheduling] Cancelled schedule '${name}'`);
    return updatedSchedule;
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

    const updated = await this.surrealFactory.withSystemConnection({}, async (db) => {
      const result = await db.query<[ScheduleRow[]]>(
        `UPDATE $scheduleId SET
           status = 'paused',
           updatedAt = time::now()
         RETURN AFTER`,
        { scheduleId: schedule.id },
      );
      return result[0]?.[0];
    });

    if (!updated) {
      throw new Error("Failed to retrieve paused schedule");
    }

    const updatedSchedule = this.rowToSchedule(updated);

    // Reschedule
    if (this.isRunning()) {
      this.requestReschedule();
    }

    logger.info(`[Scheduling] Paused schedule '${name}'`);
    return updatedSchedule;
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

    // Calculate nextRunAt - preserve stored time for one-off/dynamic schedules
    const nextRunAt = this.calculateNextRunAtFromNow(schedule, true);

    const updated = await this.surrealFactory.withSystemConnection({}, async (db) => {
      const result = await db.query<[ScheduleRow[]]>(
        `UPDATE $scheduleId SET
           status = 'active',
           nextRunAt = $nextRunAt,
           updatedAt = time::now()
         RETURN AFTER`,
        { scheduleId: schedule.id, nextRunAt },
      );
      return result[0]?.[0];
    });

    if (!updated) {
      throw new Error("Failed to retrieve resumed schedule");
    }

    const updatedSchedule = this.rowToSchedule(updated);

    // Reschedule
    if (this.isRunning()) {
      this.requestReschedule();
    }

    logger.info(`[Scheduling] Resumed schedule '${name}'`);
    return updatedSchedule;
  }

  /**
   * Get a schedule by name.
   *
   * @param name - Schedule name
   * @returns The schedule, or null if not found
   */
  async getSchedule(name: string): Promise<Schedule | null> {
    return await this.getScheduleByNameInternal(name);
  }

  /**
   * Get all schedules.
   *
   * @param status - Optional status filter
   * @returns Array of schedules
   */
  async getSchedules(status?: ScheduleStatus): Promise<Schedule[]> {
    const rows = await this.surrealFactory.withSystemConnection({}, async (db) => {
      if (status) {
        return await db.query<[ScheduleRow[]]>(
          `SELECT * FROM schedule WHERE status = $status ORDER BY createdAt ASC`,
          { status },
        );
      }
      return await db.query<[ScheduleRow[]]>(
        `SELECT * FROM schedule ORDER BY createdAt ASC`,
      );
    });

    return (rows[0] ?? []).map((row) => this.rowToSchedule(row));
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
    // Narrow mutex scope to only cover database read - triggerScheduleInternal
    // uses jobQueueService which has its own mutex
    let schedule: Schedule;
    {
      using _lock = await this.writeMutex.acquire();
      const temp = await this.getScheduleByNameInternal(name);
      if (!temp) {
        throw new ScheduleNotFoundError(name);
      }
      if (temp.status === "completed" || temp.status === "error") {
        throw new ScheduleStateError(name, temp.status, "trigger");
      }
      schedule = temp;
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

    await this.surrealFactory.withSystemConnection({}, async (db) => {
      await db.query(`DELETE $scheduleId`, { scheduleId: schedule.id });
    });

    // Reschedule
    if (this.isRunning()) {
      this.requestReschedule();
    }

    logger.info(`[Scheduling] Deleted schedule '${name}'`);
  }

  /**
   * Update an existing schedule.
   *
   * @param name - Schedule name
   * @param update - Fields to update
   * @param options - Update options
   * @returns The updated schedule
   * @throws {ScheduleNotFoundError} If schedule doesn't exist
   * @throws {ScheduleStateError} If schedule is completed or in error state
   * @throws {InvalidScheduleConfigError} If update is invalid for schedule type
   */
  async updateSchedule(
    name: string,
    update: ScheduleUpdate,
    options?: UpdateScheduleOptions,
  ): Promise<Schedule> {
    using _lock = await this.writeMutex.acquire();

    // Fetch and validate schedule exists
    const schedule = await this.getScheduleByNameInternal(name);
    if (!schedule) {
      throw new ScheduleNotFoundError(name);
    }

    // Validate state (reject completed/error)
    if (schedule.status === "completed" || schedule.status === "error") {
      throw new ScheduleStateError(name, schedule.status, "update");
    }

    // Validate update values for schedule type
    this.validateScheduleUpdate(schedule, update);

    // Build update object
    const updateFields: Record<string, unknown> = {};

    if (update.description !== undefined) {
      // Convert null to undefined for SurrealDB NONE (option<string> doesn't accept NULL)
      updateFields.description = update.description === null ? undefined : update.description;
    }

    if (update.intervalMs !== undefined) {
      updateFields.intervalMs = update.intervalMs;
    }

    if (update.jobPayload !== undefined) {
      updateFields.jobPayload = JSON.stringify(update.jobPayload);
    }

    if (update.jobPriority !== undefined) {
      updateFields.jobPriority = update.jobPriority;
    }

    if (update.jobMaxRetries !== undefined) {
      updateFields.jobMaxRetries = update.jobMaxRetries;
    }

    if (update.maxConsecutiveFailures !== undefined) {
      updateFields.maxConsecutiveFailures = update.maxConsecutiveFailures;
    }

    // Calculate nextRunAt if interval changed or explicitly provided
    const newNextRunAt = this.calculateUpdatedNextRunAt(
      schedule,
      update,
      options,
    );
    if (newNextRunAt !== undefined) {
      updateFields.nextRunAt = newNextRunAt;
    }

    // Build SET clause dynamically
    const setClause = Object.keys(updateFields)
      .map((key) => `${key} = $${key}`)
      .join(", ");

    // Execute update if there are fields to update
    if (Object.keys(updateFields).length > 0) {
      const updated = await this.surrealFactory.withSystemConnection({}, async (db) => {
        const result = await db.query<[ScheduleRow[]]>(
          `UPDATE $scheduleId SET ${setClause}, updatedAt = time::now() RETURN AFTER`,
          { scheduleId: schedule.id, ...updateFields },
        );
        return result[0]?.[0];
      });

      if (!updated) {
        throw new Error("Failed to retrieve updated schedule");
      }

      const updatedSchedule = this.rowToSchedule(updated);

      // Reschedule if service is running
      if (this.isRunning()) {
        this.requestReschedule();
      }

      logger.info(`[Scheduling] Updated schedule '${name}'`);
      return updatedSchedule;
    }

    // No fields changed, just update updatedAt
    const updated = await this.surrealFactory.withSystemConnection({}, async (db) => {
      const result = await db.query<[ScheduleRow[]]>(
        `UPDATE $scheduleId SET updatedAt = time::now() RETURN AFTER`,
        { scheduleId: schedule.id },
      );
      return result[0]?.[0];
    });

    if (!updated) {
      throw new Error("Failed to retrieve updated schedule");
    }

    logger.info(`[Scheduling] Updated schedule '${name}'`);
    return this.rowToSchedule(updated);
  }

  // ============== Internal Implementation ==============

  /**
   * Request a rescheduling of the next trigger with debouncing.
   * Prevents excessive timer recalculation when multiple schedule changes occur rapidly.
   */
  private requestReschedule(): void {
    if (this.rescheduleDebounceTimer !== null) {
      clearTimeout(this.rescheduleDebounceTimer);
    }

    this.rescheduleDebounceTimer = setTimeout(() => {
      this.rescheduleDebounceTimer = null;
      this.scheduleNextTrigger().catch((error) => {
        logger.error("[Scheduling] Reschedule failed:", error);
      });
    }, this.config.minRecalculationIntervalMs);
  }

  /**
   * Calculate the next run time for a schedule based on its type.
   *
   * @param schedule - The schedule to calculate for
   * @param preserveStoredTime - If true, use stored nextRunAt for one_off/dynamic; if false, use now
   */
  private calculateNextRunAtFromNow(
    schedule: Schedule,
    preserveStoredTime: boolean,
  ): Date {
    if (schedule.type === "one_off" || schedule.type === "dynamic") {
      if (preserveStoredTime && schedule.nextRunAt) {
        return schedule.nextRunAt;
      }
      return new Date();
    }
    // For interval types (sequential_interval, concurrent_interval)
    return new Date(Date.now() + (schedule.intervalMs ?? 0));
  }

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
   * Validate schedule update values for the schedule type.
   */
  private validateScheduleUpdate(
    schedule: Schedule,
    update: ScheduleUpdate,
  ): void {
    // intervalMs only valid for interval types
    if (update.intervalMs !== undefined) {
      if (
        schedule.type !== "sequential_interval" &&
        schedule.type !== "concurrent_interval"
      ) {
        throw new InvalidScheduleConfigError(
          `Cannot update intervalMs on ${schedule.type} schedule`,
        );
      }
      if (update.intervalMs <= 0) {
        throw new InvalidScheduleConfigError(
          "intervalMs must be positive",
        );
      }
    }
  }

  /**
   * Calculate the new nextRunAt value based on update and options.
   * Returns undefined if nextRunAt should not be changed.
   */
  private calculateUpdatedNextRunAt(
    schedule: Schedule,
    update: ScheduleUpdate,
    options?: UpdateScheduleOptions,
  ): Date | null | undefined {
    const behavior = options?.nextRunAtBehavior ?? "reset";

    // If explicit nextRunAt provided in update
    if (update.nextRunAt !== undefined) {
      if (behavior === "explicit") {
        return update.nextRunAt;
      }
      // Even without explicit behavior, if nextRunAt is in update, use it
      return update.nextRunAt;
    }

    // If intervalMs changed
    if (update.intervalMs !== undefined) {
      // If job is currently running (activeJobId set), don't change nextRunAt
      // The completion handler will use the new interval
      if (schedule.activeJobId !== null) {
        return undefined;
      }

      if (behavior === "preserve") {
        return undefined;
      }

      // Default "reset": calculate from now + new interval
      return new Date(Date.now() + update.intervalMs);
    }

    // No interval change and no explicit nextRunAt - don't update
    return undefined;
  }

  /**
   * Clear transient schedules on startup.
   */
  private async clearTransientSchedules(): Promise<void> {
    const result = await this.surrealFactory.withSystemConnection({}, async (db) => {
      const deleted = await db.query<[{ count: number }[]]>(
        `SELECT count() AS count FROM schedule WHERE isPersistent = false GROUP ALL`,
      );
      await db.query(`DELETE schedule WHERE isPersistent = false`);
      return deleted[0]?.[0]?.count ?? 0;
    });

    if (result > 0) {
      logger.info(
        `[Scheduling] Cleared ${result} transient schedule(s)`,
      );
    }
  }

  /**
   * Reset activeJobId for schedules where the job no longer exists or is complete.
   * This handles recovery after crash.
   */
  private async resetStaleActiveJobs(): Promise<void> {
    // Find schedules with activeJobId where the job is no longer active
    const staleSchedules = await this.surrealFactory.withSystemConnection({}, async (db) => {
      // Get all schedules with activeJobId set
      const schedules = await db.query<[ScheduleRow[]]>(
        `SELECT * FROM schedule WHERE activeJobId IS NOT NONE`,
      );

      const stale: ScheduleRow[] = [];
      for (const schedule of schedules[0] ?? []) {
        // Check if the job exists and is active
        const job = await db.query<[{ id: RecordId; status: string } | undefined]>(
          `RETURN $jobId.{ id, status }`,
          { jobId: schedule.activeJobId },
        );

        if (!job[0] || (job[0].status !== "pending" && job[0].status !== "running")) {
          stale.push(schedule);
        }
      }

      return stale;
    });

    for (const scheduleRow of staleSchedules) {
      const schedule = this.rowToSchedule(scheduleRow);
      logger.info(
        `[Scheduling] Resetting stale activeJobId for schedule '${schedule.name}'`,
      );

      if (
        schedule.type === "sequential_interval" ||
        schedule.type === "concurrent_interval"
      ) {
        const nextRunAt = new Date(Date.now() + (schedule.intervalMs ?? 0));
        await this.surrealFactory.withSystemConnection({}, async (db) => {
          await db.query(
            `UPDATE $scheduleId SET
               activeJobId = NONE,
               nextRunAt = $nextRunAt,
               updatedAt = time::now()`,
            { scheduleId: schedule.id, nextRunAt },
          );
        });
      } else {
        await this.surrealFactory.withSystemConnection({}, async (db) => {
          await db.query(
            `UPDATE $scheduleId SET
               activeJobId = NONE,
               updatedAt = time::now()`,
            { scheduleId: schedule.id },
          );
        });
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
    const nextSchedule = await this.surrealFactory.withSystemConnection({}, async (db) => {
      const result = await db.query<[{ nextRunAt: unknown }[]]>(
        `SELECT nextRunAt FROM schedule
         WHERE status = 'active' AND nextRunAt IS NOT NONE
         ORDER BY nextRunAt ASC
         LIMIT 1`,
      );
      return result[0]?.[0];
    });

    if (!nextSchedule) {
      logger.debug("[Scheduling] No active schedules to trigger");
      this.nextScheduledTime = null;
      return;
    }

    const nextTime = toDate(nextSchedule.nextRunAt);
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
      const dueSchedules = await this.surrealFactory.withSystemConnection({}, async (db) => {
        return await db.query<[ScheduleRow[]]>(
          `SELECT * FROM schedule
           WHERE status = 'active'
           AND nextRunAt IS NOT NONE
           AND nextRunAt <= $now`,
          { now },
        );
      });

      for (const row of dueSchedules[0] ?? []) {
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
      await this.surrealFactory.withSystemConnection({}, async (db) => {
        await db.query(
          `UPDATE $scheduleId SET
             status = 'completed',
             nextRunAt = NONE,
             activeJobId = $jobId,
             lastTriggeredAt = time::now(),
             consecutiveFailures = 0,
             updatedAt = time::now()`,
          { scheduleId: schedule.id, jobId: job.id },
        );
      });
    } else if (
      schedule.type === "dynamic" ||
      schedule.type === "sequential_interval"
    ) {
      // Dynamic and sequential: wait for job completion before scheduling next
      await this.surrealFactory.withSystemConnection({}, async (db) => {
        await db.query(
          `UPDATE $scheduleId SET
             nextRunAt = NONE,
             activeJobId = $jobId,
             lastTriggeredAt = time::now(),
             consecutiveFailures = 0,
             updatedAt = time::now()`,
          { scheduleId: schedule.id, jobId: job.id },
        );
      });

      // Subscribe to job completion events
      this.subscribeToJobCompletion(schedule.id, job.id);
    } else if (schedule.type === "concurrent_interval") {
      // Concurrent: schedule next immediately
      const nextRunAt = new Date(Date.now() + schedule.intervalMs!);
      await this.surrealFactory.withSystemConnection({}, async (db) => {
        await db.query(
          `UPDATE $scheduleId SET
             nextRunAt = $nextRunAt,
             lastTriggeredAt = time::now(),
             consecutiveFailures = 0,
             updatedAt = time::now()`,
          { scheduleId: schedule.id, nextRunAt },
        );
      });
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
      await this.surrealFactory.withSystemConnection({}, async (db) => {
        await db.query(
          `UPDATE $scheduleId SET
             status = 'error',
             consecutiveFailures = $consecutiveFailures,
             lastError = $lastError,
             updatedAt = time::now()`,
          { scheduleId: schedule.id, consecutiveFailures: newFailureCount, lastError: errorMessage },
        );
      });
      logger.error(
        `[Scheduling] Schedule '${schedule.name}' entered error state after ${newFailureCount} failures`,
      );
    } else {
      await this.surrealFactory.withSystemConnection({}, async (db) => {
        await db.query(
          `UPDATE $scheduleId SET
             consecutiveFailures = $consecutiveFailures,
             lastError = $lastError,
             updatedAt = time::now()`,
          { scheduleId: schedule.id, consecutiveFailures: newFailureCount, lastError: errorMessage },
        );
      });
    }
  }

  /**
   * Subscribe to job completion events for a schedule.
   * Called when a schedule triggers a job that needs completion tracking.
   */
  private subscribeToJobCompletion(scheduleId: RecordId, jobId: RecordId): void {
    this.jobQueueService.subscribeToCompletion(jobId, async (event: JobCompletionEvent) => {
      await this.handleJobCompletionEvent(scheduleId, event);
    });
  }

  /**
   * Handle a job completion event from the subscription.
   */
  private async handleJobCompletionEvent(scheduleId: RecordId, event: JobCompletionEvent): Promise<void> {
    const schedule = await this.getScheduleInternal(scheduleId);
    if (!schedule) {
      logger.warn(`[Scheduling] Schedule ${recordIdToString(scheduleId)} not found for job ${recordIdToString(event.job.id)} completion`);
      return;
    }

    // Verify this is still the active job for this schedule
    if (!schedule.activeJobId || recordIdToString(schedule.activeJobId) !== recordIdToString(event.job.id)) {
      logger.debug(
        `[Scheduling] Job ${recordIdToString(event.job.id)} completion ignored for schedule '${schedule.name}' ` +
        `(activeJobId is ${schedule.activeJobId ? recordIdToString(schedule.activeJobId) : "null"})`
      );
      return;
    }

    if (event.type === "completed") {
      await this.handleJobCompletion(schedule, event.job);
    } else {
      // failed or cancelled
      await this.handleJobFailure(schedule, event.job);
    }
  }

  /**
   * Re-subscribe to active jobs on startup (handles orphaned subscriptions from crash).
   */
  private async resubscribeToActiveJobs(): Promise<void> {
    const waitingSchedules = await this.surrealFactory.withSystemConnection({}, async (db) => {
      return await db.query<[ScheduleRow[]]>(
        `SELECT * FROM schedule
         WHERE activeJobId IS NOT NONE
         AND status = 'active'`,
      );
    });

    for (const row of waitingSchedules[0] ?? []) {
      const schedule = this.rowToSchedule(row);
      const job = await this.jobQueueService.getJob(schedule.activeJobId!);

      if (!job) {
        // Job was deleted (completed before we restarted) - reset schedule
        await this.resetScheduleAfterJobGone(schedule);
        continue;
      }

      // Job still exists - re-subscribe
      logger.debug(
        `[Scheduling] Re-subscribing to job ${recordIdToString(job.id)} for schedule '${schedule.name}'`
      );
      this.subscribeToJobCompletion(schedule.id, job.id);
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
      `[Scheduling] Job ${recordIdToString(job.id)} completed for schedule '${schedule.name}'`,
    );

    let nextRunAt: Date | null = null;

    if (schedule.type === "dynamic") {
      // Extract next time from job result
      const result = job.result as DynamicScheduleResult | null;
      if (result?.nextRunAt) {
        nextRunAt = new Date(result.nextRunAt);
      } else {
        // No next time - mark schedule as completed
        await this.surrealFactory.withSystemConnection({}, async (db) => {
          await db.query(
            `UPDATE $scheduleId SET
               status = 'completed',
               activeJobId = NONE,
               lastCompletedAt = time::now(),
               updatedAt = time::now()`,
            { scheduleId: schedule.id },
          );
        });
        logger.info(
          `[Scheduling] Dynamic schedule '${schedule.name}' completed (no next time)`,
        );
        // Reschedule to update timer for remaining schedules
        await this.scheduleNextTrigger();
        return;
      }
    } else if (schedule.type === "sequential_interval") {
      // Schedule next after interval
      nextRunAt = new Date(Date.now() + schedule.intervalMs!);
    }

    if (nextRunAt) {
      await this.surrealFactory.withSystemConnection({}, async (db) => {
        await db.query(
          `UPDATE $scheduleId SET
             nextRunAt = $nextRunAt,
             activeJobId = NONE,
             lastCompletedAt = time::now(),
             updatedAt = time::now()`,
          { scheduleId: schedule.id, nextRunAt },
        );
      });

      // Reschedule trigger
      await this.scheduleNextTrigger();
    }
  }

  /**
   * Handle job failure/cancellation for a schedule.
   */
  private async handleJobFailure(schedule: Schedule, job: Job): Promise<void> {
    logger.warn(
      `[Scheduling] Job ${recordIdToString(job.id)} ${job.status} for schedule '${schedule.name}'`,
    );

    const newFailureCount = schedule.consecutiveFailures + 1;
    const errorMessage =
      job.status === "cancelled"
        ? `Job cancelled: ${job.cancelReason ?? "no reason"}`
        : JSON.stringify(job.result);

    if (newFailureCount >= schedule.maxConsecutiveFailures) {
      // Enter error state
      await this.surrealFactory.withSystemConnection({}, async (db) => {
        await db.query(
          `UPDATE $scheduleId SET
             status = 'error',
             activeJobId = NONE,
             consecutiveFailures = $consecutiveFailures,
             lastError = $lastError,
             updatedAt = time::now()`,
          { scheduleId: schedule.id, consecutiveFailures: newFailureCount, lastError: errorMessage },
        );
      });
      logger.error(
        `[Scheduling] Schedule '${schedule.name}' entered error state after ${newFailureCount} job failures`,
      );
      // Reschedule to update timer for remaining schedules
      await this.scheduleNextTrigger();
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

      await this.surrealFactory.withSystemConnection({}, async (db) => {
        await db.query(
          `UPDATE $scheduleId SET
             nextRunAt = $nextRunAt,
             activeJobId = NONE,
             consecutiveFailures = $consecutiveFailures,
             lastError = $lastError,
             updatedAt = time::now()`,
          { scheduleId: schedule.id, nextRunAt, consecutiveFailures: newFailureCount, lastError: errorMessage },
        );
      });

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

    // Calculate nextRunAt - don't preserve stored time since job was deleted
    const nextRunAt = this.calculateNextRunAtFromNow(schedule, false);

    await this.surrealFactory.withSystemConnection({}, async (db) => {
      await db.query(
        `UPDATE $scheduleId SET
           nextRunAt = $nextRunAt,
           activeJobId = NONE,
           updatedAt = time::now()`,
        { scheduleId: schedule.id, nextRunAt },
      );
    });

    await this.scheduleNextTrigger();
  }

  // ============== Query Helpers ==============

  private async getScheduleInternal(id: RecordId): Promise<Schedule | null> {
    const row = await this.surrealFactory.withSystemConnection({}, async (db) => {
      const result = await db.query<[ScheduleRow | undefined]>(
        `RETURN $scheduleId.*`,
        { scheduleId: id },
      );
      return result[0];
    });

    return row ? this.rowToSchedule(row) : null;
  }

  private async getScheduleByNameInternal(
    name: string,
  ): Promise<Schedule | null> {
    const row = await this.surrealFactory.withSystemConnection({}, async (db) => {
      const result = await db.query<[ScheduleRow[]]>(
        `SELECT * FROM schedule WHERE name = $name LIMIT 1`,
        { name },
      );
      return result[0]?.[0];
    });

    return row ? this.rowToSchedule(row) : null;
  }

  private rowToSchedule(row: ScheduleRow): Schedule {
    // Validate type and status from database
    if (!isScheduleType(row.type)) {
      throw new Error(`Invalid schedule type in database: ${row.type}`);
    }
    if (!isScheduleStatus(row.status)) {
      throw new Error(`Invalid schedule status in database: ${row.status}`);
    }

    // Parse payload with error logging
    let payload: unknown = null;
    if (row.jobPayload) {
      try {
        payload = JSON.parse(row.jobPayload);
      } catch (e) {
        logger.warn(
          `[Scheduling] Failed to parse jobPayload for schedule ${recordIdToString(row.id)}, using raw value:`,
          e,
        );
        payload = row.jobPayload;
      }
    }

    return {
      id: row.id,
      name: row.name,
      description: row.description ?? null,
      type: row.type,
      status: row.status,
      isPersistent: row.isPersistent,
      nextRunAt: row.nextRunAt ? toDate(row.nextRunAt) : null,
      intervalMs: row.intervalMs ?? null,
      jobType: row.jobType,
      jobPayload: payload,
      jobPriority: row.jobPriority,
      jobMaxRetries: row.jobMaxRetries,
      jobExecutionMode: row.jobExecutionMode as Schedule["jobExecutionMode"],
      jobReferenceType: row.jobReferenceType ?? null,
      jobReferenceId: row.jobReferenceId ?? null,
      activeJobId: row.activeJobId ?? null,
      consecutiveFailures: row.consecutiveFailures,
      maxConsecutiveFailures: row.maxConsecutiveFailures ?? null,
      lastError: row.lastError ?? null,
      createdAt: toDate(row.createdAt),
      updatedAt: toDate(row.updatedAt),
      lastTriggeredAt: row.lastTriggeredAt
        ? toDate(row.lastTriggeredAt)
        : null,
      lastCompletedAt: row.lastCompletedAt
        ? toDate(row.lastCompletedAt)
        : null,
    };
  }
}
