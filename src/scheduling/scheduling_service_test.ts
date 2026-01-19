import { expect } from "@std/expect";
import { TestSetupBuilder } from "../test/test_setup_builder.ts";
import { SchedulingService } from "./scheduling_service.ts";
import { JobProcessorService } from "../jobs/job_processor_service.ts";
import {
  ScheduleNotFoundError,
  DuplicateScheduleError,
  InvalidScheduleConfigError,
  ScheduleStateError,
} from "./errors.ts";

// =============================================================================
// Schedule Registration - One-off
// =============================================================================

Deno.test("SchedulingService.registerSchedule creates one-off schedule", async () => {
  const ctx = await TestSetupBuilder.create().withScheduling().build();

  try {
    const futureDate = new Date(Date.now() + 3600000); // 1 hour from now

    const schedule = await ctx.schedulingService.registerSchedule({
      name: "test-oneoff",
      type: "one_off",
      nextRunAt: futureDate,
      jobType: "test-job",
      jobPayload: { data: "test" },
    });

    expect(schedule.name).toBe("test-oneoff");
    expect(schedule.type).toBe("one_off");
    expect(schedule.status).toBe("active");
    expect(schedule.nextRunAt).toEqual(futureDate);
    expect(schedule.jobType).toBe("test-job");
    expect(schedule.jobPayload).toEqual({ data: "test" });
    expect(schedule.isPersistent).toBe(true);
    expect(schedule.consecutiveFailures).toBe(0);
  } finally {
    await ctx.schedulingService.stop();
    await ctx.cleanup();
  }
});

Deno.test("SchedulingService.registerSchedule creates one-off with custom options", async () => {
  const ctx = await TestSetupBuilder.create().withScheduling().build();

  try {
    const futureDate = new Date(Date.now() + 3600000);

    const schedule = await ctx.schedulingService.registerSchedule({
      name: "test-oneoff-custom",
      type: "one_off",
      nextRunAt: futureDate,
      jobType: "test-job",
      jobPriority: 10,
      jobMaxRetries: 3,
      maxConsecutiveFailures: 10,
      isPersistent: false,
      description: "A test schedule",
    });

    expect(schedule.jobPriority).toBe(10);
    expect(schedule.jobMaxRetries).toBe(3);
    expect(schedule.maxConsecutiveFailures).toBe(10);
    expect(schedule.isPersistent).toBe(false);
    expect(schedule.description).toBe("A test schedule");
  } finally {
    await ctx.schedulingService.stop();
    await ctx.cleanup();
  }
});

// =============================================================================
// Schedule Registration - Interval
// =============================================================================

Deno.test("SchedulingService.registerSchedule creates sequential interval schedule", async () => {
  const ctx = await TestSetupBuilder.create().withScheduling().build();

  try {
    const schedule = await ctx.schedulingService.registerSchedule({
      name: "test-interval",
      type: "sequential_interval",
      intervalMs: 60000, // 1 minute
      jobType: "cleanup-job",
    });

    expect(schedule.name).toBe("test-interval");
    expect(schedule.type).toBe("sequential_interval");
    expect(schedule.intervalMs).toBe(60000);
    expect(schedule.nextRunAt).not.toBeNull();
    // nextRunAt should be approximately now + intervalMs
    const expectedTime = Date.now() + 60000;
    expect(schedule.nextRunAt!.getTime()).toBeGreaterThan(expectedTime - 5000);
    expect(schedule.nextRunAt!.getTime()).toBeLessThan(expectedTime + 5000);
  } finally {
    await ctx.schedulingService.stop();
    await ctx.cleanup();
  }
});

Deno.test("SchedulingService.registerSchedule creates concurrent interval schedule", async () => {
  const ctx = await TestSetupBuilder.create().withScheduling().build();

  try {
    const schedule = await ctx.schedulingService.registerSchedule({
      name: "test-concurrent",
      type: "concurrent_interval",
      intervalMs: 30000, // 30 seconds
      jobType: "metrics-job",
    });

    expect(schedule.name).toBe("test-concurrent");
    expect(schedule.type).toBe("concurrent_interval");
    expect(schedule.intervalMs).toBe(30000);
  } finally {
    await ctx.schedulingService.stop();
    await ctx.cleanup();
  }
});

// =============================================================================
// Schedule Registration - Dynamic
// =============================================================================

