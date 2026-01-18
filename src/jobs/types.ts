import type { DatabaseService } from "../database/database_service.ts";
import type { InstanceIdService } from "../instance/instance_id_service.ts";
import type { IEncryptionService } from "../encryption/types.ts";

/**
 * Job status enum.
 *
 * State transitions:
 * - pending -> running (when claimed by processor)
 * - running -> completed (on success)
 * - running -> failed (on error)
 * - running -> pending (on orphan recovery, increments retryCount)
 */
export type JobStatus = "pending" | "running" | "completed" | "failed";

/**
 * Represents a job in the queue with all metadata.
 */
export interface Job {
  /** Unique job identifier */
  id: number;
  /** Job type - used to dispatch to correct handler */
  type: string;
  /** Current job status */
  status: JobStatus;
  /** JSON payload (decrypted if encryption is enabled) */
  payload: unknown | null;
  /** JSON result from execution (error details on failure) */
  result: unknown | null;
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
}

/**
 * Input for creating a new job.
 * System fields (id, status, processInstanceId, retryCount, timestamps) are auto-generated.
 */
export interface NewJob {
  /** Job type - used to dispatch to correct handler */
  type: string;
  /** Payload data (will be JSON serialized) */
  payload?: unknown;
  /** Maximum retry attempts (default: 1) */
  maxRetries?: number;
  /** Processing priority (default: 0, higher = processed first) */
  priority?: number;
  /** Type of entity this job references */
  referenceType?: string;
  /** ID of the referenced entity */
  referenceId?: number;
}

/**
 * Job handler function signature.
 *
 * @param job - The job being processed (includes payload)
 * @returns Result data on success, or throws on failure
 */
export type JobHandler = (job: Job) => Promise<unknown>;

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
}

/**
 * Database row type for job queries.
 */
export interface JobRow {
  [key: string]: unknown; // Index signature for Row compatibility
  id: number;
  type: string;
  status: string;
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
}

// Forward declaration to avoid circular imports
// The actual class is in job_queue_service.ts
import type { JobQueueService } from "./job_queue_service.ts";
export type { JobQueueService };
