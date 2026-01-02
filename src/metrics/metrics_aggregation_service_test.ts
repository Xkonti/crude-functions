import { expect } from "@std/expect";
import { DatabaseService } from "../database/database_service.ts";
import { ExecutionMetricsService } from "./execution_metrics_service.ts";
import { MetricsAggregationService } from "./metrics_aggregation_service.ts";

// Helper functions for dynamic date calculation
function floorToMinute(date: Date): Date {
  const result = new Date(date);
  result.setUTCSeconds(0, 0);
  return result;
}

function floorToHour(date: Date): Date {
  const result = new Date(date);
  result.setUTCMinutes(0, 0, 0);
  return result;
}

function floorToDay(date: Date): Date {
  const result = new Date(date);
  result.setUTCHours(0, 0, 0, 0);
  return result;
}

// Get a completed minute from N minutes ago
function getPastMinute(minutesAgo: number, minuteOffset = 0): Date {
  const now = new Date();
  const pastTime = new Date(now.getTime() - minutesAgo * 60 * 1000);
  const floored = floorToMinute(pastTime);
  return new Date(floored.getTime() + minuteOffset * 60 * 1000);
}

// Get the start of the previous complete hour
function getPastHour(hoursAgo: number, hourOffset = 0): Date {
  const now = new Date();
  // Go back to start of current hour, then subtract additional hours
  const currentHour = floorToHour(now);
  return new Date(currentHour.getTime() - (hoursAgo * 60 * 60 * 1000) + (hourOffset * 60 * 60 * 1000));
}

// Get the start of the previous complete day
function getPastDay(daysAgo: number): Date {
  const now = new Date();
  const currentDay = floorToDay(now);
  return new Date(currentDay.getTime() - daysAgo * 24 * 60 * 60 * 1000);
}

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

interface TestSetup {
  aggregationService: MetricsAggregationService;
  metricsService: ExecutionMetricsService;
  db: DatabaseService;
  tempDir: string;
}

async function createTestSetup(
  intervalSeconds = 60,
  retentionDays = 90,
  maxMinutesPerRun = 10000 // High default for tests to process all data
): Promise<TestSetup> {
  const tempDir = await Deno.makeTempDir();
  const db = new DatabaseService({ databasePath: `${tempDir}/test.db` });
  await db.open();
  await db.exec(EXECUTION_METRICS_SCHEMA);

  const metricsService = new ExecutionMetricsService({ db });
  const aggregationService = new MetricsAggregationService({
    metricsService,
    config: {
      aggregationIntervalSeconds: intervalSeconds,
      retentionDays: retentionDays,
    },
    maxMinutesPerRun,
  });

  return { aggregationService, metricsService, db, tempDir };
}

async function cleanup(setup: TestSetup): Promise<void> {
  await setup.aggregationService.stop();
  await setup.db.close();
  await Deno.remove(setup.tempDir, { recursive: true });
}

// =====================
// Minute Aggregation Tests
// =====================

Deno.test("MetricsAggregationService aggregates executions into minute", async () => {
  const setup = await createTestSetup();

  try {
    // Create executions in a past minute (5 minutes ago)
    const minuteStart = getPastMinute(5);

    await setup.metricsService.store({
      routeId: 1,
      type: "execution",
      avgTimeMs: 100,
      maxTimeMs: 100,
      executionCount: 1,
      timestamp: new Date(minuteStart.getTime() + 10000), // 10s into minute
    });

    await setup.metricsService.store({
      routeId: 1,
      type: "execution",
      avgTimeMs: 200,
      maxTimeMs: 200,
      executionCount: 1,
      timestamp: new Date(minuteStart.getTime() + 30000), // 30s into minute
    });

    await setup.metricsService.store({
      routeId: 1,
      type: "execution",
      avgTimeMs: 150,
      maxTimeMs: 150,
      executionCount: 1,
      timestamp: new Date(minuteStart.getTime() + 50000), // 50s into minute
    });

    // Start and let it run once
    setup.aggregationService.start();
    await new Promise((resolve) => setTimeout(resolve, 200));
    await setup.aggregationService.stop();

    // Check that minute aggregate was created
    const minuteMetrics = await setup.metricsService.getByRouteId(1, "minute");
    expect(minuteMetrics.length).toBe(1);
    expect(minuteMetrics[0].executionCount).toBe(3);
    expect(minuteMetrics[0].maxTimeMs).toBe(200);
    // Weighted average: (100*1 + 200*1 + 150*1) / 3 = 150
    expect(minuteMetrics[0].avgTimeMs).toBe(150);
    expect(minuteMetrics[0].timestamp.toISOString()).toBe(minuteStart.toISOString());

    // Check that execution metrics were deleted
    const executionMetrics = await setup.metricsService.getByRouteId(1, "execution");
    expect(executionMetrics.length).toBe(0);
  } finally {
    await cleanup(setup);
  }
});

