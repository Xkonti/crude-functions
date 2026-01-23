import type { JobQueueService } from "./job_queue_service.ts";
import type { InstanceIdService } from "../instance/instance_id_service.ts";
import type {
  Job,
  JobHandler,
  JobProcessorConfig,
  JobProcessorServiceOptions,
} from "./types.ts";
import {
  JobAlreadyClaimedError,
  MaxRetriesExceededError,
  NoHandlerError as _NoHandlerError,
  JobCancellationError,
} from "./errors.ts";
import { CancellationTokenImpl } from "./cancellation_token.ts";
import { logger } from "../utils/logger.ts";
import { type EventBus, EventType } from "../events/mod.ts";

/**
 * Background service for processing jobs from the queue.
 *
 * Follows the established background service pattern:
 * - Uses setInterval() for polling with private timerId
 * - isProcessing flag prevents overlapping runs
 * - stopRequested flag for graceful shutdown
 * - Consecutive failure counter with auto-stop after 5 failures
 * - start() runs immediately then schedules interval
 * - stop() clears interval, waits for in-progress with timeout
 *
 * Job handlers are registered by type. When processing, the service:
 * 1. On startup: detects and handles orphaned jobs
 * 2. Claims the next pending job (highest priority, FIFO)
 * 3. Dispatches to registered handler
 * 4. Marks job as completed or failed based on handler result
 *
 * @example
 * ```typescript
 * const processor = new JobProcessorService({
 *   jobQueueService,
 *   instanceIdService,
 *   config: { pollingIntervalSeconds: 5 },
 * });
 *
 * processor.registerHandler("process-upload", async (job) => {
 *   // Process the job
 *   return { processed: true };
 * });
 *
 * processor.start();
 * // ... later ...
 * await processor.stop();
 * ```
 */
export class JobProcessorService {
  private readonly jobQueueService: JobQueueService;
  private readonly instanceIdService: InstanceIdService;
  private readonly config: JobProcessorConfig;
  private readonly eventBus?: EventBus;
  private readonly handlers = new Map<string, JobHandler>();

  private timerId: number | null = null;
  private isProcessing = false;
  private stopRequested = false;
  private consecutiveFailures = 0;
  private wakeupRequested = false;

  /** Active cancellation tokens for running jobs (job ID -> token) */
  private readonly activeCancellationTokens = new Map<number, CancellationTokenImpl>();
  /** Unsubscribe functions for active cancellation subscriptions */
  private readonly cancellationUnsubscribers = new Map<number, () => void>();
  /** Unsubscribe function for job enqueued events */
  private enqueuedUnsubscribe: (() => void) | null = null;
  /** Unsubscribe function for job completed events */
  private completedUnsubscribe: (() => void) | null = null;

  private static readonly MAX_CONSECUTIVE_FAILURES = 5;
  private static readonly DEFAULT_SHUTDOWN_TIMEOUT_MS = 60000;

  constructor(options: JobProcessorServiceOptions) {
    this.jobQueueService = options.jobQueueService;
    this.instanceIdService = options.instanceIdService;
    this.config = options.config;
    this.eventBus = options.eventBus;
  }

  // ============== Handler Registration ==============

  /**
   * Register a handler for a specific job type.
   *
   * @param type - Job type identifier
   * @param handler - Async function to process jobs of this type
   */
  registerHandler(type: string, handler: JobHandler): void {
    this.handlers.set(type, handler);
    logger.debug(`[JobQueue] Registered handler for job type: ${type}`);
  }

  /**
   * Unregister a handler for a job type.
   *
   * @param type - Job type identifier
   * @returns true if handler was removed, false if not found
   */
  unregisterHandler(type: string): boolean {
    const removed = this.handlers.delete(type);
    if (removed) {
      logger.debug(`[JobQueue] Unregistered handler for job type: ${type}`);
    }
    return removed;
  }

  /**
   * Check if a handler is registered for a job type.
   *
   * @param type - Job type identifier
   */
  hasHandler(type: string): boolean {
    return this.handlers.has(type);
  }

  // ============== Lifecycle ==============

