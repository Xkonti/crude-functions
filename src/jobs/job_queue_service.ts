import { Mutex } from "@core/asyncutil/mutex";
import { RecordId } from "surrealdb";
import type { SurrealConnectionFactory } from "../database/surreal_connection_factory.ts";
import { recordIdToString, toDate } from "../database/surreal_helpers.ts";
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
import { type EventBus, EventType } from "../events/mod.ts";

/**
 * Service for managing job queue entries in SurrealDB.
 *
 * Owns all database access to the job table. Other code should
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
 *   surrealFactory,
 *   instanceIdService,
 *   encryptionService, // optional
 * });
 *
 * // Enqueue a job
 * const job = await jobQueueService.enqueue({
 *   type: "process-upload",
 *   payload: { fileId: "123" },
 *   referenceType: "file",
 *   referenceId: "123",
 * });
 * ```
 */
export class JobQueueService {
  private readonly surrealFactory: SurrealConnectionFactory;
  private readonly instanceIdService: InstanceIdService;
  private readonly encryptionService?: IEncryptionService;
  private readonly eventBus?: EventBus;
  private readonly writeMutex = new Mutex();

  /** Per-job subscribers for completion events (completed/failed/cancelled) - keyed by recordIdToString */
  private readonly completionSubscribers = new Map<string, JobCompletionSubscriber[]>();
  /** Per-job subscribers for cancellation request events - keyed by recordIdToString */
  private readonly cancellationSubscribers = new Map<string, JobCancellationSubscriber[]>();