Deno.test("SchedulingService.registerSchedule creates dynamic schedule", async () => {
  const ctx = await TestSetupBuilder.create().withScheduling().build();

  try {
    const startTime = new Date(Date.now() + 10000);

    const schedule = await ctx.schedulingService.registerSchedule({
      name: "test-dynamic",
      type: "dynamic",
      nextRunAt: startTime,
      jobType: "adaptive-job",
    });

    expect(schedule.name).toBe("test-dynamic");
    expect(schedule.type).toBe("dynamic");
    expect(schedule.nextRunAt).toEqual(startTime);
  } finally {
    await ctx.schedulingService.stop();
    await ctx.cleanup();
  }
});

// =============================================================================
// Schedule Registration - Validation
// =============================================================================

Deno.test("SchedulingService.registerSchedule throws on duplicate name", async () => {
  const ctx = await TestSetupBuilder.create().withScheduling().build();

  try {
    await ctx.schedulingService.registerSchedule({
      name: "duplicate",
      type: "one_off",
      nextRunAt: new Date(Date.now() + 3600000),
      jobType: "test-job",
    });

    await expect(
      ctx.schedulingService.registerSchedule({
        name: "duplicate",
        type: "one_off",
        nextRunAt: new Date(Date.now() + 7200000),
        jobType: "test-job",
      }),
    ).rejects.toThrow(DuplicateScheduleError);
  } finally {
    await ctx.schedulingService.stop();
    await ctx.cleanup();
  }
});

Deno.test("SchedulingService.registerSchedule validates one_off requires nextRunAt", async () => {
  const ctx = await TestSetupBuilder.create().withScheduling().build();

  try {
    await expect(
      ctx.schedulingService.registerSchedule({
        name: "invalid",
        type: "one_off",
        // nextRunAt missing
        jobType: "test-job",
      }),
    ).rejects.toThrow(InvalidScheduleConfigError);
  } finally {
    await ctx.schedulingService.stop();
    await ctx.cleanup();
  }
});

Deno.test("SchedulingService.registerSchedule validates dynamic requires nextRunAt", async () => {
  const ctx = await TestSetupBuilder.create().withScheduling().build();

  try {
    await expect(
      ctx.schedulingService.registerSchedule({
        name: "invalid",
        type: "dynamic",
        // nextRunAt missing
        jobType: "test-job",
      }),
    ).rejects.toThrow(InvalidScheduleConfigError);
  } finally {
    await ctx.schedulingService.stop();
    await ctx.cleanup();
  }
});

Deno.test("SchedulingService.registerSchedule validates interval requires intervalMs", async () => {
  const ctx = await TestSetupBuilder.create().withScheduling().build();

  try {
    await expect(
      ctx.schedulingService.registerSchedule({
        name: "invalid",
        type: "sequential_interval",
        // intervalMs missing
        jobType: "test-job",
      }),
    ).rejects.toThrow(InvalidScheduleConfigError);
  } finally {
    await ctx.schedulingService.stop();
    await ctx.cleanup();
  }
});

Deno.test("SchedulingService.registerSchedule validates empty name", async () => {
  const ctx = await TestSetupBuilder.create().withScheduling().build();

  try {
    await expect(
      ctx.schedulingService.registerSchedule({
        name: "",
        type: "one_off",
        nextRunAt: new Date(Date.now() + 3600000),
        jobType: "test-job",
      }),
    ).rejects.toThrow(InvalidScheduleConfigError);
  } finally {
    await ctx.schedulingService.stop();
    await ctx.cleanup();
  }
});

Deno.test("SchedulingService.registerSchedule validates empty jobType", async () => {
  const ctx = await TestSetupBuilder.create().withScheduling().build();

  try {
    await expect(
      ctx.schedulingService.registerSchedule({
        name: "test",
        type: "one_off",
        nextRunAt: new Date(Date.now() + 3600000),
        jobType: "",
      }),
    ).rejects.toThrow(InvalidScheduleConfigError);
  } finally {
    await ctx.schedulingService.stop();
    await ctx.cleanup();
  }
});

// =============================================================================
// Schedule Lifecycle - Cancel/Pause/Resume
// =============================================================================

Deno.test("SchedulingService.cancelSchedule marks schedule as completed", async () => {
  const ctx = await TestSetupBuilder.create().withScheduling().build();

  try {
    await ctx.schedulingService.registerSchedule({
      name: "to-cancel",
      type: "sequential_interval",
      intervalMs: 60000,
      jobType: "test-job",
    });

    const cancelled = await ctx.schedulingService.cancelSchedule("to-cancel");

    expect(cancelled.status).toBe("completed");
    expect(cancelled.nextRunAt).toBeNull();
  } finally {
    await ctx.schedulingService.stop();
    await ctx.cleanup();
  }
});

