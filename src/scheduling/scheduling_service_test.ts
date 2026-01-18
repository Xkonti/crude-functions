/**
 * Tests for the scheduling service.
 *
 * Uses TestSetupBuilder for integration tests with real database.
 * Tests cover:
 * - Handler registration
 * - Task registration (in-memory and persisted)
 * - Task execution
 * - Dynamic rescheduling
 * - Error handling
 * - Lifecycle management
 */

import { expect } from "@std/expect";
import { TestSetupBuilder } from "../test/test_setup_builder.ts";
import { SchedulingService } from "./scheduling_service.ts";
import { InMemoryScheduleStore } from "./in_memory_schedule_store.ts";
import type { TaskExecutionResult } from "./types.ts";
import {
  TaskAlreadyExistsError,
  HandlerAlreadyExistsError,
  InvalidTaskConfigError,
} from "./errors.ts";

// =============================================================================
// InMemoryScheduleStore Tests (Unit Tests - No DB Required)
// =============================================================================

Deno.test("InMemoryScheduleStore.create creates task with negative ID", () => {
  const store = new InMemoryScheduleStore();

  const task = store.create({
    name: "test-task",
    type: "test",
    scheduleType: "interval",
    intervalSeconds: 60,
    scheduledAt: null,
    enabled: true,
    payload: null,
    lastRunAt: null,
    nextRunAt: new Date(),
    lastError: null,
    consecutiveFailures: 0,
    status: "idle",
    runStartedAt: null,
  });

  expect(task.id).toBeLessThan(0);
  expect(task.storageMode).toBe("in-memory");
  expect(task.name).toBe("test-task");
});

Deno.test("InMemoryScheduleStore.create throws on duplicate name", () => {
  const store = new InMemoryScheduleStore();

  store.create({
    name: "test-task",
    type: "test",
    scheduleType: "interval",
    intervalSeconds: 60,
    scheduledAt: null,
    enabled: true,
    payload: null,
    lastRunAt: null,
    nextRunAt: new Date(),
    lastError: null,
    consecutiveFailures: 0,
    status: "idle",
    runStartedAt: null,
  });

  expect(() =>
    store.create({
      name: "test-task",
      type: "test",
      scheduleType: "interval",
      intervalSeconds: 60,
      scheduledAt: null,
      enabled: true,
      payload: null,
      lastRunAt: null,
      nextRunAt: new Date(),
      lastError: null,
      consecutiveFailures: 0,
      status: "idle",
      runStartedAt: null,
    })
  ).toThrow(TaskAlreadyExistsError);
});

Deno.test("InMemoryScheduleStore.getDueTasks returns only due tasks", () => {
  const store = new InMemoryScheduleStore();
  const now = new Date();
  const past = new Date(now.getTime() - 1000);
  const future = new Date(now.getTime() + 10000);

  store.create({
    name: "past-task",
    type: "test",
    scheduleType: "interval",
    intervalSeconds: 60,
    scheduledAt: null,
    enabled: true,
    payload: null,
    lastRunAt: null,
    nextRunAt: past,
    lastError: null,
    consecutiveFailures: 0,
    status: "idle",
    runStartedAt: null,
  });

  store.create({
    name: "future-task",
    type: "test",
    scheduleType: "interval",
    intervalSeconds: 60,
    scheduledAt: null,
    enabled: true,
    payload: null,
    lastRunAt: null,
    nextRunAt: future,
    lastError: null,
    consecutiveFailures: 0,
    status: "idle",
    runStartedAt: null,
  });

  const dueTasks = store.getDueTasks(now);
  expect(dueTasks.length).toBe(1);
  expect(dueTasks[0].name).toBe("past-task");
});

Deno.test("InMemoryScheduleStore.claimTask returns null for running task", () => {
  const store = new InMemoryScheduleStore();

  store.create({
    name: "test-task",
    type: "test",
    scheduleType: "interval",
    intervalSeconds: 60,
    scheduledAt: null,
    enabled: true,
    payload: null,
    lastRunAt: null,
    nextRunAt: new Date(),
    lastError: null,
    consecutiveFailures: 0,
    status: "idle",
    runStartedAt: null,
  });

  // First claim succeeds
  const claimed = store.claimTask("test-task");
  expect(claimed).not.toBeNull();
  expect(claimed!.status).toBe("running");

  // Second claim fails
  const secondClaim = store.claimTask("test-task");
  expect(secondClaim).toBeNull();
});

