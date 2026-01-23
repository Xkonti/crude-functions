import type { DatabaseService } from "../database/database_service.ts";
import type { InstanceIdService } from "../instance/instance_id_service.ts";
import type { IEncryptionService } from "../encryption/types.ts";
import type { EventBus } from "../events/mod.ts";

/**
 * Job status enum.
 *
 * State transitions:
 * - pending -> running (when claimed by processor)
 * - running -> completed (on success)
 * - running -> failed (on error)
 * - running -> cancelled (when cancelled mid-execution or pre-cancelled)
 * - running -> pending (on orphan recovery, increments retryCount)
 */
export type JobStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

/**
 * Execution mode determines how reference uniqueness is handled.
 *
 * - sequential (default): Enforces unique constraint on active jobs per reference.
 *   Only one pending/running job allowed per referenceType+referenceId combination.
 * - concurrent: Allows multiple active jobs for the same reference.
 *   Useful when you want to run multiple jobs for the same entity in parallel.
 */
export type ExecutionMode = "sequential" | "concurrent";

/**
 * Cancellation token passed to job handlers.
 *
 * Allows handlers to detect when a job has been requested for cancellation
 * and respond gracefully (e.g., save progress, clean up resources).
 *
 * Cancellation is detected via event subscription - when cancelJob() is called,
 * the token is notified immediately.
 */
export interface CancellationToken {
  /** Whether cancellation has been requested */
  readonly isCancelled: boolean;
  /** Promise that resolves when cancellation is requested */
  readonly whenCancelled: Promise<void>;
  /** Throws JobCancellationError if cancellation was requested */
  throwIfCancelled(): void;
}

/**
 * Represents a job in the queue with all metadata.
 *
 * @template TPayload - Type of the job payload (defaults to unknown for backwards compatibility)
 * @template TResult - Type of the job result (defaults to unknown for backwards compatibility)
 */
export interface Job<TPayload = unknown, TResult = unknown> {
  /** Unique job identifier */
  id: number;
  /** Job type - used to dispatch to correct handler */
  type: string;
  /** Current job status */
  status: JobStatus;
  /** Execution mode - sequential (default) or concurrent */
  executionMode: ExecutionMode;
  /** JSON payload (decrypted if encryption is enabled) */
  payload: TPayload | null;
  /** JSON result from execution (error details on failure) */
  result: TResult | null;
  /** Instance ID of the process that claimed this job */
  processInstanceId: string | null;
  /** Number of times this job has been retried (orphan recovery) */
  retryCount: number;
  /** Maximum retry attempts allowed (default: 1 for orphan recovery) */
  maxRetries: number;
  /** Processing priority (higher = processed first) */
  priority: number;
  /** Type of entity this job references (e.g., "code_source", "file") */
  referenceType: string | null;
  /** ID of the referenced entity */
  referenceId: number | null;
  /** When the job was created */
  createdAt: Date;
  /** When the job started processing (null if pending) */
  startedAt: Date | null;
  /** When the job completed or failed (null if pending/running) */
  completedAt: Date | null;
  /** When cancellation was requested (null if not cancelled) */
  cancelledAt: Date | null;
  /** Human-readable reason for cancellation (null if not cancelled) */
  cancelReason: string | null;
}

/**
 * Input for creating a new job.
 * System fields (id, status, processInstanceId, retryCount, timestamps) are auto-generated.
 *
 * @template TPayload - Type of the job payload (defaults to unknown for backwards compatibility)
 */
export interface NewJob<TPayload = unknown> {
  /** Job type - used to dispatch to correct handler */
  type: string;
  /** Payload data (will be JSON serialized) */
  payload?: TPayload;
  /** Maximum retry attempts (default: 1) */
  maxRetries?: number;
  /** Processing priority (default: 0, higher = processed first) */
  priority?: number;
  /** Type of entity this job references */
  referenceType?: string;
  /** ID of the referenced entity */
  referenceId?: number;
  /**
   * Execution mode (default: 'sequential').
   * - sequential: Enforces unique constraint on active jobs per reference.
   * - concurrent: Allows multiple active jobs for the same reference.
   */
  executionMode?: ExecutionMode;
}

