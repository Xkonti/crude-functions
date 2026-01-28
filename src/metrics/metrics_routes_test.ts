import { integrationTest } from "../test/test_helpers.ts";
import { expect } from "@std/expect";
import { Hono } from "@hono/hono";
import { TestSetupBuilder } from "../test/test_setup_builder.ts";
import { createMetricsRoutes } from "./metrics_routes.ts";
import type { ExecutionMetricsService } from "./execution_metrics_service.ts";
import type { RoutesService } from "../routes/routes_service.ts";
import type { SettingsService } from "../settings/settings_service.ts";
import type { FunctionRoute } from "../routes/routes_service.ts";
import type { MetricType } from "./types.ts";
import { recordIdToString } from "../database/surreal_helpers.ts";
import { RecordId } from "surrealdb";

interface MetricsTestContext {
  app: Hono;
  executionMetricsService: ExecutionMetricsService;
  routesService: RoutesService;
  settingsService: SettingsService;
  routes: { route1: FunctionRoute; route2: FunctionRoute };
  cleanup: () => Promise<void>;
}

async function createTestContext(): Promise<MetricsTestContext> {
  const ctx = await TestSetupBuilder.create()
    .withMetrics()
    .withRoutes()
    .withSettings()
    .build();

  // Create test routes
  await ctx.routesService.addRoute({
    name: "test-function-1",
    routePath: "/test1",
    handler: "code/test1.ts",
    methods: ["GET"],
  });

  await ctx.routesService.addRoute({
    name: "test-function-2",
    routePath: "/test2",
    handler: "code/test2.ts",
    methods: ["GET"],
  });

  const route1 = await ctx.routesService.getByName("test-function-1");
  const route2 = await ctx.routesService.getByName("test-function-2");

  if (!route1 || !route2) {
    throw new Error("Failed to create test routes");
  }

  // Create test app with metrics routes
  const app = new Hono();
  app.route("/", createMetricsRoutes({
    executionMetricsService: ctx.executionMetricsService,
    routesService: ctx.routesService,
    settingsService: ctx.settingsService,
  }));

  return {
    app,
    executionMetricsService: ctx.executionMetricsService,
    routesService: ctx.routesService,
    settingsService: ctx.settingsService,
    routes: { route1, route2 },
    cleanup: ctx.cleanup,
  };
}

// Helper to insert test metrics
// functionId can be a RecordId or null for global metrics
async function insertMetric(
  service: ExecutionMetricsService,
  functionId: RecordId | null,
  type: MetricType,
  timestamp: Date,
  avgTimeUs = 50000, // 50ms default in microseconds
  maxTimeUs = 100000, // 100ms default in microseconds
  executionCount = 10,
): Promise<void> {
  await service.store({
    functionId,
    type,
    avgTimeUs,
    maxTimeUs,
    executionCount,
    timestamp,
  });
}

// Basic Queries

