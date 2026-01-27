import { integrationTest } from "../test/test_helpers.ts";
import { expect } from "@std/expect";
import { TestSetupBuilder } from "../test/test_setup_builder.ts";
import type { BaseTestContext, LogsContext, RoutesContext } from "../test/types.ts";
import { recordIdToString } from "../database/surreal_helpers.ts";

type LogsTestContext = BaseTestContext & LogsContext & RoutesContext & {
  functionId1: string;
  functionId2: string;
};

/**
 * Creates a test context with logs and routes services.
 * Also creates two test routes for testing function-related log operations.
 * Returns the function IDs as strings for use in tests.
 */
async function createTestSetup(): Promise<LogsTestContext> {
  const ctx = await TestSetupBuilder.create()
    .withLogs()
    .withRoute("/test-route-1", "test1.ts", { name: "test-route-1" })
    .withRoute("/test-route-2", "test2.ts", { name: "test-route-2" })
    .build();

  // Get the function IDs for use in tests
  const route1 = await ctx.routesService.getByName("test-route-1");
  const route2 = await ctx.routesService.getByName("test-route-2");

  return {
    ...ctx,
    functionId1: recordIdToString(route1!.id),
    functionId2: recordIdToString(route2!.id),
  };
}

async function cleanup(ctx: LogsTestContext): Promise<void> {
  await ctx.cleanup();
}

// =====================
// ConsoleLogService tests
// =====================

integrationTest("ConsoleLogService stores log entry", async () => {
  const ctx = await createTestSetup();

  try {
    ctx.consoleLogService.store({
      requestId: "test-request-1",
      functionId: ctx.functionId1,
      level: "log",
      message: "Test message",
    });

    // Shutdown flushes buffered logs
    await ctx.consoleLogService.shutdown();

    const logs = await ctx.consoleLogService.getByRequestId("test-request-1");
    expect(logs.length).toBe(1);
    expect(logs[0].requestId).toBe("test-request-1");
    expect(logs[0].functionId).toBe(ctx.functionId1);
    expect(logs[0].level).toBe("log");
    expect(logs[0].message).toBe("Test message");
  } finally {
    await cleanup(ctx);
  }
});

integrationTest("ConsoleLogService stores log with args", async () => {
  const ctx = await createTestSetup();

  try {
    ctx.consoleLogService.store({
      requestId: "test-request-1",
      functionId: ctx.functionId1,
      level: "debug",
      message: "Debug message",
      args: JSON.stringify([{ key: "value" }, 42]),
    });

    await ctx.consoleLogService.shutdown();
    const logs = await ctx.consoleLogService.getByRequestId("test-request-1");
    expect(logs.length).toBe(1);
    expect(logs[0].args).toBe('[{"key":"value"},42]');
  } finally {
    await cleanup(ctx);
  }
});

integrationTest("ConsoleLogService retrieves logs by requestId", async () => {
  const ctx = await createTestSetup();

  try {
    // Store logs for different requests
    ctx.consoleLogService.store({
      requestId: "request-1",
      functionId: ctx.functionId1,
      level: "log",
      message: "Message 1",
    });
    ctx.consoleLogService.store({
      requestId: "request-2",
      functionId: ctx.functionId1,
      level: "log",
      message: "Message 2",
    });
    ctx.consoleLogService.store({
      requestId: "request-1",
      functionId: ctx.functionId1,
      level: "warn",
      message: "Message 3",
    });

    await ctx.consoleLogService.shutdown();
    const logs = await ctx.consoleLogService.getByRequestId("request-1");
    expect(logs.length).toBe(2);
    expect(logs[0].message).toBe("Message 1");
    expect(logs[1].message).toBe("Message 3");
  } finally {
    await cleanup(ctx);
  }
});

integrationTest("ConsoleLogService retrieves logs by functionId", async () => {
  const ctx = await createTestSetup();

  try {
    // Store logs for different functions
    ctx.consoleLogService.store({
      requestId: "request-1",
      functionId: ctx.functionId1,
      level: "log",
      message: "Function 1 - Message 1",
    });
    ctx.consoleLogService.store({
      requestId: "request-2",
      functionId: ctx.functionId2,
      level: "log",
      message: "Function 2 - Message 1",
    });
    ctx.consoleLogService.store({
      requestId: "request-3",
      functionId: ctx.functionId1,
      level: "warn",
      message: "Function 1 - Message 2",
    });

    await ctx.consoleLogService.shutdown();
    const logs = await ctx.consoleLogService.getByFunctionId(ctx.functionId1);
    expect(logs.length).toBe(2);
    // Results are ordered newest to oldest (DESC)
    expect(logs[0].message).toBe("Function 1 - Message 2");
    expect(logs[1].message).toBe("Function 1 - Message 1");
  } finally {
    await cleanup(ctx);
  }
});