/**
 * Job handler function signature.
 *
 * Handlers can be either synchronous or asynchronous.
 * For sync handlers, the return value is automatically wrapped in a resolved Promise.
 *
 * @template TPayload - Type of the job payload (defaults to unknown for backwards compatibility)
 * @template TResult - Type of the job result (defaults to unknown for backwards compatibility)
 * @param job - The job being processed (includes payload)
 * @param cancellationToken - Token to check for cancellation requests
 * @returns Result data on success, or throws on failure
 */
export type JobHandler<TPayload = unknown, TResult = unknown> = (
  job: Job<TPayload, TResult>,
  cancellationToken: CancellationToken,
) => TResult | Promise<TResult>;

/**
 * Configuration for JobProcessorService.
 */
export interface JobProcessorConfig {
  /** Polling interval in seconds (default: 5) */
  pollingIntervalSeconds: number;
  /** Timeout for graceful shutdown in ms (default: 60000) */
  shutdownTimeoutMs?: number;
}

/**
 * Options for JobQueueService constructor.
 */
export interface JobQueueServiceOptions {
  /** Database service instance */
  db: DatabaseService;
  /** Instance ID service for tracking process ownership */
  instanceIdService: InstanceIdService;
  /** Optional encryption service for sensitive payloads */
  encryptionService?: IEncryptionService;
  /** Optional event bus for publishing job events */
  eventBus?: EventBus;
}

/**
 * Options for JobProcessorService constructor.
 */
export interface JobProcessorServiceOptions {
  /** Job queue service for job operations */
  jobQueueService: JobQueueService;
  /** Instance ID service for claiming jobs */
  instanceIdService: InstanceIdService;
  /** Processing configuration */
  config: JobProcessorConfig;
  /** Optional event bus for subscribing to job events */
  eventBus?: EventBus;
}

/**
 * Database row type for job queries.
 */
export interface JobRow {
  [key: string]: unknown; // Index signature for Row compatibility
  id: number;
  type: string;
  status: string;
  executionMode: string;
  payload: string | null;
  result: string | null;
  processInstanceId: string | null;
  retryCount: number;
  maxRetries: number;
  priority: number;
  referenceType: string | null;
  referenceId: number | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
}

// ============== Job Event Types ==============

/**
 * Type of job completion event.
 */
export type JobCompletionType = "completed" | "failed" | "cancelled";

/**
 * Event emitted when a job reaches a terminal state.
 * Subscribers receive the full job data before the job is deleted from the database.
 *
 * @template TPayload - Type of the job payload (defaults to unknown for backwards compatibility)
 * @template TResult - Type of the job result (defaults to unknown for backwards compatibility)
 */
export interface JobCompletionEvent<TPayload = unknown, TResult = unknown> {
  /** The type of completion */
  type: JobCompletionType;
  /** Full job data including result/error */
  job: Job<TPayload, TResult>;
}

/**
 * Subscriber callback for job completion events.
 *
 * @template TPayload - Type of the job payload (defaults to unknown for backwards compatibility)
 * @template TResult - Type of the job result (defaults to unknown for backwards compatibility)
 */
export type JobCompletionSubscriber<TPayload = unknown, TResult = unknown> = (
  event: JobCompletionEvent<TPayload, TResult>,
) => void | Promise<void>;

/**
 * Event emitted when a cancellation is requested for a running job.
 */
export interface JobCancellationRequestEvent {
  /** The job ID being cancelled */
  jobId: number;
  /** Optional reason for cancellation */
  reason?: string;
}

/**
 * Subscriber callback for job cancellation request events.
 */
export type JobCancellationSubscriber = (event: JobCancellationRequestEvent) => void | Promise<void>;

// Forward declaration to avoid circular imports
// The actual class is in job_queue_service.ts
import type { JobQueueService } from "./job_queue_service.ts";
export type { JobQueueService };
