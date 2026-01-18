import { Mutex } from "@core/asyncutil/mutex";
import type { DatabaseService } from "../database/database_service.ts";
import type { InstanceIdService } from "../instance/instance_id_service.ts";
import type { IEncryptionService } from "../encryption/types.ts";
import type {
  Job,
  NewJob,
  JobStatus,
  JobQueueServiceOptions,
  JobRow,
} from "./types.ts";
import {
  JobNotFoundError,
  JobAlreadyClaimedError,
  DuplicateActiveJobError,
  MaxRetriesExceededError,
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

  constructor(options: JobQueueServiceOptions) {
    this.db = options.db;
    this.instanceIdService = options.instanceIdService;
    this.encryptionService = options.encryptionService;
  }

  // ============== Enqueue Operations ==============

  /**
   * Enqueue a new job for processing.
   *
   * If referenceType and referenceId are provided, enforces unique constraint:
   * only one active (pending/running) job per reference is allowed.
   *
   * @param job - Job data to enqueue
   * @returns The created job with assigned ID
   * @throws {DuplicateActiveJobError} If an active job exists for the same reference
   */
  async enqueue(job: NewJob): Promise<Job> {
    using _lock = await this.writeMutex.acquire();

    // Check for existing active job if reference is provided
    if (job.referenceType && job.referenceId) {
      const existing = await this.db.queryOne<{ id: number }>(
        `SELECT id FROM jobQueue
         WHERE referenceType = ? AND referenceId = ?
         AND status IN ('pending', 'running')`,
        [job.referenceType, job.referenceId],
      );

      if (existing) {
        throw new DuplicateActiveJobError(job.referenceType, job.referenceId);
      }
    }

    // Serialize payload (with optional encryption)
    const payloadStr = await this.serializePayload(job.payload);

    const result = await this.db.execute(
      `INSERT INTO jobQueue (type, status, payload, maxRetries, priority,
                             referenceType, referenceId, createdAt)
       VALUES (?, 'pending', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        job.type,
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
    return this.getJobInternal(id);
  }

  /**
   * Internal method to get a job by ID (used by both public and internal methods).
   */
  private async getJobInternal(id: number): Promise<Job | null> {
    const row = await this.db.queryOne<JobRow>(
      `SELECT id, type, status, payload, result, processInstanceId,
              retryCount, maxRetries, priority, referenceType, referenceId,
              createdAt, startedAt, completedAt
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
      `SELECT id, type, status, payload, result, processInstanceId,
              retryCount, maxRetries, priority, referenceType, referenceId,
              createdAt, startedAt, completedAt
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
    let sql = `SELECT id, type, status, payload, result, processInstanceId,
                      retryCount, maxRetries, priority, referenceType, referenceId,
                      createdAt, startedAt, completedAt
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
      `SELECT id, type, status, payload, result, processInstanceId,
              retryCount, maxRetries, priority, referenceType, referenceId,
              createdAt, startedAt, completedAt
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
   *
   * @param type - Optional job type filter
   * @returns The next job to process, or null if queue is empty
   */
  async getNextPendingJob(type?: string): Promise<Job | null> {
    let sql = `SELECT id, type, status, payload, result, processInstanceId,
                      retryCount, maxRetries, priority, referenceType, referenceId,
                      createdAt, startedAt, completedAt
               FROM jobQueue
               WHERE status = 'pending'`;
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
   *
   * @param id - Job ID
   * @param result - Result data (will be JSON serialized)
   * @returns The completed job
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
    return completed;
  }

  /**
   * Mark a job as failed with error details.
   *
   * @param id - Job ID
   * @param error - Error details (will be JSON serialized)
   * @returns The failed job
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
      `SELECT id, type, status, payload, result, processInstanceId,
              retryCount, maxRetries, priority, referenceType, referenceId,
              createdAt, startedAt, completedAt
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

  // ============== Cleanup Operations ==============

  /**
   * Delete completed/failed jobs older than the specified date.
   * Does not delete pending or running jobs.
   *
   * @param olderThan - Cutoff date
   * @returns Number of jobs deleted
   */
  async deleteOldJobs(olderThan: Date): Promise<number> {
    using _lock = await this.writeMutex.acquire();

    const cutoff = olderThan.toISOString();

    const result = await this.db.execute(
      `DELETE FROM jobQueue
       WHERE status IN ('completed', 'failed')
       AND completedAt < ?`,
      [cutoff],
    );

    return result.changes;
  }

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
