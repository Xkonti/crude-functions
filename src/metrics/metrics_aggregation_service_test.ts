import { expect } from "@std/expect";
import { MetricsAggregationService } from "./metrics_aggregation_service.ts";
import { TestSetupBuilder } from "../test/test_setup_builder.ts";
import type { BaseTestContext, MetricsContext } from "../test/types.ts";

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

// Check if the given hour is on a different day than the current hour
// This is critical for tests: when running at 00:xx, getPastHour(1) returns yesterday,
// and those hours get aggregated into day records, not hour records
function isPastHourOnDifferentDay(hoursAgo: number): boolean {
  const now = new Date();
  const currentDay = floorToDay(now);
  const pastHour = getPastHour(hoursAgo);
  const pastHourDay = floorToDay(pastHour);
  return pastHourDay.getTime() !== currentDay.getTime();
}

type MetricsTestContext = BaseTestContext & MetricsContext;

interface TestSetup {
  aggregationService: MetricsAggregationService;
  ctx: MetricsTestContext;
}

async function createTestSetup(
  intervalSeconds = 60,
  retentionDays = 90,
  maxMinutesPerRun = 10000 // High default for tests to process all data
): Promise<TestSetup> {
  const ctx = await TestSetupBuilder.create()
    .withMetrics()
    .build();

  const aggregationService = new MetricsAggregationService({
    metricsService: ctx.executionMetricsService,
    stateService: ctx.metricsStateService,
    config: {
      aggregationIntervalSeconds: intervalSeconds,
      retentionDays: retentionDays,
    },
    maxMinutesPerRun,
  });

  return { aggregationService, ctx };
}

async function cleanup(setup: TestSetup): Promise<void> {
  await setup.ctx.cleanup();
}

// =====================
// Minute Aggregation Tests
// =====================