Deno.test("SchedulingService.cancelSchedule throws for non-existent schedule", async () => {
  const ctx = await TestSetupBuilder.create().withScheduling().build();

  try {
    await expect(
      ctx.schedulingService.cancelSchedule("non-existent"),
    ).rejects.toThrow(ScheduleNotFoundError);
  } finally {
    await ctx.schedulingService.stop();
    await ctx.cleanup();
  }
});

Deno.test("SchedulingService.pauseSchedule pauses active schedule", async () => {
  const ctx = await TestSetupBuilder.create().withScheduling().build();

  try {
    await ctx.schedulingService.registerSchedule({
      name: "to-pause",
      type: "sequential_interval",
      intervalMs: 60000,
      jobType: "test-job",
    });

    const paused = await ctx.schedulingService.pauseSchedule("to-pause");

    expect(paused.status).toBe("paused");
  } finally {
    await ctx.schedulingService.stop();
    await ctx.cleanup();
  }
});

Deno.test("SchedulingService.pauseSchedule throws for non-active schedule", async () => {
  const ctx = await TestSetupBuilder.create().withScheduling().build();

  try {
    await ctx.schedulingService.registerSchedule({
      name: "to-pause",
      type: "sequential_interval",
      intervalMs: 60000,
      jobType: "test-job",
    });

    await ctx.schedulingService.pauseSchedule("to-pause");

    // Try to pause again
    await expect(
      ctx.schedulingService.pauseSchedule("to-pause"),
    ).rejects.toThrow(ScheduleStateError);
  } finally {
    await ctx.schedulingService.stop();
    await ctx.cleanup();
  }
});

Deno.test("SchedulingService.resumeSchedule resumes paused schedule", async () => {
  const ctx = await TestSetupBuilder.create().withScheduling().build();

  try {
    await ctx.schedulingService.registerSchedule({
      name: "to-resume",
      type: "sequential_interval",
      intervalMs: 60000,
      jobType: "test-job",
    });

    await ctx.schedulingService.pauseSchedule("to-resume");
    const resumed = await ctx.schedulingService.resumeSchedule("to-resume");

    expect(resumed.status).toBe("active");
    expect(resumed.nextRunAt).not.toBeNull();
  } finally {
    await ctx.schedulingService.stop();
    await ctx.cleanup();
  }
});

Deno.test("SchedulingService.resumeSchedule throws for non-paused schedule", async () => {
  const ctx = await TestSetupBuilder.create().withScheduling().build();

  try {
    await ctx.schedulingService.registerSchedule({
      name: "active-schedule",
      type: "sequential_interval",
      intervalMs: 60000,
      jobType: "test-job",
    });

    // Try to resume an active schedule
    await expect(
      ctx.schedulingService.resumeSchedule("active-schedule"),
    ).rejects.toThrow(ScheduleStateError);
  } finally {
    await ctx.schedulingService.stop();
    await ctx.cleanup();
  }
});

// =============================================================================
// Schedule Queries
// =============================================================================

Deno.test("SchedulingService.getSchedule returns schedule by name", async () => {
  const ctx = await TestSetupBuilder.create().withScheduling().build();

  try {
    await ctx.schedulingService.registerSchedule({
      name: "test-get",
      type: "one_off",
      nextRunAt: new Date(Date.now() + 3600000),
      jobType: "test-job",
    });

    const schedule = await ctx.schedulingService.getSchedule("test-get");

    expect(schedule).not.toBeNull();
    expect(schedule!.name).toBe("test-get");
  } finally {
    await ctx.schedulingService.stop();
    await ctx.cleanup();
  }
});

Deno.test("SchedulingService.getSchedule returns null for non-existent", async () => {
  const ctx = await TestSetupBuilder.create().withScheduling().build();

  try {
    const schedule = await ctx.schedulingService.getSchedule("non-existent");
    expect(schedule).toBeNull();
  } finally {
    await ctx.schedulingService.stop();
    await ctx.cleanup();
  }
});

