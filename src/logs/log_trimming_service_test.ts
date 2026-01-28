import { integrationTest } from "../test/test_helpers.ts";
import { expect } from "@std/expect";
import { LogTrimmingService } from "./log_trimming_service.ts";
import { TestSetupBuilder } from "../test/test_setup_builder.ts";
import type { BaseTestContext, LogsContext, FunctionsContext } from "../test/types.ts";
import { recordIdToString } from "../database/surreal_helpers.ts";

type LogTrimmingTestContext = BaseTestContext & LogsContext & FunctionsContext;

/**
 * Creates a test context with logs and routes services,
 * plus a LogTrimmingService with the given configuration.
 * Returns the function IDs as strings for use in tests.
 */
async function createTestSetup(
  options: {
    intervalSeconds?: number;
    maxLogsPerRoute?: number;
    retentionSeconds?: number;
  } = {}
): Promise<{
  ctx: LogTrimmingTestContext;
  trimmingService: LogTrimmingService;
  functionId1: string;
  functionId2: string;
}> {
  const ctx = await TestSetupBuilder.create()
    .withLogs()
    .withFunction("/test-route-1", "test1.ts", { name: "test-route-1" })
    .withFunction("/test-route-2", "test2.ts", { name: "test-route-2" })
    .build();

  const trimmingService = new LogTrimmingService({
    logService: ctx.consoleLogService,
    config: {
      trimmingIntervalSeconds: options.intervalSeconds ?? 60,
      maxLogsPerRoute: options.maxLogsPerRoute ?? 100,
      retentionSeconds: options.retentionSeconds ?? 86400, // 1 day default
    },
  });

  // Get the function IDs for use in tests
  const route1 = await ctx.functionsService.getByName("test-route-1");
  const route2 = await ctx.functionsService.getByName("test-route-2");

  return {
    ctx,
    trimmingService,
    functionId1: recordIdToString(route1!.id),
    functionId2: recordIdToString(route2!.id),
  };
}

async function cleanup(setup: {
  ctx: LogTrimmingTestContext;
}): Promise<void> {
  await setup.ctx.cleanup();
}

// =====================
// Time-based retention tests
// =====================

integrationTest("LogTrimmingService deletes logs older than retention period", async () => {
  // Use a very short retention (1 second) so we can test it
  const setup = await createTestSetup({ retentionSeconds: 1 });

  try {
    // Store a log
    setup.ctx.consoleLogService.store({
      requestId: "old-request",
      functionId: setup.functionId1,
      level: "log",
      message: "Old message",
    });
    await setup.ctx.consoleLogService.flush();

    // Wait for 2 seconds to ensure the log is older than retention
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Store a recent log
    setup.ctx.consoleLogService.store({
      requestId: "new-request",
      functionId: setup.functionId1,
      level: "log",
      message: "New message",
    });
    await setup.ctx.consoleLogService.flush();

    // Run trimming
    const result = await setup.trimmingService.performTrimming();

    // Should have deleted old log
    expect(result.deletedByAge).toBe(1);

    // Old log should be deleted, new log should remain
    const oldLogs = await setup.ctx.consoleLogService.getByRequestId("old-request");
    expect(oldLogs.length).toBe(0);

    const newLogs = await setup.ctx.consoleLogService.getByRequestId("new-request");
    expect(newLogs.length).toBe(1);
  } finally {
    await cleanup(setup);
  }
});

integrationTest("LogTrimmingService skips time-based deletion when retentionSeconds is 0", async () => {
  const setup = await createTestSetup({ retentionSeconds: 0 }); // Disabled

  try {
    // Store a log
    setup.ctx.consoleLogService.store({
      requestId: "test-request",
      functionId: setup.functionId1,
      level: "log",
      message: "Test message",
    });
    await setup.ctx.consoleLogService.flush();

    // Run trimming
    const result = await setup.trimmingService.performTrimming();

    // No time-based deletions (disabled)
    expect(result.deletedByAge).toBe(0);

    // Log should still exist (time-based deletion disabled)
    const logs = await setup.ctx.consoleLogService.getByRequestId("test-request");
    expect(logs.length).toBe(1);
  } finally {
    await cleanup(setup);
  }
});

// =====================
// Count-based trimming tests
// =====================

integrationTest("LogTrimmingService trims logs exceeding max per function", async () => {
  const setup = await createTestSetup({ maxLogsPerRoute: 5 }); // Max 5 logs per function

  try {
    // Store 10 logs for function 1
    for (let i = 0; i < 10; i++) {
      setup.ctx.consoleLogService.store({
        requestId: `request-${i}`,
        functionId: setup.functionId1,
        level: "log",
        message: `Message ${i}`,
      });
    }
    await setup.ctx.consoleLogService.flush();

    // Run trimming
    const result = await setup.trimmingService.performTrimming();

    // Should have trimmed 5 logs (10 - 5 = 5)
    expect(result.trimmedByCount).toBe(5);

    // Should have only 5 logs remaining
    const logs = await setup.ctx.consoleLogService.getByFunctionId(setup.functionId1);
    expect(logs.length).toBe(5);
    // Newest should be kept (DESC order)
    expect(logs[0].message).toBe("Message 9");
  } finally {
    await cleanup(setup);
  }
});

