/**
 * Job Queue Module
 *
 * Provides background job processing capabilities:
 * - Priority-based job queue with SurrealDB persistence
 * - Orphan detection for crashed containers
 * - Optional payload encryption
 * - Cancellation support with tokens
 * - Sequential and concurrent execution modes
 */

// Service classes
export { JobQueueService } from "./job_queue_service.ts";
export { JobProcessorService } from "./job_processor_service.ts";

// Cancellation
export { CancellationTokenImpl } from "./cancellation_token.ts";

// Errors
export {
  JobQueueError,
  JobNotFoundError,
  JobAlreadyClaimedError,
  DuplicateActiveJobError,
  NoHandlerError,
  MaxRetriesExceededError,
  JobCancellationError,
  JobNotCancellableError,
} from "./errors.ts";

// Types
export type {
  Job,
  NewJob,
  JobStatus,
  ExecutionMode,
  CancellationToken,
  JobHandler,
  JobProcessorConfig,
  JobQueueServiceOptions,
  JobProcessorServiceOptions,
  JobRow,
} from "./types.ts";