integrationTest("ConsoleLogService retrieves logs by functionId with limit", async () => {
  const ctx = await createTestSetup();

  try {
    // Store multiple logs
    for (let i = 0; i < 5; i++) {
      ctx.consoleLogService.store({
        requestId: `request-${i}`,
        functionId: ctx.functionId1,
        level: "log",
        message: `Message ${i}`,
      });
    }

    await ctx.consoleLogService.shutdown();
    const logs = await ctx.consoleLogService.getByFunctionId(ctx.functionId1, 3);
    expect(logs.length).toBe(3);
    // Results are ordered newest to oldest (DESC), limit 3 gets most recent
    expect(logs[0].message).toBe("Message 4");
    expect(logs[2].message).toBe("Message 2");
  } finally {
    await cleanup(ctx);
  }
});

integrationTest("ConsoleLogService getRecent returns most recent logs", async () => {
  const ctx = await createTestSetup();

  try {
    // Store logs
    for (let i = 0; i < 5; i++) {
      ctx.consoleLogService.store({
        requestId: `request-${i}`,
        functionId: ctx.functionId1,
        level: "log",
        message: `Message ${i}`,
      });
    }

    await ctx.consoleLogService.shutdown();
    const logs = await ctx.consoleLogService.getRecent(3);
    expect(logs.length).toBe(3);
    // Most recent first (DESC order)
    expect(logs[0].message).toBe("Message 4");
    expect(logs[1].message).toBe("Message 3");
    expect(logs[2].message).toBe("Message 2");
  } finally {
    await cleanup(ctx);
  }
});

integrationTest("ConsoleLogService deletes logs older than date", async () => {
  const ctx = await createTestSetup();

  try {
    // Store a log
    ctx.consoleLogService.store({
      requestId: "old-request",
      functionId: ctx.functionId1,
      level: "log",
      message: "Old message",
    });

    await ctx.consoleLogService.shutdown();

    // Delete logs older than 1 second from now
    const futureDate = new Date(Date.now() + 1000);
    const deleted = await ctx.consoleLogService.deleteOlderThan(futureDate);

    expect(deleted).toBe(1);

    const logs = await ctx.consoleLogService.getByRequestId("old-request");
    expect(logs.length).toBe(0);
  } finally {
    await cleanup(ctx);
  }
});

integrationTest("ConsoleLogService deletes logs older than cutoff date", async () => {
  const ctx = await createTestSetup();

  try {
    // Store a log
    ctx.consoleLogService.store({
      requestId: "test-request",
      functionId: ctx.functionId1,
      level: "log",
      message: "Test message",
    });

    await ctx.consoleLogService.shutdown();

    // Verify log was stored
    const logs = await ctx.consoleLogService.getByRequestId("test-request");
    expect(logs.length).toBe(1);

    // Delete logs older than a future date (should delete all logs)
    const futureDate = new Date(Date.now() + 60000);
    const deleted = await ctx.consoleLogService.deleteOlderThan(futureDate);
    expect(deleted).toBe(1);

    // Verify log was deleted
    const logsAfter = await ctx.consoleLogService.getByRequestId("test-request");
    expect(logsAfter.length).toBe(0);
  } finally {
    await cleanup(ctx);
  }
});

integrationTest("ConsoleLogService deletes logs by functionId", async () => {
  const ctx = await createTestSetup();

  try {
    // Store logs for different functions
    ctx.consoleLogService.store({
      requestId: "request-1",
      functionId: ctx.functionId1,
      level: "log",
      message: "Function 1 message",
    });
    ctx.consoleLogService.store({
      requestId: "request-2",
      functionId: ctx.functionId2,
      level: "log",
      message: "Function 2 message",
    });

    await ctx.consoleLogService.shutdown();

    const deleted = await ctx.consoleLogService.deleteByFunctionId(ctx.functionId1);
    expect(deleted).toBe(1);

    const logsFunc1 = await ctx.consoleLogService.getByFunctionId(ctx.functionId1);
    expect(logsFunc1.length).toBe(0);

    const logsFunc2 = await ctx.consoleLogService.getByFunctionId(ctx.functionId2);
    expect(logsFunc2.length).toBe(1);
  } finally {
    await cleanup(ctx);
  }
});