integrationTest("LogTrimmingService processes multiple functions independently", async () => {
  const setup = await createTestSetup({ maxLogsPerRoute: 3 });

  try {
    // Store different numbers of logs per function
    for (let i = 0; i < 5; i++) {
      setup.ctx.consoleLogService.store({
        requestId: `f1-${i}`,
        functionId: setup.functionId1,
        level: "log",
        message: `Function1 ${i}`,
      });
    }
    for (let i = 0; i < 2; i++) {
      setup.ctx.consoleLogService.store({
        requestId: `f2-${i}`,
        functionId: setup.functionId2,
        level: "log",
        message: `Function2 ${i}`,
      });
    }
    await setup.ctx.consoleLogService.flush();

    // Run trimming
    const result = await setup.trimmingService.performTrimming();

    // Should have trimmed 2 logs from function 1 (5 - 3 = 2)
    expect(result.trimmedByCount).toBe(2);

    // Function 1: 5 -> 3 (trimmed)
    const func1Logs = await setup.ctx.consoleLogService.getByFunctionId(setup.functionId1);
    expect(func1Logs.length).toBe(3);

    // Function 2: 2 -> 2 (unchanged, under limit)
    const func2Logs = await setup.ctx.consoleLogService.getByFunctionId(setup.functionId2);
    expect(func2Logs.length).toBe(2);
  } finally {
    await cleanup(setup);
  }
});

// =====================
// Execution tests
// =====================

integrationTest("LogTrimmingService can be called multiple times", async () => {
  const setup = await createTestSetup({ maxLogsPerRoute: 5 });

  try {
    // Store some logs
    for (let i = 0; i < 10; i++) {
      setup.ctx.consoleLogService.store({
        requestId: `request-${i}`,
        functionId: setup.functionId1,
        level: "log",
        message: `Message ${i}`,
      });
    }
    await setup.ctx.consoleLogService.flush();

    // First trim
    const result1 = await setup.trimmingService.performTrimming();
    expect(result1.trimmedByCount).toBe(5);

    // Second trim should do nothing (already at limit)
    const result2 = await setup.trimmingService.performTrimming();
    expect(result2.trimmedByCount).toBe(0);

    // Logs should still be at 5
    const logs = await setup.ctx.consoleLogService.getByFunctionId(setup.functionId1);
    expect(logs.length).toBe(5);
  } finally {
    await cleanup(setup);
  }
});

integrationTest("LogTrimmingService does nothing when no logs exist", async () => {
  const setup = await createTestSetup();

  try {
    // Run trimming with no logs
    const result = await setup.trimmingService.performTrimming();

    // Nothing should be deleted
    expect(result.deletedByAge).toBe(0);
    expect(result.trimmedByCount).toBe(0);

    // No logs created
    const logs = await setup.ctx.consoleLogService.getRecent(100);
    expect(logs.length).toBe(0);
  } finally {
    await cleanup(setup);
  }
});

// =====================
// getDistinctFunctionIds tests
// =====================

integrationTest("LogTrimmingService handles logs with empty functionId", async () => {
  const setup = await createTestSetup({ maxLogsPerRoute: 5 });

  try {
    // Store a log with empty functionId (orphaned log)
    setup.ctx.consoleLogService.store({
      requestId: "orphan-request",
      functionId: "",
      level: "log",
      message: "Orphan message",
    });

    // Insert normal logs
    for (let i = 0; i < 3; i++) {
      setup.ctx.consoleLogService.store({
        requestId: `normal-${i}`,
        functionId: setup.functionId1,
        level: "log",
        message: `Normal ${i}`,
      });
    }
    await setup.ctx.consoleLogService.flush();

    // Run trimming - should not fail on empty functionId
    const result = await setup.trimmingService.performTrimming();

    // No count-based trimming needed (under limit)
    expect(result.trimmedByCount).toBe(0);

    // Orphan log should still exist (empty functionId is not processed by per-function trimming)
    const orphanLogs = await setup.ctx.consoleLogService.getByRequestId("orphan-request");
    expect(orphanLogs.length).toBe(1);

    // Normal logs should still exist (under limit)
    const normalLogs = await setup.ctx.consoleLogService.getByFunctionId(setup.functionId1);
    expect(normalLogs.length).toBe(3);
  } finally {
    await cleanup(setup);
  }
});
