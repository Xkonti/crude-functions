import { expect } from "@std/expect";
import { TestSetupBuilder } from "../test/test_setup_builder.ts";
import {
  DuplicateActiveJobError,
  JobAlreadyClaimedError,
  JobNotFoundError,
  MaxRetriesExceededError,
} from "./errors.ts";

// =============================================================================
// Basic CRUD Operations
// =============================================================================

Deno.test("JobQueueService.enqueue creates a pending job", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    const job = await ctx.jobQueueService.enqueue({
      type: "test-job",
      payload: { message: "hello" },
    });

    expect(job.id).toBeGreaterThan(0);
    expect(job.type).toBe("test-job");
    expect(job.status).toBe("pending");
    expect(job.payload).toEqual({ message: "hello" });
    expect(job.retryCount).toBe(0);
    expect(job.maxRetries).toBe(1);
    expect(job.priority).toBe(0);
    expect(job.processInstanceId).toBeNull();
    expect(job.startedAt).toBeNull();
    expect(job.completedAt).toBeNull();
    expect(job.createdAt).toBeInstanceOf(Date);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("JobQueueService.enqueue accepts custom maxRetries and priority", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    const job = await ctx.jobQueueService.enqueue({
      type: "test-job",
      maxRetries: 5,
      priority: 10,
    });

    expect(job.maxRetries).toBe(5);
    expect(job.priority).toBe(10);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("JobQueueService.getJob retrieves job by ID", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    const created = await ctx.jobQueueService.enqueue({
      type: "test-job",
      payload: { key: "value" },
    });

    const retrieved = await ctx.jobQueueService.getJob(created.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe(created.id);
    expect(retrieved!.type).toBe("test-job");
    expect(retrieved!.payload).toEqual({ key: "value" });
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("JobQueueService.getJob returns null for non-existent job", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    const job = await ctx.jobQueueService.getJob(99999);
    expect(job).toBeNull();
  } finally {
    await ctx.cleanup();
  }
});

// =============================================================================
// Reference Constraint Tests
// =============================================================================

Deno.test("JobQueueService.enqueue with reference stores referenceType and referenceId", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    const job = await ctx.jobQueueService.enqueue({
      type: "sync-source",
      referenceType: "code_source",
      referenceId: 42,
    });

    expect(job.referenceType).toBe("code_source");
    expect(job.referenceId).toBe(42);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("JobQueueService.enqueue throws DuplicateActiveJobError for same reference", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    // First job succeeds
    await ctx.jobQueueService.enqueue({
      type: "sync-source",
      referenceType: "code_source",
      referenceId: 123,
    });

    // Second job with same reference should throw
    await expect(
      ctx.jobQueueService.enqueue({
        type: "sync-source",
        referenceType: "code_source",
        referenceId: 123,
      }),
    ).rejects.toThrow(DuplicateActiveJobError);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("JobQueueService.enqueue allows different references", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    const job1 = await ctx.jobQueueService.enqueue({
      type: "sync-source",
      referenceType: "code_source",
      referenceId: 1,
    });

    const job2 = await ctx.jobQueueService.enqueue({
      type: "sync-source",
      referenceType: "code_source",
      referenceId: 2,
    });

    expect(job1.id).not.toBe(job2.id);
    expect(job1.referenceId).toBe(1);
    expect(job2.referenceId).toBe(2);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("JobQueueService.enqueue allows same reference after job completes", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    // Create first job
    const job1 = await ctx.jobQueueService.enqueue({
      type: "sync-source",
      referenceType: "code_source",
      referenceId: 123,
    });

    // Complete the first job
    await ctx.jobQueueService.claimJob(job1.id);
    await ctx.jobQueueService.completeJob(job1.id, { success: true });

    // Now we can create another job for the same reference
    const job2 = await ctx.jobQueueService.enqueue({
      type: "sync-source",
      referenceType: "code_source",
      referenceId: 123,
    });

    expect(job2.id).not.toBe(job1.id);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("JobQueueService.enqueueIfNotExists returns null on duplicate", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    // First job succeeds
    const job1 = await ctx.jobQueueService.enqueueIfNotExists({
      type: "sync-source",
      referenceType: "code_source",
      referenceId: 123,
    });
    expect(job1).not.toBeNull();

    // Second job returns null instead of throwing
    const job2 = await ctx.jobQueueService.enqueueIfNotExists({
      type: "sync-source",
      referenceType: "code_source",
      referenceId: 123,
    });
    expect(job2).toBeNull();
  } finally {
    await ctx.cleanup();
  }
});

// =============================================================================
// Query Operations
// =============================================================================

Deno.test("JobQueueService.getJobsByStatus returns jobs with matching status", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    await ctx.jobQueueService.enqueue({ type: "job1" });
    await ctx.jobQueueService.enqueue({ type: "job2" });

    const pendingJobs = await ctx.jobQueueService.getJobsByStatus("pending");
    expect(pendingJobs.length).toBe(2);
    expect(pendingJobs.every((j) => j.status === "pending")).toBe(true);

    const runningJobs = await ctx.jobQueueService.getJobsByStatus("running");
    expect(runningJobs.length).toBe(0);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("JobQueueService.getJobsByType returns jobs with matching type", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    await ctx.jobQueueService.enqueue({ type: "sync" });
    await ctx.jobQueueService.enqueue({ type: "sync" });
    await ctx.jobQueueService.enqueue({ type: "cleanup" });

    const syncJobs = await ctx.jobQueueService.getJobsByType("sync");
    expect(syncJobs.length).toBe(2);
    expect(syncJobs.every((j) => j.type === "sync")).toBe(true);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("JobQueueService.getJobsByType filters by status when provided", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    const job1 = await ctx.jobQueueService.enqueue({ type: "sync" });
    await ctx.jobQueueService.enqueue({ type: "sync" });

    // Claim and complete one job
    await ctx.jobQueueService.claimJob(job1.id);
    await ctx.jobQueueService.completeJob(job1.id);

    const pendingSyncJobs = await ctx.jobQueueService.getJobsByType(
      "sync",
      "pending",
    );
    expect(pendingSyncJobs.length).toBe(1);

    const completedSyncJobs = await ctx.jobQueueService.getJobsByType(
      "sync",
      "completed",
    );
    expect(completedSyncJobs.length).toBe(1);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("JobQueueService.getActiveJobForReference returns active job", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    await ctx.jobQueueService.enqueue({
      type: "sync",
      referenceType: "source",
      referenceId: 1,
    });

    const activeJob = await ctx.jobQueueService.getActiveJobForReference(
      "source",
      1,
    );
    expect(activeJob).not.toBeNull();
    expect(activeJob!.referenceType).toBe("source");
    expect(activeJob!.referenceId).toBe(1);

    const noJob = await ctx.jobQueueService.getActiveJobForReference(
      "source",
      999,
    );
    expect(noJob).toBeNull();
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("JobQueueService.getNextPendingJob returns highest priority first", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    await ctx.jobQueueService.enqueue({ type: "low", priority: 0 });
    await ctx.jobQueueService.enqueue({ type: "high", priority: 10 });
    await ctx.jobQueueService.enqueue({ type: "medium", priority: 5 });

    const next = await ctx.jobQueueService.getNextPendingJob();
    expect(next).not.toBeNull();
    expect(next!.type).toBe("high");
    expect(next!.priority).toBe(10);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("JobQueueService.getNextPendingJob uses FIFO within same priority", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    await ctx.jobQueueService.enqueue({ type: "first", priority: 5 });
    await ctx.jobQueueService.enqueue({ type: "second", priority: 5 });
    await ctx.jobQueueService.enqueue({ type: "third", priority: 5 });

    const next = await ctx.jobQueueService.getNextPendingJob();
    expect(next).not.toBeNull();
    expect(next!.type).toBe("first");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("JobQueueService.getNextPendingJob filters by type when provided", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    await ctx.jobQueueService.enqueue({ type: "sync", priority: 10 });
    await ctx.jobQueueService.enqueue({ type: "cleanup", priority: 5 });

    const nextCleanup = await ctx.jobQueueService.getNextPendingJob("cleanup");
    expect(nextCleanup).not.toBeNull();
    expect(nextCleanup!.type).toBe("cleanup");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("JobQueueService.getNextPendingJob returns null when queue is empty", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    const next = await ctx.jobQueueService.getNextPendingJob();
    expect(next).toBeNull();
  } finally {
    await ctx.cleanup();
  }
});

// =============================================================================
// Claim/Complete/Fail Operations
// =============================================================================

Deno.test("JobQueueService.claimJob sets status to running", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    const job = await ctx.jobQueueService.enqueue({ type: "test" });

    const claimed = await ctx.jobQueueService.claimJob(job.id);
    expect(claimed.status).toBe("running");
    expect(claimed.processInstanceId).toBe(ctx.instanceIdService.getId());
    expect(claimed.startedAt).toBeInstanceOf(Date);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("JobQueueService.claimJob throws JobNotFoundError for non-existent job", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    await expect(ctx.jobQueueService.claimJob(99999)).rejects.toThrow(
      JobNotFoundError,
    );
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("JobQueueService.claimJob throws JobAlreadyClaimedError if not pending", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    const job = await ctx.jobQueueService.enqueue({ type: "test" });

    // Claim once - should succeed
    await ctx.jobQueueService.claimJob(job.id);

    // Claim again - should fail
    await expect(ctx.jobQueueService.claimJob(job.id)).rejects.toThrow(
      JobAlreadyClaimedError,
    );
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("JobQueueService.completeJob sets status to completed with result", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    const job = await ctx.jobQueueService.enqueue({ type: "test" });
    await ctx.jobQueueService.claimJob(job.id);

    const completed = await ctx.jobQueueService.completeJob(job.id, {
      processed: true,
      count: 42,
    });

    expect(completed.status).toBe("completed");
    expect(completed.result).toEqual({ processed: true, count: 42 });
    expect(completed.completedAt).toBeInstanceOf(Date);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("JobQueueService.completeJob works without result", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    const job = await ctx.jobQueueService.enqueue({ type: "test" });
    await ctx.jobQueueService.claimJob(job.id);

    const completed = await ctx.jobQueueService.completeJob(job.id);

    expect(completed.status).toBe("completed");
    expect(completed.result).toBeNull();
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("JobQueueService.completeJob throws JobNotFoundError for non-existent job", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    await expect(ctx.jobQueueService.completeJob(99999)).rejects.toThrow(
      JobNotFoundError,
    );
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("JobQueueService.failJob sets status to failed with error details", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    const job = await ctx.jobQueueService.enqueue({ type: "test" });
    await ctx.jobQueueService.claimJob(job.id);

    const failed = await ctx.jobQueueService.failJob(job.id, {
      error: "NetworkError",
      message: "Connection timeout",
    });

    expect(failed.status).toBe("failed");
    expect(failed.result).toEqual({
      error: "NetworkError",
      message: "Connection timeout",
    });
    expect(failed.completedAt).toBeInstanceOf(Date);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("JobQueueService.failJob throws JobNotFoundError for non-existent job", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    await expect(
      ctx.jobQueueService.failJob(99999, { error: "test" }),
    ).rejects.toThrow(JobNotFoundError);
  } finally {
    await ctx.cleanup();
  }
});

// =============================================================================
// Orphan Detection and Recovery
// =============================================================================

Deno.test("JobQueueService.getOrphanedJobs finds jobs with different instance ID", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    // Insert a job with a different instance ID directly (simulating crash)
    await ctx.db.execute(
      `INSERT INTO jobQueue (type, status, processInstanceId, startedAt, createdAt)
       VALUES (?, 'running', 'old-crashed-instance', datetime('now'), datetime('now'))`,
      ["orphaned-job"],
    );

    const orphaned = await ctx.jobQueueService.getOrphanedJobs();
    expect(orphaned.length).toBe(1);
    expect(orphaned[0].type).toBe("orphaned-job");
    expect(orphaned[0].processInstanceId).toBe("old-crashed-instance");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("JobQueueService.getOrphanedJobs excludes jobs with current instance ID", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    // Create and claim a job normally
    const job = await ctx.jobQueueService.enqueue({ type: "normal-job" });
    await ctx.jobQueueService.claimJob(job.id);

    const orphaned = await ctx.jobQueueService.getOrphanedJobs();
    expect(orphaned.length).toBe(0);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("JobQueueService.resetOrphanedJob resets job to pending", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    // Insert an orphaned job
    await ctx.db.execute(
      `INSERT INTO jobQueue (type, status, processInstanceId, startedAt, retryCount, maxRetries, createdAt)
       VALUES (?, 'running', 'crashed-instance', datetime('now'), 0, 2, datetime('now'))`,
      ["orphaned-job"],
    );

    const orphaned = await ctx.jobQueueService.getOrphanedJobs();
    expect(orphaned.length).toBe(1);

    const reset = await ctx.jobQueueService.resetOrphanedJob(orphaned[0].id);

    expect(reset.status).toBe("pending");
    expect(reset.processInstanceId).toBeNull();
    expect(reset.startedAt).toBeNull();
    expect(reset.retryCount).toBe(1); // Incremented
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("JobQueueService.resetOrphanedJob throws MaxRetriesExceededError when limit reached", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    // Insert an orphaned job that has already reached max retries
    await ctx.db.execute(
      `INSERT INTO jobQueue (type, status, processInstanceId, startedAt, retryCount, maxRetries, createdAt)
       VALUES (?, 'running', 'crashed-instance', datetime('now'), 1, 1, datetime('now'))`,
      ["exhausted-job"],
    );

    const orphaned = await ctx.jobQueueService.getOrphanedJobs();
    expect(orphaned.length).toBe(1);

    await expect(
      ctx.jobQueueService.resetOrphanedJob(orphaned[0].id),
    ).rejects.toThrow(MaxRetriesExceededError);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("JobQueueService.resetOrphanedJob throws JobNotFoundError for non-existent job", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    await expect(ctx.jobQueueService.resetOrphanedJob(99999)).rejects.toThrow(
      JobNotFoundError,
    );
  } finally {
    await ctx.cleanup();
  }
});

// =============================================================================
// Cleanup Operations
// =============================================================================

Deno.test("JobQueueService.deleteOldJobs removes old completed jobs", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    // Create and complete a job
    const job = await ctx.jobQueueService.enqueue({ type: "old-job" });
    await ctx.jobQueueService.claimJob(job.id);
    await ctx.jobQueueService.completeJob(job.id);

    // Update completedAt to be in the past
    await ctx.db.execute(
      `UPDATE jobQueue SET completedAt = datetime('now', '-10 days') WHERE id = ?`,
      [job.id],
    );

    const deleted = await ctx.jobQueueService.deleteOldJobs(
      new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
    );

    expect(deleted).toBe(1);
    expect(await ctx.jobQueueService.getJob(job.id)).toBeNull();
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("JobQueueService.deleteOldJobs removes old failed jobs", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    // Create and fail a job
    const job = await ctx.jobQueueService.enqueue({ type: "failed-job" });
    await ctx.jobQueueService.claimJob(job.id);
    await ctx.jobQueueService.failJob(job.id, { error: "test" });

    // Update completedAt to be in the past
    await ctx.db.execute(
      `UPDATE jobQueue SET completedAt = datetime('now', '-10 days') WHERE id = ?`,
      [job.id],
    );

    const deleted = await ctx.jobQueueService.deleteOldJobs(
      new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
    );

    expect(deleted).toBe(1);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("JobQueueService.deleteOldJobs does not delete pending or running jobs", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    // Create pending and running jobs
    await ctx.jobQueueService.enqueue({ type: "pending-job" });
    const runningJob = await ctx.jobQueueService.enqueue({
      type: "running-job",
    });
    await ctx.jobQueueService.claimJob(runningJob.id);

    // Try to delete with a future date
    const deleted = await ctx.jobQueueService.deleteOldJobs(
      new Date(Date.now() + 24 * 60 * 60 * 1000), // tomorrow
    );

    expect(deleted).toBe(0);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("JobQueueService.getJobCounts returns counts by status", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    // Create jobs in various states
    await ctx.jobQueueService.enqueue({ type: "pending1" });
    await ctx.jobQueueService.enqueue({ type: "pending2" });

    const runningJob = await ctx.jobQueueService.enqueue({ type: "running" });
    await ctx.jobQueueService.claimJob(runningJob.id);

    const completedJob = await ctx.jobQueueService.enqueue({
      type: "completed",
    });
    await ctx.jobQueueService.claimJob(completedJob.id);
    await ctx.jobQueueService.completeJob(completedJob.id);

    const failedJob = await ctx.jobQueueService.enqueue({ type: "failed" });
    await ctx.jobQueueService.claimJob(failedJob.id);
    await ctx.jobQueueService.failJob(failedJob.id, { error: "test" });

    const counts = await ctx.jobQueueService.getJobCounts();

    expect(counts.pending).toBe(2);
    expect(counts.running).toBe(1);
    expect(counts.completed).toBe(1);
    expect(counts.failed).toBe(1);
  } finally {
    await ctx.cleanup();
  }
});

// =============================================================================
// Null/Empty Payload Handling
// =============================================================================

Deno.test("JobQueueService handles null payload", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    const job = await ctx.jobQueueService.enqueue({
      type: "no-payload",
    });

    expect(job.payload).toBeNull();

    const retrieved = await ctx.jobQueueService.getJob(job.id);
    expect(retrieved!.payload).toBeNull();
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("JobQueueService handles undefined payload", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    const job = await ctx.jobQueueService.enqueue({
      type: "undefined-payload",
      payload: undefined,
    });

    expect(job.payload).toBeNull();
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("JobQueueService handles complex payload", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    const complexPayload = {
      nested: {
        array: [1, 2, { deep: true }],
        date: "2024-01-15T12:00:00Z",
      },
      empty: {},
      nullValue: null,
    };

    const job = await ctx.jobQueueService.enqueue({
      type: "complex-payload",
      payload: complexPayload,
    });

    const retrieved = await ctx.jobQueueService.getJob(job.id);
    expect(retrieved!.payload).toEqual(complexPayload);
  } finally {
    await ctx.cleanup();
  }
});

// =============================================================================
// Deferred Job Pattern (withJob)
// =============================================================================

Deno.test("TestSetupBuilder.withJob seeds jobs during build", async () => {
  const ctx = await TestSetupBuilder.create()
    .withJob({ type: "seeded-job", payload: { test: true }, priority: 5 })
    .withJob({ type: "another-job" })
    .build();

  try {
    const jobs = await ctx.jobQueueService.getJobsByStatus("pending");
    expect(jobs.length).toBe(2);

    const seededJob = jobs.find((j) => j.type === "seeded-job");
    expect(seededJob).not.toBeUndefined();
    expect(seededJob!.payload).toEqual({ test: true });
    expect(seededJob!.priority).toBe(5);
  } finally {
    await ctx.cleanup();
  }
});