Deno.test("MetricsAggregationService handles weighted averages correctly", async () => {
  const setup = await createTestSetup();

  try {
    const minuteStart = getPastMinute(5);

    // Single execution with count 1, avg 100
    await setup.metricsService.store({
      routeId: 1,
      type: "execution",
      avgTimeMs: 100,
      maxTimeMs: 100,
      executionCount: 1,
      timestamp: new Date(minuteStart.getTime() + 10000),
    });

    // Another execution with count 1, avg 300
    await setup.metricsService.store({
      routeId: 1,
      type: "execution",
      avgTimeMs: 300,
      maxTimeMs: 300,
      executionCount: 1,
      timestamp: new Date(minuteStart.getTime() + 20000),
    });

    setup.aggregationService.start();
    await new Promise((resolve) => setTimeout(resolve, 200));
    await setup.aggregationService.stop();

    const minuteMetrics = await setup.metricsService.getByRouteId(1, "minute");
    expect(minuteMetrics.length).toBe(1);
    // Weighted average: (100*1 + 300*1) / 2 = 200
    expect(minuteMetrics[0].avgTimeMs).toBe(200);
    expect(minuteMetrics[0].executionCount).toBe(2);
    expect(minuteMetrics[0].maxTimeMs).toBe(300);
  } finally {
    await cleanup(setup);
  }
});

Deno.test("MetricsAggregationService processes multiple routes separately", async () => {
  const setup = await createTestSetup();

  try {
    const minuteStart = getPastMinute(5);

    // Route 1 executions
    await setup.metricsService.store({
      routeId: 1,
      type: "execution",
      avgTimeMs: 100,
      maxTimeMs: 100,
      executionCount: 1,
      timestamp: new Date(minuteStart.getTime() + 10000),
    });

    // Route 2 executions
    await setup.metricsService.store({
      routeId: 2,
      type: "execution",
      avgTimeMs: 500,
      maxTimeMs: 500,
      executionCount: 1,
      timestamp: new Date(minuteStart.getTime() + 20000),
    });

    setup.aggregationService.start();
    await new Promise((resolve) => setTimeout(resolve, 200));
    await setup.aggregationService.stop();

    const route1Minutes = await setup.metricsService.getByRouteId(1, "minute");
    const route2Minutes = await setup.metricsService.getByRouteId(2, "minute");

    expect(route1Minutes.length).toBe(1);
    expect(route1Minutes[0].avgTimeMs).toBe(100);

    expect(route2Minutes.length).toBe(1);
    expect(route2Minutes[0].avgTimeMs).toBe(500);
  } finally {
    await cleanup(setup);
  }
});

