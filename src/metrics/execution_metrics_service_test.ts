import { expect } from "@std/expect";
import { DatabaseService } from "../database/database_service.ts";
import { ExecutionMetricsService } from "./execution_metrics_service.ts";

const EXECUTION_METRICS_SCHEMA = `
  CREATE TABLE execution_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    route_id INTEGER NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('execution', 'minute', 'hour', 'day')),
    avg_time_ms REAL NOT NULL,
    max_time_ms INTEGER NOT NULL,
    execution_count INTEGER NOT NULL DEFAULT 1,
    timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX idx_execution_metrics_route_id ON execution_metrics(route_id);
  CREATE INDEX idx_execution_metrics_type_route_timestamp ON execution_metrics(type, route_id, timestamp);
  CREATE INDEX idx_execution_metrics_timestamp ON execution_metrics(timestamp);
`;

async function createTestSetup(): Promise<{
  service: ExecutionMetricsService;
  db: DatabaseService;
  tempDir: string;
}> {
  const tempDir = await Deno.makeTempDir();
  const db = new DatabaseService({ databasePath: `${tempDir}/test.db` });
  await db.open();
  await db.exec(EXECUTION_METRICS_SCHEMA);

  const service = new ExecutionMetricsService({ db });
  return { service, db, tempDir };
}

async function cleanup(db: DatabaseService, tempDir: string): Promise<void> {
  await db.close();
  await Deno.remove(tempDir, { recursive: true });
}

// =====================
// ExecutionMetricsService tests
// =====================