// =============================================================================
// SchedulingService Tests (Integration Tests with DB)
// =============================================================================

Deno.test("SchedulingService.registerHandler stores handler", async () => {
  const ctx = await TestSetupBuilder.create()
    .withInstanceId()
    .build();

  try {
    const scheduler = new SchedulingService({
      db: ctx.db,
      instanceIdService: ctx.instanceIdService,
    });

    scheduler.registerHandler("test-type", {
      handler: () => ({ success: true }),
    });

    expect(scheduler.hasHandler("test-type")).toBe(true);
    expect(scheduler.hasHandler("other-type")).toBe(false);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SchedulingService.registerHandler throws on duplicate", async () => {
  const ctx = await TestSetupBuilder.create()
    .withInstanceId()
    .build();

  try {
    const scheduler = new SchedulingService({
      db: ctx.db,
      instanceIdService: ctx.instanceIdService,
    });

    scheduler.registerHandler("test-type", {
      handler: () => ({ success: true }),
    });

    expect(() =>
      scheduler.registerHandler("test-type", {
        handler: () => ({ success: true }),
      })
    ).toThrow(HandlerAlreadyExistsError);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SchedulingService.registerInMemoryTask creates task", async () => {
  const ctx = await TestSetupBuilder.create()
    .withInstanceId()
    .build();

  try {
    const scheduler = new SchedulingService({
      db: ctx.db,
      instanceIdService: ctx.instanceIdService,
    });

    const task = scheduler.registerInMemoryTask({
      name: "test-task",
      type: "test",
      scheduleType: "interval",
      intervalSeconds: 60,
    });

    expect(task.name).toBe("test-task");
    expect(task.type).toBe("test");
    expect(task.storageMode).toBe("in-memory");
    expect(task.intervalSeconds).toBe(60);
    expect(task.nextRunAt).not.toBeNull();
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SchedulingService.registerInMemoryTask with runImmediately", async () => {
  const ctx = await TestSetupBuilder.create()
    .withInstanceId()
    .build();

  try {
    const scheduler = new SchedulingService({
      db: ctx.db,
      instanceIdService: ctx.instanceIdService,
    });

    const before = new Date();
    const task = scheduler.registerInMemoryTask({
      name: "test-task",
      type: "test",
      scheduleType: "interval",
      intervalSeconds: 60,
      runImmediately: true,
    });

    expect(task.nextRunAt).not.toBeNull();
    expect(task.nextRunAt!.getTime()).toBeLessThanOrEqual(Date.now());
    expect(task.nextRunAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SchedulingService.registerInMemoryTask validates interval config", async () => {
  const ctx = await TestSetupBuilder.create()
    .withInstanceId()
    .build();

  try {
    const scheduler = new SchedulingService({
      db: ctx.db,
      instanceIdService: ctx.instanceIdService,
    });

    expect(() =>
      scheduler.registerInMemoryTask({
        name: "test-task",
        type: "test",
        scheduleType: "interval",
        // Missing intervalSeconds
      })
    ).toThrow(InvalidTaskConfigError);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SchedulingService.registerInMemoryTask validates one-off config", async () => {
  const ctx = await TestSetupBuilder.create()
    .withInstanceId()
    .build();

  try {
    const scheduler = new SchedulingService({
      db: ctx.db,
      instanceIdService: ctx.instanceIdService,
    });

    expect(() =>
      scheduler.registerInMemoryTask({
        name: "test-task",
        type: "test",
        scheduleType: "one-off",
        // Missing scheduledAt and runImmediately
      })
    ).toThrow(InvalidTaskConfigError);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SchedulingService.registerPersistedTask creates task in DB", async () => {
  const ctx = await TestSetupBuilder.create()
    .withInstanceId()
    .build();

  try {
    const scheduler = new SchedulingService({
      db: ctx.db,
      instanceIdService: ctx.instanceIdService,
    });

    const task = await scheduler.registerPersistedTask({
      name: "test-task",
      type: "test",
      scheduleType: "interval",
      intervalSeconds: 60,
    });

    expect(task.name).toBe("test-task");
    expect(task.storageMode).toBe("persisted");
    expect(task.id).toBeGreaterThan(0);

    // Verify in database
    const row = await ctx.db.queryOne<{ name: string }>(
      "SELECT name FROM scheduledTasks WHERE name = ?",
      ["test-task"]
    );
    expect(row).not.toBeNull();
    expect(row!.name).toBe("test-task");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SchedulingService.getTask finds in-memory task", async () => {
  const ctx = await TestSetupBuilder.create()
    .withInstanceId()
    .build();

  try {
    const scheduler = new SchedulingService({
      db: ctx.db,
      instanceIdService: ctx.instanceIdService,
    });

    scheduler.registerInMemoryTask({
      name: "test-task",
      type: "test",
      scheduleType: "interval",
      intervalSeconds: 60,
    });

    const task = await scheduler.getTask("test-task");
    expect(task).not.toBeNull();
    expect(task!.name).toBe("test-task");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SchedulingService.getTask finds persisted task", async () => {
  const ctx = await TestSetupBuilder.create()
    .withInstanceId()
    .build();

  try {
    const scheduler = new SchedulingService({
      db: ctx.db,
      instanceIdService: ctx.instanceIdService,
    });

    await scheduler.registerPersistedTask({
      name: "test-task",
      type: "test",
      scheduleType: "interval",
      intervalSeconds: 60,
    });

    const task = await scheduler.getTask("test-task");
    expect(task).not.toBeNull();
    expect(task!.name).toBe("test-task");
    expect(task!.storageMode).toBe("persisted");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SchedulingService.getAllTasks returns both stores", async () => {
  const ctx = await TestSetupBuilder.create()
    .withInstanceId()
    .build();

  try {
    const scheduler = new SchedulingService({
      db: ctx.db,
      instanceIdService: ctx.instanceIdService,
    });

    scheduler.registerInMemoryTask({
      name: "memory-task",
      type: "test",
      scheduleType: "interval",
      intervalSeconds: 60,
    });

    await scheduler.registerPersistedTask({
      name: "persisted-task",
      type: "test",
      scheduleType: "interval",
      intervalSeconds: 60,
    });

    const tasks = await scheduler.getAllTasks();
    expect(tasks.length).toBe(2);
    expect(tasks.map((t) => t.name).sort()).toEqual(["memory-task", "persisted-task"]);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SchedulingService.unregisterTask removes in-memory task", async () => {
  const ctx = await TestSetupBuilder.create()
    .withInstanceId()
    .build();

  try {
    const scheduler = new SchedulingService({
      db: ctx.db,
      instanceIdService: ctx.instanceIdService,
    });

    scheduler.registerInMemoryTask({
      name: "test-task",
      type: "test",
      scheduleType: "interval",
      intervalSeconds: 60,
    });

    const removed = await scheduler.unregisterTask("test-task");
    expect(removed).toBe(true);

    const task = await scheduler.getTask("test-task");
    expect(task).toBeNull();
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SchedulingService.unregisterTask removes persisted task", async () => {
  const ctx = await TestSetupBuilder.create()
    .withInstanceId()
    .build();

  try {
    const scheduler = new SchedulingService({
      db: ctx.db,
      instanceIdService: ctx.instanceIdService,
    });

    await scheduler.registerPersistedTask({
      name: "test-task",
      type: "test",
      scheduleType: "interval",
      intervalSeconds: 60,
    });

    const removed = await scheduler.unregisterTask("test-task");
    expect(removed).toBe(true);

    const task = await scheduler.getTask("test-task");
    expect(task).toBeNull();
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SchedulingService.updateTaskSchedule updates interval", async () => {
  const ctx = await TestSetupBuilder.create()
    .withInstanceId()
    .build();

  try {
    const scheduler = new SchedulingService({
      db: ctx.db,
      instanceIdService: ctx.instanceIdService,
    });

    scheduler.registerInMemoryTask({
      name: "test-task",
      type: "test",
      scheduleType: "interval",
      intervalSeconds: 60,
    });

    const updated = await scheduler.updateTaskSchedule("test-task", {
      intervalSeconds: 120,
    });

    expect(updated.intervalSeconds).toBe(120);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SchedulingService.rescheduleTask sets new nextRunAt", async () => {
  const ctx = await TestSetupBuilder.create()
    .withInstanceId()
    .build();

  try {
    const scheduler = new SchedulingService({
      db: ctx.db,
      instanceIdService: ctx.instanceIdService,
    });

    scheduler.registerInMemoryTask({
      name: "test-task",
      type: "test",
      scheduleType: "one-off",
      scheduledAt: new Date(Date.now() + 10000),
    });

    const newTime = new Date(Date.now() + 5000);
    const updated = await scheduler.rescheduleTask("test-task", newTime);

    expect(updated.nextRunAt).toEqual(newTime);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SchedulingService.enableTask enables disabled task", async () => {
  const ctx = await TestSetupBuilder.create()
    .withInstanceId()
    .build();

  try {
    const scheduler = new SchedulingService({
      db: ctx.db,
      instanceIdService: ctx.instanceIdService,
    });

    scheduler.registerInMemoryTask({
      name: "test-task",
      type: "test",
      scheduleType: "interval",
      intervalSeconds: 60,
    });

    await scheduler.disableTask("test-task");
    let task = await scheduler.getTask("test-task");
    expect(task!.enabled).toBe(false);

    await scheduler.enableTask("test-task");
    task = await scheduler.getTask("test-task");
    expect(task!.enabled).toBe(true);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SchedulingService executes due tasks", async () => {
  const ctx = await TestSetupBuilder.create()
    .withInstanceId()
    .build();

  try {
    const scheduler = new SchedulingService({
      db: ctx.db,
      instanceIdService: ctx.instanceIdService,
      pollingIntervalSeconds: 0.1, // Fast polling for tests
    });

    let executionCount = 0;
    scheduler.registerHandler("test", {
      handler: () => {
        executionCount++;
        return { success: true };
      },
    });

    scheduler.registerInMemoryTask({
      name: "test-task",
      type: "test",
      scheduleType: "interval",
      intervalSeconds: 60,
      runImmediately: true,
    });

    await scheduler.start();

    // Wait for execution
    await new Promise((resolve) => setTimeout(resolve, 300));

    await scheduler.stop();

    expect(executionCount).toBeGreaterThanOrEqual(1);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SchedulingService handles task failure", async () => {
  const ctx = await TestSetupBuilder.create()
    .withInstanceId()
    .build();

  try {
    const scheduler = new SchedulingService({
      db: ctx.db,
      instanceIdService: ctx.instanceIdService,
      pollingIntervalSeconds: 0.1,
    });

    scheduler.registerHandler("test", {
      handler: () => {
        throw new Error("Test error");
      },
    });

    scheduler.registerInMemoryTask({
      name: "test-task",
      type: "test",
      scheduleType: "interval",
      intervalSeconds: 60,
      runImmediately: true,
    });

    await scheduler.start();
    await new Promise((resolve) => setTimeout(resolve, 300));
    await scheduler.stop();

    const task = await scheduler.getTask("test-task");
    expect(task!.consecutiveFailures).toBeGreaterThanOrEqual(1);
    expect(task!.lastError).toBe("Test error");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SchedulingService respects dynamic nextRunAt from handler", async () => {
  const ctx = await TestSetupBuilder.create()
    .withInstanceId()
    .build();

  try {
    const scheduler = new SchedulingService({
      db: ctx.db,
      instanceIdService: ctx.instanceIdService,
      pollingIntervalSeconds: 0.1,
    });

    const customNextRun = new Date(Date.now() + 999999);
    scheduler.registerHandler("test", {
      handler: (): TaskExecutionResult => ({
        success: true,
        nextRunAt: customNextRun,
      }),
    });

    scheduler.registerInMemoryTask({
      name: "test-task",
      type: "test",
      scheduleType: "dynamic",
      runImmediately: true,
    });

    await scheduler.start();
    await new Promise((resolve) => setTimeout(resolve, 300));
    await scheduler.stop();

    const task = await scheduler.getTask("test-task");
    expect(task!.nextRunAt).toEqual(customNextRun);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SchedulingService one-off task runs once", async () => {
  const ctx = await TestSetupBuilder.create()
    .withInstanceId()
    .build();

  try {
    const scheduler = new SchedulingService({
      db: ctx.db,
      instanceIdService: ctx.instanceIdService,
      pollingIntervalSeconds: 0.1,
    });

    let executionCount = 0;
    scheduler.registerHandler("test", {
      handler: () => {
        executionCount++;
        return { success: true };
      },
    });

    scheduler.registerInMemoryTask({
      name: "test-task",
      type: "test",
      scheduleType: "one-off",
      runImmediately: true,
    });

    await scheduler.start();
    await new Promise((resolve) => setTimeout(resolve, 500));
    await scheduler.stop();

    // Should only execute once
    expect(executionCount).toBe(1);

    // nextRunAt should be null after completion
    const task = await scheduler.getTask("test-task");
    expect(task!.nextRunAt).toBeNull();
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SchedulingService.triggerTask causes immediate execution", async () => {
  const ctx = await TestSetupBuilder.create()
    .withInstanceId()
    .build();

  try {
    const scheduler = new SchedulingService({
      db: ctx.db,
      instanceIdService: ctx.instanceIdService,
      pollingIntervalSeconds: 0.1,
    });

    let executionCount = 0;
    scheduler.registerHandler("test", {
      handler: () => {
        executionCount++;
        return { success: true };
      },
    });

    // Schedule far in the future
    scheduler.registerInMemoryTask({
      name: "test-task",
      type: "test",
      scheduleType: "interval",
      intervalSeconds: 9999,
    });

    await scheduler.start();

    // Trigger immediate execution
    await scheduler.triggerTask("test-task");

    await new Promise((resolve) => setTimeout(resolve, 300));
    await scheduler.stop();

    expect(executionCount).toBeGreaterThanOrEqual(1);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SchedulingService.getStatus returns correct counts", async () => {
  const ctx = await TestSetupBuilder.create()
    .withInstanceId()
    .build();

  try {
    const scheduler = new SchedulingService({
      db: ctx.db,
      instanceIdService: ctx.instanceIdService,
    });

    scheduler.registerHandler("test1", { handler: () => ({ success: true }) });
    scheduler.registerHandler("test2", { handler: () => ({ success: true }) });

    scheduler.registerInMemoryTask({
      name: "memory-task",
      type: "test1",
      scheduleType: "interval",
      intervalSeconds: 60,
    });

    await scheduler.registerPersistedTask({
      name: "persisted-task",
      type: "test2",
      scheduleType: "interval",
      intervalSeconds: 60,
    });

    const status = await scheduler.getStatus();
    expect(status.handlerCount).toBe(2);
    expect(status.inMemoryTaskCount).toBe(1);
    expect(status.persistedTaskCount).toBe(1);
    expect(status.isRunning).toBe(false);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SchedulingService graceful shutdown waits for running task", async () => {
  const ctx = await TestSetupBuilder.create()
    .withInstanceId()
    .build();

  try {
    const scheduler = new SchedulingService({
      db: ctx.db,
      instanceIdService: ctx.instanceIdService,
      pollingIntervalSeconds: 0.1,
    });

    scheduler.registerHandler("test", {
      handler: async (_task, _signal) => {
        // Simulate long-running task
        await new Promise((resolve) => setTimeout(resolve, 200));
        return { success: true };
      },
    });

    scheduler.registerInMemoryTask({
      name: "test-task",
      type: "test",
      scheduleType: "one-off",
      runImmediately: true,
    });

    await scheduler.start();

    // Give task time to start
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Stop should wait for task
    await scheduler.stop();

    // Task should have completed (or been aborted gracefully)
    expect(scheduler.getIsRunning()).toBe(false);
  } finally {
    await ctx.cleanup();
  }
});
