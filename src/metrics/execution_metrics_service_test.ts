import { expect } from "@std/expect";
import { DatabaseService } from "../database/database_service.ts";
import { ExecutionMetricsService } from "./execution_metrics_service.ts";

const EXECUTION_METRICS_SCHEMA = `
  CREATE TABLE execution_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    route_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    time_value_ms INTEGER NOT NULL,
    timestamp TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX idx_execution_metrics_route_id ON execution_metrics(route_id);
  CREATE INDEX idx_execution_metrics_type ON execution_metrics(type, timestamp);
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
      type: "single_execution",
      timeValueMs: 45,
    });

    const metrics = await service.getByRouteId(1);
    expect(metrics.length).toBe(1);
    expect(metrics[0].routeId).toBe(1);
    expect(metrics[0].type).toBe("single_execution");
    expect(metrics[0].timeValueMs).toBe(45);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("ExecutionMetricsService retrieves metrics by routeId", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    // Store metrics for different routes
    await service.store({ routeId: 1, type: "single_execution", timeValueMs: 10 });
    await service.store({ routeId: 2, type: "single_execution", timeValueMs: 20 });
    await service.store({ routeId: 1, type: "single_execution", timeValueMs: 30 });

    const metrics = await service.getByRouteId(1);
    expect(metrics.length).toBe(2);
    // Newest first (DESC order)
    expect(metrics[0].timeValueMs).toBe(30);
    expect(metrics[1].timeValueMs).toBe(10);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("ExecutionMetricsService retrieves metrics by routeId with type filter", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    await service.store({ routeId: 1, type: "single_execution", timeValueMs: 10 });
    await service.store({ routeId: 1, type: "minute_avg", timeValueMs: 15 });
    await service.store({ routeId: 1, type: "single_execution", timeValueMs: 20 });

    const metrics = await service.getByRouteId(1, "single_execution");
    expect(metrics.length).toBe(2);
    expect(metrics.every((m) => m.type === "single_execution")).toBe(true);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("ExecutionMetricsService retrieves metrics by routeId with limit", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    for (let i = 0; i < 5; i++) {
      await service.store({ routeId: 1, type: "single_execution", timeValueMs: i * 10 });
    }

    const metrics = await service.getByRouteId(1, undefined, 3);
    expect(metrics.length).toBe(3);
    // Newest first
    expect(metrics[0].timeValueMs).toBe(40);
    expect(metrics[2].timeValueMs).toBe(20);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("ExecutionMetricsService getRecent returns most recent metrics", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    for (let i = 0; i < 5; i++) {
      await service.store({ routeId: 1, type: "single_execution", timeValueMs: i * 10 });
    }

    const metrics = await service.getRecent(3);
    expect(metrics.length).toBe(3);
    // Most recent first (DESC order)
    expect(metrics[0].timeValueMs).toBe(40);
    expect(metrics[1].timeValueMs).toBe(30);
    expect(metrics[2].timeValueMs).toBe(20);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("ExecutionMetricsService deletes metrics older than date", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    await service.store({ routeId: 1, type: "single_execution", timeValueMs: 10 });

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
    await service.store({ routeId: 1, type: "single_execution", timeValueMs: 10 });
    await service.store({ routeId: 2, type: "single_execution", timeValueMs: 20 });

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
    const types = [
      "single_execution",
      "minute_avg",
      "minute_max",
      "hourly_avg",
      "hourly_max",
      "daily_avg",
      "daily_max",
    ] as const;

    for (const type of types) {
      await service.store({ routeId: 1, type, timeValueMs: 100 });
    }

    const metrics = await service.getByRouteId(1);
    expect(metrics.length).toBe(7);

    for (let i = 0; i < types.length; i++) {
      // Reverse order since newest first
      expect(metrics[types.length - 1 - i].type).toBe(types[i]);
    }
  } finally {
    await cleanup(db, tempDir);
  }
});
