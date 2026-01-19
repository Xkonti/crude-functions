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
  public readonly jobId: number;

  constructor(jobId: number) {
    super(`Job with id ${jobId} not found`);
    this.name = "JobNotFoundError";
    this.jobId = jobId;
  }
}

/**
 * Thrown when attempting to claim a job that is already running or completed.
 */
export class JobAlreadyClaimedError extends JobQueueError {
  public readonly jobId: number;

  constructor(jobId: number) {
    super(`Job ${jobId} is already claimed by another process`);
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
  public readonly referenceId: number;

  constructor(referenceType: string, referenceId: number) {
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
  public readonly jobId: number;
  public readonly retryCount: number;
  public readonly maxRetries: number;

  constructor(jobId: number, retryCount: number, maxRetries: number) {
    super(
      `Job ${jobId} has exceeded maximum retries (${retryCount}/${maxRetries})`,
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
  public readonly jobId: number;
  public readonly reason?: string;

  constructor(jobId: number, reason?: string) {
    super(
      reason
        ? `Job ${jobId} was cancelled: ${reason}`
        : `Job ${jobId} was cancelled`,
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
  public readonly jobId: number;
  public readonly currentStatus: string;

  constructor(jobId: number, currentStatus: string) {
    super(
      `Job ${jobId} cannot be cancelled: current status is '${currentStatus}'`,
    );
    this.name = "JobNotCancellableError";
    this.jobId = jobId;
    this.currentStatus = currentStatus;
  }
}