Deno.test("MetricsAggregationService aggregates executions into minute", async () => {
  const setup = await createTestSetup();

  try {
    // Create executions in a past minute (5 minutes ago)
    const minuteStart = getPastMinute(5);

    await setup.ctx.executionMetricsService.store({
      routeId: 1,
      type: "execution",
      avgTimeMs: 100,
      maxTimeMs: 100,
      executionCount: 1,
      timestamp: new Date(minuteStart.getTime() + 10000), // 10s into minute
    });

    await setup.ctx.executionMetricsService.store({
      routeId: 1,
      type: "execution",
      avgTimeMs: 200,
      maxTimeMs: 200,
      executionCount: 1,
      timestamp: new Date(minuteStart.getTime() + 30000), // 30s into minute
    });

    await setup.ctx.executionMetricsService.store({
      routeId: 1,
      type: "execution",
      avgTimeMs: 150,
      maxTimeMs: 150,
      executionCount: 1,
      timestamp: new Date(minuteStart.getTime() + 50000), // 50s into minute
    });

    // Run aggregation once
    await setup.aggregationService.runOnce();

    // Check that minute aggregate was created
    const minuteMetrics = await setup.ctx.executionMetricsService.getByRouteId(1, "minute");
    expect(minuteMetrics.length).toBe(1);
    expect(minuteMetrics[0].executionCount).toBe(3);
    expect(minuteMetrics[0].maxTimeMs).toBe(200);
    // Weighted average: (100*1 + 200*1 + 150*1) / 3 = 150
    expect(minuteMetrics[0].avgTimeMs).toBe(150);
    expect(minuteMetrics[0].timestamp.toISOString()).toBe(minuteStart.toISOString());

    // Check that execution metrics were deleted
    const executionMetrics = await setup.ctx.executionMetricsService.getByRouteId(1, "execution");
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
    await setup.ctx.executionMetricsService.store({
      routeId: 1,
      type: "execution",
      avgTimeMs: 100,
      maxTimeMs: 100,
      executionCount: 1,
      timestamp: new Date(minuteStart.getTime() + 10000),
    });

    // Another execution with count 1, avg 300
    await setup.ctx.executionMetricsService.store({
      routeId: 1,
      type: "execution",
      avgTimeMs: 300,
      maxTimeMs: 300,
      executionCount: 1,
      timestamp: new Date(minuteStart.getTime() + 20000),
    });

    // Run aggregation once
    await setup.aggregationService.runOnce();

    const minuteMetrics = await setup.ctx.executionMetricsService.getByRouteId(1, "minute");
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
    await setup.ctx.executionMetricsService.store({
      routeId: 1,
      type: "execution",
      avgTimeMs: 100,
      maxTimeMs: 100,
      executionCount: 1,
      timestamp: new Date(minuteStart.getTime() + 10000),
    });

    // Route 2 executions
    await setup.ctx.executionMetricsService.store({
      routeId: 2,
      type: "execution",
      avgTimeMs: 500,
      maxTimeMs: 500,
      executionCount: 1,
      timestamp: new Date(minuteStart.getTime() + 20000),
    });

    // Run aggregation once
    await setup.aggregationService.runOnce();

    const route1Minutes = await setup.ctx.executionMetricsService.getByRouteId(1, "minute");
    const route2Minutes = await setup.ctx.executionMetricsService.getByRouteId(2, "minute");

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
    await setup.ctx.executionMetricsService.store({
      routeId: 1,
      type: "execution",
      avgTimeMs: 100,
      maxTimeMs: 100,
      executionCount: 1,
      timestamp: new Date(minute1Start.getTime() + 10000),
    });

    // Create an execution in minute 2 (skipping minute 1)
    const minute3Start = getPastMinute(5, 2);
    await setup.ctx.executionMetricsService.store({
      routeId: 1,
      type: "execution",
      avgTimeMs: 200,
      maxTimeMs: 200,
      executionCount: 1,
      timestamp: new Date(minute3Start.getTime() + 10000),
    });

    // Run aggregation once
    await setup.aggregationService.runOnce();

    // Should have minute records for both minutes only
    // Empty periods are skipped - no zero-value rows
    const minuteMetrics = await setup.ctx.executionMetricsService.getByRouteId(1, "minute");
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
    const crossesDayBoundary = isPastHourOnDifferentDay(1);

    // Create executions in the last 3 minutes of the previous hour
    // This ensures the hour boundary will be crossed during processing
    await setup.ctx.executionMetricsService.store({
      routeId: 1,
      type: "execution",
      avgTimeMs: 100,
      maxTimeMs: 100,
      executionCount: 1,
      timestamp: new Date(prevHourStart.getTime() + 57 * 60 * 1000 + 10000), // :57
    });

    await setup.ctx.executionMetricsService.store({
      routeId: 1,
      type: "execution",
      avgTimeMs: 200,
      maxTimeMs: 200,
      executionCount: 1,
      timestamp: new Date(prevHourStart.getTime() + 58 * 60 * 1000 + 10000), // :58
    });

    await setup.ctx.executionMetricsService.store({
      routeId: 1,
      type: "execution",
      avgTimeMs: 150,
      maxTimeMs: 150,
      executionCount: 1,
      timestamp: new Date(prevHourStart.getTime() + 59 * 60 * 1000 + 10000), // :59
    });

    // Add an execution in the next hour to trigger the hour boundary crossing
    const currHourStart = new Date(prevHourStart.getTime() + 60 * 60 * 1000);
    await setup.ctx.executionMetricsService.store({
      routeId: 1,
      type: "execution",
      avgTimeMs: 50,
      maxTimeMs: 50,
      executionCount: 1,
      timestamp: new Date(currHourStart.getTime() + 10000), // :00 of next hour
    });

    // Run aggregation once
    await setup.aggregationService.runOnce();

    if (crossesDayBoundary) {
      // When running at 00:xx, the previous hour (23:xx) is on yesterday,
      // so hour records get aggregated into day records
      const dayMetrics = await setup.ctx.executionMetricsService.getByRouteId(1, "day");
      expect(dayMetrics.length).toBe(1);
      expect(dayMetrics[0].executionCount).toBe(3); // 3 executions from prev day's hour
      expect(dayMetrics[0].maxTimeMs).toBe(200);
      expect(Math.round(dayMetrics[0].avgTimeMs)).toBe(150);

      // Hour records from yesterday should be aggregated into day
      const hourMetrics = await setup.ctx.executionMetricsService.getByRouteId(1, "hour");
      expect(hourMetrics.length).toBe(0);
    } else {
      // Normal case: hour record exists for the previous hour
      const hourMetrics = await setup.ctx.executionMetricsService.getByRouteId(1, "hour");
      expect(hourMetrics.length).toBe(1);
      expect(hourMetrics[0].executionCount).toBe(3); // 3 executions in prev hour
      expect(hourMetrics[0].maxTimeMs).toBe(200);
      // Weighted average: (100*1 + 200*1 + 150*1) / 3 = 150
      expect(Math.round(hourMetrics[0].avgTimeMs)).toBe(150);
      expect(hourMetrics[0].timestamp.toISOString()).toBe(prevHourStart.toISOString());
    }

    // Check that minute metrics from prev hour were deleted (aggregated into hour)
    const minuteMetrics = await setup.ctx.executionMetricsService.getByRouteId(1, "minute");
    // Should have 1 minute record remaining from current hour (:00)
    expect(minuteMetrics.length).toBe(1);

    // Check all executions were processed
    const executionMetrics = await setup.ctx.executionMetricsService.getByRouteId(1, "execution");
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

    // Check if we're in the first hour of the day (00:xx)
    // At 00:xx, the execution at 00:00:10 stays as a minute (hour not complete)
    const currentHour = new Date().getUTCHours();
    const isFirstHourOfDay = currentHour === 0;

    // Create hour records for the previous day (pre-aggregated for simplicity)
    // These will be aggregated when the day boundary is crossed
    await setup.ctx.executionMetricsService.store({
      routeId: 1,
      type: "hour",
      avgTimeMs: 100,
      maxTimeMs: 150,
      executionCount: 100,
      timestamp: new Date(prevDayStart.getTime() + 12 * 60 * 60 * 1000), // 12:00
    });

    await setup.ctx.executionMetricsService.store({
      routeId: 1,
      type: "hour",
      avgTimeMs: 200,
      maxTimeMs: 300,
      executionCount: 200,
      timestamp: new Date(prevDayStart.getTime() + 22 * 60 * 60 * 1000), // 22:00
    });

    // Create execution in the last hour of the previous day to start processing there
    await setup.ctx.executionMetricsService.store({
      routeId: 1,
      type: "execution",
      avgTimeMs: 150,
      maxTimeMs: 150,
      executionCount: 1,
      timestamp: new Date(prevDayStart.getTime() + 23 * 60 * 60 * 1000 + 59 * 60 * 1000 + 10000), // 23:59:10
    });

    // Create execution in the first hour of the current day to cross the day boundary
    const currDayStart = new Date(prevDayStart.getTime() + 24 * 60 * 60 * 1000);
    await setup.ctx.executionMetricsService.store({
      routeId: 1,
      type: "execution",
      avgTimeMs: 50,
      maxTimeMs: 50,
      executionCount: 1,
      timestamp: new Date(currDayStart.getTime() + 10000), // 00:00:10
    });

    // Run aggregation once
    await setup.aggregationService.runOnce();

    // Check day aggregate was created for the previous day
    const dayMetrics = await setup.ctx.executionMetricsService.getByRouteId(1, "day");
    expect(dayMetrics.length).toBe(1);
    // Should have 100 + 200 + 1 (from the hour + the one execution that was in 23:59)
    // Actually, the execution at 23:59 becomes minute, then hour, then day
    // Plus the 2 pre-existing hour records
    // So: hour1 (100 exec) + hour2 (200 exec) + hour3 (1 exec from minute) = 301
    expect(dayMetrics[0].executionCount).toBe(301);
    expect(dayMetrics[0].maxTimeMs).toBe(300);
    expect(dayMetrics[0].timestamp.toISOString()).toBe(prevDayStart.toISOString());

    // Check hour metrics from prev day were deleted (aggregated into day)
    const hourMetrics = await setup.ctx.executionMetricsService.getByRouteId(1, "hour");
    if (isFirstHourOfDay) {
      // At 00:xx, the execution at 00:00:10 stays as a minute (hour 00 not complete yet)
      // So no hour records exist from today
      expect(hourMetrics.length).toBe(0);
    } else {
      // Later in the day, hour 00 has completed and its minute was aggregated to hour
      expect(hourMetrics.length).toBe(1);
    }

    // Check all executions were processed
    const executionMetrics = await setup.ctx.executionMetricsService.getByRouteId(1, "execution");
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
    await setup.ctx.executionMetricsService.store({
      routeId: 1,
      type: "day",
      avgTimeMs: 100,
      maxTimeMs: 150,
      executionCount: 1000,
      timestamp: oldDate,
    });

    await setup.ctx.executionMetricsService.store({
      routeId: 1,
      type: "hour",
      avgTimeMs: 50,
      maxTimeMs: 75,
      executionCount: 500,
      timestamp: oldDate,
    });

    await setup.ctx.executionMetricsService.store({
      routeId: 1,
      type: "minute",
      avgTimeMs: 25,
      maxTimeMs: 40,
      executionCount: 50,
      timestamp: oldDate,
    });

    // Add recent day metric
    await setup.ctx.executionMetricsService.store({
      routeId: 1,
      type: "day",
      avgTimeMs: 200,
      maxTimeMs: 250,
      executionCount: 2000,
      timestamp: recentDate,
    });

    // Run aggregation once
    await setup.aggregationService.runOnce();

    // Only the recent day metric should remain - all old metrics deleted
    const dayMetrics = await setup.ctx.executionMetricsService.getByRouteId(1, "day");
    expect(dayMetrics.length).toBe(1);
    expect(dayMetrics[0].executionCount).toBe(2000);

    // Old hour and minute metrics should also be deleted
    const hourMetrics = await setup.ctx.executionMetricsService.getByRouteId(1, "hour");
    expect(hourMetrics.length).toBe(0);

    const minuteMetrics = await setup.ctx.executionMetricsService.getByRouteId(1, "minute");
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
      await setup.ctx.executionMetricsService.store({
        routeId: 1,
        type: "execution",
        avgTimeMs: 100 + minute * 10,
        maxTimeMs: 100 + minute * 10,
        executionCount: 1,
        timestamp: new Date(baseTime.getTime() + minute * 60 * 1000 + 30000), // 30s into each minute
      });
    }

    // Run aggregation once
    await setup.aggregationService.runOnce();

    // All executions should be deleted
    const executionMetrics = await setup.ctx.executionMetricsService.getByRouteId(1, "execution");
    expect(executionMetrics.length).toBe(0);

    // The 5 executions should be aggregated into minute (and possibly hour) records
    // If the 5 minutes span an hour boundary, some may be further aggregated into hour records
    const minuteMetrics = await setup.ctx.executionMetricsService.getByRouteId(1, "minute");
    const hourMetrics = await setup.ctx.executionMetricsService.getByRouteId(1, "hour");

    // Calculate total execution count from all aggregated records
    const minuteCount = minuteMetrics.reduce((sum, m) => sum + m.executionCount, 0);
    const hourCount = hourMetrics.reduce((sum, m) => sum + m.executionCount, 0);

    // Total should equal our original 5 executions
    expect(minuteCount + hourCount).toBe(5);

    // Should have at least some aggregated records
    expect(minuteMetrics.length + hourMetrics.length).toBeGreaterThan(0);
  } finally {
    await cleanup(setup);
  }
});