integrationTest("ConsoleLogService stores all log levels", async () => {
  const ctx = await createTestSetup();

  try {
    const levels = ["log", "debug", "info", "warn", "error", "trace"] as const;

    for (const level of levels) {
      ctx.consoleLogService.store({
        requestId: "request-1",
        functionId: ctx.functionId1,
        level,
        message: `${level} message`,
      });
    }

    await ctx.consoleLogService.shutdown();
    const logs = await ctx.consoleLogService.getByRequestId("request-1");
    expect(logs.length).toBe(6);

    for (let i = 0; i < levels.length; i++) {
      expect(logs[i].level).toBe(levels[i]);
      expect(logs[i].message).toBe(`${levels[i]} message`);
    }
  } finally {
    await cleanup(ctx);
  }
});

// =====================
// trimToLimit tests
// =====================

integrationTest("ConsoleLogService trimToLimit keeps newest logs when over limit", async () => {
  const ctx = await createTestSetup();

  try {
    // Store 10 logs for function 1
    for (let i = 0; i < 10; i++) {
      ctx.consoleLogService.store({
        requestId: `request-${i}`,
        functionId: ctx.functionId1,
        level: "log",
        message: `Message ${i}`,
      });
    }

    await ctx.consoleLogService.shutdown();

    // Trim to keep only 5 logs
    const deleted = await ctx.consoleLogService.trimToLimit(ctx.functionId1, 5);

    expect(deleted).toBe(5);

    const logs = await ctx.consoleLogService.getByFunctionId(ctx.functionId1);
    expect(logs.length).toBe(5);
    // Newest logs should remain (DESC order, so first is newest)
    expect(logs[0].message).toBe("Message 9");
    expect(logs[4].message).toBe("Message 5");
  } finally {
    await cleanup(ctx);
  }
});

integrationTest("ConsoleLogService trimToLimit returns 0 when under limit", async () => {
  const ctx = await createTestSetup();

  try {
    // Store 3 logs
    for (let i = 0; i < 3; i++) {
      ctx.consoleLogService.store({
        requestId: `request-${i}`,
        functionId: ctx.functionId1,
        level: "log",
        message: `Message ${i}`,
      });
    }

    await ctx.consoleLogService.shutdown();

    // Trim to limit of 5 (more than we have)
    const deleted = await ctx.consoleLogService.trimToLimit(ctx.functionId1, 5);

    expect(deleted).toBe(0);

    const logs = await ctx.consoleLogService.getByFunctionId(ctx.functionId1);
    expect(logs.length).toBe(3);
  } finally {
    await cleanup(ctx);
  }
});

integrationTest("ConsoleLogService trimToLimit only affects specified function", async () => {
  const ctx = await createTestSetup();

  try {
    // Store logs for two functions
    for (let i = 0; i < 10; i++) {
      ctx.consoleLogService.store({
        requestId: `f1-request-${i}`,
        functionId: ctx.functionId1,
        level: "log",
        message: `Function 1 - Message ${i}`,
      });
      ctx.consoleLogService.store({
        requestId: `f2-request-${i}`,
        functionId: ctx.functionId2,
        level: "log",
        message: `Function 2 - Message ${i}`,
      });
    }

    await ctx.consoleLogService.shutdown();

    // Trim only function 1
    const deleted = await ctx.consoleLogService.trimToLimit(ctx.functionId1, 3);

    expect(deleted).toBe(7);

    const func1Logs = await ctx.consoleLogService.getByFunctionId(ctx.functionId1);
    expect(func1Logs.length).toBe(3);

    // Function 2 should be unchanged
    const func2Logs = await ctx.consoleLogService.getByFunctionId(ctx.functionId2);
    expect(func2Logs.length).toBe(10);
  } finally {
    await cleanup(ctx);
  }
});

// =====================
// getPaginated tests
// =====================

