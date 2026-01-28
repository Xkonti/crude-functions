import type { RecordId } from "surrealdb";
import { recordIdToString } from "../database/surreal_helpers.ts";

/**
 * Helper to convert job ID to string for error messages.
 */
function jobIdToStr(jobId: RecordId | string): string {
  return typeof jobId === "string" ? jobId : recordIdToString(jobId);
}

/**
 * Base error class for job queue-related errors.
 */
export class JobQueueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JobQueueError";
  }
}

/**
 * Thrown when a job is not found by ID.
 */
export class JobNotFoundError extends JobQueueError {
  public readonly jobId: RecordId | string;

  constructor(jobId: RecordId | string) {
    super(`Job with id ${jobIdToStr(jobId)} not found`);
    this.name = "JobNotFoundError";
    this.jobId = jobId;
  }
}

/**
 * Thrown when attempting to claim a job that is already running or completed.
 */
export class JobAlreadyClaimedError extends JobQueueError {
  public readonly jobId: RecordId | string;

  constructor(jobId: RecordId | string) {
    super(`Job ${jobIdToStr(jobId)} is already claimed by another process`);
    this.name = "JobAlreadyClaimedError";
    this.jobId = jobId;
  }
}

/**
 * Thrown when attempting to enqueue a job but an active job
 * already exists for the same reference (type + id).
 */
export class DuplicateActiveJobError extends JobQueueError {
  public readonly referenceType: string;
  public readonly referenceId: string;

  constructor(referenceType: string, referenceId: string) {
    super(
      `An active job already exists for ${referenceType}:${referenceId}. ` +
        `Wait for the existing job to complete or fail before enqueuing a new one.`,
    );
    this.name = "DuplicateActiveJobError";
    this.referenceType = referenceType;
    this.referenceId = referenceId;
  }
}

/**
 * Thrown when no handler is registered for a job type.
 */
export class NoHandlerError extends JobQueueError {
  public readonly jobType: string;

  constructor(jobType: string) {
    super(`No handler registered for job type: ${jobType}`);
    this.name = "NoHandlerError";
    this.jobType = jobType;
  }
}

/**
 * Thrown when a job exceeds its maximum retry count.
 */
export class MaxRetriesExceededError extends JobQueueError {
  public readonly jobId: RecordId | string;
  public readonly retryCount: number;
  public readonly maxRetries: number;

  constructor(jobId: RecordId | string, retryCount: number, maxRetries: number) {
    super(
      `Job ${jobIdToStr(jobId)} has exceeded maximum retries (${retryCount}/${maxRetries})`,
    );
    this.name = "MaxRetriesExceededError";
    this.jobId = jobId;
    this.retryCount = retryCount;
    this.maxRetries = maxRetries;
  }
}

/**
 * Thrown when a handler detects cancellation via the cancellation token.
 * This signals to the processor that the job should be marked as cancelled.
 */
export class JobCancellationError extends JobQueueError {
  public readonly jobId: RecordId | string;
  public readonly reason?: string;

  constructor(jobId: RecordId | string, reason?: string) {
    const idStr = jobIdToStr(jobId);
    super(
      reason
        ? `Job ${idStr} was cancelled: ${reason}`
        : `Job ${idStr} was cancelled`,
    );
    this.name = "JobCancellationError";
    this.jobId = jobId;
    this.reason = reason;
  }
}

/**
 * Thrown when attempting to cancel a job that is already completed, failed, or cancelled.
 */
export class JobNotCancellableError extends JobQueueError {
  public readonly jobId: RecordId | string;
  public readonly currentStatus: string;

  constructor(jobId: RecordId | string, currentStatus: string) {
    super(
      `Job ${jobIdToStr(jobId)} cannot be cancelled: current status is '${currentStatus}'`,
    );
    this.name = "JobNotCancellableError";
    this.jobId = jobId;
    this.currentStatus = currentStatus;
  }
}
