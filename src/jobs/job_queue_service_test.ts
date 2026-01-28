import { integrationTest } from "../test/test_helpers.ts";
import { expect } from "@std/expect";
import { RecordId } from "surrealdb";
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

integrationTest("JobQueueService.enqueue creates a pending job", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    const job = await ctx.jobQueueService.enqueue({
      type: "test-job",
      payload: { message: "hello" },
    });

    expect(job.id).toBeInstanceOf(RecordId);
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

integrationTest("JobQueueService.enqueue accepts custom maxRetries and priority", async () => {
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

integrationTest("JobQueueService.getJob retrieves job by ID", async () => {
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

integrationTest("JobQueueService.getJob returns null for non-existent job", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    const job = await ctx.jobQueueService.getJob(new RecordId("job", "non-existent"));
    expect(job).toBeNull();
  } finally {
    await ctx.cleanup();
  }
});

// =============================================================================
// Reference Constraint Tests
// =============================================================================

integrationTest("JobQueueService.enqueue with reference stores referenceType and referenceId", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    const job = await ctx.jobQueueService.enqueue({
      type: "sync-source",
      referenceType: "code_source",
      referenceId: "42",
    });

    expect(job.referenceType).toBe("code_source");
    expect(job.referenceId).toBe("42");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("JobQueueService.enqueue throws DuplicateActiveJobError for same reference", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    // First job succeeds
    await ctx.jobQueueService.enqueue({
      type: "sync-source",
      referenceType: "code_source",
      referenceId: "123",
    });

    // Second job with same reference should throw
    await expect(
      ctx.jobQueueService.enqueue({
        type: "sync-source",
        referenceType: "code_source",
        referenceId: "123",
      }),
    ).rejects.toThrow(DuplicateActiveJobError);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("JobQueueService.enqueue allows different references", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    const job1 = await ctx.jobQueueService.enqueue({
      type: "sync-source",
      referenceType: "code_source",
      referenceId: "1",
    });

    const job2 = await ctx.jobQueueService.enqueue({
      type: "sync-source",
      referenceType: "code_source",
      referenceId: "2",
    });

    expect(job1.id).not.toBe(job2.id);
    expect(job1.referenceId).toBe(1);
    expect(job2.referenceId).toBe(2);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("JobQueueService.enqueue allows same reference after job completes", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    // Create first job
    const job1 = await ctx.jobQueueService.enqueue({
      type: "sync-source",
      referenceType: "code_source",
      referenceId: "123",
    });
    const job1Id = job1.id;

    // Complete the first job (job is deleted from DB after completion)
    await ctx.jobQueueService.claimJob(job1.id);
    await ctx.jobQueueService.completeJob(job1.id, { success: true });

    // Now we can create another job for the same reference
    const job2 = await ctx.jobQueueService.enqueue({
      type: "sync-source",
      referenceType: "code_source",
      referenceId: "123",
    });

    expect(job2.id).not.toBe(job1Id);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("JobQueueService.enqueueIfNotExists returns null on duplicate", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    // First job succeeds
    const job1 = await ctx.jobQueueService.enqueueIfNotExists({
      type: "sync-source",
      referenceType: "code_source",
      referenceId: "123",
    });
    expect(job1).not.toBeNull();

    // Second job returns null instead of throwing
    const job2 = await ctx.jobQueueService.enqueueIfNotExists({
      type: "sync-source",
      referenceType: "code_source",
      referenceId: "123",
    });
    expect(job2).toBeNull();
  } finally {
    await ctx.cleanup();
  }
});

// =============================================================================
// Query Operations
// =============================================================================

integrationTest("JobQueueService.getJobsByStatus returns jobs with matching status", async () => {
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

integrationTest("JobQueueService.getJobsByType returns jobs with matching type", async () => {
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

integrationTest("JobQueueService.getJobsByType filters by status when provided", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    const job1 = await ctx.jobQueueService.enqueue({ type: "sync" });
    await ctx.jobQueueService.enqueue({ type: "sync" });

    // Claim and complete one job (job is deleted after completion)
    await ctx.jobQueueService.claimJob(job1.id);
    await ctx.jobQueueService.completeJob(job1.id);

    // Only the pending job remains
    const pendingSyncJobs = await ctx.jobQueueService.getJobsByType(
      "sync",
      "pending",
    );
    expect(pendingSyncJobs.length).toBe(1);

    // Completed jobs are deleted immediately
    const completedSyncJobs = await ctx.jobQueueService.getJobsByType(
      "sync",
      "completed",
    );
    expect(completedSyncJobs.length).toBe(0);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("JobQueueService.getActiveJobForReference returns active job", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    await ctx.jobQueueService.enqueue({
      type: "sync",
      referenceType: "source",
      referenceId: "1",
    });

    const activeJob = await ctx.jobQueueService.getActiveJobForReference(
      "source",
      "1",
    );
    expect(activeJob).not.toBeNull();
    expect(activeJob!.referenceType).toBe("source");
    expect(activeJob!.referenceId).toBe("1");

    const noJob = await ctx.jobQueueService.getActiveJobForReference(
      "source",
      "999",
    );
    expect(noJob).toBeNull();
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("JobQueueService.getNextPendingJob returns highest priority first", async () => {
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

integrationTest("JobQueueService.getNextPendingJob uses FIFO within same priority", async () => {
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

integrationTest("JobQueueService.getNextPendingJob filters by type when provided", async () => {
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

integrationTest("JobQueueService.getNextPendingJob returns null when queue is empty", async () => {
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

integrationTest("JobQueueService.claimJob sets status to running", async () => {
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

integrationTest("JobQueueService.claimJob throws JobNotFoundError for non-existent job", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    await expect(ctx.jobQueueService.claimJob(new RecordId("job", "non-existent"))).rejects.toThrow(
      JobNotFoundError,
    );
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("JobQueueService.claimJob throws JobAlreadyClaimedError if not pending", async () => {
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

integrationTest("JobQueueService.completeJob sets status to completed with result", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    const job = await ctx.jobQueueService.enqueue({ type: "test" });
    await ctx.jobQueueService.claimJob(job.id);

    const completed = await ctx.jobQueueService.completeJob(job.id, {
      processed: true,
      count: 42,
    });

    // completeJob returns the job state before deletion
    expect(completed.status).toBe("completed");
    expect(completed.result).toEqual({ processed: true, count: 42 });
    expect(completed.completedAt).toBeInstanceOf(Date);

    // Job should be deleted from the database
    expect(await ctx.jobQueueService.getJob(job.id)).toBeNull();
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("JobQueueService.completeJob works without result", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    const job = await ctx.jobQueueService.enqueue({ type: "test" });
    await ctx.jobQueueService.claimJob(job.id);

    const completed = await ctx.jobQueueService.completeJob(job.id);

    expect(completed.status).toBe("completed");
    expect(completed.result).toBeNull();

    // Job should be deleted from the database
    expect(await ctx.jobQueueService.getJob(job.id)).toBeNull();
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("JobQueueService.completeJob throws JobNotFoundError for non-existent job", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    await expect(ctx.jobQueueService.completeJob(new RecordId("job", "non-existent"))).rejects.toThrow(
      JobNotFoundError,
    );
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("JobQueueService.failJob sets status to failed with error details", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    const job = await ctx.jobQueueService.enqueue({ type: "test" });
    await ctx.jobQueueService.claimJob(job.id);

    const failed = await ctx.jobQueueService.failJob(job.id, {
      error: "NetworkError",
      message: "Connection timeout",
    });

    // failJob returns the job state before deletion
    expect(failed.status).toBe("failed");
    expect(failed.result).toEqual({
      error: "NetworkError",
      message: "Connection timeout",
    });
    expect(failed.completedAt).toBeInstanceOf(Date);

    // Job should be deleted from the database
    expect(await ctx.jobQueueService.getJob(job.id)).toBeNull();
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("JobQueueService.failJob throws JobNotFoundError for non-existent job", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    await expect(
      ctx.jobQueueService.failJob(new RecordId("job", "non-existent"), { error: "test" }),
    ).rejects.toThrow(JobNotFoundError);
  } finally {
    await ctx.cleanup();
  }
});

// =============================================================================
// Orphan Detection and Recovery
// =============================================================================

integrationTest("JobQueueService.getOrphanedJobs finds jobs with different instance ID", async () => {
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

integrationTest("JobQueueService.getOrphanedJobs excludes jobs with current instance ID", async () => {
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

integrationTest("JobQueueService.resetOrphanedJob resets job to pending", async () => {
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

integrationTest("JobQueueService.resetOrphanedJob throws MaxRetriesExceededError when limit reached", async () => {
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

integrationTest("JobQueueService.resetOrphanedJob throws JobNotFoundError for non-existent job", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    await expect(ctx.jobQueueService.resetOrphanedJob(new RecordId("job", "non-existent"))).rejects.toThrow(
      JobNotFoundError,
    );
  } finally {
    await ctx.cleanup();
  }
});

// =============================================================================
// Stats Operations
// =============================================================================

integrationTest("JobQueueService.getJobCounts returns counts by status", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    // Create jobs in various states
    await ctx.jobQueueService.enqueue({ type: "pending1" });
    await ctx.jobQueueService.enqueue({ type: "pending2" });

    const runningJob = await ctx.jobQueueService.enqueue({ type: "running" });
    await ctx.jobQueueService.claimJob(runningJob.id);

    // Note: completed/failed jobs are deleted immediately after completion,
    // so they won't show up in counts. We just verify pending and running.
    const counts = await ctx.jobQueueService.getJobCounts();

    expect(counts.pending).toBe(2);
    expect(counts.running).toBe(1);
    expect(counts.completed).toBe(0); // Jobs are deleted after completion
    expect(counts.failed).toBe(0); // Jobs are deleted after failure
  } finally {
    await ctx.cleanup();
  }
});

// =============================================================================
// Null/Empty Payload Handling
// =============================================================================

integrationTest("JobQueueService handles null payload", async () => {
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

integrationTest("JobQueueService handles undefined payload", async () => {
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

integrationTest("JobQueueService handles complex payload", async () => {
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

integrationTest("TestSetupBuilder.withJob seeds jobs during build", async () => {
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

// =============================================================================
// Cancellation Operations
// =============================================================================

integrationTest("JobQueueService.cancelJob cancels pending job immediately", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    const job = await ctx.jobQueueService.enqueue({ type: "cancel-test" });
    expect(job.status).toBe("pending");

    const cancelled = await ctx.jobQueueService.cancelJob(job.id, { reason: "User requested" });

    // cancelJob returns the job state before deletion
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.cancelledAt).toBeInstanceOf(Date);
    expect(cancelled.cancelReason).toBe("User requested");
    expect(cancelled.completedAt).toBeInstanceOf(Date);

    // Pending cancelled jobs are deleted immediately
    expect(await ctx.jobQueueService.getJob(job.id)).toBeNull();
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("JobQueueService.cancelJob sets cancelledAt on running job", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    const job = await ctx.jobQueueService.enqueue({ type: "cancel-test" });
    await ctx.jobQueueService.claimJob(job.id);

    const cancelled = await ctx.jobQueueService.cancelJob(job.id, { reason: "Timeout" });

    // Running job stays running until handler finishes
    expect(cancelled.status).toBe("running");
    expect(cancelled.cancelledAt).toBeInstanceOf(Date);
    expect(cancelled.cancelReason).toBe("Timeout");
    expect(cancelled.completedAt).toBeNull(); // Not completed yet
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("JobQueueService.cancelJob throws JobNotFoundError for completed job", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    const job = await ctx.jobQueueService.enqueue({ type: "cancel-test" });
    await ctx.jobQueueService.claimJob(job.id);
    await ctx.jobQueueService.completeJob(job.id);

    // Completed jobs are deleted, so trying to cancel throws JobNotFoundError
    await expect(ctx.jobQueueService.cancelJob(job.id)).rejects.toThrow(
      JobNotFoundError,
    );
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("JobQueueService.cancelJob throws JobNotFoundError for failed job", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    const job = await ctx.jobQueueService.enqueue({ type: "cancel-test" });
    await ctx.jobQueueService.claimJob(job.id);
    await ctx.jobQueueService.failJob(job.id, { error: "test" });

    // Failed jobs are deleted, so trying to cancel throws JobNotFoundError
    await expect(ctx.jobQueueService.cancelJob(job.id)).rejects.toThrow(
      JobNotFoundError,
    );
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("JobQueueService.cancelJob throws JobNotFoundError for non-existent job", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    await expect(ctx.jobQueueService.cancelJob(new RecordId("job", "non-existent"))).rejects.toThrow(
      JobNotFoundError,
    );
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("JobQueueService.cancelJob is idempotent for already cancelled jobs", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    const job = await ctx.jobQueueService.enqueue({ type: "cancel-test" });
    await ctx.jobQueueService.claimJob(job.id);

    // Cancel twice
    const first = await ctx.jobQueueService.cancelJob(job.id, { reason: "First" });
    const second = await ctx.jobQueueService.cancelJob(job.id, { reason: "Second" });

    // Second call should return same job (already marked for cancellation)
    expect(first.cancelReason).toBe("First");
    expect(second.cancelReason).toBe("First"); // Original reason preserved
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("JobQueueService.cancelJobs cancels multiple pending jobs by type", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    await ctx.jobQueueService.enqueue({ type: "batch-cancel" });
    await ctx.jobQueueService.enqueue({ type: "batch-cancel" });
    await ctx.jobQueueService.enqueue({ type: "keep-this" });

    const count = await ctx.jobQueueService.cancelJobs({
      type: "batch-cancel",
      reason: "Batch cancelled",
    });

    expect(count).toBe(2);

    // Pending cancelled jobs are deleted immediately
    const cancelled = await ctx.jobQueueService.getJobsByStatus("cancelled");
    expect(cancelled.length).toBe(0);

    // Only the unaffected job remains
    const pending = await ctx.jobQueueService.getJobsByStatus("pending");
    expect(pending.length).toBe(1);
    expect(pending[0].type).toBe("keep-this");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("JobQueueService.cancelJobs cancels jobs by reference", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    await ctx.jobQueueService.enqueue({
      type: "ref-cancel",
      referenceType: "entity",
      referenceId: "1",
    });
    await ctx.jobQueueService.enqueue({
      type: "ref-cancel",
      referenceType: "entity",
      referenceId: "2",
    });

    const count = await ctx.jobQueueService.cancelJobs({
      referenceType: "entity",
      referenceId: "1",
      reason: "Entity deleted",
    });

    expect(count).toBe(1);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("JobQueueService.getCancellationStatus returns null for non-cancelled job", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    const job = await ctx.jobQueueService.enqueue({ type: "status-test" });

    const status = await ctx.jobQueueService.getCancellationStatus(job.id);
    expect(status).toBeNull();
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("JobQueueService.getCancellationStatus returns cancellation info for running job", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    const job = await ctx.jobQueueService.enqueue({ type: "status-test" });
    await ctx.jobQueueService.claimJob(job.id);

    // Cancel the running job (marks for cancellation but doesn't delete yet)
    await ctx.jobQueueService.cancelJob(job.id, { reason: "Testing" });

    const status = await ctx.jobQueueService.getCancellationStatus(job.id);
    expect(status).not.toBeNull();
    expect(status!.cancelledAt).toBeInstanceOf(Date);
    expect(status!.reason).toBe("Testing");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("JobQueueService.markJobCancelled marks running job as cancelled", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    const job = await ctx.jobQueueService.enqueue({ type: "mark-test" });
    await ctx.jobQueueService.claimJob(job.id);

    const cancelled = await ctx.jobQueueService.markJobCancelled(job.id, "Handler detected cancellation");

    // markJobCancelled returns the job state before deletion
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.cancelledAt).toBeInstanceOf(Date);
    expect(cancelled.cancelReason).toBe("Handler detected cancellation");
    expect(cancelled.completedAt).toBeInstanceOf(Date);

    // Job should be deleted from the database
    expect(await ctx.jobQueueService.getJob(job.id)).toBeNull();
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("JobQueueService cancelled pending jobs are deleted", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    const job1 = await ctx.jobQueueService.enqueue({ type: "pending-1" });
    await ctx.jobQueueService.enqueue({ type: "pending-2" });

    // Cancel the first job (deleted immediately since it's pending)
    await ctx.jobQueueService.cancelJob(job1.id);

    // Get next should return the second job (first is deleted)
    const next = await ctx.jobQueueService.getNextPendingJob();
    expect(next).not.toBeNull();
    expect(next!.type).toBe("pending-2");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("JobQueueService cancelled pending jobs result in zero cancelled count", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    const job = await ctx.jobQueueService.enqueue({ type: "count-test" });
    await ctx.jobQueueService.cancelJob(job.id);

    // Pending cancelled jobs are deleted immediately
    const counts = await ctx.jobQueueService.getJobCounts();
    expect(counts.cancelled).toBe(0);
    expect(counts.pending).toBe(0);
  } finally {
    await ctx.cleanup();
  }
});

// =============================================================================
// Execution Mode Tests
// =============================================================================

integrationTest("JobQueueService.enqueue defaults to sequential execution mode", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    const job = await ctx.jobQueueService.enqueue({ type: "mode-test" });

    expect(job.executionMode).toBe("sequential");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("JobQueueService.enqueue accepts concurrent execution mode", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    const job = await ctx.jobQueueService.enqueue({
      type: "mode-test",
      executionMode: "concurrent",
    });

    expect(job.executionMode).toBe("concurrent");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("JobQueueService.enqueue allows concurrent jobs with same reference", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    const job1 = await ctx.jobQueueService.enqueue({
      type: "concurrent-test",
      executionMode: "concurrent",
      referenceType: "entity",
      referenceId: "123",
    });

    const job2 = await ctx.jobQueueService.enqueue({
      type: "concurrent-test",
      executionMode: "concurrent",
      referenceType: "entity",
      referenceId: "123",
    });

    expect(job1.id).not.toBe(job2.id);
    expect(job1.referenceId).toBe(123);
    expect(job2.referenceId).toBe(123);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("JobQueueService.enqueue throws DuplicateActiveJobError for sequential jobs with same reference", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    await ctx.jobQueueService.enqueue({
      type: "sequential-test",
      executionMode: "sequential",
      referenceType: "entity",
      referenceId: "123",
    });

    await expect(
      ctx.jobQueueService.enqueue({
        type: "sequential-test",
        executionMode: "sequential",
        referenceType: "entity",
        referenceId: "123",
      }),
    ).rejects.toThrow(DuplicateActiveJobError);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("JobQueueService.enqueue allows sequential job when concurrent exists for same reference", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    // First job is concurrent
    await ctx.jobQueueService.enqueue({
      type: "mixed-mode",
      executionMode: "concurrent",
      referenceType: "entity",
      referenceId: "123",
    });

    // Second job is sequential - should succeed since concurrent doesn't block
    const job2 = await ctx.jobQueueService.enqueue({
      type: "mixed-mode",
      executionMode: "sequential",
      referenceType: "entity",
      referenceId: "123",
    });

    expect(job2.executionMode).toBe("sequential");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("JobQueueService.enqueue allows concurrent job when sequential exists for same reference", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    // First job is sequential
    await ctx.jobQueueService.enqueue({
      type: "mixed-mode",
      executionMode: "sequential",
      referenceType: "entity",
      referenceId: "123",
    });

    // Second job is concurrent - should succeed
    const job2 = await ctx.jobQueueService.enqueue({
      type: "mixed-mode",
      executionMode: "concurrent",
      referenceType: "entity",
      referenceId: "123",
    });

    expect(job2.executionMode).toBe("concurrent");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("TestSetupBuilder.withJob seeds jobs with execution mode", async () => {
  const ctx = await TestSetupBuilder.create()
    .withJob({ type: "seeded-sequential" })
    .withJob({ type: "seeded-concurrent", executionMode: "concurrent" })
    .build();

  try {
    const jobs = await ctx.jobQueueService.getJobsByStatus("pending");

    const seqJob = jobs.find((j) => j.type === "seeded-sequential");
    const concJob = jobs.find((j) => j.type === "seeded-concurrent");

    expect(seqJob!.executionMode).toBe("sequential");
    expect(concJob!.executionMode).toBe("concurrent");
  } finally {
    await ctx.cleanup();
  }
});

// =============================================================================
// Event Subscription Tests
// =============================================================================

integrationTest("JobQueueService.subscribeToCompletion notifies on job completion", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    const job = await ctx.jobQueueService.enqueue({ type: "sub-test" });
    await ctx.jobQueueService.claimJob(job.id);

    let receivedEvent: { type: string; job: { id: RecordId } } | null = null;

    ctx.jobQueueService.subscribeToCompletion(job.id, (event) => {
      receivedEvent = event;
    });

    await ctx.jobQueueService.completeJob(job.id, { done: true });

    expect(receivedEvent).not.toBeNull();
    expect(receivedEvent!.type).toBe("completed");
    expect(receivedEvent!.job.id).toBe(job.id);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("JobQueueService.subscribeToCompletion notifies on job failure", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    const job = await ctx.jobQueueService.enqueue({ type: "sub-test" });
    await ctx.jobQueueService.claimJob(job.id);

    let receivedEvent: { type: string; job: { id: RecordId } } | null = null;

    ctx.jobQueueService.subscribeToCompletion(job.id, (event) => {
      receivedEvent = event;
    });

    await ctx.jobQueueService.failJob(job.id, { error: "test" });

    expect(receivedEvent).not.toBeNull();
    expect(receivedEvent!.type).toBe("failed");
    expect(receivedEvent!.job.id).toBe(job.id);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("JobQueueService.subscribeToCompletion notifies on job cancellation", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    const job = await ctx.jobQueueService.enqueue({ type: "sub-test" });

    let receivedEvent: { type: string; job: { id: RecordId } } | null = null;

    ctx.jobQueueService.subscribeToCompletion(job.id, (event) => {
      receivedEvent = event;
    });

    // Cancel pending job
    await ctx.jobQueueService.cancelJob(job.id, { reason: "test" });

    expect(receivedEvent).not.toBeNull();
    expect(receivedEvent!.type).toBe("cancelled");
    expect(receivedEvent!.job.id).toBe(job.id);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("JobQueueService.subscribeToCompletion unsubscribe works", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    const job = await ctx.jobQueueService.enqueue({ type: "sub-test" });
    await ctx.jobQueueService.claimJob(job.id);

    let callCount = 0;

    const unsubscribe = ctx.jobQueueService.subscribeToCompletion(job.id, () => {
      callCount++;
    });

    // Unsubscribe before completion
    unsubscribe();

    await ctx.jobQueueService.completeJob(job.id);

    // Should not have been called
    expect(callCount).toBe(0);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("JobQueueService.subscribeToCancellation notifies on cancellation request", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    const job = await ctx.jobQueueService.enqueue({ type: "sub-test" });
    await ctx.jobQueueService.claimJob(job.id);

    let receivedEvent: { jobId: RecordId; reason?: string } | null = null;

    ctx.jobQueueService.subscribeToCancellation(job.id, (event) => {
      receivedEvent = event;
    });

    // Cancel running job - this triggers cancellation subscription
    await ctx.jobQueueService.cancelJob(job.id, { reason: "stop now" });

    expect(receivedEvent).not.toBeNull();
    expect(receivedEvent!.jobId).toBe(job.id);
    expect(receivedEvent!.reason).toBe("stop now");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("JobQueueService supports multiple subscribers per job", async () => {
  const ctx = await TestSetupBuilder.create().withJobQueue().build();

  try {
    const job = await ctx.jobQueueService.enqueue({ type: "multi-sub-test" });
    await ctx.jobQueueService.claimJob(job.id);

    let callCount1 = 0;
    let callCount2 = 0;

    ctx.jobQueueService.subscribeToCompletion(job.id, () => {
      callCount1++;
    });
    ctx.jobQueueService.subscribeToCompletion(job.id, () => {
      callCount2++;
    });

    await ctx.jobQueueService.completeJob(job.id);

    expect(callCount1).toBe(1);
    expect(callCount2).toBe(1);
  } finally {
    await ctx.cleanup();
  }
});