Deno.test("SchedulingService.getSchedules returns all schedules", async () => {
  const ctx = await TestSetupBuilder.create().withScheduling().build();

  try {
    await ctx.schedulingService.registerSchedule({
      name: "schedule-1",
      type: "one_off",
      nextRunAt: new Date(Date.now() + 3600000),
      jobType: "test-job",
    });

    await ctx.schedulingService.registerSchedule({
      name: "schedule-2",
      type: "sequential_interval",
      intervalMs: 60000,
      jobType: "test-job",
    });

    const schedules = await ctx.schedulingService.getSchedules();

    expect(schedules.length).toBe(2);
    expect(schedules.map((s) => s.name)).toContain("schedule-1");
    expect(schedules.map((s) => s.name)).toContain("schedule-2");
  } finally {
    await ctx.schedulingService.stop();
    await ctx.cleanup();
  }
});

Deno.test("SchedulingService.getSchedules filters by status", async () => {
  const ctx = await TestSetupBuilder.create().withScheduling().build();

  try {
    await ctx.schedulingService.registerSchedule({
      name: "active-schedule",
      type: "sequential_interval",
      intervalMs: 60000,
      jobType: "test-job",
    });

    await ctx.schedulingService.registerSchedule({
      name: "paused-schedule",
      type: "sequential_interval",
      intervalMs: 60000,
      jobType: "test-job",
    });
    await ctx.schedulingService.pauseSchedule("paused-schedule");

    const activeSchedules = await ctx.schedulingService.getSchedules("active");
    const pausedSchedules = await ctx.schedulingService.getSchedules("paused");

    expect(activeSchedules.length).toBe(1);
    expect(activeSchedules[0].name).toBe("active-schedule");
    expect(pausedSchedules.length).toBe(1);
    expect(pausedSchedules[0].name).toBe("paused-schedule");
  } finally {
    await ctx.schedulingService.stop();
    await ctx.cleanup();
  }
});

// =============================================================================
// Delete Schedule
// =============================================================================

Deno.test("SchedulingService.deleteSchedule removes schedule", async () => {
  const ctx = await TestSetupBuilder.create().withScheduling().build();

  try {
    await ctx.schedulingService.registerSchedule({
      name: "to-delete",
      type: "sequential_interval",
      intervalMs: 60000,
      jobType: "test-job",
    });

    await ctx.schedulingService.deleteSchedule("to-delete");

    const schedule = await ctx.schedulingService.getSchedule("to-delete");
    expect(schedule).toBeNull();
  } finally {
    await ctx.schedulingService.stop();
    await ctx.cleanup();
  }
});

Deno.test("SchedulingService.deleteSchedule throws for non-existent", async () => {
  const ctx = await TestSetupBuilder.create().withScheduling().build();

  try {
    await expect(
      ctx.schedulingService.deleteSchedule("non-existent"),
    ).rejects.toThrow(ScheduleNotFoundError);
  } finally {
    await ctx.schedulingService.stop();
    await ctx.cleanup();
  }
});

// =============================================================================
// Manual Trigger
// =============================================================================

Deno.test("SchedulingService.triggerNow creates job immediately", async () => {
  const ctx = await TestSetupBuilder.create().withScheduling().build();

  try {
    await ctx.schedulingService.registerSchedule({
      name: "manual-trigger",
      type: "sequential_interval",
      intervalMs: 3600000, // 1 hour - won't trigger naturally
      jobType: "trigger-test",
      jobPayload: { manual: true },
    });

    const job = await ctx.schedulingService.triggerNow("manual-trigger");

    expect(job).not.toBeNull();
    expect(job.type).toBe("trigger-test");
    expect(job.payload).toEqual({ manual: true });
    expect(job.status).toBe("pending");
  } finally {
    await ctx.schedulingService.stop();
    await ctx.cleanup();
  }
});

Deno.test("SchedulingService.triggerNow works for paused schedules", async () => {
  const ctx = await TestSetupBuilder.create().withScheduling().build();

  try {
    await ctx.schedulingService.registerSchedule({
      name: "paused-trigger",
      type: "sequential_interval",
      intervalMs: 3600000,
      jobType: "trigger-test",
    });

    await ctx.schedulingService.pauseSchedule("paused-trigger");
    const job = await ctx.schedulingService.triggerNow("paused-trigger");

    expect(job).not.toBeNull();
    expect(job.type).toBe("trigger-test");
  } finally {
    await ctx.schedulingService.stop();
    await ctx.cleanup();
  }
});

