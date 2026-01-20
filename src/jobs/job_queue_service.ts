import { Mutex } from "@core/asyncutil/mutex";
import type { DatabaseService } from "../database/database_service.ts";
import type { InstanceIdService } from "../instance/instance_id_service.ts";
import type { IEncryptionService } from "../encryption/types.ts";
import type {
  Job,
  NewJob,
  JobStatus,
  ExecutionMode,
  JobQueueServiceOptions,
  JobRow,
  JobCompletionType,
  JobCompletionSubscriber,
  JobCancellationSubscriber,
} from "./types.ts";
import { logger } from "../utils/logger.ts";
import {
  JobNotFoundError,
  JobAlreadyClaimedError,
  DuplicateActiveJobError,
  MaxRetriesExceededError,
  JobNotCancellableError,
} from "./errors.ts";

/**
 * Service for managing job queue entries in SQLite database.
 *
 * Owns all database access to the jobQueue table. Other code should
 * never query this table directly - always go through this service.
 *
 * Features:
 * - Unique constraint on active jobs per reference (type + id)
 * - Optional payload encryption for sensitive data
 * - Priority-based processing order
 * - Orphan detection via process instance ID
 *
 * @example
 * ```typescript
 * const jobQueueService = new JobQueueService({
 *   db,
 *   instanceIdService,
 *   encryptionService, // optional
 * });
 *
 * // Enqueue a job
 * const job = await jobQueueService.enqueue({
 *   type: "process-upload",
 *   payload: { fileId: 123 },
 *   referenceType: "file",
 *   referenceId: 123,
 * });
 * ```
 */
export class JobQueueService {
  private readonly db: DatabaseService;
  private readonly instanceIdService: InstanceIdService;
  private readonly encryptionService?: IEncryptionService;
  private readonly writeMutex = new Mutex();

  /** Per-job subscribers for completion events (completed/failed/cancelled) */
  private readonly completionSubscribers = new Map<number, JobCompletionSubscriber[]>();
  /** Per-job subscribers for cancellation request events */
  private readonly cancellationSubscribers = new Map<number, JobCancellationSubscriber[]>();

  constructor(options: JobQueueServiceOptions) {
    this.db = options.db;
    this.instanceIdService = options.instanceIdService;
    this.encryptionService = options.encryptionService;
  }

  // ============== Enqueue Operations ==============