integrationTest("GET /api/metrics returns empty array when no metrics exist", async () => {
  const ctx = await createTestContext();
  try {
    const res = await ctx.app.request("/?resolution=minutes");
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.metrics).toEqual([]);
    expect(json.data.functionId).toBe(null);
    expect(json.data.resolution).toBe("minutes");
    expect(json.data.summary.totalExecutions).toBe(0);
    expect(json.data.summary.avgExecutionTime).toBe(0);
    expect(json.data.summary.maxExecutionTime).toBe(0);
    expect(json.data.summary.periodCount).toBe(0);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/metrics returns metrics for specific function", async () => {
  const ctx = await createTestContext();
  try {
    const now = new Date();
    const timestamp = new Date(now.getTime() - 30 * 60 * 1000); // 30 minutes ago

    // Use RecordId directly - 45500 microseconds = 45.5ms
    await insertMetric(
      ctx.executionMetricsService,
      ctx.routes.route1.id,
      "minute",
      timestamp,
      45500, // avgTimeUs
      120000, // maxTimeUs (120ms)
      15,
    );

    const res = await ctx.app.request(
      `/?functionId=${recordIdToString(ctx.routes.route1.id)}&resolution=minutes`,
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.metrics.length).toBe(1);
    expect(json.data.functionId).toBe(recordIdToString(ctx.routes.route1.id));
    expect(json.data.resolution).toBe("minutes");
    // API converts microseconds to milliseconds
    expect(json.data.metrics[0].avgTimeMs).toBe(45.5);
    expect(json.data.metrics[0].maxTimeMs).toBe(120);
    expect(json.data.metrics[0].executionCount).toBe(15);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/metrics returns global metrics when functionId omitted", async () => {
  const ctx = await createTestContext();
  try {
    const now = new Date();
    const timestamp = new Date(now.getTime() - 30 * 60 * 1000);

    // Insert global metric (functionId = null)
    await insertMetric(
      ctx.executionMetricsService,
      null,
      "minute",
      timestamp,
      50000, // 50ms in microseconds
      100000, // 100ms in microseconds
      20,
    );

    const res = await ctx.app.request("/?resolution=minutes");
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.metrics.length).toBe(1);
    expect(json.data.functionId).toBe(null);
    expect(json.data.metrics[0].avgTimeMs).toBe(50);
    expect(json.data.metrics[0].executionCount).toBe(20);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/metrics filters by resolution (minutes/hours/days)", async () => {
  const ctx = await createTestContext();
  try {
    const now = new Date();

    // Insert different metric types (using null for global metrics)
    await insertMetric(
      ctx.executionMetricsService,
      null,
      "minute",
      new Date(now.getTime() - 30 * 60 * 1000),
    );
    await insertMetric(
      ctx.executionMetricsService,
      null,
      "hour",
      new Date(now.getTime() - 2 * 60 * 60 * 1000),
    );
    await insertMetric(
      ctx.executionMetricsService,
      null,
      "day",
      new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
    );

    // Query minutes
    let res = await ctx.app.request("/?resolution=minutes");
    let json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.metrics.length).toBe(1);

    // Query hours
    res = await ctx.app.request("/?resolution=hours");
    json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.metrics.length).toBe(1);

    // Query days
    res = await ctx.app.request("/?resolution=days");
    json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.metrics.length).toBe(1);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/metrics returns metrics ordered by timestamp ASC", async () => {
  const ctx = await createTestContext();
  try {
    const now = new Date();

    // Insert metrics out of order
    await insertMetric(
      ctx.executionMetricsService,
      null,
      "minute",
      new Date(now.getTime() - 50 * 60 * 1000),
      10000, // 10ms
      20000, // 20ms
      5,
    );
    await insertMetric(
      ctx.executionMetricsService,
      null,
      "minute",
      new Date(now.getTime() - 10 * 60 * 1000),
      30000, // 30ms
      40000, // 40ms
      5,
    );
    await insertMetric(
      ctx.executionMetricsService,
      null,
      "minute",
      new Date(now.getTime() - 30 * 60 * 1000),
      20000, // 20ms
      30000, // 30ms
      5,
    );

    const res = await ctx.app.request("/?resolution=minutes");
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.metrics.length).toBe(3);

    // Verify ascending order
    const timestamps = json.data.metrics.map((m: {
      timestamp: string;
      avgTimeMs: number;
      maxTimeMs: number;
      executionCount: number;
    }) => new Date(m.timestamp).getTime());
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
    }
  } finally {
    await ctx.cleanup();
  }
});

// Validation Tests

