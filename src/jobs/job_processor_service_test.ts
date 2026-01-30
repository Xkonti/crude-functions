import { integrationTest } from "../test/test_helpers.ts";
import { expect } from "@std/expect";
import { RecordId } from "surrealdb";
import { TestSetupBuilder } from "../test/test_setup_builder.ts";
import { JobProcessorService } from "./job_processor_service.ts";
import { JobCancellationError } from "./errors.ts";
import type { CancellationToken } from "./types.ts";

// =============================================================================
// Handler Registration
// =============================================================================

integrationTest("JobProcessorService.registerHandler registers handler", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  const processor = new JobProcessorService({
    jobQueueService: ctx.jobQueueService,
    instanceIdService: ctx.instanceIdService,
    config: { pollingIntervalSeconds: 60 },
  });

  try {
    processor.registerHandler("test-job", (_job, _token) => ({ done: true }));

    expect(processor.hasHandler("test-job")).toBe(true);
    expect(processor.hasHandler("unknown-job")).toBe(false);
  } finally {
    await processor.stop();
    await ctx.cleanup();
  }
});

integrationTest("JobProcessorService.unregisterHandler removes handler", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  const processor = new JobProcessorService({
    jobQueueService: ctx.jobQueueService,
    instanceIdService: ctx.instanceIdService,
    config: { pollingIntervalSeconds: 60 },
  });

  try {
    processor.registerHandler("test-job", (_job, _token) => ({}));
    expect(processor.hasHandler("test-job")).toBe(true);

    const removed = processor.unregisterHandler("test-job");
    expect(removed).toBe(true);
    expect(processor.hasHandler("test-job")).toBe(false);

    // Second unregister returns false
    expect(processor.unregisterHandler("test-job")).toBe(false);
  } finally {
    await processor.stop();
    await ctx.cleanup();
  }
});

integrationTest("JobProcessorService.getStatus returns registered handlers", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  const processor = new JobProcessorService({
    jobQueueService: ctx.jobQueueService,
    instanceIdService: ctx.instanceIdService,
    config: { pollingIntervalSeconds: 60 },
  });

  try {
    processor.registerHandler("job-a", (_job, _token) => ({}));
    processor.registerHandler("job-b", (_job, _token) => ({}));

    const status = processor.getStatus();
    expect(status.registeredHandlers).toContain("job-a");
    expect(status.registeredHandlers).toContain("job-b");
    expect(status.isRunning).toBe(false);
    expect(status.isProcessing).toBe(false);
    expect(status.consecutiveFailures).toBe(0);
  } finally {
    await processor.stop();
    await ctx.cleanup();
  }
});

// =============================================================================
// processOne() - Single Job Processing
// =============================================================================

integrationTest("JobProcessorService.processOne processes pending job", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  const processor = new JobProcessorService({
    jobQueueService: ctx.jobQueueService,
    instanceIdService: ctx.instanceIdService,
    config: { pollingIntervalSeconds: 60 },
  });

  try {
    let processedPayload: unknown = null;

    processor.registerHandler("test-job", (job, _token) => {
      processedPayload = job.payload;
      return { processed: true };
    });

    const enqueued = await ctx.jobQueueService.enqueue({
      type: "test-job",
      payload: { value: 42 },
    });

    const result = await processor.processOne();

    // processOne returns the job state after completion (before deletion)
    expect(result).not.toBeNull();
    expect(result!.status).toBe("completed");
    expect(result!.result).toEqual({ processed: true });
    expect(processedPayload).toEqual({ value: 42 });

    // Job is deleted from DB after completion
    expect(await ctx.jobQueueService.getJob(enqueued.id)).toBeNull();
  } finally {
    await processor.stop();
    await ctx.cleanup();
  }
});

integrationTest("JobProcessorService.processOne returns null when queue is empty", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  const processor = new JobProcessorService({
    jobQueueService: ctx.jobQueueService,
    instanceIdService: ctx.instanceIdService,
    config: { pollingIntervalSeconds: 60 },
  });

  try {
    processor.registerHandler("test-job", (_job, _token) => ({}));

    const result = await processor.processOne();
    expect(result).toBeNull();
  } finally {
    await processor.stop();
    await ctx.cleanup();
  }
});

