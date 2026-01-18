/**
 * Type definitions for the scheduling service.
 *
 * The scheduling service supports three schedule types:
 * - one-off: Runs once at a specific datetime
 * - interval: Runs every N seconds
 * - dynamic: Next run determined by callback after each execution
 *
 * And two storage modes:
 * - persisted: Stored in database, survives restarts
 * - in-memory: Lost on restart, re-registered at startup
 */

/**
 * Schedule type determines how the next run time is calculated.
 */
export type ScheduleType = "one-off" | "interval" | "dynamic";

/**
 * Task status tracks the current state of a scheduled task.
 */
export type TaskStatus = "idle" | "running" | "disabled";

/**
 * Storage mode determines whether tasks survive restarts.
 */
export type StorageMode = "persisted" | "in-memory";

/**
 * Represents a scheduled task with all its configuration and state.
 */
export interface ScheduledTask {
  /** Database ID (null for in-memory tasks) */
  id: number | null;
  /** Unique task name (e.g., 'git-sync:source-1', 'log-trimming') */
  name: string;
  /** Task type for handler dispatch (e.g., 'git-sync', 'cleanup') */
  type: string;
  /** How the schedule is calculated */
  scheduleType: ScheduleType;
  /** Where the task is stored */
  storageMode: StorageMode;
  /** Interval in seconds (for 'interval' type) */
  intervalSeconds: number | null;
  /** Specific datetime for one-off tasks */
  scheduledAt: Date | null;
  /** Whether this task is enabled */
  enabled: boolean;
  /** JSON payload for the task handler */
  payload: unknown | null;
  /** Last successful execution timestamp */
  lastRunAt: Date | null;
  /** Next scheduled execution timestamp */
  nextRunAt: Date | null;
  /** Last error message (null if last run succeeded) */
  lastError: string | null;
  /** Count of consecutive failures (reset on success) */
  consecutiveFailures: number;
  /** Current status */
  status: TaskStatus;
  /** When status became 'running' (for stuck task detection) */
  runStartedAt: Date | null;
}

/**
 * Result returned by a task handler after execution.
 */
export interface TaskExecutionResult {
  /** Whether the execution succeeded */
  success: boolean;
  /** Optional result data */
  result?: unknown;
  /** Error message if success is false */
  error?: string;
  /** Override for dynamic tasks - when to run next */
  nextRunAt?: Date | null;
}

/**
 * Handler function that executes the actual task work.
 *
 * @param task - The task being executed
 * @param signal - AbortSignal for graceful cancellation
 * @returns Result of the execution
 */
export type TaskHandler = (
  task: ScheduledTask,
  signal: AbortSignal,
) => Promise<TaskExecutionResult> | TaskExecutionResult;

/**
 * Configuration for a task handler.
 */
export interface TaskHandlerConfig {
  /** The function that performs the task work */
  handler: TaskHandler;
  /** Optional pre-execution check - return false to skip this run */
  shouldRun?: (task: ScheduledTask) => Promise<boolean> | boolean;
  /** Max consecutive failures before disabling (default: 5) */
  maxConsecutiveFailures?: number;
  /** Execution timeout in milliseconds (default: from settings) */
  timeoutMs?: number;
}

/**
 * Options for registering a persisted task.
 */
export interface RegisterPersistedTaskOptions {
  /** Unique task name */
  name: string;
  /** Task type for handler dispatch */
  type: string;
  /** Schedule type */
  scheduleType: ScheduleType;
  /** Interval in seconds (required for 'interval' type) */
  intervalSeconds?: number;
  /** Specific datetime (required for 'one-off' type) */
  scheduledAt?: Date;
  /** Optional payload data */
  payload?: unknown;
  /** Whether to run immediately after registration */
  runImmediately?: boolean;
}

/**
 * Options for registering an in-memory task.
 */
export interface RegisterInMemoryTaskOptions {
  /** Unique task name */
  name: string;
  /** Task type for handler dispatch */
  type: string;
  /** Schedule type */
  scheduleType: ScheduleType;
  /** Interval in seconds (required for 'interval' type) */
  intervalSeconds?: number;
  /** Specific datetime (required for 'one-off' type) */
  scheduledAt?: Date;
  /** Optional payload data */
  payload?: unknown;
  /** Whether to run immediately after registration */
  runImmediately?: boolean;
}

/**
 * Options for updating a task's schedule.
 */
export interface UpdateTaskScheduleOptions {
  /** New interval in seconds (for interval tasks) */
  intervalSeconds?: number;
  /** New scheduled datetime (for one-off tasks) */
  scheduledAt?: Date;
  /** Whether to run immediately after updating */
  runImmediately?: boolean;
}

/**
 * Service status information.
 */
export interface SchedulingServiceStatus {
  /** Whether the service is running */
  isRunning: boolean;
  /** Number of registered handlers */
  handlerCount: number;
  /** Number of in-memory tasks */
  inMemoryTaskCount: number;
  /** Number of persisted tasks */
  persistedTaskCount: number;
  /** Number of currently running tasks */
  runningTaskCount: number;
}

/**
 * Database row for scheduled tasks.
 */
export interface ScheduledTaskRow {
  [key: string]: unknown; // Index signature for Row compatibility
  id: number;
  name: string;
  type: string;
  scheduleType: string;
  intervalSeconds: number | null;
  scheduledAt: string | null;
  enabled: number;
  payload: string | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  processInstanceId: string | null;
  status: string;
  runStartedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Options for the scheduling service.
 */
export interface SchedulingServiceOptions {
  /** Database service for persisted tasks */
  db: import("../database/database_service.ts").DatabaseService;
  /** Instance ID service for orphan detection */
  instanceIdService: import("../instance/instance_id_service.ts").InstanceIdService;
  /** Polling interval in seconds (default: 1) */
  pollingIntervalSeconds?: number;
  /** Default timeout for task execution in milliseconds (default: 300000) */
  defaultTimeoutMs?: number;
  /** Timeout for detecting stuck tasks in milliseconds (default: 3600000) */
  stuckTaskTimeoutMs?: number;
}