Deno.test("MetricsAggregationService skips empty periods (no zero-value rows)", async () => {
  const setup = await createTestSetup();

  try {
    // Create an execution in minute 0 (5 minutes ago)
    const minute1Start = getPastMinute(5, 0);
    await setup.metricsService.store({
      routeId: 1,
      type: "execution",
      avgTimeMs: 100,
      maxTimeMs: 100,
      executionCount: 1,
      timestamp: new Date(minute1Start.getTime() + 10000),
    });

    // Create an execution in minute 2 (skipping minute 1)
    const minute3Start = getPastMinute(5, 2);
    await setup.metricsService.store({
      routeId: 1,
      type: "execution",
      avgTimeMs: 200,
      maxTimeMs: 200,
      executionCount: 1,
      timestamp: new Date(minute3Start.getTime() + 10000),
    });

    setup.aggregationService.start();
    await new Promise((resolve) => setTimeout(resolve, 200));
    await setup.aggregationService.stop();

    // Should have minute records for both minutes only
    // Empty periods are skipped - no zero-value rows
    const minuteMetrics = await setup.metricsService.getByRouteId(1, "minute");
    expect(minuteMetrics.length).toBe(2);
  } finally {
    await cleanup(setup);
  }
});

// =====================
// Hour Aggregation Tests
// =====================

Deno.test("MetricsAggregationService aggregates minutes into hour", async () => {
  const setup = await createTestSetup();

  try {
    // Get the last complete hour (1 hour before current hour start)
    const prevHourStart = getPastHour(1);

    // Create executions in the last 3 minutes of the previous hour
    // This ensures the hour boundary will be crossed during processing
    await setup.metricsService.store({
      routeId: 1,
      type: "execution",
      avgTimeMs: 100,
      maxTimeMs: 100,
      executionCount: 1,
      timestamp: new Date(prevHourStart.getTime() + 57 * 60 * 1000 + 10000), // :57
    });

    await setup.metricsService.store({
      routeId: 1,
      type: "execution",
      avgTimeMs: 200,
      maxTimeMs: 200,
      executionCount: 1,
      timestamp: new Date(prevHourStart.getTime() + 58 * 60 * 1000 + 10000), // :58
    });

    await setup.metricsService.store({
      routeId: 1,
      type: "execution",
      avgTimeMs: 150,
      maxTimeMs: 150,
      executionCount: 1,
      timestamp: new Date(prevHourStart.getTime() + 59 * 60 * 1000 + 10000), // :59
    });

    // Add an execution in the next hour to trigger the hour boundary crossing
    const currHourStart = new Date(prevHourStart.getTime() + 60 * 60 * 1000);
    await setup.metricsService.store({
      routeId: 1,
      type: "execution",
      avgTimeMs: 50,
      maxTimeMs: 50,
      executionCount: 1,
      timestamp: new Date(currHourStart.getTime() + 10000), // :00 of next hour
    });

    setup.aggregationService.start();
    await new Promise((resolve) => setTimeout(resolve, 500));
    await setup.aggregationService.stop();

    // Check hour aggregate was created for the previous hour
    const hourMetrics = await setup.metricsService.getByRouteId(1, "hour");
    expect(hourMetrics.length).toBe(1);
    expect(hourMetrics[0].executionCount).toBe(3); // 3 executions in prev hour
    expect(hourMetrics[0].maxTimeMs).toBe(200);
    // Weighted average: (100*1 + 200*1 + 150*1) / 3 = 150
    expect(Math.round(hourMetrics[0].avgTimeMs)).toBe(150);
    expect(hourMetrics[0].timestamp.toISOString()).toBe(prevHourStart.toISOString());

    // Check that minute metrics from prev hour were deleted (aggregated into hour)
    const minuteMetrics = await setup.metricsService.getByRouteId(1, "minute");
    // Should have 1 minute record remaining from current hour (:00)
    expect(minuteMetrics.length).toBe(1);

    // Check all executions were processed
    const executionMetrics = await setup.metricsService.getByRouteId(1, "execution");
    expect(executionMetrics.length).toBe(0);
  } finally {
    await cleanup(setup);
  }
});

// =====================
// Day Aggregation Tests
// =====================

