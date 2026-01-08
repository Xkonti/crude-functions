import { expect } from "@std/expect";
import { TestSetupBuilder } from "../test/test_setup_builder.ts";
import type { BaseTestContext, LogsContext, RoutesContext } from "../test/types.ts";

type LogsTestContext = BaseTestContext & LogsContext & RoutesContext;

/**
 * Creates a test context with logs and routes services.
 * Also creates two test routes (IDs 1 and 2) for testing route-related log operations.
 */
async function createTestSetup(): Promise<LogsTestContext> {
  const ctx = await TestSetupBuilder.create()
    .withLogs()
    .withRoute("/test-route-1", "test1.ts")
    .withRoute("/test-route-2", "test2.ts")
    .build();

  return ctx;
}

async function cleanup(ctx: LogsTestContext): Promise<void> {
  await ctx.cleanup();
}

// =====================
// ConsoleLogService tests
// =====================

Deno.test("ConsoleLogService stores log entry", async () => {
  const ctx = await createTestSetup();

  try {
    ctx.consoleLogService.store({
      requestId: "test-request-1",
      routeId: 1,
      level: "log",
      message: "Test message",
    });

    // Shutdown flushes buffered logs
    await ctx.consoleLogService.shutdown();

    const logs = await ctx.consoleLogService.getByRequestId("test-request-1");
    expect(logs.length).toBe(1);
    expect(logs[0].requestId).toBe("test-request-1");
    expect(logs[0].routeId).toBe(1);
    expect(logs[0].level).toBe("log");
    expect(logs[0].message).toBe("Test message");
  } finally {
    await cleanup(ctx);
  }
});

Deno.test("ConsoleLogService stores log with args", async () => {
  const ctx = await createTestSetup();

  try {
    ctx.consoleLogService.store({
      requestId: "test-request-1",
      routeId: 1,
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

Deno.test("ConsoleLogService retrieves logs by requestId", async () => {
  const ctx = await createTestSetup();

  try {
    // Store logs for different requests
    ctx.consoleLogService.store({
      requestId: "request-1",
      routeId: 1,
      level: "log",
      message: "Message 1",
    });
    ctx.consoleLogService.store({
      requestId: "request-2",
      routeId: 1,
      level: "log",
      message: "Message 2",
    });
    ctx.consoleLogService.store({
      requestId: "request-1",
      routeId: 1,
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

Deno.test("ConsoleLogService retrieves logs by routeId", async () => {
  const ctx = await createTestSetup();

  try {
    // Store logs for different routes
    ctx.consoleLogService.store({
      requestId: "request-1",
      routeId: 1,
      level: "log",
      message: "Route 1 - Message 1",
    });
    ctx.consoleLogService.store({
      requestId: "request-2",
      routeId: 2,
      level: "log",
      message: "Route 2 - Message 1",
    });
    ctx.consoleLogService.store({
      requestId: "request-3",
      routeId: 1,
      level: "warn",
      message: "Route 1 - Message 2",
    });

    await ctx.consoleLogService.shutdown();
    const logs = await ctx.consoleLogService.getByRouteId(1);
    expect(logs.length).toBe(2);
    // Results are ordered newest to oldest (DESC)
    expect(logs[0].message).toBe("Route 1 - Message 2");
    expect(logs[1].message).toBe("Route 1 - Message 1");
  } finally {
    await cleanup(ctx);
  }
});

Deno.test("ConsoleLogService retrieves logs by routeId with limit", async () => {
  const ctx = await createTestSetup();

  try {
    // Store multiple logs
    for (let i = 0; i < 5; i++) {
      ctx.consoleLogService.store({
        requestId: `request-${i}`,
        routeId: 1,
        level: "log",
        message: `Message ${i}`,
      });
    }

    await ctx.consoleLogService.shutdown();
    const logs = await ctx.consoleLogService.getByRouteId(1, 3);
    expect(logs.length).toBe(3);
    // Results are ordered newest to oldest (DESC), limit 3 gets most recent
    expect(logs[0].message).toBe("Message 4");
    expect(logs[2].message).toBe("Message 2");
  } finally {
    await cleanup(ctx);
  }
});

Deno.test("ConsoleLogService getRecent returns most recent logs", async () => {
  const ctx = await createTestSetup();

  try {
    // Store logs
    for (let i = 0; i < 5; i++) {
      ctx.consoleLogService.store({
        requestId: `request-${i}`,
        routeId: 1,
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

Deno.test("ConsoleLogService deletes logs older than date", async () => {
  const ctx = await createTestSetup();

  try {
    // Store a log
    ctx.consoleLogService.store({
      requestId: "old-request",
      routeId: 1,
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

Deno.test("ConsoleLogService deletes logs with mixed timestamp formats", async () => {
  const ctx = await createTestSetup();

  try {
    // Manually insert logs with SQLite format timestamps (simulating old data from DB)
    const oldDate = new Date("2020-01-01T12:00:00.000Z");
    const sqliteFormat = oldDate.toISOString().replace("T", " ").slice(0, 19);

    await ctx.db.execute(
      `INSERT INTO executionLogs (requestId, routeId, level, message, timestamp)
       VALUES (?, ?, ?, ?, ?)`,
      ["old-sqlite-format", 1, "log", "Old SQLite format log", sqliteFormat]
    );

    // Also insert a newer log using the service
    ctx.consoleLogService.store({
      requestId: "newer-request",
      routeId: 1,
      level: "log",
      message: "Newer message",
    });

    await ctx.consoleLogService.shutdown();

    // Delete logs older than a date between the two logs
    const cutoffDate = new Date("2021-01-01T00:00:00.000Z");
    const deleted = await ctx.consoleLogService.deleteOlderThan(cutoffDate);

    // Should delete the old SQLite-format log but not the newer one
    expect(deleted).toBe(1);

    const oldLogs = await ctx.consoleLogService.getByRequestId("old-sqlite-format");
    expect(oldLogs.length).toBe(0);

    const newLogs = await ctx.consoleLogService.getByRequestId("newer-request");
    expect(newLogs.length).toBe(1);
  } finally {
    await cleanup(ctx);
  }
});

Deno.test("ConsoleLogService deletes logs by routeId", async () => {
  const ctx = await createTestSetup();

  try {
    // Store logs for different routes
    ctx.consoleLogService.store({
      requestId: "request-1",
      routeId: 1,
      level: "log",
      message: "Route 1 message",
    });
    ctx.consoleLogService.store({
      requestId: "request-2",
      routeId: 2,
      level: "log",
      message: "Route 2 message",
    });

    await ctx.consoleLogService.shutdown();

    const deleted = await ctx.consoleLogService.deleteByRouteId(1);
    expect(deleted).toBe(1);

    const logsRoute1 = await ctx.consoleLogService.getByRouteId(1);
    expect(logsRoute1.length).toBe(0);

    const logsRoute2 = await ctx.consoleLogService.getByRouteId(2);
    expect(logsRoute2.length).toBe(1);
  } finally {
    await cleanup(ctx);
  }
});

Deno.test("ConsoleLogService stores all log levels", async () => {
  const ctx = await createTestSetup();

  try {
    const levels = ["log", "debug", "info", "warn", "error", "trace"] as const;

    for (const level of levels) {
      ctx.consoleLogService.store({
        requestId: "request-1",
        routeId: 1,
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