integrationTest("ConsoleLogService - getPaginated returns logs across all functions", async () => {
  const ctx = await createTestSetup();

  try {
    // Insert test logs across multiple functions
    ctx.consoleLogService.store({
      requestId: "req1",
      functionId: ctx.functionId1,
      level: "info",
      message: "Function 1 log 1",
    });
    ctx.consoleLogService.store({
      requestId: "req2",
      functionId: ctx.functionId1,
      level: "info",
      message: "Function 1 log 2",
    });
    ctx.consoleLogService.store({
      requestId: "req3",
      functionId: ctx.functionId2,
      level: "info",
      message: "Function 2 log 1",
    });
    ctx.consoleLogService.store({
      requestId: "req4",
      functionId: ctx.functionId2,
      level: "info",
      message: "Function 2 log 2",
    });

    await ctx.consoleLogService.shutdown();

    const result = await ctx.consoleLogService.getPaginated({
      limit: 2,
    });

    expect(result.logs.length).toBe(2);
    expect(result.logs[0].message).toBe("Function 2 log 2"); // newest first
    expect(result.logs[1].message).toBe("Function 2 log 1");
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBeDefined();
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("ConsoleLogService - getPaginated filters by functionId", async () => {
  const ctx = await createTestSetup();

  try {
    ctx.consoleLogService.store({
      requestId: "req1",
      functionId: ctx.functionId1,
      level: "info",
      message: "Function 1 log",
    });
    ctx.consoleLogService.store({
      requestId: "req2",
      functionId: ctx.functionId2,
      level: "info",
      message: "Function 2 log",
    });

    await ctx.consoleLogService.shutdown();

    const result = await ctx.consoleLogService.getPaginated({
      functionId: ctx.functionId1,
      limit: 10,
    });

    expect(result.logs.length).toBe(1);
    expect(result.logs[0].message).toBe("Function 1 log");
    expect(result.logs[0].functionId).toBe(ctx.functionId1);
    expect(result.hasMore).toBe(false);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("ConsoleLogService - getPaginated uses cursor for next page", async () => {
  const ctx = await createTestSetup();

  try {
    ctx.consoleLogService.store({
      requestId: "req1",
      functionId: ctx.functionId1,
      level: "info",
      message: "Log 1",
    });
    ctx.consoleLogService.store({
      requestId: "req2",
      functionId: ctx.functionId1,
      level: "info",
      message: "Log 2",
    });
    ctx.consoleLogService.store({
      requestId: "req3",
      functionId: ctx.functionId1,
      level: "info",
      message: "Log 3",
    });

    await ctx.consoleLogService.shutdown();

    const page1 = await ctx.consoleLogService.getPaginated({ limit: 2 });
    expect(page1.logs.length).toBe(2);
    expect(page1.hasMore).toBe(true);

    const page2 = await ctx.consoleLogService.getPaginated({
      limit: 2,
      cursor: page1.nextCursor,
    });
    expect(page2.logs.length).toBe(1);
    expect(page2.logs[0].message).toBe("Log 1");
    expect(page2.hasMore).toBe(false);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("ConsoleLogService - getPaginated handles logs with same timestamp", async () => {
  const ctx = await createTestSetup();

  try {
    // Store logs in quick succession - they may have same or different timestamps
    ctx.consoleLogService.store({
      requestId: "req1",
      functionId: ctx.functionId1,
      level: "info",
      message: "Log A",
    });
    ctx.consoleLogService.store({
      requestId: "req2",
      functionId: ctx.functionId1,
      level: "info",
      message: "Log B",
    });
    ctx.consoleLogService.store({
      requestId: "req3",
      functionId: ctx.functionId1,
      level: "info",
      message: "Log C",
    });

    await ctx.consoleLogService.shutdown();

    const page1 = await ctx.consoleLogService.getPaginated({ limit: 2 });
    expect(page1.logs.length).toBe(2);

    const page2 = await ctx.consoleLogService.getPaginated({
      limit: 2,
      cursor: page1.nextCursor,
    });
    expect(page2.logs.length).toBe(1);

    // All three logs should be unique across both pages
    const allMessages = [...page1.logs, ...page2.logs].map(l => l.message).sort();
    expect(allMessages).toEqual(["Log A", "Log B", "Log C"]);
  } finally {
    await ctx.cleanup();
  }
});