Deno.test("MetricsAggregationService does nothing when no data", async () => {
  const setup = await createTestSetup();

  try {
    // Run with no data
    await setup.aggregationService.runOnce();

    // No errors should occur, no data should be created
    const allMetrics = await setup.ctx.executionMetricsService.getRecent(100);
    expect(allMetrics.length).toBe(0);
  } finally {
    await cleanup(setup);
  }
});

// =====================
// Execution Tests
// =====================

Deno.test("MetricsAggregationService can be run multiple times", async () => {
  const setup = await createTestSetup();

  try {
    // Add some data to process (from 5 minutes ago)
    const minuteStart = getPastMinute(5);
    for (let i = 0; i < 10; i++) {
      await setup.ctx.executionMetricsService.store({
        routeId: 1,
        type: "execution",
        avgTimeMs: 100,
        maxTimeMs: 100,
        executionCount: 1,
        timestamp: new Date(minuteStart.getTime() + i * 1000),
      });
    }

    // Run aggregation multiple times
    await setup.aggregationService.performAggregation();
    await setup.aggregationService.performAggregation();
    await setup.aggregationService.runOnce();

    // Processing should have completed
    const minuteMetrics = await setup.ctx.executionMetricsService.getByRouteId(1, "minute");
    expect(minuteMetrics.length).toBe(1);
  } finally {
    await cleanup(setup);
  }
});