  /**
   * Enqueue a new job for processing.
   *
   * If referenceType and referenceId are provided and executionMode is 'sequential' (default),
   * enforces unique constraint: only one active (pending/running) job per reference is allowed.
   * For concurrent execution mode, the uniqueness check is skipped.
   *
   * @param job - Job data to enqueue
   * @returns The created job with assigned ID
   * @throws {DuplicateActiveJobError} If an active sequential job exists for the same reference
   */
  async enqueue(job: NewJob): Promise<Job> {
    using _lock = await this.writeMutex.acquire();

    const executionMode: ExecutionMode = job.executionMode ?? "sequential";

    // Check for existing active job if reference is provided and mode is sequential
    if (executionMode === "sequential" && job.referenceType && job.referenceId) {
      const existing = await this.db.queryOne<{ id: number }>(
        `SELECT id FROM jobQueue
         WHERE referenceType = ? AND referenceId = ?
         AND status IN ('pending', 'running')
         AND executionMode = 'sequential'`,
        [job.referenceType, job.referenceId],
      );

      if (existing) {
        throw new DuplicateActiveJobError(job.referenceType, job.referenceId);
      }
    }

    // Serialize payload (with optional encryption)
    const payloadStr = await this.serializePayload(job.payload);

    const result = await this.db.execute(
      `INSERT INTO jobQueue (type, status, executionMode, payload, maxRetries, priority,
                             referenceType, referenceId, createdAt)
       VALUES (?, 'pending', ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        job.type,
        executionMode,
        payloadStr,
        job.maxRetries ?? 1,
        job.priority ?? 0,
        job.referenceType ?? null,
        job.referenceId ?? null,
      ],
    );

    const created = await this.getJobInternal(Number(result.lastInsertRowId));
    if (!created) {
      throw new Error("Failed to retrieve created job");
    }
    return created;
  }

  /**
   * Enqueue a job only if no active job exists for the reference.
   * Unlike enqueue(), this returns null instead of throwing on duplicate.
   *
   * @param job - Job data to enqueue
   * @returns The created job, or null if an active job already exists
   */
  async enqueueIfNotExists(job: NewJob): Promise<Job | null> {
    try {
      return await this.enqueue(job);
    } catch (error) {
      if (error instanceof DuplicateActiveJobError) {
        return null;
      }
      throw error;
    }
  }

  // ============== Query Operations ==============

  /**
   * Get a single job by ID.
   *
   * @param id - Job ID
   * @returns The job with decrypted payload, or null if not found
   */
  async getJob(id: number): Promise<Job | null> {
    return await this.getJobInternal(id);
  }

  /**
   * Internal method to get a job by ID (used by both public and internal methods).
   */
  private async getJobInternal(id: number): Promise<Job | null> {
    const row = await this.db.queryOne<JobRow>(
      `SELECT id, type, status, executionMode, payload, result, processInstanceId,
              retryCount, maxRetries, priority, referenceType, referenceId,
              createdAt, startedAt, completedAt, cancelledAt, cancelReason
       FROM jobQueue WHERE id = ?`,
      [id],
    );

    if (!row) {
      return null;
    }

    return this.rowToJob(row);
  }

  /**
   * Get all jobs with a specific status.
   * Ordered by priority DESC, then createdAt ASC (FIFO within same priority).
   *
   * @param status - Job status to filter by
   * @returns Array of jobs matching the status
   */
  async getJobsByStatus(status: JobStatus): Promise<Job[]> {
    const rows = await this.db.queryAll<JobRow>(
      `SELECT id, type, status, executionMode, payload, result, processInstanceId,
              retryCount, maxRetries, priority, referenceType, referenceId,
              createdAt, startedAt, completedAt, cancelledAt, cancelReason
       FROM jobQueue
       WHERE status = ?
       ORDER BY priority DESC, createdAt ASC`,
      [status],
    );

    return Promise.all(rows.map((row) => this.rowToJob(row)));
  }

  /**
   * Get jobs by type, optionally filtered by status.
   * Ordered by priority DESC, then createdAt ASC.
   *
   * @param type - Job type to filter by
   * @param status - Optional status filter
   * @returns Array of matching jobs
   */
  async getJobsByType(type: string, status?: JobStatus): Promise<Job[]> {
    let sql = `SELECT id, type, status, executionMode, payload, result, processInstanceId,
                      retryCount, maxRetries, priority, referenceType, referenceId,
                      createdAt, startedAt, completedAt, cancelledAt, cancelReason
               FROM jobQueue
               WHERE type = ?`;
    const params: (string | number)[] = [type];

    if (status) {
      sql += ` AND status = ?`;
      params.push(status);
    }

    sql += ` ORDER BY priority DESC, createdAt ASC`;

    const rows = await this.db.queryAll<JobRow>(sql, params);
    return Promise.all(rows.map((row) => this.rowToJob(row)));
  }

  /**
   * Check if an active (pending/running) job exists for a reference.
   *
   * @param referenceType - Reference type (e.g., "code_source", "file")
   * @param referenceId - Reference ID
   * @returns The active job if it exists, null otherwise
   */
  async getActiveJobForReference(
    referenceType: string,
    referenceId: number,
  ): Promise<Job | null> {
    const row = await this.db.queryOne<JobRow>(
      `SELECT id, type, status, executionMode, payload, result, processInstanceId,
              retryCount, maxRetries, priority, referenceType, referenceId,
              createdAt, startedAt, completedAt, cancelledAt, cancelReason
       FROM jobQueue
       WHERE referenceType = ? AND referenceId = ?
       AND status IN ('pending', 'running')`,
      [referenceType, referenceId],
    );

    if (!row) {
      return null;
    }

    return this.rowToJob(row);
  }

  /**
   * Get the next pending job to process.
   * Returns the highest priority pending job (FIFO within same priority).
   * Excludes jobs that have been marked for cancellation (cancelledAt is set).
   *
   * @param type - Optional job type filter
   * @returns The next job to process, or null if queue is empty
   */
  async getNextPendingJob(type?: string): Promise<Job | null> {
    let sql = `SELECT id, type, status, executionMode, payload, result, processInstanceId,
                      retryCount, maxRetries, priority, referenceType, referenceId,
                      createdAt, startedAt, completedAt, cancelledAt, cancelReason
               FROM jobQueue
               WHERE status = 'pending' AND cancelledAt IS NULL`;
    const params: string[] = [];

    if (type) {
      sql += ` AND type = ?`;
      params.push(type);
    }

    sql += ` ORDER BY priority DESC, createdAt ASC LIMIT 1`;

    const row = await this.db.queryOne<JobRow>(sql, params);

    if (!row) {
      return null;
    }

    return this.rowToJob(row);
  }

  // ============== Claim/Complete Operations ==============

  /**
   * Atomically claim a job for processing.
   * Sets status to 'running', assigns processInstanceId, and sets startedAt.
   *
   * Uses optimistic concurrency: only succeeds if job is still pending.
   *
   * @param id - Job ID to claim
   * @returns The claimed job with updated status
   * @throws {JobNotFoundError} If job doesn't exist
   * @throws {JobAlreadyClaimedError} If job is not pending (race condition)
   */
  async claimJob(id: number): Promise<Job> {
    using _lock = await this.writeMutex.acquire();

    const instanceId = this.instanceIdService.getId();

    // Atomic claim with optimistic concurrency
    const result = await this.db.execute(
      `UPDATE jobQueue
       SET status = 'running',
           processInstanceId = ?,
           startedAt = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'pending'`,
      [instanceId, id],
    );

    if (result.changes === 0) {
      // Check if job exists at all
      const job = await this.getJobInternal(id);
      if (!job) {
        throw new JobNotFoundError(id);
      }
      // Job exists but wasn't pending - someone else claimed it
      throw new JobAlreadyClaimedError(id);
    }

    const claimed = await this.getJobInternal(id);
    if (!claimed) {
      throw new Error("Failed to retrieve claimed job");
    }
    return claimed;
  }

  /**
   * Mark a job as completed with result data.
   * Notifies all completion subscribers and deletes the job from the database.
   *
   * @param id - Job ID
   * @param result - Result data (will be JSON serialized)
   * @returns The completed job (note: job is deleted after this returns)
   * @throws {JobNotFoundError} If job doesn't exist
   */
  async completeJob(id: number, result?: unknown): Promise<Job> {
    using _lock = await this.writeMutex.acquire();

    const resultStr = result !== undefined ? JSON.stringify(result) : null;

    const execResult = await this.db.execute(
      `UPDATE jobQueue
       SET status = 'completed',
           result = ?,
           completedAt = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [resultStr, id],
    );

    if (execResult.changes === 0) {
      throw new JobNotFoundError(id);
    }

    const completed = await this.getJobInternal(id);
    if (!completed) {
      throw new Error("Failed to retrieve completed job");
    }

    // Notify subscribers and delete job
    await this.notifyCompletionAndDelete(completed, "completed");

    return completed;
  }