integrationTest("JobProcessorService.processOne marks job failed when handler throws", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  const processor = new JobProcessorService({
    jobQueueService: ctx.jobQueueService,
    instanceIdService: ctx.instanceIdService,
    config: { pollingIntervalSeconds: 60 },
  });

  try {
    processor.registerHandler("failing-job", (_job, _token) => {
      throw new Error("Handler failed!");
    });

    const enqueued = await ctx.jobQueueService.enqueue({ type: "failing-job" });

    const result = await processor.processOne();

    expect(result).not.toBeNull();
    expect(result!.status).toBe("failed");
    expect(result!.result).toEqual({
      error: "Error",
      message: "Handler failed!",
      stack: expect.any(String),
    });

    // Job is deleted from DB after failure
    expect(await ctx.jobQueueService.getJob(enqueued.id)).toBeNull();
  } finally {
    await processor.stop();
    await ctx.cleanup();
  }
});

integrationTest("JobProcessorService.processOne fails job when no handler registered", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  const processor = new JobProcessorService({
    jobQueueService: ctx.jobQueueService,
    instanceIdService: ctx.instanceIdService,
    config: { pollingIntervalSeconds: 60 },
  });

  try {
    // No handler registered for this type
    const enqueued = await ctx.jobQueueService.enqueue({ type: "unknown-job" });

    const result = await processor.processOne();

    expect(result).not.toBeNull();
    expect(result!.status).toBe("failed");
    expect(result!.result).toEqual({
      error: "NoHandlerError",
      message: "No handler registered for job type: unknown-job",
    });

    // Job is deleted from DB after failure
    expect(await ctx.jobQueueService.getJob(enqueued.id)).toBeNull();
  } finally {
    await processor.stop();
    await ctx.cleanup();
  }
});

integrationTest("JobProcessorService.processOne processes highest priority job first", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  const processor = new JobProcessorService({
    jobQueueService: ctx.jobQueueService,
    instanceIdService: ctx.instanceIdService,
    config: { pollingIntervalSeconds: 60 },
  });

  try {
    const processedTypes: string[] = [];

    processor.registerHandler("low-priority", (job, _token) => {
      processedTypes.push(job.type);
      return {};
    });

    processor.registerHandler("high-priority", (job, _token) => {
      processedTypes.push(job.type);
      return {};
    });

    await ctx.jobQueueService.enqueue({ type: "low-priority", priority: 0 });
    await ctx.jobQueueService.enqueue({ type: "high-priority", priority: 10 });

    await processor.processOne();

    expect(processedTypes).toEqual(["high-priority"]);

    // High priority job is now deleted, low priority still pending
    const jobs = await ctx.jobQueueService.getJobsByStatus("pending");
    expect(jobs.length).toBe(1);
    expect(jobs[0].type).toBe("low-priority");
  } finally {
    await processor.stop();
    await ctx.cleanup();
  }
});

// =============================================================================
// Lifecycle (start/stop)
// =============================================================================

integrationTest("JobProcessorService.start and stop lifecycle", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  const processor = new JobProcessorService({
    jobQueueService: ctx.jobQueueService,
    instanceIdService: ctx.instanceIdService,
    config: { pollingIntervalSeconds: 1 },
  });

  try {
    expect(processor.isRunning()).toBe(false);

    processor.start();

    // Poll for running state instead of fixed delay
    const startTime = Date.now();
    while (!processor.isRunning() && Date.now() - startTime < 5000) {
      await new Promise((r) => setTimeout(r, 10));
    }

    expect(processor.isRunning()).toBe(true);

    await processor.stop();

    expect(processor.isRunning()).toBe(false);
  } finally {
    await processor.stop();
    await ctx.cleanup();
  }
});