Deno.test("SchedulingService.triggerNow throws for completed schedule", async () => {
  const ctx = await TestSetupBuilder.create().withScheduling().build();

  try {
    await ctx.schedulingService.registerSchedule({
      name: "completed-trigger",
      type: "sequential_interval",
      intervalMs: 3600000,
      jobType: "trigger-test",
    });

    await ctx.schedulingService.cancelSchedule("completed-trigger");

    await expect(
      ctx.schedulingService.triggerNow("completed-trigger"),
    ).rejects.toThrow(ScheduleStateError);
  } finally {
    await ctx.schedulingService.stop();
    await ctx.cleanup();
  }
});

// =============================================================================
// Schedule Execution - One-off
// =============================================================================

Deno.test("SchedulingService triggers one-off schedule at scheduled time", async () => {
  const ctx = await TestSetupBuilder.create().withScheduling().build();

  try {
    // Schedule to run in 100ms
    const triggerTime = new Date(Date.now() + 100);

    await ctx.schedulingService.registerSchedule({
      name: "soon-oneoff",
      type: "one_off",
      nextRunAt: triggerTime,
      jobType: "oneoff-job",
    });

    ctx.schedulingService.start();

    // Wait for trigger
    await new Promise((r) => setTimeout(r, 300));

    // Check that job was created
    const jobs = await ctx.jobQueueService.getJobsByType("oneoff-job");
    expect(jobs.length).toBe(1);
    expect(jobs[0].status).toBe("pending");

    // Schedule should be completed
    const schedule = await ctx.schedulingService.getSchedule("soon-oneoff");
    expect(schedule!.status).toBe("completed");
  } finally {
    await ctx.schedulingService.stop();
    await ctx.cleanup();
  }
});

// =============================================================================
// Transient Schedules
// =============================================================================

Deno.test("SchedulingService clears transient schedules on startup", async () => {
  const ctx = await TestSetupBuilder.create().withScheduling().build();

  try {
    // Create a transient schedule directly (bypassing service to avoid auto-cleanup)
    await ctx.db.execute(
      `INSERT INTO schedules (name, type, status, isPersistent, nextRunAt, jobType)
       VALUES (?, 'one_off', 'active', 0, ?, 'test-job')`,
      ["transient-schedule", new Date(Date.now() + 3600000).toISOString()],
    );

    // Create a persistent schedule
    await ctx.db.execute(
      `INSERT INTO schedules (name, type, status, isPersistent, nextRunAt, jobType)
       VALUES (?, 'one_off', 'active', 1, ?, 'test-job')`,
      ["persistent-schedule", new Date(Date.now() + 3600000).toISOString()],
    );

    // Start service (which should clear transient schedules)
    ctx.schedulingService.start();

    // Wait for startup
    await new Promise((r) => setTimeout(r, 100));

    // Transient schedule should be gone
    const transient =
      await ctx.schedulingService.getSchedule("transient-schedule");
    expect(transient).toBeNull();

    // Persistent schedule should remain
    const persistent =
      await ctx.schedulingService.getSchedule("persistent-schedule");
    expect(persistent).not.toBeNull();
  } finally {
    await ctx.schedulingService.stop();
    await ctx.cleanup();
  }
});

// =============================================================================
// Sequential Interval - Completion Handling
// =============================================================================

Deno.test("SchedulingService sequential_interval waits for job completion", async () => {
  const ctx = await TestSetupBuilder.create().withScheduling().build();

  const processor = new JobProcessorService({
    jobQueueService: ctx.jobQueueService,
    instanceIdService: ctx.instanceIdService,
    config: { pollingIntervalSeconds: 60 },
  });

  // Use a new scheduling service with shorter check interval for testing
  const schedulingService = new SchedulingService({
    db: ctx.db,
    jobQueueService: ctx.jobQueueService,
    config: { completionCheckIntervalMs: 50 },
  });

  try {
    processor.registerHandler("seq-interval-job", () => {
      return { success: true };
    });

    await schedulingService.registerSchedule({
      name: "seq-interval",
      type: "sequential_interval",
      intervalMs: 5000, // Long enough that second trigger won't happen during test
      nextRunAt: new Date(Date.now() + 50), // Start soon
      jobType: "seq-interval-job",
    });

    schedulingService.start();

    // Wait for first trigger
    await new Promise((r) => setTimeout(r, 150));

    // Process the job
    await processor.processOne();

    // Wait for completion to be detected
    await new Promise((r) => setTimeout(r, 200));

    // Check schedule has new nextRunAt and completion was recorded
    const schedule = await schedulingService.getSchedule("seq-interval");
    expect(schedule!.status).toBe("active");
    expect(schedule!.activeJobId).toBeNull();
    expect(schedule!.lastCompletedAt).not.toBeNull();
    // nextRunAt should be set to approximately now + 5000ms
    expect(schedule!.nextRunAt).not.toBeNull();
    expect(schedule!.nextRunAt!.getTime()).toBeGreaterThan(Date.now() + 4000);
  } finally {
    await schedulingService.stop();
    await processor.stop();
    await ctx.cleanup();
  }
});