  /**
   * Mark a job as failed with error details.
   * Notifies all completion subscribers and deletes the job from the database.
   *
   * @param id - Job ID
   * @param error - Error details (will be JSON serialized)
   * @returns The failed job (note: job is deleted after this returns)
   * @throws {JobNotFoundError} If job doesn't exist
   */
  async failJob(id: number, error: unknown): Promise<Job> {
    using _lock = await this.writeMutex.acquire();

    const errorStr = JSON.stringify(error);

    const result = await this.db.execute(
      `UPDATE jobQueue
       SET status = 'failed',
           result = ?,
           completedAt = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [errorStr, id],
    );

    if (result.changes === 0) {
      throw new JobNotFoundError(id);
    }

    const failed = await this.getJobInternal(id);
    if (!failed) {
      throw new Error("Failed to retrieve failed job");
    }

    // Notify subscribers and delete job
    await this.notifyCompletionAndDelete(failed, "failed");

    return failed;
  }

  // ============== Orphan Detection ==============

  /**
   * Find all running jobs that belong to a different process instance.
   * These are "orphaned" jobs from a crashed container.
   *
   * @returns Array of orphaned jobs
   */
  async getOrphanedJobs(): Promise<Job[]> {
    const currentInstanceId = this.instanceIdService.getId();

    // Find running jobs that belong to a different process
    const rows = await this.db.queryAll<JobRow>(
      `SELECT id, type, status, executionMode, payload, result, processInstanceId,
              retryCount, maxRetries, priority, referenceType, referenceId,
              createdAt, startedAt, completedAt, cancelledAt, cancelReason
       FROM jobQueue
       WHERE status = 'running'
       AND processInstanceId != ?
       AND processInstanceId IS NOT NULL
       ORDER BY priority DESC, createdAt ASC`,
      [currentInstanceId],
    );

    return Promise.all(rows.map((row) => this.rowToJob(row)));
  }

  /**
   * Reset an orphaned job back to pending status for retry.
   * Increments retryCount. Fails if maxRetries exceeded.
   *
   * @param id - Job ID to reset
   * @returns The reset job with incremented retryCount
   * @throws {JobNotFoundError} If job doesn't exist
   * @throws {MaxRetriesExceededError} If retryCount >= maxRetries
   */
  async resetOrphanedJob(id: number): Promise<Job> {
    using _lock = await this.writeMutex.acquire();

    const job = await this.getJobInternal(id);
    if (!job) {
      throw new JobNotFoundError(id);
    }

    // Check retry limit
    if (job.retryCount >= job.maxRetries) {
      throw new MaxRetriesExceededError(id, job.retryCount, job.maxRetries);
    }

    await this.db.execute(
      `UPDATE jobQueue
       SET status = 'pending',
           processInstanceId = NULL,
           startedAt = NULL,
           retryCount = retryCount + 1
       WHERE id = ?`,
      [id],
    );

    const reset = await this.getJobInternal(id);
    if (!reset) {
      throw new Error("Failed to retrieve reset job");
    }
    return reset;
  }

  // ============== Cancellation Operations ==============

  /**
   * Cancel a single job by ID.
   *
   * For pending jobs: Sets status to 'cancelled', notifies subscribers, and deletes the job.
   * For running jobs: Sets cancelledAt to signal handler to stop via cancellation event.
   *
   * @param id - Job ID to cancel
   * @param options - Optional cancellation options
   * @returns The updated job (note: pending jobs are deleted after this returns)
   * @throws {JobNotFoundError} If job doesn't exist
   * @throws {JobNotCancellableError} If job is already completed/failed/cancelled
   */
  async cancelJob(id: number, options?: { reason?: string }): Promise<Job> {
    using _lock = await this.writeMutex.acquire();

    const job = await this.getJobInternal(id);
    if (!job) {
      throw new JobNotFoundError(id);
    }

    // Can only cancel pending or running jobs
    if (job.status !== "pending" && job.status !== "running") {
      throw new JobNotCancellableError(id, job.status);
    }

    // Already marked for cancellation
    if (job.cancelledAt) {
      return job;
    }

    const reason = options?.reason ?? null;

    if (job.status === "pending") {
      // Pending jobs can be cancelled immediately
      await this.db.execute(
        `UPDATE jobQueue
         SET status = 'cancelled',
             cancelledAt = CURRENT_TIMESTAMP,
             cancelReason = ?,
             completedAt = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [reason, id],
      );

      const cancelled = await this.getJobInternal(id);
      if (!cancelled) {
        throw new Error("Failed to retrieve cancelled job");
      }

      // Notify subscribers and delete job
      await this.notifyCompletionAndDelete(cancelled, "cancelled");

      return cancelled;
    } else {
      // Running jobs: set cancelledAt to signal handler
      await this.db.execute(
        `UPDATE jobQueue
         SET cancelledAt = CURRENT_TIMESTAMP,
             cancelReason = ?
         WHERE id = ?`,
        [reason, id],
      );

      // Notify cancellation subscribers (processor will handle the token)
      this.notifyCancellationRequest(id, reason ?? undefined);

      const updated = await this.getJobInternal(id);
      if (!updated) {
        throw new Error("Failed to retrieve cancelled job");
      }
      return updated;
    }
  }

  /**
   * Cancel multiple jobs by criteria.
   * For pending jobs: notifies subscribers and deletes them.
   * For running jobs: notifies cancellation subscribers.
   *
   * @param options - Filter criteria and cancellation reason
   * @returns Number of jobs cancelled
   */
  async cancelJobs(options: {
    type?: string;
    referenceType?: string;
    referenceId?: number;
    reason?: string;
  }): Promise<number> {
    using _lock = await this.writeMutex.acquire();

    const conditions: string[] = ["status IN ('pending', 'running')", "cancelledAt IS NULL"];
    const params: (string | number)[] = [];

    if (options.type) {
      conditions.push("type = ?");
      params.push(options.type);
    }
    if (options.referenceType) {
      conditions.push("referenceType = ?");
      params.push(options.referenceType);
    }
    if (options.referenceId !== undefined) {
      conditions.push("referenceId = ?");
      params.push(options.referenceId);
    }

    const reason = options.reason ?? null;

    // Find all matching jobs first
    const rows = await this.db.queryAll<JobRow>(
      `SELECT id, type, status, executionMode, payload, result, processInstanceId,
              retryCount, maxRetries, priority, referenceType, referenceId,
              createdAt, startedAt, completedAt, cancelledAt, cancelReason
       FROM jobQueue
       WHERE ${conditions.join(" AND ")}`,
      params,
    );

    let cancelledCount = 0;

    for (const row of rows) {
      const job = await this.rowToJob(row);

      if (job.status === "pending") {
        // Cancel pending jobs immediately
        await this.db.execute(
          `UPDATE jobQueue
           SET status = 'cancelled',
               cancelledAt = CURRENT_TIMESTAMP,
               cancelReason = ?,
               completedAt = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [reason, job.id],
        );

        const cancelled = await this.getJobInternal(job.id);
        if (cancelled) {
          await this.notifyCompletionAndDelete(cancelled, "cancelled");
        }
        cancelledCount++;
      } else {
        // For running jobs, set cancelledAt and notify
        await this.db.execute(
          `UPDATE jobQueue
           SET cancelledAt = CURRENT_TIMESTAMP,
               cancelReason = ?
           WHERE id = ?`,
          [reason, job.id],
        );

        this.notifyCancellationRequest(job.id, reason ?? undefined);
        cancelledCount++;
      }
    }

    return cancelledCount;
  }

  /**
   * Check if a job has a cancellation request.
   * Used by the processor to poll for cancellation of running jobs.
   *
   * @param id - Job ID to check
   * @returns Cancellation info if requested, null otherwise
   */
  async getCancellationStatus(id: number): Promise<{ cancelledAt: Date; reason?: string } | null> {
    const row = await this.db.queryOne<{ cancelledAt: string | null; cancelReason: string | null }>(
      `SELECT cancelledAt, cancelReason FROM jobQueue WHERE id = ?`,
      [id],
    );

    if (!row || !row.cancelledAt) {
      return null;
    }

    return {
      cancelledAt: new Date(row.cancelledAt),
      reason: row.cancelReason ?? undefined,
    };
  }

  /**
   * Mark a running job as cancelled (final state).
   * Called by processor when handler finishes after cancellation was requested.
   * Notifies all completion subscribers and deletes the job from the database.
   *
   * @param id - Job ID
   * @param reason - Optional reason (uses existing cancelReason if not provided)
   * @returns The cancelled job (note: job is deleted after this returns)
   * @throws {JobNotFoundError} If job doesn't exist
   */
  async markJobCancelled(id: number, reason?: string): Promise<Job> {
    using _lock = await this.writeMutex.acquire();

    const job = await this.getJobInternal(id);
    if (!job) {
      throw new JobNotFoundError(id);
    }

    // Use provided reason or existing reason
    const cancelReason = reason ?? job.cancelReason ?? null;

    await this.db.execute(
      `UPDATE jobQueue
       SET status = 'cancelled',
           cancelledAt = COALESCE(cancelledAt, CURRENT_TIMESTAMP),
           cancelReason = ?,
           completedAt = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [cancelReason, id],
    );

    const cancelled = await this.getJobInternal(id);
    if (!cancelled) {
      throw new Error("Failed to retrieve cancelled job");
    }

    // Notify subscribers and delete job
    await this.notifyCompletionAndDelete(cancelled, "cancelled");

    return cancelled;
  }

  // ============== Event Subscription ==============

  /**
   * Subscribe to completion events for a specific job.
   * Subscriber will be called when the job reaches a terminal state
   * (completed, failed, or cancelled).
   *
   * @param jobId - Job ID to subscribe to
   * @param subscriber - Callback function
   * @returns Unsubscribe function
   */
  subscribeToCompletion(jobId: number, subscriber: JobCompletionSubscriber): () => void {
    const subscribers = this.completionSubscribers.get(jobId) ?? [];
    subscribers.push(subscriber);
    this.completionSubscribers.set(jobId, subscribers);

    return () => {
      const current = this.completionSubscribers.get(jobId);
      if (current) {
        const index = current.indexOf(subscriber);
        if (index !== -1) {
          current.splice(index, 1);
        }
        if (current.length === 0) {
          this.completionSubscribers.delete(jobId);
        }
      }
    };
  }

  /**
   * Subscribe to cancellation request events for a specific job.
   * Subscriber will be called when cancelJob() is called on a running job.
   *
   * @param jobId - Job ID to subscribe to
   * @param subscriber - Callback function
   * @returns Unsubscribe function
   */
  subscribeToCancellation(jobId: number, subscriber: JobCancellationSubscriber): () => void {
    const subscribers = this.cancellationSubscribers.get(jobId) ?? [];
    subscribers.push(subscriber);
    this.cancellationSubscribers.set(jobId, subscribers);

    return () => {
      const current = this.cancellationSubscribers.get(jobId);
      if (current) {
        const index = current.indexOf(subscriber);
        if (index !== -1) {
          current.splice(index, 1);
        }
        if (current.length === 0) {
          this.cancellationSubscribers.delete(jobId);
        }
      }
    };
  }

  // ============== Stats Operations ==============

  /**
   * Get count of jobs by status for monitoring.
   *
   * @returns Object with counts per status
   */
  async getJobCounts(): Promise<Record<JobStatus, number>> {
    const rows = await this.db.queryAll<{ status: string; count: number }>(
      `SELECT status, COUNT(*) as count
       FROM jobQueue
       GROUP BY status`,
    );

    const counts: Record<JobStatus, number> = {
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    };

    for (const row of rows) {
      if (row.status in counts) {
        counts[row.status as JobStatus] = row.count;
      }
    }

    return counts;
  }

  // ============== Private Helpers ==============

  /**
   * Notify completion subscribers and delete the job from the database.
   * Called after job reaches terminal state (completed/failed/cancelled).
   *
   * @param job - The completed job with full data
   * @param type - The type of completion
   */
  private async notifyCompletionAndDelete(job: Job, type: JobCompletionType): Promise<void> {
    const subscribers = this.completionSubscribers.get(job.id) ?? [];

    // Notify all subscribers with full job data
    for (const subscriber of subscribers) {
      try {
        await subscriber({ type, job });
      } catch (error) {
        logger.error(`[JobQueue] Completion subscriber error for job ${job.id}:`, error);
        // Continue notifying other subscribers even if one fails
      }
    }

    // Clean up subscribers
    this.completionSubscribers.delete(job.id);
    this.cancellationSubscribers.delete(job.id);

    // Delete the job from the database
    await this.db.execute(`DELETE FROM jobQueue WHERE id = ?`, [job.id]);
    logger.debug(`[JobQueue] Deleted job ${job.id} after ${type}`);
  }

  /**
   * Notify cancellation subscribers when a cancellation is requested.
   * Called by cancelJob() for running jobs.
   *
   * @param jobId - The job ID being cancelled
   * @param reason - Optional cancellation reason
   */
  private notifyCancellationRequest(jobId: number, reason?: string): void {
    const subscribers = this.cancellationSubscribers.get(jobId) ?? [];

    for (const subscriber of subscribers) {
      try {
        // Fire-and-forget for cancellation notifications
        const result = subscriber({ jobId, reason });
        if (result instanceof Promise) {
          result.catch((error) => {
            logger.error(`[JobQueue] Cancellation subscriber error for job ${jobId}:`, error);
          });
        }
      } catch (error) {
        logger.error(`[JobQueue] Cancellation subscriber error for job ${jobId}:`, error);
      }
    }
  }

  /**
   * Transform database row to Job object.
   * Handles JSON parsing, date conversion, and payload decryption.
   */
  private async rowToJob(row: JobRow): Promise<Job> {
    // Deserialize and optionally decrypt payload
    const payload = await this.deserializePayload(row.payload);

    // Parse result JSON
    let result: unknown = null;
    if (row.result) {
      try {
        result = JSON.parse(row.result);
      } catch {
        // If parsing fails, return raw string
        result = row.result;
      }
    }

    return {
      id: row.id,
      type: row.type,
      status: row.status as JobStatus,
      executionMode: row.executionMode as ExecutionMode,
      payload,
      result,
      processInstanceId: row.processInstanceId,
      retryCount: row.retryCount,
      maxRetries: row.maxRetries,
      priority: row.priority,
      referenceType: row.referenceType,
      referenceId: row.referenceId,
      createdAt: new Date(row.createdAt),
      startedAt: row.startedAt ? new Date(row.startedAt) : null,
      completedAt: row.completedAt ? new Date(row.completedAt) : null,
      cancelledAt: row.cancelledAt ? new Date(row.cancelledAt) : null,
      cancelReason: row.cancelReason,
    };
  }

  /**
   * Serialize and optionally encrypt payload.
   */
  private async serializePayload(payload: unknown): Promise<string | null> {
    if (payload === undefined || payload === null) {
      return null;
    }

    const jsonStr = JSON.stringify(payload);

    if (this.encryptionService) {
      return await this.encryptionService.encrypt(jsonStr);
    }

    return jsonStr;
  }

  /**
   * Deserialize and optionally decrypt payload.
   */
  private async deserializePayload(data: string | null): Promise<unknown> {
    if (!data) {
      return null;
    }

    let jsonStr = data;

    if (this.encryptionService) {
      try {
        jsonStr = await this.encryptionService.decrypt(data);
      } catch {
        // If decryption fails, assume it's not encrypted (for backward compatibility)
        // or the encryption key changed. Log and return null.
        globalThis.console.error(
          "[JobQueue] Failed to decrypt payload, returning null",
        );
        return null;
      }
    }

    try {
      return JSON.parse(jsonStr);
    } catch {
      // If parsing fails, return raw string
      return jsonStr;
    }
  }
}