integrationTest("JobProcessorService.start processes pending jobs", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  const processor = new JobProcessorService({
    jobQueueService: ctx.jobQueueService,
    instanceIdService: ctx.instanceIdService,
    config: { pollingIntervalSeconds: 1 },
  });

  try {
    let handlerCalled = false;
    let handlerResolve: () => void;
    const handlerPromise = new Promise<void>((resolve) => {
      handlerResolve = resolve;
    });

    processor.registerHandler("auto-process", (_job, _token) => {
      handlerCalled = true;
      handlerResolve();
      return { done: true };
    });

    await ctx.jobQueueService.enqueue({ type: "auto-process" });

    processor.start();

    // Wait for handler to be called
    await handlerPromise;

    expect(handlerCalled).toBe(true);

    // Poll for job to be deleted (deleted after completion)
    let jobs: { status: string }[] = [];
    const deadline = Date.now() + 1000;
    while (Date.now() < deadline) {
      jobs = await ctx.jobQueueService.getJobsByType("auto-process");
      if (jobs.length === 0) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(jobs.length).toBe(0);
  } finally {
    await processor.stop();
    await ctx.cleanup();
  }
});

integrationTest("JobProcessorService warns when start called twice", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  const processor = new JobProcessorService({
    jobQueueService: ctx.jobQueueService,
    instanceIdService: ctx.instanceIdService,
    config: { pollingIntervalSeconds: 60 },
  });

  try {
    processor.start();

    // Poll for running state instead of fixed delay
    const startTime = Date.now();
    while (!processor.isRunning() && Date.now() - startTime < 5000) {
      await new Promise((r) => setTimeout(r, 10));
    }

    // Second start should warn but not crash
    processor.start();
  } finally {
    await processor.stop();
    await ctx.cleanup();
  }
});

// =============================================================================
// Orphan Recovery
// =============================================================================

integrationTest("JobProcessorService recovers orphaned jobs on startup", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    // Insert orphaned job directly
    await ctx.surrealDb.query(`
      CREATE job SET
        type = $type,
        status = $status,
        executionMode = $executionMode,
        processInstanceId = $processInstanceId,
        startedAt = $startedAt,
        createdAt = $createdAt,
        payload = NONE,
        result = NONE,
        retryCount = $retryCount,
        maxRetries = $maxRetries,
        priority = $priority,
        referenceType = NONE,
        referenceId = NONE,
        completedAt = NONE,
        cancelledAt = NONE,
        cancelReason = NONE
    `, {
      type: "orphaned-job",
      status: "running",
      executionMode: "sequential",
      processInstanceId: "crashed-instance",
      startedAt: new Date(),
      createdAt: new Date(),
      retryCount: 0,
      maxRetries: 2,
      priority: 0,
    });

    // Verify it's orphaned
    const orphaned = await ctx.jobQueueService.getOrphanedJobs();
    expect(orphaned.length).toBe(1);

    let handlerCalled = false;
    let handlerResolve: () => void;
    const handlerPromise = new Promise<void>((resolve) => {
      handlerResolve = resolve;
    });

    const processor = new JobProcessorService({
      jobQueueService: ctx.jobQueueService,
      instanceIdService: ctx.instanceIdService,
      config: { pollingIntervalSeconds: 60 },
    });

    processor.registerHandler("orphaned-job", (_job, _token) => {
      handlerCalled = true;
      handlerResolve();
      return { recovered: true };
    });

    processor.start();

    // Wait for handler to be called
    await handlerPromise;

    await processor.stop();

    expect(handlerCalled).toBe(true);

    // Jobs are deleted after completion
    const jobs = await ctx.jobQueueService.getJobsByType("orphaned-job");
    expect(jobs.length).toBe(0);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("JobProcessorService marks exhausted orphaned jobs as failed", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    // Insert orphaned job that has already reached max retries
    await ctx.surrealDb.query(`
      CREATE job SET
        type = $type,
        status = $status,
        executionMode = $executionMode,
        processInstanceId = $processInstanceId,
        startedAt = $startedAt,
        createdAt = $createdAt,
        payload = NONE,
        result = NONE,
        retryCount = $retryCount,
        maxRetries = $maxRetries,
        priority = $priority,
        referenceType = NONE,
        referenceId = NONE,
        completedAt = NONE,
        cancelledAt = NONE,
        cancelReason = NONE
    `, {
      type: "exhausted-job",
      status: "running",
      executionMode: "sequential",
      processInstanceId: "crashed-instance",
      startedAt: new Date(),
      createdAt: new Date(),
      retryCount: 1,
      maxRetries: 1,
      priority: 0,
    });

    const processor = new JobProcessorService({
      jobQueueService: ctx.jobQueueService,
      instanceIdService: ctx.instanceIdService,
      config: { pollingIntervalSeconds: 60 },
    });

    processor.registerHandler("exhausted-job", (_job, _token) => {
      return {};
    });

    processor.start();

    // Poll for job to be processed and deleted
    const startTime = Date.now();
    let jobs = await ctx.jobQueueService.getJobsByType("exhausted-job");
    while (jobs.length > 0 && Date.now() - startTime < 5000) {
      await new Promise((r) => setTimeout(r, 50));
      jobs = await ctx.jobQueueService.getJobsByType("exhausted-job");
    }

    await processor.stop();

    // Job should be deleted after being marked as failed
    expect(jobs.length).toBe(0);
  } finally {
    await ctx.cleanup();
  }
});

