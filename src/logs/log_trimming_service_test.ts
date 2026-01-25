import { integrationTest } from "../test/test_helpers.ts";
import { expect } from "@std/expect";
import { LogTrimmingService } from "./log_trimming_service.ts";
import { TestSetupBuilder } from "../test/test_setup_builder.ts";
import type { BaseTestContext, LogsContext, RoutesContext } from "../test/types.ts";

type LogTrimmingTestContext = BaseTestContext & LogsContext & RoutesContext;

/**
 * Creates a test context with logs and routes services,
 * plus a LogTrimmingService with the given configuration.
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
}> {
  const ctx = await TestSetupBuilder.create()
    .withLogs()
    .withRoute("/test-route-1", "test1.ts")
    .withRoute("/test-route-2", "test2.ts")
    .build();

  const trimmingService = new LogTrimmingService({
    logService: ctx.consoleLogService,
    config: {
      trimmingIntervalSeconds: options.intervalSeconds ?? 60,
      maxLogsPerRoute: options.maxLogsPerRoute ?? 100,
      retentionSeconds: options.retentionSeconds ?? 86400, // 1 day default
    },
  });

  return { ctx, trimmingService };
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
  const setup = await createTestSetup({ retentionSeconds: 3600 }); // 1 hour retention

  try {
    // Insert an old log directly (2 hours ago)
    const oldDate = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const sqliteFormat = oldDate.toISOString().replace("T", " ").slice(0, 23);
    await setup.ctx.db.execute(
      `INSERT INTO executionLogs (requestId, routeId, level, message, timestamp)
       VALUES (?, ?, ?, ?, ?)`,
      ["old-request", 1, "log", "Old message", sqliteFormat]
    );

    // Insert a recent log
    setup.ctx.consoleLogService.store({
      requestId: "new-request",
      routeId: 1,
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
    // Insert an old log (would be deleted if retention was active)
    const oldDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000); // 1 year ago
    const sqliteFormat = oldDate.toISOString().replace("T", " ").slice(0, 23);
    await setup.ctx.db.execute(
      `INSERT INTO executionLogs (requestId, routeId, level, message, timestamp)
       VALUES (?, ?, ?, ?, ?)`,
      ["ancient-request", 1, "log", "Ancient message", sqliteFormat]
    );

    // Run trimming
    const result = await setup.trimmingService.performTrimming();

    // No time-based deletions (disabled)
    expect(result.deletedByAge).toBe(0);

    // Old log should still exist (time-based deletion disabled)
    const oldLogs = await setup.ctx.consoleLogService.getByRequestId("ancient-request");
    expect(oldLogs.length).toBe(1);
  } finally {
    await cleanup(setup);
  }
});

// =====================
// Count-based trimming tests
// =====================

integrationTest("LogTrimmingService trims logs exceeding max per route", async () => {
  const setup = await createTestSetup({ maxLogsPerRoute: 5 }); // Max 5 logs per route

  try {
    // Store 10 logs for route 1
    for (let i = 0; i < 10; i++) {
      setup.ctx.consoleLogService.store({
        requestId: `request-${i}`,
        routeId: 1,
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
    const logs = await setup.ctx.consoleLogService.getByRouteId(1);
    expect(logs.length).toBe(5);
    // Newest should be kept (DESC order)
    expect(logs[0].message).toBe("Message 9");
  } finally {
    await cleanup(setup);
  }
});

integrationTest("LogTrimmingService processes multiple routes independently", async () => {
  const setup = await createTestSetup({ maxLogsPerRoute: 3 });

  try {
    // Store different numbers of logs per route
    for (let i = 0; i < 5; i++) {
      setup.ctx.consoleLogService.store({
        requestId: `r1-${i}`,
        routeId: 1,
        level: "log",
        message: `Route1 ${i}`,
      });
    }
    for (let i = 0; i < 2; i++) {
      setup.ctx.consoleLogService.store({
        requestId: `r2-${i}`,
        routeId: 2,
        level: "log",
        message: `Route2 ${i}`,
      });
    }
    await setup.ctx.consoleLogService.flush();

    // Run trimming
    const result = await setup.trimmingService.performTrimming();

    // Should have trimmed 2 logs from route 1 (5 - 3 = 2)
    expect(result.trimmedByCount).toBe(2);

    // Route 1: 5 -> 3 (trimmed)
    const route1Logs = await setup.ctx.consoleLogService.getByRouteId(1);
    expect(route1Logs.length).toBe(3);

    // Route 2: 2 -> 2 (unchanged, under limit)
    const route2Logs = await setup.ctx.consoleLogService.getByRouteId(2);
    expect(route2Logs.length).toBe(2);
  } finally {
    await cleanup(setup);
  }
});

// =====================
// Combined behavior tests
// =====================

integrationTest("LogTrimmingService applies time-based deletion before count-based trimming", async () => {
  const setup = await createTestSetup({ retentionSeconds: 3600, maxLogsPerRoute: 5 }); // 1 hour, max 5

  try {
    // Insert 3 old logs (will be deleted by time-based)
    const oldDate = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago
    const sqliteFormat = oldDate.toISOString().replace("T", " ").slice(0, 23);
    for (let i = 0; i < 3; i++) {
      await setup.ctx.db.execute(
        `INSERT INTO executionLogs (requestId, routeId, level, message, timestamp)
         VALUES (?, ?, ?, ?, ?)`,
        [`old-${i}`, 1, "log", `Old ${i}`, sqliteFormat]
      );
    }

    // Insert 4 new logs (under max, but 7 total before time deletion)
    for (let i = 0; i < 4; i++) {
      setup.ctx.consoleLogService.store({
        requestId: `new-${i}`,
        routeId: 1,
        level: "log",
        message: `New ${i}`,
      });
    }
    await setup.ctx.consoleLogService.flush();

    // Run trimming
    const result = await setup.trimmingService.performTrimming();

    // 3 deleted by age, 0 by count (4 remaining is under limit of 5)
    expect(result.deletedByAge).toBe(3);
    expect(result.trimmedByCount).toBe(0);

    // Should have 4 new logs (old ones deleted by time, new ones under count limit)
    const logs = await setup.ctx.consoleLogService.getByRouteId(1);
    expect(logs.length).toBe(4);
    expect(logs.every((l) => l.message.startsWith("New"))).toBe(true);
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
        routeId: 1,
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
    const logs = await setup.ctx.consoleLogService.getByRouteId(1);
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
// getDistinctRouteIds tests
// =====================

integrationTest("LogTrimmingService handles logs with null routeId", async () => {
  const setup = await createTestSetup({ maxLogsPerRoute: 5 });

  try {
    // Insert log with null routeId directly
    await setup.ctx.db.execute(
      `INSERT INTO executionLogs (requestId, routeId, level, message, timestamp)
       VALUES (?, NULL, ?, ?, ?)`,
      ["orphan-request", "log", "Orphan message", new Date().toISOString().replace("T", " ").slice(0, 23)]
    );

    // Insert normal logs
    for (let i = 0; i < 3; i++) {
      setup.ctx.consoleLogService.store({
        requestId: `normal-${i}`,
        routeId: 1,
        level: "log",
        message: `Normal ${i}`,
      });
    }
    await setup.ctx.consoleLogService.flush();

    // Run trimming - should not fail on null routeId
    const result = await setup.trimmingService.performTrimming();

    // No count-based trimming needed (under limit)
    expect(result.trimmedByCount).toBe(0);

    // Orphan log should still exist (null routeId is not processed by per-route trimming)
    const orphanLogs = await setup.ctx.consoleLogService.getByRequestId("orphan-request");
    expect(orphanLogs.length).toBe(1);

    // Normal logs should still exist (under limit)
    const normalLogs = await setup.ctx.consoleLogService.getByRouteId(1);
    expect(normalLogs.length).toBe(3);
  } finally {
    await cleanup(setup);
  }
});