  constructor(options: JobQueueServiceOptions) {
    this.surrealFactory = options.surrealFactory;
    this.instanceIdService = options.instanceIdService;
    this.encryptionService = options.encryptionService;
    this.eventBus = options.eventBus;
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

    // Convert referenceId to string if provided
    const referenceId = job.referenceId !== undefined && job.referenceId !== null
      ? String(job.referenceId)
      : undefined;

    // Check for existing active job if reference is provided and mode is sequential
    if (executionMode === "sequential" && job.referenceType && referenceId) {
      const existing = await this.surrealFactory.withSystemConnection({}, async (db) => {
        return await db.query<[{ id: RecordId }[] | undefined]>(
          `SELECT id FROM job
           WHERE referenceType = $referenceType AND referenceId = $referenceId
           AND status IN ['pending', 'running']
           AND executionMode = 'sequential'
           LIMIT 1`,
          { referenceType: job.referenceType, referenceId },
        );
      });

      if (existing[0] && existing[0].length > 0) {
        throw new DuplicateActiveJobError(job.referenceType, referenceId);
      }
    }

    // Serialize payload (with optional encryption)
    const payloadStr = await this.serializePayload(job.payload);

    const created = await this.surrealFactory.withSystemConnection({}, async (db) => {
      const result = await db.query<[JobRow | undefined]>(
        `CREATE job SET
           type = $type,
           status = 'pending',
           executionMode = $executionMode,
           payload = $payload,
           result = NONE,
           processInstanceId = NONE,
           retryCount = 0,
           maxRetries = $maxRetries,
           priority = $priority,
           referenceType = $referenceType,
           referenceId = $referenceId,
           createdAt = time::now(),
           startedAt = NONE,
           completedAt = NONE,
           cancelledAt = NONE,
           cancelReason = NONE
         RETURN AFTER`,
        {
          type: job.type,
          executionMode,
          payload: payloadStr,
          maxRetries: job.maxRetries ?? 1,
          priority: job.priority ?? 0,
          referenceType: job.referenceType ?? undefined,
          referenceId,
        },
      );

      // CREATE returns an array with a single element
      const row = Array.isArray(result[0]) ? result[0][0] : result[0];
      if (!row) {
        throw new Error("Failed to create job");
      }
      return row;
    });

    const createdJob = await this.rowToJob(created);

    // Publish event for immediate processing (fire-and-forget)
    this.eventBus?.publish(EventType.JOB_ENQUEUED, {
      jobId: createdJob.id,
      type: createdJob.type,
    });

    return createdJob;
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
   * @param id - Job ID (RecordId)
   * @returns The job with decrypted payload, or null if not found
   */
  async getJob(id: RecordId): Promise<Job | null> {
    return await this.getJobInternal(id);
  }

  /**
   * Internal method to get a job by ID (used by both public and internal methods).
   */
  private async getJobInternal(id: RecordId): Promise<Job | null> {
    const row = await this.surrealFactory.withSystemConnection({}, async (db) => {
      const result = await db.query<[JobRow | undefined]>(
        `RETURN $jobId.*`,
        { jobId: id },
      );
      return result[0];
    });

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
    const rows = await this.surrealFactory.withSystemConnection({}, async (db) => {
      return await db.query<[JobRow[]]>(
        `SELECT * FROM job
         WHERE status = $status
         ORDER BY priority DESC, createdAt ASC`,
        { status },
      );
    });

    return Promise.all((rows[0] ?? []).map((row) => this.rowToJob(row)));
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
    const rows = await this.surrealFactory.withSystemConnection({}, async (db) => {
      if (status) {
        return await db.query<[JobRow[]]>(
          `SELECT * FROM job
           WHERE type = $type AND status = $status
           ORDER BY priority DESC, createdAt ASC`,
          { type, status },
        );
      }
      return await db.query<[JobRow[]]>(
        `SELECT * FROM job
         WHERE type = $type
         ORDER BY priority DESC, createdAt ASC`,
        { type },
      );
    });

    return Promise.all((rows[0] ?? []).map((row) => this.rowToJob(row)));
  }

  /**
   * Check if an active (pending/running) job exists for a reference.
   *
   * @param referenceType - Reference type (e.g., "code_source", "file")
   * @param referenceId - Reference ID (string)
   * @returns The active job if it exists, null otherwise
   */
  async getActiveJobForReference(
    referenceType: string,
    referenceId: string,
  ): Promise<Job | null> {
    const row = await this.surrealFactory.withSystemConnection({}, async (db) => {
      const result = await db.query<[JobRow[]]>(
        `SELECT * FROM job
         WHERE referenceType = $referenceType AND referenceId = $referenceId
         AND status IN ['pending', 'running']
         LIMIT 1`,
        { referenceType, referenceId },
      );
      return result[0]?.[0];
    });

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
    const row = await this.surrealFactory.withSystemConnection({}, async (db) => {
      if (type) {
        const result = await db.query<[JobRow[]]>(
          `SELECT * FROM job
           WHERE status = 'pending' AND cancelledAt IS NONE AND type = $type
           ORDER BY priority DESC, createdAt ASC
           LIMIT 1`,
          { type },
        );
        return result[0]?.[0];
      }
      const result = await db.query<[JobRow[]]>(
        `SELECT * FROM job
         WHERE status = 'pending' AND cancelledAt IS NONE
         ORDER BY priority DESC, createdAt ASC
         LIMIT 1`,
      );
      return result[0]?.[0];
    });

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
   * @param id - Job ID to claim (RecordId)
   * @returns The claimed job with updated status
   * @throws {JobNotFoundError} If job doesn't exist
   * @throws {JobAlreadyClaimedError} If job is not pending (race condition)
   */
  async claimJob(id: RecordId): Promise<Job> {
    using _lock = await this.writeMutex.acquire();

    const instanceId = this.instanceIdService.getId();

    const result = await this.surrealFactory.withSystemConnection({}, async (db) => {
      // Atomic claim with optimistic concurrency
      const updated = await db.query<[JobRow[]]>(
        `UPDATE $jobId SET
           status = 'running',
           processInstanceId = $instanceId,
           startedAt = time::now()
         WHERE status = 'pending'
         RETURN AFTER`,
        { jobId: id, instanceId },
      );
      return updated[0];
    });

    if (!result || result.length === 0) {
      // Check if job exists at all
      const job = await this.getJobInternal(id);
      if (!job) {
        throw new JobNotFoundError(id);
      }
      // Job exists but wasn't pending - someone else claimed it
      throw new JobAlreadyClaimedError(id);
    }

    return this.rowToJob(result[0]);
  }

  /**
   * Mark a job as completed with result data.
   * Notifies all completion subscribers and deletes the job from the database.
   *
   * @param id - Job ID (RecordId)
   * @param result - Result data (will be JSON serialized)
   * @returns The completed job (note: job is deleted after this returns)
   * @throws {JobNotFoundError} If job doesn't exist
   */
  async completeJob(id: RecordId, result?: unknown): Promise<Job> {
    using _lock = await this.writeMutex.acquire();

    // Return undefined (not null) to map to SurrealDB NONE instead of NULL
    // SurrealDB's option<string> accepts NONE but not NULL
    const resultStr = result !== undefined ? JSON.stringify(result) : undefined;

    const updated = await this.surrealFactory.withSystemConnection({}, async (db) => {
      const rows = await db.query<[JobRow[]]>(
        `UPDATE $jobId SET
           status = 'completed',
           result = $result,
           completedAt = time::now()
         RETURN AFTER`,
        { jobId: id, result: resultStr },
      );
      return rows[0]?.[0];
    });

    if (!updated) {
      throw new JobNotFoundError(id);
    }

    const completed = await this.rowToJob(updated);

    // Notify subscribers and delete job
    await this.notifyCompletionAndDelete(completed, "completed");

    return completed;
  }

  /**
   * Mark a job as failed with error details.
   * Notifies all completion subscribers and deletes the job from the database.
   *
   * @param id - Job ID (RecordId)
   * @param error - Error details (will be JSON serialized)
   * @returns The failed job (note: job is deleted after this returns)
   * @throws {JobNotFoundError} If job doesn't exist
   */
  async failJob(id: RecordId, error: unknown): Promise<Job> {
    using _lock = await this.writeMutex.acquire();

    const errorStr = JSON.stringify(error);

    const updated = await this.surrealFactory.withSystemConnection({}, async (db) => {
      const rows = await db.query<[JobRow[]]>(
        `UPDATE $jobId SET
           status = 'failed',
           result = $error,
           completedAt = time::now()
         RETURN AFTER`,
        { jobId: id, error: errorStr },
      );
      return rows[0]?.[0];
    });

    if (!updated) {
      throw new JobNotFoundError(id);
    }

    const failed = await this.rowToJob(updated);

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

    const rows = await this.surrealFactory.withSystemConnection({}, async (db) => {
      return await db.query<[JobRow[]]>(
        `SELECT * FROM job
         WHERE status = 'running'
         AND processInstanceId != $instanceId
         AND processInstanceId IS NOT NONE
         ORDER BY priority DESC, createdAt ASC`,
        { instanceId: currentInstanceId },
      );
    });

    return Promise.all((rows[0] ?? []).map((row) => this.rowToJob(row)));
  }

  /**
   * Reset an orphaned job back to pending status for retry.
   * Increments retryCount. Fails if maxRetries exceeded.
   *
   * @param id - Job ID to reset (RecordId)
   * @returns The reset job with incremented retryCount
   * @throws {JobNotFoundError} If job doesn't exist
   * @throws {MaxRetriesExceededError} If retryCount >= maxRetries
   */
  async resetOrphanedJob(id: RecordId): Promise<Job> {
    using _lock = await this.writeMutex.acquire();

    const job = await this.getJobInternal(id);
    if (!job) {
      throw new JobNotFoundError(id);
    }

    // Check retry limit
    if (job.retryCount >= job.maxRetries) {
      throw new MaxRetriesExceededError(id, job.retryCount, job.maxRetries);
    }

    const updated = await this.surrealFactory.withSystemConnection({}, async (db) => {
      const rows = await db.query<[JobRow[]]>(
        `UPDATE $jobId SET
           status = 'pending',
           processInstanceId = NONE,
           startedAt = NONE,
           retryCount = retryCount + 1
         RETURN AFTER`,
        { jobId: id },
      );
      return rows[0]?.[0];
    });

    if (!updated) {
      throw new Error("Failed to retrieve reset job");
    }

    return this.rowToJob(updated);
  }

  // ============== Cancellation Operations ==============

  /**
   * Cancel a single job by ID.
   *
   * For pending jobs: Sets status to 'cancelled', notifies subscribers, and deletes the job.
   * For running jobs: Sets cancelledAt to signal handler to stop via cancellation event.
   *
   * @param id - Job ID to cancel (RecordId)
   * @param options - Optional cancellation options
   * @returns The updated job (note: pending jobs are deleted after this returns)
   * @throws {JobNotFoundError} If job doesn't exist
   * @throws {JobNotCancellableError} If job is already completed/failed/cancelled
   */
  async cancelJob(id: RecordId, options?: { reason?: string }): Promise<Job> {
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

    // Return undefined (not null) to map to SurrealDB NONE instead of NULL
    // SurrealDB's option<string> accepts NONE but not NULL
    const reason = options?.reason ?? undefined;

    if (job.status === "pending") {
      // Pending jobs can be cancelled immediately
      const updated = await this.surrealFactory.withSystemConnection({}, async (db) => {
        const rows = await db.query<[JobRow[]]>(
          `UPDATE $jobId SET
             status = 'cancelled',
             cancelledAt = time::now(),
             cancelReason = $reason,
             completedAt = time::now()
           RETURN AFTER`,
          { jobId: id, reason },
        );
        return rows[0]?.[0];
      });

      if (!updated) {
        throw new Error("Failed to retrieve cancelled job");
      }

      const cancelled = await this.rowToJob(updated);

      // Notify subscribers and delete job
      await this.notifyCompletionAndDelete(cancelled, "cancelled");

      return cancelled;
    } else {
      // Running jobs: set cancelledAt to signal handler
      const updated = await this.surrealFactory.withSystemConnection({}, async (db) => {
        const rows = await db.query<[JobRow[]]>(
          `UPDATE $jobId SET
             cancelledAt = time::now(),
             cancelReason = $reason
           RETURN AFTER`,
          { jobId: id, reason },
        );
        return rows[0]?.[0];
      });

      if (!updated) {
        throw new Error("Failed to retrieve cancelled job");
      }

      // Notify cancellation subscribers (processor will handle the token)
      this.notifyCancellationRequest(id, reason ?? undefined);

      return this.rowToJob(updated);
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
    referenceId?: string;
    reason?: string;
  }): Promise<number> {
    using _lock = await this.writeMutex.acquire();

    const conditions: string[] = ["status IN ['pending', 'running']", "cancelledAt IS NONE"];
    const params: Record<string, unknown> = {};

    if (options.type) {
      conditions.push("type = $type");
      params.type = options.type;
    }
    if (options.referenceType) {
      conditions.push("referenceType = $referenceType");
      params.referenceType = options.referenceType;
    }
    if (options.referenceId !== undefined) {
      conditions.push("referenceId = $referenceId");
      params.referenceId = options.referenceId;
    }

    // Return undefined (not null) to map to SurrealDB NONE instead of NULL
    // SurrealDB's option<string> accepts NONE but not NULL
    const reason = options.reason ?? undefined;

    // Find all matching jobs first
    const rows = await this.surrealFactory.withSystemConnection({}, async (db) => {
      return await db.query<[JobRow[]]>(
        `SELECT * FROM job WHERE ${conditions.join(" AND ")}`,
        params,
      );
    });

    let cancelledCount = 0;

    for (const row of rows[0] ?? []) {
      const job = await this.rowToJob(row);

      if (job.status === "pending") {
        // Cancel pending jobs immediately
        const updated = await this.surrealFactory.withSystemConnection({}, async (db) => {
          const result = await db.query<[JobRow[]]>(
            `UPDATE $jobId SET
               status = 'cancelled',
               cancelledAt = time::now(),
               cancelReason = $reason,
               completedAt = time::now()
             RETURN AFTER`,
            { jobId: job.id, reason },
          );
          return result[0]?.[0];
        });

        if (updated) {
          const cancelled = await this.rowToJob(updated);
          await this.notifyCompletionAndDelete(cancelled, "cancelled");
        }
        cancelledCount++;
      } else {
        // For running jobs, set cancelledAt and notify
        await this.surrealFactory.withSystemConnection({}, async (db) => {
          await db.query(
            `UPDATE $jobId SET
               cancelledAt = time::now(),
               cancelReason = $reason`,
            { jobId: job.id, reason },
          );
        });

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
   * @param id - Job ID to check (RecordId)
   * @returns Cancellation info if requested, null otherwise
   */
  async getCancellationStatus(id: RecordId): Promise<{ cancelledAt: Date; reason?: string } | null> {
    const row = await this.surrealFactory.withSystemConnection({}, async (db) => {
      const result = await db.query<[{ cancelledAt: unknown | null; cancelReason: string | null } | undefined]>(
        `RETURN $jobId.{ cancelledAt, cancelReason }`,
        { jobId: id },
      );
      return result[0];
    });

    if (!row || !row.cancelledAt) {
      return null;
    }

    return {
      cancelledAt: toDate(row.cancelledAt),
      reason: row.cancelReason ?? undefined,
    };
  }

  /**
   * Mark a running job as cancelled (final state).
   * Called by processor when handler finishes after cancellation was requested.
   * Notifies all completion subscribers and deletes the job from the database.
   *
   * @param id - Job ID (RecordId)
   * @param reason - Optional reason (uses existing cancelReason if not provided)
   * @returns The cancelled job (note: job is deleted after this returns)
   * @throws {JobNotFoundError} If job doesn't exist
   */
  async markJobCancelled(id: RecordId, reason?: string): Promise<Job> {
    using _lock = await this.writeMutex.acquire();

    const job = await this.getJobInternal(id);
    if (!job) {
      throw new JobNotFoundError(id);
    }

    // Use provided reason or existing reason
    // Return undefined (not null) to map to SurrealDB NONE instead of NULL
    const cancelReason = reason ?? job.cancelReason ?? undefined;

    const updated = await this.surrealFactory.withSystemConnection({}, async (db) => {
      const rows = await db.query<[JobRow[]]>(
        `UPDATE $jobId SET
           status = 'cancelled',
           cancelledAt = cancelledAt ?? time::now(),
           cancelReason = $cancelReason,
           completedAt = time::now()
         RETURN AFTER`,
        { jobId: id, cancelReason },
      );
      return rows[0]?.[0];
    });

    if (!updated) {
      throw new Error("Failed to retrieve cancelled job");
    }

    const cancelled = await this.rowToJob(updated);

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
   * @param jobId - Job ID to subscribe to (RecordId)
   * @param subscriber - Callback function
   * @returns Unsubscribe function
   */
  subscribeToCompletion(jobId: RecordId, subscriber: JobCompletionSubscriber): () => void {
    const key = recordIdToString(jobId);
    const subscribers = this.completionSubscribers.get(key) ?? [];
    subscribers.push(subscriber);
    this.completionSubscribers.set(key, subscribers);

    return () => {
      const current = this.completionSubscribers.get(key);
      if (current) {
        const index = current.indexOf(subscriber);
        if (index !== -1) {
          current.splice(index, 1);
        }
        if (current.length === 0) {
          this.completionSubscribers.delete(key);
        }
      }
    };
  }

  /**
   * Subscribe to cancellation request events for a specific job.
   * Subscriber will be called when cancelJob() is called on a running job.
   *
   * @param jobId - Job ID to subscribe to (RecordId)
   * @param subscriber - Callback function
   * @returns Unsubscribe function
   */
  subscribeToCancellation(jobId: RecordId, subscriber: JobCancellationSubscriber): () => void {
    const key = recordIdToString(jobId);
    const subscribers = this.cancellationSubscribers.get(key) ?? [];
    subscribers.push(subscriber);
    this.cancellationSubscribers.set(key, subscribers);

    return () => {
      const current = this.cancellationSubscribers.get(key);
      if (current) {
        const index = current.indexOf(subscriber);
        if (index !== -1) {
          current.splice(index, 1);
        }
        if (current.length === 0) {
          this.cancellationSubscribers.delete(key);
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
    const rows = await this.surrealFactory.withSystemConnection({}, async (db) => {
      return await db.query<[{ status: string; count: number }[]]>(
        `SELECT status, count() AS count FROM job GROUP BY status`,
      );
    });

    const counts: Record<JobStatus, number> = {
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    };

    for (const row of rows[0] ?? []) {
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
    const key = recordIdToString(job.id);
    const subscribers = this.completionSubscribers.get(key) ?? [];

    // Notify all subscribers with full job data
    for (const subscriber of subscribers) {
      try {
        await subscriber({ type, job });
      } catch (error) {
        logger.error(`[JobQueue] Completion subscriber error for job ${key}:`, error);
        // Continue notifying other subscribers even if one fails
      }
    }

    // Clean up subscribers
    this.completionSubscribers.delete(key);
    this.cancellationSubscribers.delete(key);

    // Publish global completion event for processor wake-up (fire-and-forget)
    this.eventBus?.publish(EventType.JOB_COMPLETED, {
      jobId: job.id,
      type: job.type,
      status: type,
    });

    // Delete the job from the database
    await this.surrealFactory.withSystemConnection({}, async (db) => {
      await db.query(`DELETE $jobId`, { jobId: job.id });
    });
    logger.debug(`[JobQueue] Deleted job ${key} after ${type}`);
  }

  /**
   * Notify cancellation subscribers when a cancellation is requested.
   * Called by cancelJob() for running jobs.
   *
   * @param jobId - The job ID being cancelled (RecordId)
   * @param reason - Optional cancellation reason
   */
  private notifyCancellationRequest(jobId: RecordId, reason?: string): void {
    const key = recordIdToString(jobId);
    const subscribers = this.cancellationSubscribers.get(key) ?? [];

    for (const subscriber of subscribers) {
      try {
        // Fire-and-forget for cancellation notifications
        const result = subscriber({ jobId, reason });
        if (result instanceof Promise) {
          result.catch((error) => {
            logger.error(`[JobQueue] Cancellation subscriber error for job ${key}:`, error);
          });
        }
      } catch (error) {
        logger.error(`[JobQueue] Cancellation subscriber error for job ${key}:`, error);
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
        // If parsing fails, return null for type safety
        globalThis.console.error(
          `[JobQueue] Failed to parse result JSON for job ${recordIdToString(row.id)}, returning null`,
        );
        result = null;
      }
    }

    return {
      id: row.id,
      type: row.type,
      status: row.status as JobStatus,
      executionMode: row.executionMode as ExecutionMode,
      payload,
      result,
      processInstanceId: row.processInstanceId ?? null,
      retryCount: row.retryCount,
      maxRetries: row.maxRetries,
      priority: row.priority,
      referenceType: row.referenceType ?? null,
      referenceId: row.referenceId ?? null,
      createdAt: toDate(row.createdAt),
      startedAt: row.startedAt ? toDate(row.startedAt) : null,
      completedAt: row.completedAt ? toDate(row.completedAt) : null,
      cancelledAt: row.cancelledAt ? toDate(row.cancelledAt) : null,
      cancelReason: row.cancelReason ?? null,
    };
  }

  /**
   * Serialize and optionally encrypt payload.
   */
  private async serializePayload(payload: unknown): Promise<string | null | undefined> {
    if (payload === undefined || payload === null) {
      // Return undefined (not null) to map to SurrealDB NONE instead of NULL
      // SurrealDB's option<string> accepts NONE but not NULL
      return undefined;
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
      // If parsing fails, return null for type safety
      globalThis.console.error(
        "[JobQueue] Failed to parse payload JSON, returning null",
      );
      return null;
    }
  }
}