Deno.test("MetricsAggregationService aggregates hours into day", async () => {
  const setup = await createTestSetup();

  try {
    // Get the previous complete day
    const prevDayStart = getPastDay(1);

    // Create hour records for the previous day (pre-aggregated for simplicity)
    // These will be aggregated when the day boundary is crossed
    await setup.metricsService.store({
      routeId: 1,
      type: "hour",
      avgTimeMs: 100,
      maxTimeMs: 150,
      executionCount: 100,
      timestamp: new Date(prevDayStart.getTime() + 12 * 60 * 60 * 1000), // 12:00
    });

    await setup.metricsService.store({
      routeId: 1,
      type: "hour",
      avgTimeMs: 200,
      maxTimeMs: 300,
      executionCount: 200,
      timestamp: new Date(prevDayStart.getTime() + 22 * 60 * 60 * 1000), // 22:00
    });

    // Create execution in the last hour of the previous day to start processing there
    await setup.metricsService.store({
      routeId: 1,
      type: "execution",
      avgTimeMs: 150,
      maxTimeMs: 150,
      executionCount: 1,
      timestamp: new Date(prevDayStart.getTime() + 23 * 60 * 60 * 1000 + 59 * 60 * 1000 + 10000), // 23:59:10
    });

    // Create execution in the first hour of the current day to cross the day boundary
    const currDayStart = new Date(prevDayStart.getTime() + 24 * 60 * 60 * 1000);
    await setup.metricsService.store({
      routeId: 1,
      type: "execution",
      avgTimeMs: 50,
      maxTimeMs: 50,
      executionCount: 1,
      timestamp: new Date(currDayStart.getTime() + 10000), // 00:00:10
    });

    setup.aggregationService.start();
    await new Promise((resolve) => setTimeout(resolve, 500));
    await setup.aggregationService.stop();

    // Check day aggregate was created for the previous day
    const dayMetrics = await setup.metricsService.getByRouteId(1, "day");
    expect(dayMetrics.length).toBe(1);
    // Should have 100 + 200 + 1 (from the hour + the one execution that was in 23:59)
    // Actually, the execution at 23:59 becomes minute, then hour, then day
    // Plus the 2 pre-existing hour records
    // So: hour1 (100 exec) + hour2 (200 exec) + hour3 (1 exec from minute) = 301
    expect(dayMetrics[0].executionCount).toBe(301);
    expect(dayMetrics[0].maxTimeMs).toBe(300);
    expect(dayMetrics[0].timestamp.toISOString()).toBe(prevDayStart.toISOString());

    // Check that hour metrics from prev day were deleted (aggregated into day)
    // Current day's hour remains because the current hour hasn't completed yet
    const hourMetrics = await setup.metricsService.getByRouteId(1, "hour");
    expect(hourMetrics.length).toBe(1); // Current hour from today remains

    // Check all executions were processed
    const executionMetrics = await setup.metricsService.getByRouteId(1, "execution");
    expect(executionMetrics.length).toBe(0);
  } finally {
    await cleanup(setup);
  }
});

// =====================
// Retention Cleanup Tests
// =====================

Deno.test("MetricsAggregationService cleans up old metrics of all types", async () => {
  const setup = await createTestSetup(60, 30); // 30 days retention

  try {
    const now = new Date();
    const oldDate = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000); // 40 days ago
    const recentDate = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000); // 10 days ago

    // Add old metrics of various types
    await setup.metricsService.store({
      routeId: 1,
      type: "day",
      avgTimeMs: 100,
      maxTimeMs: 150,
      executionCount: 1000,
      timestamp: oldDate,
    });

    await setup.metricsService.store({
      routeId: 1,
      type: "hour",
      avgTimeMs: 50,
      maxTimeMs: 75,
      executionCount: 500,
      timestamp: oldDate,
    });

    await setup.metricsService.store({
      routeId: 1,
      type: "minute",
      avgTimeMs: 25,
      maxTimeMs: 40,
      executionCount: 50,
      timestamp: oldDate,
    });

    // Add recent day metric
    await setup.metricsService.store({
      routeId: 1,
      type: "day",
      avgTimeMs: 200,
      maxTimeMs: 250,
      executionCount: 2000,
      timestamp: recentDate,
    });

    setup.aggregationService.start();
    await new Promise((resolve) => setTimeout(resolve, 200));
    await setup.aggregationService.stop();

    // Only the recent day metric should remain - all old metrics deleted
    const dayMetrics = await setup.metricsService.getByRouteId(1, "day");
    expect(dayMetrics.length).toBe(1);
    expect(dayMetrics[0].executionCount).toBe(2000);

    // Old hour and minute metrics should also be deleted
    const hourMetrics = await setup.metricsService.getByRouteId(1, "hour");
    expect(hourMetrics.length).toBe(0);

    const minuteMetrics = await setup.metricsService.getByRouteId(1, "minute");
    expect(minuteMetrics.length).toBe(0);
  } finally {
    await cleanup(setup);
  }
});