  /**
   * Start the job processor.
   *
   * On startup:
   * 1. Detects and recovers orphaned jobs from crashed instances
   * 2. Processes any pending jobs immediately
   * 3. Schedules polling interval for new jobs
   */
  start(): void {
    if (this.timerId !== null) {
      logger.warn("[JobQueue] Already running");
      return;
    }

    logger.info(
      `[JobQueue] Starting with polling interval ${this.config.pollingIntervalSeconds}s, ` +
        `instance ID: ${this.instanceIdService.getId().slice(0, 8)}...`,
    );

    // Subscribe to job events for immediate wake-up
    if (this.eventBus) {
      this.enqueuedUnsubscribe = this.eventBus.subscribe(EventType.JOB_ENQUEUED, () => {
        this.requestWakeup();
      });
      this.completedUnsubscribe = this.eventBus.subscribe(EventType.JOB_COMPLETED, () => {
        this.requestWakeup();
      });
    }

    // Handle orphaned jobs first, then start processing
    this.handleOrphanedJobs()
      .then(() => this.processLoop())
      .then(() => {
        this.consecutiveFailures = 0;

        if (this.stopRequested) {
          logger.debug("[JobQueue] Stop requested during startup");
          return;
        }

        // Start polling interval for new jobs
        this.timerId = setInterval(() => {
          this.processLoop()
            .then(() => {
              this.consecutiveFailures = 0;
            })
            .catch((error) => {
              this.consecutiveFailures++;
              logger.error(
                `[JobQueue] Processing failed (${this.consecutiveFailures}/${JobProcessorService.MAX_CONSECUTIVE_FAILURES}):`,
                error,
              );

              if (
                this.consecutiveFailures >=
                JobProcessorService.MAX_CONSECUTIVE_FAILURES
              ) {
                logger.error(
                  "[JobQueue] Max consecutive failures reached, stopping service",
                );
                if (this.timerId !== null) {
                  clearInterval(this.timerId);
                  this.timerId = null;
                }
              }
            });
        }, this.config.pollingIntervalSeconds * 1000);
      })
      .catch((error) => {
        logger.error("[JobQueue] Startup failed:", error);
      });
  }

  /**
   * Stop the job processor gracefully.
   *
   * Clears the polling interval,
   * waits for any in-progress job to complete (with configurable timeout),
   * and cleans up active cancellation tokens and subscriptions.
   */
  async stop(): Promise<void> {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }

    this.stopRequested = true;

    const timeoutMs =
      this.config.shutdownTimeoutMs ??
      JobProcessorService.DEFAULT_SHUTDOWN_TIMEOUT_MS;