// =====================
// Pending Aggregation Tests (no executions scenario)
// =====================

Deno.test("MetricsAggregationService processes pending minutes into hours when no executions", async () => {
  const setup = await createTestSetup();

  try {
    // Get the last complete hour (2 hours ago to ensure it's complete)
    const prevHourStart = getPastHour(2);
    const crossesDayBoundary = isPastHourOnDifferentDay(2);

    // Create minute records directly (as if executions were already processed)
    // This simulates the state where execution→minute happened but minute→hour didn't
    await setup.ctx.executionMetricsService.store({
      routeId: 1,
      type: "minute",
      avgTimeMs: 100,
      maxTimeMs: 100,
      executionCount: 1,
      timestamp: new Date(prevHourStart.getTime() + 55 * 60 * 1000), // :55
    });

    await setup.ctx.executionMetricsService.store({
      routeId: 1,
      type: "minute",
      avgTimeMs: 200,
      maxTimeMs: 200,
      executionCount: 1,
      timestamp: new Date(prevHourStart.getTime() + 56 * 60 * 1000), // :56
    });

    await setup.ctx.executionMetricsService.store({
      routeId: 1,
      type: "minute",
      avgTimeMs: 150,
      maxTimeMs: 150,
      executionCount: 1,
      timestamp: new Date(prevHourStart.getTime() + 57 * 60 * 1000), // :57
    });

    // Verify no executions exist
    const execsBefore = await setup.ctx.executionMetricsService.getByRouteId(1, "execution");
    expect(execsBefore.length).toBe(0);

    // Run aggregation once
    await setup.aggregationService.runOnce();

    if (crossesDayBoundary) {
      // When running at 00:xx or 01:xx, getPastHour(2) returns yesterday's hour,
      // so hour records get aggregated into day records
      const dayMetrics = await setup.ctx.executionMetricsService.getByRouteId(1, "day");
      expect(dayMetrics.length).toBe(1);
      expect(dayMetrics[0].executionCount).toBe(3);
      expect(dayMetrics[0].maxTimeMs).toBe(200);

      // Hour records from yesterday should be aggregated into day
      const hourMetrics = await setup.ctx.executionMetricsService.getByRouteId(1, "hour");
      expect(hourMetrics.length).toBe(0);
    } else {
      // Normal case: hour record exists for the previous hour
      const hourMetrics = await setup.ctx.executionMetricsService.getByRouteId(1, "hour");
      expect(hourMetrics.length).toBe(1);
      expect(hourMetrics[0].executionCount).toBe(3);
      expect(hourMetrics[0].maxTimeMs).toBe(200);
      expect(hourMetrics[0].timestamp.toISOString()).toBe(prevHourStart.toISOString());
    }

    // Check that minute metrics were deleted (aggregated into hour)
    const minuteMetrics = await setup.ctx.executionMetricsService.getByRouteId(1, "minute");
    expect(minuteMetrics.length).toBe(0);
  } finally {
    await cleanup(setup);
  }
});