// =============================================================================
// Dynamic Schedules
// =============================================================================

Deno.test("SchedulingService dynamic schedule uses handler result for next time", async () => {
  const ctx = await TestSetupBuilder.create().withScheduling().build();

  const processor = new JobProcessorService({
    jobQueueService: ctx.jobQueueService,
    instanceIdService: ctx.instanceIdService,
    config: { pollingIntervalSeconds: 60 },
  });

  const schedulingService = new SchedulingService({
    db: ctx.db,
    jobQueueService: ctx.jobQueueService,
    config: { completionCheckIntervalMs: 50 },
  });

  try {
    const nextTime = new Date(Date.now() + 60000);

    processor.registerHandler("dynamic-job", () => {
      return { nextRunAt: nextTime };
    });

    await schedulingService.registerSchedule({
      name: "dynamic",
      type: "dynamic",
      nextRunAt: new Date(Date.now() + 50),
      jobType: "dynamic-job",
    });

    schedulingService.start();

    // Wait for trigger
    await new Promise((r) => setTimeout(r, 150));

    // Process the job
    await processor.processOne();

    // Wait for completion detection
    await new Promise((r) => setTimeout(r, 200));

    const schedule = await schedulingService.getSchedule("dynamic");
    expect(schedule!.nextRunAt?.getTime()).toBe(nextTime.getTime());
    expect(schedule!.status).toBe("active");
  } finally {
    await schedulingService.stop();
    await processor.stop();
    await ctx.cleanup();
  }
});

Deno.test("SchedulingService dynamic schedule completes when handler returns no next time", async () => {
  const ctx = await TestSetupBuilder.create().withScheduling().build();

  const processor = new JobProcessorService({
    jobQueueService: ctx.jobQueueService,
    instanceIdService: ctx.instanceIdService,
    config: { pollingIntervalSeconds: 60 },
  });

  const schedulingService = new SchedulingService({
    db: ctx.db,
    jobQueueService: ctx.jobQueueService,
    config: { completionCheckIntervalMs: 50 },
  });

  try {
    processor.registerHandler("dynamic-final-job", () => {
      return { nextRunAt: null }; // No more runs
    });

    await schedulingService.registerSchedule({
      name: "dynamic-final",
      type: "dynamic",
      nextRunAt: new Date(Date.now() + 50),
      jobType: "dynamic-final-job",
    });

    schedulingService.start();

    await new Promise((r) => setTimeout(r, 150));
    await processor.processOne();
    await new Promise((r) => setTimeout(r, 200));

    const schedule = await schedulingService.getSchedule("dynamic-final");
    expect(schedule!.status).toBe("completed");
  } finally {
    await schedulingService.stop();
    await processor.stop();
    await ctx.cleanup();
  }
});

// =============================================================================
// Service Lifecycle
// =============================================================================

Deno.test("SchedulingService.isRunning returns correct state", async () => {
  const ctx = await TestSetupBuilder.create().withScheduling().build();

  try {
    expect(ctx.schedulingService.isRunning()).toBe(false);

    ctx.schedulingService.start();
    await new Promise((r) => setTimeout(r, 50));
    expect(ctx.schedulingService.isRunning()).toBe(true);

    await ctx.schedulingService.stop();
    expect(ctx.schedulingService.isRunning()).toBe(false);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SchedulingService.start is idempotent", async () => {
  const ctx = await TestSetupBuilder.create().withScheduling().build();

  try {
    ctx.schedulingService.start();
    ctx.schedulingService.start(); // Should not throw or cause issues
    await new Promise((r) => setTimeout(r, 50));
    expect(ctx.schedulingService.isRunning()).toBe(true);
  } finally {
    await ctx.schedulingService.stop();
    await ctx.cleanup();
  }
});