// =====================
// Catch-up Processing Tests
// =====================

Deno.test("MetricsAggregationService processes multiple minutes in one run", async () => {
  const setup = await createTestSetup();

  try {
    // Create executions across 5 consecutive minutes (starting 10 minutes ago)
    const baseTime = getPastMinute(10);

    for (let minute = 0; minute < 5; minute++) {
      await setup.metricsService.store({
        routeId: 1,
        type: "execution",
        avgTimeMs: 100 + minute * 10,
        maxTimeMs: 100 + minute * 10,
        executionCount: 1,
        timestamp: new Date(baseTime.getTime() + minute * 60 * 1000 + 30000), // 30s into each minute
      });
    }

    // Run aggregation once
    setup.aggregationService.start();
    await new Promise((resolve) => setTimeout(resolve, 500));
    await setup.aggregationService.stop();

    // Should have 5 minute metrics
    const minuteMetrics = await setup.metricsService.getByRouteId(1, "minute");
    expect(minuteMetrics.length).toBe(5);

    // All executions should be deleted
    const executionMetrics = await setup.metricsService.getByRouteId(1, "execution");
    expect(executionMetrics.length).toBe(0);
  } finally {
    await cleanup(setup);
  }
});

Deno.test("MetricsAggregationService does nothing when no data", async () => {
  const setup = await createTestSetup();

  try {
    // Run with no data
    setup.aggregationService.start();
    await new Promise((resolve) => setTimeout(resolve, 200));
    await setup.aggregationService.stop();

    // No errors should occur, no data should be created
    const allMetrics = await setup.metricsService.getRecent(100);
    expect(allMetrics.length).toBe(0);
  } finally {
    await cleanup(setup);
  }
});

// =====================
// Timer Control Tests
// =====================

Deno.test("MetricsAggregationService can be started and stopped", async () => {
  const setup = await createTestSetup();

  try {
    // Start the service
    setup.aggregationService.start();
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Stop the service
    await setup.aggregationService.stop();

    // Starting again should warn but work
    setup.aggregationService.start();
    await new Promise((resolve) => setTimeout(resolve, 100));
    await setup.aggregationService.stop();
  } finally {
    await cleanup(setup);
  }
});

Deno.test("MetricsAggregationService stop waits for processing to complete", async () => {
  const setup = await createTestSetup();

  try {
    // Add some data to process (from 5 minutes ago)
    const minuteStart = getPastMinute(5);
    for (let i = 0; i < 10; i++) {
      await setup.metricsService.store({
        routeId: 1,
        type: "execution",
        avgTimeMs: 100,
        maxTimeMs: 100,
        executionCount: 1,
        timestamp: new Date(minuteStart.getTime() + i * 1000),
      });
    }

    // Start and wait a moment for processing to begin, then stop
    setup.aggregationService.start();
    await new Promise((resolve) => setTimeout(resolve, 100));
    await setup.aggregationService.stop();

    // Processing should have completed
    const minuteMetrics = await setup.metricsService.getByRouteId(1, "minute");
    expect(minuteMetrics.length).toBe(1);
  } finally {
    await cleanup(setup);
  }
});