Deno.test("ExecutionMetricsService stores metric entry", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    await service.store({
      routeId: 1,
      type: "execution",
      avgTimeMs: 45,
      maxTimeMs: 45,
      executionCount: 1,
    });

    const metrics = await service.getByRouteId(1);
    expect(metrics.length).toBe(1);
    expect(metrics[0].routeId).toBe(1);
    expect(metrics[0].type).toBe("execution");
    expect(metrics[0].avgTimeMs).toBe(45);
    expect(metrics[0].maxTimeMs).toBe(45);
    expect(metrics[0].executionCount).toBe(1);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("ExecutionMetricsService stores metric with custom timestamp", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    const customTimestamp = new Date("2024-01-15T10:30:00.000Z");
    await service.store({
      routeId: 1,
      type: "minute",
      avgTimeMs: 100,
      maxTimeMs: 150,
      executionCount: 5,
      timestamp: customTimestamp,
    });

    const metrics = await service.getByRouteId(1);
    expect(metrics.length).toBe(1);
    expect(metrics[0].timestamp.toISOString()).toBe(customTimestamp.toISOString());
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("ExecutionMetricsService retrieves metrics by routeId", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    // Store metrics for different routes
    await service.store({ routeId: 1, type: "execution", avgTimeMs: 10, maxTimeMs: 10, executionCount: 1 });
    await service.store({ routeId: 2, type: "execution", avgTimeMs: 20, maxTimeMs: 20, executionCount: 1 });
    await service.store({ routeId: 1, type: "execution", avgTimeMs: 30, maxTimeMs: 30, executionCount: 1 });

    const metrics = await service.getByRouteId(1);
    expect(metrics.length).toBe(2);
    // Newest first (DESC order)
    expect(metrics[0].avgTimeMs).toBe(30);
    expect(metrics[1].avgTimeMs).toBe(10);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("ExecutionMetricsService retrieves metrics by routeId with type filter", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    await service.store({ routeId: 1, type: "execution", avgTimeMs: 10, maxTimeMs: 10, executionCount: 1 });
    await service.store({ routeId: 1, type: "minute", avgTimeMs: 15, maxTimeMs: 20, executionCount: 3 });
    await service.store({ routeId: 1, type: "execution", avgTimeMs: 20, maxTimeMs: 20, executionCount: 1 });

    const metrics = await service.getByRouteId(1, "execution");
    expect(metrics.length).toBe(2);
    expect(metrics.every((m) => m.type === "execution")).toBe(true);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("ExecutionMetricsService retrieves metrics by routeId with limit", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    for (let i = 0; i < 5; i++) {
      await service.store({ routeId: 1, type: "execution", avgTimeMs: i * 10, maxTimeMs: i * 10, executionCount: 1 });
    }

    const metrics = await service.getByRouteId(1, undefined, 3);
    expect(metrics.length).toBe(3);
    // Newest first
    expect(metrics[0].avgTimeMs).toBe(40);
    expect(metrics[2].avgTimeMs).toBe(20);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("ExecutionMetricsService getRecent returns most recent metrics", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    for (let i = 0; i < 5; i++) {
      await service.store({ routeId: 1, type: "execution", avgTimeMs: i * 10, maxTimeMs: i * 10, executionCount: 1 });
    }

    const metrics = await service.getRecent(3);
    expect(metrics.length).toBe(3);
    // Most recent first (DESC order)
    expect(metrics[0].avgTimeMs).toBe(40);
    expect(metrics[1].avgTimeMs).toBe(30);
    expect(metrics[2].avgTimeMs).toBe(20);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("ExecutionMetricsService deletes metrics older than date", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    await service.store({ routeId: 1, type: "execution", avgTimeMs: 10, maxTimeMs: 10, executionCount: 1 });

    // Delete metrics older than 1 second from now
    const futureDate = new Date(Date.now() + 1000);
    const deleted = await service.deleteOlderThan(futureDate);

    expect(deleted).toBe(1);

    const metrics = await service.getByRouteId(1);
    expect(metrics.length).toBe(0);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("ExecutionMetricsService deletes metrics by routeId", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    await service.store({ routeId: 1, type: "execution", avgTimeMs: 10, maxTimeMs: 10, executionCount: 1 });
    await service.store({ routeId: 2, type: "execution", avgTimeMs: 20, maxTimeMs: 20, executionCount: 1 });

    const deleted = await service.deleteByRouteId(1);
    expect(deleted).toBe(1);

    const metricsRoute1 = await service.getByRouteId(1);
    expect(metricsRoute1.length).toBe(0);

    const metricsRoute2 = await service.getByRouteId(2);
    expect(metricsRoute2.length).toBe(1);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("ExecutionMetricsService stores all metric types", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    const types = ["execution", "minute", "hour", "day"] as const;

    for (const type of types) {
      await service.store({ routeId: 1, type, avgTimeMs: 100, maxTimeMs: 100, executionCount: 1 });
    }

    const metrics = await service.getByRouteId(1);
    expect(metrics.length).toBe(4);

    for (let i = 0; i < types.length; i++) {
      // Reverse order since newest first
      expect(metrics[types.length - 1 - i].type).toBe(types[i]);
    }
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("ExecutionMetricsService getDistinctRouteIds returns all unique route IDs", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    await service.store({ routeId: 1, type: "execution", avgTimeMs: 10, maxTimeMs: 10, executionCount: 1 });
    await service.store({ routeId: 2, type: "execution", avgTimeMs: 20, maxTimeMs: 20, executionCount: 1 });
    await service.store({ routeId: 1, type: "minute", avgTimeMs: 15, maxTimeMs: 20, executionCount: 2 });
    await service.store({ routeId: 3, type: "hour", avgTimeMs: 25, maxTimeMs: 30, executionCount: 10 });

    const routeIds = await service.getDistinctRouteIds();
    expect(routeIds.sort()).toEqual([1, 2, 3]);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("ExecutionMetricsService getDistinctRouteIdsByType returns route IDs for specific type", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    await service.store({ routeId: 1, type: "execution", avgTimeMs: 10, maxTimeMs: 10, executionCount: 1 });
    await service.store({ routeId: 2, type: "execution", avgTimeMs: 20, maxTimeMs: 20, executionCount: 1 });
    await service.store({ routeId: 1, type: "minute", avgTimeMs: 15, maxTimeMs: 20, executionCount: 2 });
    await service.store({ routeId: 3, type: "minute", avgTimeMs: 25, maxTimeMs: 30, executionCount: 5 });

    const executionRouteIds = await service.getDistinctRouteIdsByType("execution");
    expect(executionRouteIds.sort()).toEqual([1, 2]);

    const minuteRouteIds = await service.getDistinctRouteIdsByType("minute");
    expect(minuteRouteIds.sort()).toEqual([1, 3]);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("ExecutionMetricsService getByRouteIdTypeAndTimeRange returns metrics in range", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    const baseTime = new Date("2024-01-15T10:00:00.000Z");

    // Store metrics at different times
    await service.store({
      routeId: 1,
      type: "execution",
      avgTimeMs: 10,
      maxTimeMs: 10,
      executionCount: 1,
      timestamp: new Date(baseTime.getTime() + 0 * 60000), // 10:00
    });
    await service.store({
      routeId: 1,
      type: "execution",
      avgTimeMs: 20,
      maxTimeMs: 20,
      executionCount: 1,
      timestamp: new Date(baseTime.getTime() + 1 * 60000), // 10:01
    });
    await service.store({
      routeId: 1,
      type: "execution",
      avgTimeMs: 30,
      maxTimeMs: 30,
      executionCount: 1,
      timestamp: new Date(baseTime.getTime() + 2 * 60000), // 10:02
    });

    // Query for 10:00 to 10:02 (exclusive end)
    const start = new Date("2024-01-15T10:00:00.000Z");
    const end = new Date("2024-01-15T10:02:00.000Z");
    const metrics = await service.getByRouteIdTypeAndTimeRange(1, "execution", start, end);

    expect(metrics.length).toBe(2);
    expect(metrics[0].avgTimeMs).toBe(10);
    expect(metrics[1].avgTimeMs).toBe(20);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("ExecutionMetricsService deleteByRouteIdTypeAndTimeRange deletes metrics in range", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    const baseTime = new Date("2024-01-15T10:00:00.000Z");

    await service.store({
      routeId: 1,
      type: "execution",
      avgTimeMs: 10,
      maxTimeMs: 10,
      executionCount: 1,
      timestamp: new Date(baseTime.getTime() + 0 * 60000), // 10:00
    });
    await service.store({
      routeId: 1,
      type: "execution",
      avgTimeMs: 20,
      maxTimeMs: 20,
      executionCount: 1,
      timestamp: new Date(baseTime.getTime() + 1 * 60000), // 10:01
    });
    await service.store({
      routeId: 1,
      type: "execution",
      avgTimeMs: 30,
      maxTimeMs: 30,
      executionCount: 1,
      timestamp: new Date(baseTime.getTime() + 2 * 60000), // 10:02
    });

    // Delete 10:00 to 10:02 (exclusive end)
    const start = new Date("2024-01-15T10:00:00.000Z");
    const end = new Date("2024-01-15T10:02:00.000Z");
    const deleted = await service.deleteByRouteIdTypeAndTimeRange(1, "execution", start, end);

    expect(deleted).toBe(2);

    const remaining = await service.getByRouteId(1);
    expect(remaining.length).toBe(1);
    expect(remaining[0].avgTimeMs).toBe(30);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("ExecutionMetricsService getMostRecentByType returns most recent metric", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    const baseTime = new Date("2024-01-15T10:00:00.000Z");

    await service.store({
      routeId: 1,
      type: "minute",
      avgTimeMs: 10,
      maxTimeMs: 15,
      executionCount: 2,
      timestamp: new Date(baseTime.getTime() + 0 * 60000),
    });
    await service.store({
      routeId: 2,
      type: "minute",
      avgTimeMs: 20,
      maxTimeMs: 25,
      executionCount: 3,
      timestamp: new Date(baseTime.getTime() + 1 * 60000),
    });
    await service.store({
      routeId: 1,
      type: "execution",
      avgTimeMs: 5,
      maxTimeMs: 5,
      executionCount: 1,
      timestamp: new Date(baseTime.getTime() + 2 * 60000),
    });

    const mostRecent = await service.getMostRecentByType("minute");
    expect(mostRecent).not.toBeNull();
    expect(mostRecent!.routeId).toBe(2);
    expect(mostRecent!.avgTimeMs).toBe(20);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("ExecutionMetricsService getMostRecentByType returns null when no metrics", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    const mostRecent = await service.getMostRecentByType("hour");
    expect(mostRecent).toBeNull();
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("ExecutionMetricsService getOldestByType returns oldest metric", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    const baseTime = new Date("2024-01-15T10:00:00.000Z");

    await service.store({
      routeId: 1,
      type: "execution",
      avgTimeMs: 10,
      maxTimeMs: 10,
      executionCount: 1,
      timestamp: new Date(baseTime.getTime() + 0 * 60000),
    });
    await service.store({
      routeId: 2,
      type: "execution",
      avgTimeMs: 20,
      maxTimeMs: 20,
      executionCount: 1,
      timestamp: new Date(baseTime.getTime() + 1 * 60000),
    });

    const oldest = await service.getOldestByType("execution");
    expect(oldest).not.toBeNull();
    expect(oldest!.routeId).toBe(1);
    expect(oldest!.avgTimeMs).toBe(10);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("ExecutionMetricsService deleteByTypeOlderThan deletes old metrics of type", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    const oldTime = new Date("2024-01-01T10:00:00.000Z");
    const newTime = new Date("2024-01-15T10:00:00.000Z");

    await service.store({
      routeId: 1,
      type: "day",
      avgTimeMs: 10,
      maxTimeMs: 15,
      executionCount: 100,
      timestamp: oldTime,
    });
    await service.store({
      routeId: 1,
      type: "day",
      avgTimeMs: 20,
      maxTimeMs: 25,
      executionCount: 150,
      timestamp: newTime,
    });
    await service.store({
      routeId: 1,
      type: "hour",
      avgTimeMs: 5,
      maxTimeMs: 8,
      executionCount: 10,
      timestamp: oldTime, // Old but different type
    });

    // Delete day metrics older than 2024-01-10
    const cutoff = new Date("2024-01-10T00:00:00.000Z");
    const deleted = await service.deleteByTypeOlderThan("day", cutoff);

    expect(deleted).toBe(1);

    const dayMetrics = await service.getByRouteId(1, "day");
    expect(dayMetrics.length).toBe(1);
    expect(dayMetrics[0].avgTimeMs).toBe(20);

    // Hour metric should still exist
    const hourMetrics = await service.getByRouteId(1, "hour");
    expect(hourMetrics.length).toBe(1);
  } finally {
    await cleanup(db, tempDir);
  }
});