Deno.test("MetricsAggregationService processes pending hours into days when no executions", async () => {
  const setup = await createTestSetup();

  try {
    // Get the previous complete day
    const prevDayStart = getPastDay(1);

    // Create hour records directly (as if minute→hour already happened)
    // This simulates the state where minute→hour happened but hour→day didn't
    await setup.ctx.executionMetricsService.store({
      routeId: 1,
      type: "hour",
      avgTimeMs: 100,
      maxTimeMs: 150,
      executionCount: 50,
      timestamp: new Date(prevDayStart.getTime() + 10 * 60 * 60 * 1000), // 10:00
    });

    await setup.ctx.executionMetricsService.store({
      routeId: 1,
      type: "hour",
      avgTimeMs: 200,
      maxTimeMs: 300,
      executionCount: 100,
      timestamp: new Date(prevDayStart.getTime() + 15 * 60 * 60 * 1000), // 15:00
    });

    // Verify no executions or minutes exist
    const execsBefore = await setup.ctx.executionMetricsService.getByRouteId(1, "execution");
    expect(execsBefore.length).toBe(0);
    const minutesBefore = await setup.ctx.executionMetricsService.getByRouteId(1, "minute");
    expect(minutesBefore.length).toBe(0);

    // Run aggregation once
    await setup.aggregationService.runOnce();

    // Check day aggregate was created
    const dayMetrics = await setup.ctx.executionMetricsService.getByRouteId(1, "day");
    expect(dayMetrics.length).toBe(1);
    expect(dayMetrics[0].executionCount).toBe(150); // 50 + 100
    expect(dayMetrics[0].maxTimeMs).toBe(300);
    expect(dayMetrics[0].timestamp.toISOString()).toBe(prevDayStart.toISOString());

    // Check that hour metrics were deleted (aggregated into day)
    const hourMetrics = await setup.ctx.executionMetricsService.getByRouteId(1, "hour");
    expect(hourMetrics.length).toBe(0);
  } finally {
    await cleanup(setup);
  }
});