// =============================================================================
// Multiple Jobs Processing
// =============================================================================

integrationTest("JobProcessorService processes multiple jobs in sequence", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  const processor = new JobProcessorService({
    jobQueueService: ctx.jobQueueService,
    instanceIdService: ctx.instanceIdService,
    config: { pollingIntervalSeconds: 60 },
  });

  try {
    const processedIds: RecordId[] = [];

    processor.registerHandler("sequential-job", (job, _token) => {
      processedIds.push(job.id);
      return {};
    });

    // Enqueue 3 jobs
    await ctx.jobQueueService.enqueue({ type: "sequential-job" });
    await ctx.jobQueueService.enqueue({ type: "sequential-job" });
    await ctx.jobQueueService.enqueue({ type: "sequential-job" });

    // Process all
    await processor.processOne();
    await processor.processOne();
    await processor.processOne();

    expect(processedIds.length).toBe(3);

    // All jobs are deleted after completion
    const jobs = await ctx.jobQueueService.getJobsByType("sequential-job");
    expect(jobs.length).toBe(0);
  } finally {
    await processor.stop();
    await ctx.cleanup();
  }
});

// =============================================================================
// Job Context Available to Handler
// =============================================================================

integrationTest("JobProcessorService passes full job context to handler", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  const processor = new JobProcessorService({
    jobQueueService: ctx.jobQueueService,
    instanceIdService: ctx.instanceIdService,
    config: { pollingIntervalSeconds: 60 },
  });

  try {
    let receivedJob: unknown = null;

    processor.registerHandler("context-check", (job, _token) => {
      receivedJob = job;
      return {};
    });

    await ctx.jobQueueService.enqueue({
      type: "context-check",
      payload: { data: "test" },
      priority: 5,
      referenceType: "test-entity",
      referenceId: "123",
    });

    await processor.processOne();

    expect(receivedJob).not.toBeNull();
    const job = receivedJob as Record<string, unknown>;
    expect(job.type).toBe("context-check");
    expect(job.payload).toEqual({ data: "test" });
    expect(job.priority).toBe(5);
    expect(job.referenceType).toBe("test-entity");
    expect(job.referenceId).toBe("123");
    expect(job.status).toBe("running"); // Job is claimed when handler runs
    expect(job.processInstanceId).toBe(ctx.instanceIdService.getId());
  } finally {
    await processor.stop();
    await ctx.cleanup();
  }
});

// =============================================================================
// Cancellation Tests
// =============================================================================

integrationTest("JobProcessorService passes cancellation token to handler", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  const processor = new JobProcessorService({
    jobQueueService: ctx.jobQueueService,
    instanceIdService: ctx.instanceIdService,
    config: { pollingIntervalSeconds: 60 },
  });

  try {
    let receivedToken: CancellationToken | null = null;

    processor.registerHandler("token-test", (_job, token) => {
      receivedToken = token;
      return { done: true };
    });

    await ctx.jobQueueService.enqueue({ type: "token-test" });
    await processor.processOne();

    expect(receivedToken).not.toBeNull();
    expect(receivedToken!.isCancelled).toBe(false);
    expect(typeof receivedToken!.throwIfCancelled).toBe("function");
    expect(receivedToken!.whenCancelled).toBeInstanceOf(Promise);
  } finally {
    await processor.stop();
    await ctx.cleanup();
  }
});