    // Wait for any in-progress processing to complete with timeout
    const startTime = Date.now();
    while (this.isProcessing) {
      if (Date.now() - startTime > timeoutMs) {
        logger.warn(
          "[JobQueue] Stop timeout exceeded, processing may still be running",
        );
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // Unsubscribe from job events
    this.enqueuedUnsubscribe?.();
    this.enqueuedUnsubscribe = null;
    this.completedUnsubscribe?.();
    this.completedUnsubscribe = null;

    // Clean up any remaining cancellation tokens and subscriptions
    this.activeCancellationTokens.clear();
    for (const unsubscribe of this.cancellationUnsubscribers.values()) {
      unsubscribe();
    }
    this.cancellationUnsubscribers.clear();

    this.stopRequested = false;
    logger.info("[JobQueue] Stopped");
  }

  /**
   * Process one job synchronously (for testing).
   * Does not start the polling loop.
   *
   * @returns The processed job in its final state, or null if queue was empty
   */
  async processOne(): Promise<Job | null> {
    const job = await this.jobQueueService.getNextPendingJob();
    if (!job) {
      return null;
    }

    // Subscribe to capture the final job state before it's deleted
    let finalJob: Job | null = null;
    const unsubscribe = this.jobQueueService.subscribeToCompletion(job.id, (event) => {
      finalJob = event.job;
    });

    try {
      await this.processJob(job);
    } finally {
      unsubscribe();
    }

    return finalJob;
  }

  // ============== Status ==============

  /**
   * Check if the processor is currently running.
   */
  isRunning(): boolean {
    return this.timerId !== null;
  }

  /**
   * Get current processor status for monitoring.
   */
  getStatus(): {
    isRunning: boolean;
    isProcessing: boolean;
    consecutiveFailures: number;
    registeredHandlers: string[];
  } {
    return {
      isRunning: this.timerId !== null,
      isProcessing: this.isProcessing,
      consecutiveFailures: this.consecutiveFailures,
      registeredHandlers: Array.from(this.handlers.keys()),
    };
  }

  // ============== Private Implementation ==============

  /**
   * Request immediate job queue check.
   *
   * Multiple requests are coalesced - if processing is already running,
   * it will re-check after completing current job batch.
   */
  private requestWakeup(): void {
    if (this.isProcessing) {
      // Processing is running - set flag so it re-checks after current batch
      this.wakeupRequested = true;
      logger.debug("[JobQueue] Wakeup requested (will check after current job)");
    } else {
      // Not processing - trigger immediate check
      logger.debug("[JobQueue] Wakeup requested (triggering immediate check)");
      this.processLoop()
        .then(() => {
          this.consecutiveFailures = 0;
        })
        .catch((error) => {
          this.consecutiveFailures++;
          logger.error(
            `[JobQueue] Event-triggered processing failed (${this.consecutiveFailures}/${JobProcessorService.MAX_CONSECUTIVE_FAILURES}):`,
            error,
          );
        });
    }
  }

  /**
   * Main processing loop - called by timer or event trigger.
   */
  private async processLoop(): Promise<void> {
    if (this.isProcessing) {
      logger.debug("[JobQueue] Skipping, already processing");
      return;
    }

    this.isProcessing = true;
    try {
      // Process jobs until queue is empty or stop requested
      // Use do-while to re-check if wakeup was requested during processing
      do {
        this.wakeupRequested = false;

        while (!this.stopRequested) {
          const job = await this.jobQueueService.getNextPendingJob();
          if (!job) {
            break; // Queue empty
          }

          await this.processJob(job);
        }
      } while (this.wakeupRequested && !this.stopRequested);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Handle orphaned jobs from crashed instances.
   * Called once at startup.
   */
  private async handleOrphanedJobs(): Promise<void> {
    const orphanedJobs = await this.jobQueueService.getOrphanedJobs();

    if (orphanedJobs.length === 0) {
      return;
    }

    logger.info(
      `[JobQueue] Found ${orphanedJobs.length} orphaned jobs from crashed instance`,
    );

    for (const job of orphanedJobs) {
      if (this.stopRequested) return;

      try {
        await this.jobQueueService.resetOrphanedJob(job.id);
        logger.info(
          `[JobQueue] Reset orphaned job ${job.id} (type: ${job.type}, ` +
            `retry: ${job.retryCount + 1}/${job.maxRetries})`,
        );
      } catch (error) {
        if (error instanceof MaxRetriesExceededError) {
          // Mark as failed since we can't retry
          await this.jobQueueService.failJob(job.id, {
            error: "MaxRetriesExceeded",
            message: `Job exceeded maximum retries after orphan recovery`,
            retryCount: job.retryCount,
            maxRetries: job.maxRetries,
          });
          logger.warn(
            `[JobQueue] Orphaned job ${job.id} exceeded max retries, marked as failed`,
          );
        } else {
          logger.error(
            `[JobQueue] Failed to reset orphaned job ${job.id}:`,
            error,
          );
        }
      }
    }
  }

  /**
   * Process a single job.
   * Claims, executes handler with cancellation token, and marks complete/failed/cancelled.
   */
  private async processJob(job: Job): Promise<void> {
    const handler = this.handlers.get(job.type);

    if (!handler) {
      logger.error(`[JobQueue] No handler for job type: ${job.type}`);
      await this.jobQueueService.failJob(job.id, {
        error: "NoHandlerError",
        message: `No handler registered for job type: ${job.type}`,
      });
      return;
    }

    // Create cancellation token for this job
    const cancellationToken = new CancellationTokenImpl(job.id);

    try {
      // Check if job was already cancelled before we claim it
      const preCancellation = await this.jobQueueService.getCancellationStatus(job.id);
      if (preCancellation) {
        logger.info(`[JobQueue] Job ${job.id} was cancelled before processing, marking as cancelled`);
        await this.jobQueueService.markJobCancelled(job.id, preCancellation.reason);
        return;
      }

      // Claim the job
      const claimedJob = await this.jobQueueService.claimJob(job.id);

      // Register token and subscribe to cancellation events
      this.activeCancellationTokens.set(job.id, cancellationToken);
      const unsubscribe = this.jobQueueService.subscribeToCancellation(job.id, (event) => {
        logger.debug(`[JobQueue] Cancellation event received for job ${job.id}`);
        cancellationToken._cancel(event.reason);
      });
      this.cancellationUnsubscribers.set(job.id, unsubscribe);

      logger.debug(`[JobQueue] Processing job ${job.id} (type: ${job.type})`);

      // Execute handler with cancellation token
      const result = await handler(claimedJob, cancellationToken);

      // Check if cancellation was requested during execution
      if (cancellationToken.isCancelled) {
        logger.info(`[JobQueue] Job ${job.id} completed but was cancelled, marking as cancelled`);
        await this.jobQueueService.markJobCancelled(job.id, cancellationToken.reason);
      } else {
        // Mark complete
        await this.jobQueueService.completeJob(job.id, result);
        logger.info(`[JobQueue] Completed job ${job.id} (type: ${job.type})`);
      }
    } catch (error) {
      if (error instanceof JobAlreadyClaimedError) {
        // Another process claimed it - not an error
        logger.debug(`[JobQueue] Job ${job.id} claimed by another process`);
        return;
      }

      if (error instanceof JobCancellationError) {
        // Handler threw cancellation error - mark as cancelled
        logger.info(`[JobQueue] Job ${job.id} cancelled: ${error.reason ?? "no reason provided"}`);
        await this.jobQueueService.markJobCancelled(job.id, error.reason);
        return;
      }

      // Handler error or other failure
      logger.error(`[JobQueue] Job ${job.id} failed:`, error);

      const errorDetails =
        error instanceof Error
          ? { error: error.name, message: error.message, stack: error.stack }
          : { error: "Unknown", message: String(error) };

      await this.jobQueueService.failJob(job.id, errorDetails);
    } finally {
      // Always clean up the token and subscription
      this.activeCancellationTokens.delete(job.id);
      const unsubscribe = this.cancellationUnsubscribers.get(job.id);
      if (unsubscribe) {
        unsubscribe();
        this.cancellationUnsubscribers.delete(job.id);
      }
    }
  }
}