Deno.test("MetricsAggregationService processes both pending minutes and hours in one run", async () => {
  const setup = await createTestSetup();

  try {
    // Get dates for yesterday and two hours ago
    const prevDayStart = getPastDay(1);
    const prevHourStart = getPastHour(2);
    const crossesDayBoundary = isPastHourOnDifferentDay(2);

    // Create hour records from yesterday (should become day record)
    await setup.ctx.executionMetricsService.store({
      routeId: 1,
      type: "hour",
      avgTimeMs: 100,
      maxTimeMs: 100,
      executionCount: 25,
      timestamp: new Date(prevDayStart.getTime() + 12 * 60 * 60 * 1000), // Yesterday 12:00
    });

    // Create minute records from 2 hours ago (should become hour record)
    await setup.ctx.executionMetricsService.store({
      routeId: 1,
      type: "minute",
      avgTimeMs: 200,
      maxTimeMs: 200,
      executionCount: 5,
      timestamp: new Date(prevHourStart.getTime() + 30 * 60 * 1000), // 2 hours ago :30
    });

    // Verify no executions exist
    const execsBefore = await setup.ctx.executionMetricsService.getByRouteId(1, "execution");
    expect(execsBefore.length).toBe(0);

    // Run aggregation once
    await setup.aggregationService.runOnce();

    // Check day aggregate was created from yesterday's hour
    const dayMetrics = await setup.ctx.executionMetricsService.getByRouteId(1, "day");
    expect(dayMetrics.length).toBe(1);
    expect(dayMetrics[0].timestamp.toISOString()).toBe(prevDayStart.toISOString());

    if (crossesDayBoundary) {
      // At 00:xx or 01:xx, getPastHour(2) returns yesterday's hour,
      // so its minutes become hours, which then become day records
      // Both the hour from 12:00 and the new hour from prevHourStart end up in the same day
      expect(dayMetrics[0].executionCount).toBe(30); // 25 + 5

      // Hour records from yesterday should be aggregated into day
      const hourMetrics = await setup.ctx.executionMetricsService.getByRouteId(1, "hour");
      expect(hourMetrics.length).toBe(0);
    } else {
      // Normal case: day record only contains the 12:00 hour
      expect(dayMetrics[0].executionCount).toBe(25);

      // Hour record from today's minutes exists
      const hourMetrics = await setup.ctx.executionMetricsService.getByRouteId(1, "hour");
      expect(hourMetrics.length).toBe(1);
      expect(hourMetrics[0].executionCount).toBe(5);
      expect(hourMetrics[0].timestamp.toISOString()).toBe(prevHourStart.toISOString());
    }

    // All minutes should be processed
    const minuteMetrics = await setup.ctx.executionMetricsService.getByRouteId(1, "minute");
    expect(minuteMetrics.length).toBe(0);
  } finally {
    await cleanup(setup);
  }
});