integrationTest("JobProcessorService marks job cancelled when handler throws JobCancellationError", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  const processor = new JobProcessorService({
    jobQueueService: ctx.jobQueueService,
    instanceIdService: ctx.instanceIdService,
    config: { pollingIntervalSeconds: 60 },
  });

  try {
    processor.registerHandler("cancel-throw-test", (job, _token) => {
      throw new JobCancellationError(job.id, "Handler decided to cancel");
    });

    const enqueued = await ctx.jobQueueService.enqueue({ type: "cancel-throw-test" });
    const result = await processor.processOne();

    expect(result).not.toBeNull();
    expect(result!.status).toBe("cancelled");
    expect(result!.cancelReason).toBe("Handler decided to cancel");

    // Job is deleted after cancellation
    const job = await ctx.jobQueueService.getJob(enqueued.id);
    expect(job).toBeNull();
  } finally {
    await processor.stop();
    await ctx.cleanup();
  }
});

integrationTest("JobProcessorService does not process deleted cancelled jobs", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  const processor = new JobProcessorService({
    jobQueueService: ctx.jobQueueService,
    instanceIdService: ctx.instanceIdService,
    config: { pollingIntervalSeconds: 60 },
  });

  try {
    let handlerCalled = false;

    processor.registerHandler("pre-cancel-test", (_job, _token) => {
      handlerCalled = true;
      return {};
    });

    // Enqueue a job
    const job = await ctx.jobQueueService.enqueue({ type: "pre-cancel-test" });

    // Cancel it before processing (pending cancelled jobs are deleted immediately)
    await ctx.jobQueueService.cancelJob(job.id, { reason: "Pre-cancelled" });

    // Verify job is already deleted
    expect(await ctx.jobQueueService.getJob(job.id)).toBeNull();

    // Try to process - should return null since no jobs in queue
    const result = await processor.processOne();

    expect(handlerCalled).toBe(false);
    expect(result).toBeNull();
  } finally {
    await processor.stop();
    await ctx.cleanup();
  }
});

integrationTest("JobProcessorService handler can check cancellation via token.isCancelled", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  const processor = new JobProcessorService({
    jobQueueService: ctx.jobQueueService,
    instanceIdService: ctx.instanceIdService,
    config: { pollingIntervalSeconds: 60 },
  });

  try {
    let tokenWasCancelledDuringHandler = false;

    processor.registerHandler("check-cancel-test", async (_job, token) => {
      // Initially not cancelled
      expect(token.isCancelled).toBe(false);

      // Simulate some work
      await new Promise((r) => setTimeout(r, 50));

      // Check again - still not cancelled in this test
      tokenWasCancelledDuringHandler = token.isCancelled;

      return { checked: true };
    });

    await ctx.jobQueueService.enqueue({ type: "check-cancel-test" });
    const result = await processor.processOne();

    expect(result!.status).toBe("completed");
    expect(tokenWasCancelledDuringHandler).toBe(false);
  } finally {
    await processor.stop();
    await ctx.cleanup();
  }
});

integrationTest("JobProcessorService handler can use token.throwIfCancelled()", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  const processor = new JobProcessorService({
    jobQueueService: ctx.jobQueueService,
    instanceIdService: ctx.instanceIdService,
    config: { pollingIntervalSeconds: 60 },
  });

  try {
    processor.registerHandler("throw-check-test", (_job, token) => {
      // This should not throw since job is not cancelled
      token.throwIfCancelled();
      return { success: true };
    });

    await ctx.jobQueueService.enqueue({ type: "throw-check-test" });
    const result = await processor.processOne();

    expect(result!.status).toBe("completed");
    expect(result!.result).toEqual({ success: true });
  } finally {
    await processor.stop();
    await ctx.cleanup();
  }
});
