import { integrationTest } from "../test/test_helpers.ts";
import { expect } from "@std/expect";
import { TestSetupBuilder } from "../test/test_setup_builder.ts";
import type { BaseTestContext, LogsContext, RoutesContext } from "../test/types.ts";
import { recordIdToString } from "../database/surreal_helpers.ts";

type LogsTestContext = BaseTestContext & LogsContext & RoutesContext & {
  routeId1: string;
  routeId2: string;
};

/**
 * Creates a test context with logs and routes services.
 * Also creates two test routes for testing route-related log operations.
 * Returns the route IDs as strings for use in tests.
 */
async function createTestSetup(): Promise<LogsTestContext> {
  const ctx = await TestSetupBuilder.create()
    .withLogs()
    .withRoute("/test-route-1", "test1.ts")
    .withRoute("/test-route-2", "test2.ts")
    .build();

  // Get the route IDs for use in tests
  const route1 = await ctx.routesService.getByName("test-route-1");
  const route2 = await ctx.routesService.getByName("test-route-2");

  return {
    ...ctx,
    routeId1: recordIdToString(route1!.id),
    routeId2: recordIdToString(route2!.id),
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
      routeId: ctx.routeId1,
      level: "log",
      message: "Test message",
    });

    // Shutdown flushes buffered logs
    await ctx.consoleLogService.shutdown();

    const logs = await ctx.consoleLogService.getByRequestId("test-request-1");
    expect(logs.length).toBe(1);
    expect(logs[0].requestId).toBe("test-request-1");
    expect(logs[0].routeId).toBe(ctx.routeId1);
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
      routeId: ctx.routeId1,
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
      routeId: ctx.routeId1,
      level: "log",
      message: "Message 1",
    });
    ctx.consoleLogService.store({
      requestId: "request-2",
      routeId: ctx.routeId1,
      level: "log",
      message: "Message 2",
    });
    ctx.consoleLogService.store({
      requestId: "request-1",
      routeId: ctx.routeId1,
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

integrationTest("ConsoleLogService retrieves logs by routeId", async () => {
  const ctx = await createTestSetup();

  try {
    // Store logs for different routes
    ctx.consoleLogService.store({
      requestId: "request-1",
      routeId: ctx.routeId1,
      level: "log",
      message: "Route 1 - Message 1",
    });
    ctx.consoleLogService.store({
      requestId: "request-2",
      routeId: ctx.routeId2,
      level: "log",
      message: "Route 2 - Message 1",
    });
    ctx.consoleLogService.store({
      requestId: "request-3",
      routeId: ctx.routeId1,
      level: "warn",
      message: "Route 1 - Message 2",
    });

    await ctx.consoleLogService.shutdown();
    const logs = await ctx.consoleLogService.getByRouteId(ctx.routeId1);
    expect(logs.length).toBe(2);
    // Results are ordered newest to oldest (DESC)
    expect(logs[0].message).toBe("Route 1 - Message 2");
    expect(logs[1].message).toBe("Route 1 - Message 1");
  } finally {
    await cleanup(ctx);
  }
});

integrationTest("ConsoleLogService retrieves logs by routeId with limit", async () => {
  const ctx = await createTestSetup();

  try {
    // Store multiple logs
    for (let i = 0; i < 5; i++) {
      ctx.consoleLogService.store({
        requestId: `request-${i}`,
        routeId: ctx.routeId1,
        level: "log",
        message: `Message ${i}`,
      });
    }

    await ctx.consoleLogService.shutdown();
    const logs = await ctx.consoleLogService.getByRouteId(ctx.routeId1, 3);
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
        routeId: ctx.routeId1,
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
      routeId: ctx.routeId1,
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

integrationTest("ConsoleLogService deletes logs with mixed timestamp formats", async () => {
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
      routeId: ctx.routeId1,
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

integrationTest("ConsoleLogService deletes logs by routeId", async () => {
  const ctx = await createTestSetup();

  try {
    // Store logs for different routes
    ctx.consoleLogService.store({
      requestId: "request-1",
      routeId: ctx.routeId1,
      level: "log",
      message: "Route 1 message",
    });
    ctx.consoleLogService.store({
      requestId: "request-2",
      routeId: ctx.routeId2,
      level: "log",
      message: "Route 2 message",
    });

    await ctx.consoleLogService.shutdown();

    const deleted = await ctx.consoleLogService.deleteByRouteId(ctx.routeId1);
    expect(deleted).toBe(1);

    const logsRoute1 = await ctx.consoleLogService.getByRouteId(ctx.routeId1);
    expect(logsRoute1.length).toBe(0);

    const logsRoute2 = await ctx.consoleLogService.getByRouteId(ctx.routeId2);
    expect(logsRoute2.length).toBe(1);
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
        routeId: ctx.routeId1,
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
    // Store 10 logs for route 1
    for (let i = 0; i < 10; i++) {
      ctx.consoleLogService.store({
        requestId: `request-${i}`,
        routeId: ctx.routeId1,
        level: "log",
        message: `Message ${i}`,
      });
    }

    await ctx.consoleLogService.shutdown();

    // Trim to keep only 5 logs
    const deleted = await ctx.consoleLogService.trimToLimit(ctx.routeId1, 5);

    expect(deleted).toBe(5);

    const logs = await ctx.consoleLogService.getByRouteId(ctx.routeId1);
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
        routeId: ctx.routeId1,
        level: "log",
        message: `Message ${i}`,
      });
    }

    await ctx.consoleLogService.shutdown();

    // Trim to limit of 5 (more than we have)
    const deleted = await ctx.consoleLogService.trimToLimit(ctx.routeId1, 5);

    expect(deleted).toBe(0);

    const logs = await ctx.consoleLogService.getByRouteId(ctx.routeId1);
    expect(logs.length).toBe(3);
  } finally {
    await cleanup(ctx);
  }
});

integrationTest("ConsoleLogService trimToLimit only affects specified route", async () => {
  const ctx = await createTestSetup();

  try {
    // Store logs for two routes
    for (let i = 0; i < 10; i++) {
      ctx.consoleLogService.store({
        requestId: `r1-request-${i}`,
        routeId: ctx.routeId1,
        level: "log",
        message: `Route 1 - Message ${i}`,
      });
      ctx.consoleLogService.store({
        requestId: `r2-request-${i}`,
        routeId: ctx.routeId2,
        level: "log",
        message: `Route 2 - Message ${i}`,
      });
    }

    await ctx.consoleLogService.shutdown();

    // Trim only route 1
    const deleted = await ctx.consoleLogService.trimToLimit(ctx.routeId1, 3);

    expect(deleted).toBe(7);

    const route1Logs = await ctx.consoleLogService.getByRouteId(ctx.routeId1);
    expect(route1Logs.length).toBe(3);

    // Route 2 should be unchanged
    const route2Logs = await ctx.consoleLogService.getByRouteId(ctx.routeId2);
    expect(route2Logs.length).toBe(10);
  } finally {
    await cleanup(ctx);
  }
});

// =====================
// getPaginated tests
// =====================

integrationTest("ConsoleLogService - getPaginated returns logs across all routes", async () => {
  const ctx = await createTestSetup();

  try {
    // Insert test logs across multiple routes using actual route IDs
    await ctx.db.execute(
      `INSERT INTO executionLogs (requestId, routeId, level, message, args, timestamp)
       VALUES (?, ?, 'info', 'Route 1 log 1', NULL, '2026-01-08 10:00:00.000')`,
      ["req1", ctx.routeId1]
    );
    await ctx.db.execute(
      `INSERT INTO executionLogs (requestId, routeId, level, message, args, timestamp)
       VALUES (?, ?, 'info', 'Route 1 log 2', NULL, '2026-01-08 10:00:01.000')`,
      ["req2", ctx.routeId1]
    );
    await ctx.db.execute(
      `INSERT INTO executionLogs (requestId, routeId, level, message, args, timestamp)
       VALUES (?, ?, 'info', 'Route 2 log 1', NULL, '2026-01-08 10:00:02.000')`,
      ["req3", ctx.routeId2]
    );
    await ctx.db.execute(
      `INSERT INTO executionLogs (requestId, routeId, level, message, args, timestamp)
       VALUES (?, ?, 'info', 'Route 2 log 2', NULL, '2026-01-08 10:00:03.000')`,
      ["req4", ctx.routeId2]
    );

    const result = await ctx.consoleLogService.getPaginated({
      limit: 2,
    });

    expect(result.logs.length).toBe(2);
    expect(result.logs[0].message).toBe("Route 2 log 2"); // newest first
    expect(result.logs[1].message).toBe("Route 2 log 1");
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBeDefined();
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("ConsoleLogService - getPaginated filters by routeId", async () => {
  const ctx = await createTestSetup();

  try {
    await ctx.db.execute(
      `INSERT INTO executionLogs (requestId, routeId, level, message, args, timestamp)
       VALUES (?, ?, 'info', 'Route 1 log', NULL, '2026-01-08 10:00:00.000')`,
      ["req1", ctx.routeId1]
    );
    await ctx.db.execute(
      `INSERT INTO executionLogs (requestId, routeId, level, message, args, timestamp)
       VALUES (?, ?, 'info', 'Route 2 log', NULL, '2026-01-08 10:00:01.000')`,
      ["req2", ctx.routeId2]
    );

    const result = await ctx.consoleLogService.getPaginated({
      routeId: ctx.routeId1,
      limit: 10,
    });

    expect(result.logs.length).toBe(1);
    expect(result.logs[0].message).toBe("Route 1 log");
    expect(result.logs[0].routeId).toBe(ctx.routeId1);
    expect(result.hasMore).toBe(false);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("ConsoleLogService - getPaginated uses cursor for next page", async () => {
  const ctx = await createTestSetup();

  try {
    await ctx.db.execute(
      `INSERT INTO executionLogs (requestId, routeId, level, message, args, timestamp)
       VALUES (?, ?, 'info', 'Log 1', NULL, '2026-01-08 10:00:00.000')`,
      ["req1", ctx.routeId1]
    );
    await ctx.db.execute(
      `INSERT INTO executionLogs (requestId, routeId, level, message, args, timestamp)
       VALUES (?, ?, 'info', 'Log 2', NULL, '2026-01-08 10:00:01.000')`,
      ["req2", ctx.routeId1]
    );
    await ctx.db.execute(
      `INSERT INTO executionLogs (requestId, routeId, level, message, args, timestamp)
       VALUES (?, ?, 'info', 'Log 3', NULL, '2026-01-08 10:00:02.000')`,
      ["req3", ctx.routeId1]
    );

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

integrationTest("ConsoleLogService - getPaginated handles same timestamp with different IDs", async () => {
  const ctx = await createTestSetup();

  try {
    const sameTimestamp = '2026-01-08 10:00:00.000';
    await ctx.db.execute(
      `INSERT INTO executionLogs (requestId, routeId, level, message, args, timestamp)
       VALUES (?, ?, 'info', 'Log A', NULL, ?)`,
      ["req1", ctx.routeId1, sameTimestamp]
    );
    await ctx.db.execute(
      `INSERT INTO executionLogs (requestId, routeId, level, message, args, timestamp)
       VALUES (?, ?, 'info', 'Log B', NULL, ?)`,
      ["req2", ctx.routeId1, sameTimestamp]
    );
    await ctx.db.execute(
      `INSERT INTO executionLogs (requestId, routeId, level, message, args, timestamp)
       VALUES (?, ?, 'info', 'Log C', NULL, ?)`,
      ["req3", ctx.routeId1, sameTimestamp]
    );

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
