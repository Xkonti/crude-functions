import type { DatabaseService } from "../database/database_service.ts";
import type { JobQueueService } from "../jobs/job_queue_service.ts";
import type { ExecutionMode } from "../jobs/types.ts";

/**
 * Schedule type determines execution behavior.
 *
 * - one_off: Execute once at specified time, then mark completed
 * - dynamic: After job completes, handler returns next time via result
 * - sequential_interval: Wait for job completion, then schedule next after intervalMs
 * - concurrent_interval: Enqueue at every interval regardless of running jobs
 */
export type ScheduleType =
  | "one_off"
  | "dynamic"
  | "sequential_interval"
  | "concurrent_interval";

/**
 * Schedule status.
 *
 * - active: Schedule is enabled and will trigger
 * - paused: Schedule is disabled, will not trigger until resumed
 * - completed: One-off schedule that has executed (or cancelled)
 * - error: Schedule encountered too many failures
 */
export type ScheduleStatus = "active" | "paused" | "completed" | "error";

/**
 * Type guard for ScheduleType values.
 * Used for runtime validation of database values.
 */
export function isScheduleType(type: string): type is ScheduleType {
  return ["one_off", "dynamic", "sequential_interval", "concurrent_interval"].includes(type);
}

/**
 * Type guard for ScheduleStatus values.
 * Used for runtime validation of database values.
 */
export function isScheduleStatus(status: string): status is ScheduleStatus {
  return ["active", "paused", "completed", "error"].includes(status);
}

/**
 * A schedule definition.
 */
export interface Schedule {
  /** Unique schedule identifier */
  id: number;
  /** Unique schedule name (used as API identifier) */
  name: string;
  /** Human-readable description */
  description: string | null;
  /** Schedule type */
  type: ScheduleType;
  /** Current status */
  status: ScheduleStatus;
  /** Whether schedule survives restart */
  isPersistent: boolean;
  /** Next scheduled execution time (null if paused/completed) */
  nextRunAt: Date | null;
  /** Interval in milliseconds (for interval types) */
  intervalMs: number | null;
  /** Job type to enqueue when triggered */
  jobType: string;
  /** Job payload (decrypted) */
  jobPayload: unknown;
  /** Job priority */
  jobPriority: number;
  /** Job max retries */
  jobMaxRetries: number;
  /** Job execution mode */
  jobExecutionMode: ExecutionMode;
  /** Job reference type for duplicate detection */
  jobReferenceType: string | null;
  /** Job reference ID */
  jobReferenceId: number | null;
  /** Currently active job ID (for tracking completion) */
  activeJobId: number | null;
  /** Consecutive failure count */
  consecutiveFailures: number;
  /** Max failures before error state */
  maxConsecutiveFailures: number;
  /** Error message if status is 'error' */
  lastError: string | null;
  /** When schedule was created */
  createdAt: Date;
  /** When schedule was last updated */
  updatedAt: Date;
  /** When schedule last triggered */
  lastTriggeredAt: Date | null;
  /** When a job last completed */
  lastCompletedAt: Date | null;
}

/**
 * Input for creating a new schedule.
 */
export interface NewSchedule {
  /** Unique name for the schedule */
  name: string;
  /** Optional description */
  description?: string;
  /** Schedule type */
  type: ScheduleType;
  /** Whether schedule survives restart (default: true) */
  isPersistent?: boolean;
  /**
   * When to first execute.
   * - For one_off: Required, the single execution time
   * - For dynamic: Required, first execution time
   * - For interval types: Optional, defaults to now + intervalMs
   */
  nextRunAt?: Date;
  /**
   * Interval in milliseconds.
   * Required for sequential_interval and concurrent_interval.
   * Ignored for one_off and dynamic.
   */
  intervalMs?: number;
  /** Job type to enqueue */
  jobType: string;
  /** Job payload (optional) */
  jobPayload?: unknown;
  /** Job priority (default: 0) */
  jobPriority?: number;
  /** Job max retries (default: 1) */
  jobMaxRetries?: number;
  /** Job execution mode (default: sequential) */
  jobExecutionMode?: ExecutionMode;
  /** Job reference type for duplicate detection */
  jobReferenceType?: string;
  /** Job reference ID for duplicate detection */
  jobReferenceId?: number;
  /** Max consecutive failures before error state (default: 5) */
  maxConsecutiveFailures?: number;
}

/**
 * Options for cancelling a schedule.
 */
export interface CancelScheduleOptions {
  /** Also cancel any currently running job (default: false) */
  cancelRunningJob?: boolean;
  /** Reason for cancellation */
  reason?: string;
}

/**
 * Input for updating an existing schedule.
 * All fields are optional - only provided fields are updated.
 */
export interface ScheduleUpdate {
  description?: string | null;
  intervalMs?: number;
  jobPayload?: unknown;
  nextRunAt?: Date | null;
  jobPriority?: number;
  jobMaxRetries?: number;
  maxConsecutiveFailures?: number;
}

/**
 * Options for updating a schedule.
 */
export interface UpdateScheduleOptions {
  /**
   * How to handle nextRunAt when intervalMs changes.
   * - 'reset': Set to now + newIntervalMs (default)
   * - 'preserve': Keep existing nextRunAt
   * - 'explicit': Use the nextRunAt provided in update
   */
  nextRunAtBehavior?: "reset" | "preserve" | "explicit";
}

/**
 * Result from a dynamic schedule handler indicating next execution.
 * Handlers return this via job result.
 */
export interface DynamicScheduleResult {
  /** Next execution time. If null, schedule is completed. */
  nextRunAt: Date | null;
  /** Optional: any other result data */
  [key: string]: unknown;
}

/**
 * Configuration for SchedulingService.
 */
export interface SchedulingServiceConfig {
  /**
   * Minimum time between timeout recalculations (ms).
   * Prevents excessive timer churn if many schedules change rapidly.
   * Default: 100
   */
  minRecalculationIntervalMs?: number;
  /**
   * Maximum time to wait for a single timeout (ms).
   * Prevents issues with very large setTimeout values.
   * Default: 2147483647 (max 32-bit signed int, ~24.8 days)
   */
  maxTimeoutMs?: number;
}

/**
 * Options for SchedulingService constructor.
 */
export interface SchedulingServiceOptions {
  /** Database service instance */
  db: DatabaseService;
  /** Job queue service for creating jobs */
  jobQueueService: JobQueueService;
  /** Service configuration */
  config?: SchedulingServiceConfig;
}

/**
 * Database row type for schedule queries.
 */
export interface ScheduleRow {
  [key: string]: unknown; // Index signature for Row compatibility
  id: number;
  name: string;
  description: string | null;
  type: string;
  status: string;
  isPersistent: number;
  nextRunAt: string | null;
  intervalMs: number | null;
  jobType: string;
  jobPayload: string | null;
  jobPriority: number;
  jobMaxRetries: number;
  jobExecutionMode: string;
  jobReferenceType: string | null;
  jobReferenceId: number | null;
  activeJobId: number | null;
  consecutiveFailures: number;
  maxConsecutiveFailures: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  lastTriggeredAt: string | null;
  lastCompletedAt: string | null;
}