integrationTest("GET /api/metrics returns 400 for missing resolution parameter", async () => {
  const ctx = await createTestContext();
  try {
    const res = await ctx.app.request("/");
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("Missing required parameter: resolution");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/metrics returns 400 for invalid resolution value", async () => {
  const ctx = await createTestContext();
  try {
    const res = await ctx.app.request("/?resolution=invalid");
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("Invalid resolution parameter");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/metrics returns 400 for invalid functionId format", async () => {
  const ctx = await createTestContext();
  try {
    // IDs with colons are invalid for validateSurrealId (alphanumeric + underscore/hyphen only)
    const res = await ctx.app.request("/?resolution=minutes&functionId=invalid:format");
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("Invalid functionId parameter");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/metrics returns 404 for non-existent functionId", async () => {
  const ctx = await createTestContext();
  try {
    // Valid format but no function with this ID exists
    const res = await ctx.app.request("/?resolution=minutes&functionId=nonexistent123");
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain("not found");
  } finally {
    await ctx.cleanup();
  }
});

// Summary Calculation Tests

integrationTest("GET /api/metrics summary totalExecutions sums all execution counts", async () => {
  const ctx = await createTestContext();
  try {
    const now = new Date();

    await insertMetric(
      ctx.executionMetricsService,
      null,
      "minute",
      new Date(now.getTime() - 50 * 60 * 1000),
      50000,
      100000,
      10,
    );
    await insertMetric(
      ctx.executionMetricsService,
      null,
      "minute",
      new Date(now.getTime() - 30 * 60 * 1000),
      50000,
      100000,
      20,
    );
    await insertMetric(
      ctx.executionMetricsService,
      null,
      "minute",
      new Date(now.getTime() - 10 * 60 * 1000),
      50000,
      100000,
      15,
    );

    const res = await ctx.app.request("/?resolution=minutes");
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.summary.totalExecutions).toBe(45); // 10 + 20 + 15
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/metrics summary avgExecutionTime is weighted average", async () => {
  const ctx = await createTestContext();
  try {
    const now = new Date();

    // Insert metrics with different weights
    await insertMetric(
      ctx.executionMetricsService,
      null,
      "minute",
      new Date(now.getTime() - 50 * 60 * 1000),
      100000, // avgTimeUs = 100ms
      200000, // maxTimeUs
      10, // executionCount
    );
    await insertMetric(
      ctx.executionMetricsService,
      null,
      "minute",
      new Date(now.getTime() - 30 * 60 * 1000),
      50000, // avgTimeUs = 50ms
      100000, // maxTimeUs
      20, // executionCount
    );

    const res = await ctx.app.request("/?resolution=minutes");
    const json = await res.json();

    expect(res.status).toBe(200);
    // Weighted average: (100*10 + 50*20) / (10+20) = 2000/30 = 66.666...
    expect(json.data.summary.avgExecutionTime).toBeCloseTo(66.67, 1);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/metrics summary maxExecutionTime is maximum of all max values", async () => {
  const ctx = await createTestContext();
  try {
    const now = new Date();

    await insertMetric(
      ctx.executionMetricsService,
      null,
      "minute",
      new Date(now.getTime() - 50 * 60 * 1000),
      50000, // 50ms
      100000, // 100ms max
      10,
    );
    await insertMetric(
      ctx.executionMetricsService,
      null,
      "minute",
      new Date(now.getTime() - 30 * 60 * 1000),
      60000, // 60ms
      250000, // 250ms max - highest
      15,
    );
    await insertMetric(
      ctx.executionMetricsService,
      null,
      "minute",
      new Date(now.getTime() - 10 * 60 * 1000),
      55000, // 55ms
      150000, // 150ms max
      12,
    );

    const res = await ctx.app.request("/?resolution=minutes");
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.summary.maxExecutionTime).toBe(250);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/metrics summary periodCount matches number of metric records", async () => {
  const ctx = await createTestContext();
  try {
    const now = new Date();

    // Insert 5 metrics
    for (let i = 0; i < 5; i++) {
      await insertMetric(
        ctx.executionMetricsService,
        null,
        "minute",
        new Date(now.getTime() - (10 + i * 5) * 60 * 1000),
      );
    }

    const res = await ctx.app.request("/?resolution=minutes");
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.summary.periodCount).toBe(5);
    expect(json.data.metrics.length).toBe(5);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/metrics summary handles empty metrics correctly", async () => {
  const ctx = await createTestContext();
  try {
    const res = await ctx.app.request("/?resolution=minutes");
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.summary.totalExecutions).toBe(0);
    expect(json.data.summary.avgExecutionTime).toBe(0);
    expect(json.data.summary.maxExecutionTime).toBe(0);
    expect(json.data.summary.periodCount).toBe(0);
  } finally {
    await ctx.cleanup();
  }
});

// Edge Cases

integrationTest("GET /api/metrics handles metrics with identical timestamps", async () => {
  const ctx = await createTestContext();
  try {
    const now = new Date();
    const sameTimestamp = new Date(now.getTime() - 30 * 60 * 1000);

    // Insert two metrics with the exact same timestamp for different routes
    await insertMetric(
      ctx.executionMetricsService,
      ctx.routes.route1.id,
      "minute",
      sameTimestamp,
      50000, // 50ms
      100000, // 100ms
      10,
    );
    await insertMetric(
      ctx.executionMetricsService,
      ctx.routes.route2.id,
      "minute",
      sameTimestamp,
      60000, // 60ms
      110000, // 110ms
      12,
    );

    // Query for route1
    const res = await ctx.app.request(
      `/?functionId=${recordIdToString(ctx.routes.route1.id)}&resolution=minutes`,
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.metrics.length).toBe(1);
    expect(json.data.metrics[0].avgTimeMs).toBe(50);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/metrics returns all available metrics regardless of count", async () => {
  const ctx = await createTestContext();
  try {
    const now = new Date();

    // Insert 70 metrics (more than 60 minutes window, but should return all in range)
    for (let i = 0; i < 70; i++) {
      await insertMetric(
        ctx.executionMetricsService,
        null,
        "minute",
        new Date(now.getTime() - i * 60 * 1000),
      );
    }

    const res = await ctx.app.request("/?resolution=minutes");
    const json = await res.json();

    expect(res.status).toBe(200);
    // Should return metrics within last 60 minutes (0-59 minutes ago = 60 records)
    expect(json.data.metrics.length).toBe(60);
  } finally {
    await ctx.cleanup();
  }
});

// Response Format Tests

integrationTest("GET /api/metrics success response has correct data wrapper structure", async () => {
  const ctx = await createTestContext();
  try {
    const res = await ctx.app.request("/?resolution=minutes");
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toHaveProperty("data");
    expect(json.data).toHaveProperty("metrics");
    expect(json.data).toHaveProperty("functionId");
    expect(json.data).toHaveProperty("resolution");
    expect(json.data).toHaveProperty("summary");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/metrics metrics objects have all required fields", async () => {
  const ctx = await createTestContext();
  try {
    const now = new Date();
    await insertMetric(
      ctx.executionMetricsService,
      null,
      "minute",
      new Date(now.getTime() - 30 * 60 * 1000),
    );

    const res = await ctx.app.request("/?resolution=minutes");
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.metrics.length).toBe(1);

    const metric = json.data.metrics[0];
    expect(metric).toHaveProperty("timestamp");
    expect(metric).toHaveProperty("avgTimeMs");
    expect(metric).toHaveProperty("maxTimeMs");
    expect(metric).toHaveProperty("executionCount");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/metrics timestamps are in ISO 8601 format", async () => {
  const ctx = await createTestContext();
  try {
    const now = new Date();
    await insertMetric(
      ctx.executionMetricsService,
      null,
      "minute",
      new Date(now.getTime() - 30 * 60 * 1000),
    );

    const res = await ctx.app.request("/?resolution=minutes");
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.metrics.length).toBe(1);

    const timestamp = json.data.metrics[0].timestamp;
    // ISO 8601 format: YYYY-MM-DDTHH:mm:ss.sssZ
    expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    // Verify it's a valid date
    const parsed = new Date(timestamp);
    expect(parsed.toString()).not.toBe("Invalid Date");
  } finally {
    await ctx.cleanup();
  }
});
