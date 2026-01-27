import { integrationTest } from "../test/test_helpers.ts";
import { expect } from "@std/expect";
import { TestSetupBuilder } from "../test/test_setup_builder.ts";

// =====================
// ExecutionMetricsService tests
// =====================

integrationTest("ExecutionMetricsService stores metric entry", async () => {
  const ctx = await TestSetupBuilder.create()
    .withExecutionMetricsService()
    .build();

  try {
    await ctx.executionMetricsService.store({
      routeId: "1",
      type: "execution",
      avgTimeMs: 45,
      maxTimeMs: 45,
      executionCount: 1,
    });

    const metrics = await ctx.executionMetricsService.getByRouteId("1");
    expect(metrics.length).toBe(1);
    expect(metrics[0].routeId).toBe("1");
    expect(metrics[0].type).toBe("execution");
    expect(metrics[0].avgTimeMs).toBe(45);
    expect(metrics[0].maxTimeMs).toBe(45);
    expect(metrics[0].executionCount).toBe(1);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("ExecutionMetricsService stores metric with custom timestamp", async () => {
  const ctx = await TestSetupBuilder.create()
    .withExecutionMetricsService()
    .build();

  try {
    const customTimestamp = new Date("2024-01-15T10:30:00.000Z");
    await ctx.executionMetricsService.store({
      routeId: "1",
      type: "minute",
      avgTimeMs: 100,
      maxTimeMs: 150,
      executionCount: 5,
      timestamp: customTimestamp,
    });

    const metrics = await ctx.executionMetricsService.getByRouteId("1");
    expect(metrics.length).toBe(1);
    expect(metrics[0].timestamp.toISOString()).toBe(customTimestamp.toISOString());
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("ExecutionMetricsService retrieves metrics by routeId", async () => {
  const ctx = await TestSetupBuilder.create()
    .withExecutionMetricsService()
    .build();

  try {
    // Store metrics for different routes
    await ctx.executionMetricsService.store({ routeId: "1", type: "execution", avgTimeMs: 10, maxTimeMs: 10, executionCount: 1 });
    await ctx.executionMetricsService.store({ routeId: "2", type: "execution", avgTimeMs: 20, maxTimeMs: 20, executionCount: 1 });
    await ctx.executionMetricsService.store({ routeId: "1", type: "execution", avgTimeMs: 30, maxTimeMs: 30, executionCount: 1 });

    const metrics = await ctx.executionMetricsService.getByRouteId("1");
    expect(metrics.length).toBe(2);
    // Newest first (DESC order)
    expect(metrics[0].avgTimeMs).toBe(30);
    expect(metrics[1].avgTimeMs).toBe(10);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("ExecutionMetricsService retrieves metrics by routeId with type filter", async () => {
  const ctx = await TestSetupBuilder.create()
    .withExecutionMetricsService()
    .build();

  try {
    await ctx.executionMetricsService.store({ routeId: "1", type: "execution", avgTimeMs: 10, maxTimeMs: 10, executionCount: 1 });
    await ctx.executionMetricsService.store({ routeId: "1", type: "minute", avgTimeMs: 15, maxTimeMs: 20, executionCount: 3 });
    await ctx.executionMetricsService.store({ routeId: "1", type: "execution", avgTimeMs: 20, maxTimeMs: 20, executionCount: 1 });

    const metrics = await ctx.executionMetricsService.getByRouteId("1", "execution");
    expect(metrics.length).toBe(2);
    expect(metrics.every((m) => m.type === "execution")).toBe(true);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("ExecutionMetricsService retrieves metrics by routeId with limit", async () => {
  const ctx = await TestSetupBuilder.create()
    .withExecutionMetricsService()
    .build();

  try {
    for (let i = 0; i < 5; i++) {
      await ctx.executionMetricsService.store({ routeId: "1", type: "execution", avgTimeMs: i * 10, maxTimeMs: i * 10, executionCount: 1 });
    }

    const metrics = await ctx.executionMetricsService.getByRouteId("1", undefined, 3);
    expect(metrics.length).toBe(3);
    // Newest first
    expect(metrics[0].avgTimeMs).toBe(40);
    expect(metrics[2].avgTimeMs).toBe(20);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("ExecutionMetricsService getRecent returns most recent metrics", async () => {
  const ctx = await TestSetupBuilder.create()
    .withExecutionMetricsService()
    .build();

  try {
    for (let i = 0; i < 5; i++) {
      await ctx.executionMetricsService.store({ routeId: "1", type: "execution", avgTimeMs: i * 10, maxTimeMs: i * 10, executionCount: 1 });
    }

    const metrics = await ctx.executionMetricsService.getRecent(3);
    expect(metrics.length).toBe(3);
    // Most recent first (DESC order)
    expect(metrics[0].avgTimeMs).toBe(40);
    expect(metrics[1].avgTimeMs).toBe(30);
    expect(metrics[2].avgTimeMs).toBe(20);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("ExecutionMetricsService deletes metrics older than date", async () => {
  const ctx = await TestSetupBuilder.create()
    .withExecutionMetricsService()
    .build();

  try {
    await ctx.executionMetricsService.store({ routeId: "1", type: "execution", avgTimeMs: 10, maxTimeMs: 10, executionCount: 1 });

    // Delete metrics older than 1 second from now
    const futureDate = new Date(Date.now() + 1000);
    const deleted = await ctx.executionMetricsService.deleteOlderThan(futureDate);

    expect(deleted).toBe(1);

    const metrics = await ctx.executionMetricsService.getByRouteId("1");
    expect(metrics.length).toBe(0);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("ExecutionMetricsService deletes metrics by routeId", async () => {
  const ctx = await TestSetupBuilder.create()
    .withExecutionMetricsService()
    .build();

  try {
    await ctx.executionMetricsService.store({ routeId: "1", type: "execution", avgTimeMs: 10, maxTimeMs: 10, executionCount: 1 });
    await ctx.executionMetricsService.store({ routeId: "2", type: "execution", avgTimeMs: 20, maxTimeMs: 20, executionCount: 1 });

    const deleted = await ctx.executionMetricsService.deleteByRouteId("1");
    expect(deleted).toBe(1);

    const metricsRoute1 = await ctx.executionMetricsService.getByRouteId("1");
    expect(metricsRoute1.length).toBe(0);

    const metricsRoute2 = await ctx.executionMetricsService.getByRouteId("2");
    expect(metricsRoute2.length).toBe(1);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("ExecutionMetricsService stores all metric types", async () => {
  const ctx = await TestSetupBuilder.create()
    .withExecutionMetricsService()
    .build();

  try {
    const types = ["execution", "minute", "hour", "day"] as const;

    for (const type of types) {
      await ctx.executionMetricsService.store({ routeId: "1", type, avgTimeMs: 100, maxTimeMs: 100, executionCount: 1 });
    }

    const metrics = await ctx.executionMetricsService.getByRouteId("1");
    expect(metrics.length).toBe(4);

    for (let i = 0; i < types.length; i++) {
      // Reverse order since newest first
      expect(metrics[types.length - 1 - i].type).toBe(types[i]);
    }
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("ExecutionMetricsService getDistinctRouteIds returns all unique route IDs", async () => {
  const ctx = await TestSetupBuilder.create()
    .withExecutionMetricsService()
    .build();

  try {
    await ctx.executionMetricsService.store({ routeId: "1", type: "execution", avgTimeMs: 10, maxTimeMs: 10, executionCount: 1 });
    await ctx.executionMetricsService.store({ routeId: "2", type: "execution", avgTimeMs: 20, maxTimeMs: 20, executionCount: 1 });
    await ctx.executionMetricsService.store({ routeId: "1", type: "minute", avgTimeMs: 15, maxTimeMs: 20, executionCount: 2 });
    await ctx.executionMetricsService.store({ routeId: "3", type: "hour", avgTimeMs: 25, maxTimeMs: 30, executionCount: 10 });

    const routeIds = await ctx.executionMetricsService.getDistinctRouteIds();
    expect(routeIds.sort()).toEqual(["1", "2", "3"]);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("ExecutionMetricsService getDistinctRouteIdsByType returns route IDs for specific type", async () => {
  const ctx = await TestSetupBuilder.create()
    .withExecutionMetricsService()
    .build();

  try {
    await ctx.executionMetricsService.store({ routeId: "1", type: "execution", avgTimeMs: 10, maxTimeMs: 10, executionCount: 1 });
    await ctx.executionMetricsService.store({ routeId: "2", type: "execution", avgTimeMs: 20, maxTimeMs: 20, executionCount: 1 });
    await ctx.executionMetricsService.store({ routeId: "1", type: "minute", avgTimeMs: 15, maxTimeMs: 20, executionCount: 2 });
    await ctx.executionMetricsService.store({ routeId: "3", type: "minute", avgTimeMs: 25, maxTimeMs: 30, executionCount: 5 });

    const executionRouteIds = await ctx.executionMetricsService.getDistinctRouteIdsByType("execution");
    expect(executionRouteIds.sort()).toEqual(["1", "2"]);

    const minuteRouteIds = await ctx.executionMetricsService.getDistinctRouteIdsByType("minute");
    expect(minuteRouteIds.sort()).toEqual(["1", "3"]);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("ExecutionMetricsService getByRouteIdTypeAndTimeRange returns metrics in range", async () => {
  const ctx = await TestSetupBuilder.create()
    .withExecutionMetricsService()
    .build();

  try {
    const baseTime = new Date("2024-01-15T10:00:00.000Z");

    // Store metrics at different times
    await ctx.executionMetricsService.store({
      routeId: "1",
      type: "execution",
      avgTimeMs: 10,
      maxTimeMs: 10,
      executionCount: 1,
      timestamp: new Date(baseTime.getTime() + 0 * 60000), // 10:00
    });
    await ctx.executionMetricsService.store({
      routeId: "1",
      type: "execution",
      avgTimeMs: 20,
      maxTimeMs: 20,
      executionCount: 1,
      timestamp: new Date(baseTime.getTime() + 1 * 60000), // 10:01
    });
    await ctx.executionMetricsService.store({
      routeId: "1",
      type: "execution",
      avgTimeMs: 30,
      maxTimeMs: 30,
      executionCount: 1,
      timestamp: new Date(baseTime.getTime() + 2 * 60000), // 10:02
    });

    // Query for 10:00 to 10:02 (exclusive end)
    const start = new Date("2024-01-15T10:00:00.000Z");
    const end = new Date("2024-01-15T10:02:00.000Z");
    const metrics = await ctx.executionMetricsService.getByRouteIdTypeAndTimeRange("1", "execution", start, end);

    expect(metrics.length).toBe(2);
    expect(metrics[0].avgTimeMs).toBe(10);
    expect(metrics[1].avgTimeMs).toBe(20);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("ExecutionMetricsService deleteByRouteIdTypeAndTimeRange deletes metrics in range", async () => {
  const ctx = await TestSetupBuilder.create()
    .withExecutionMetricsService()
    .build();

  try {
    const baseTime = new Date("2024-01-15T10:00:00.000Z");

    await ctx.executionMetricsService.store({
      routeId: "1",
      type: "execution",
      avgTimeMs: 10,
      maxTimeMs: 10,
      executionCount: 1,
      timestamp: new Date(baseTime.getTime() + 0 * 60000), // 10:00
    });
    await ctx.executionMetricsService.store({
      routeId: "1",
      type: "execution",
      avgTimeMs: 20,
      maxTimeMs: 20,
      executionCount: 1,
      timestamp: new Date(baseTime.getTime() + 1 * 60000), // 10:01
    });
    await ctx.executionMetricsService.store({
      routeId: "1",
      type: "execution",
      avgTimeMs: 30,
      maxTimeMs: 30,
      executionCount: 1,
      timestamp: new Date(baseTime.getTime() + 2 * 60000), // 10:02
    });

    // Delete 10:00 to 10:02 (exclusive end)
    const start = new Date("2024-01-15T10:00:00.000Z");
    const end = new Date("2024-01-15T10:02:00.000Z");
    const deleted = await ctx.executionMetricsService.deleteByRouteIdTypeAndTimeRange("1", "execution", start, end);

    expect(deleted).toBe(2);

    const remaining = await ctx.executionMetricsService.getByRouteId("1");
    expect(remaining.length).toBe(1);
    expect(remaining[0].avgTimeMs).toBe(30);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("ExecutionMetricsService getMostRecentByType returns most recent metric", async () => {
  const ctx = await TestSetupBuilder.create()
    .withExecutionMetricsService()
    .build();

  try {
    const baseTime = new Date("2024-01-15T10:00:00.000Z");

    await ctx.executionMetricsService.store({
      routeId: "1",
      type: "minute",
      avgTimeMs: 10,
      maxTimeMs: 15,
      executionCount: 2,
      timestamp: new Date(baseTime.getTime() + 0 * 60000),
    });
    await ctx.executionMetricsService.store({
      routeId: "2",
      type: "minute",
      avgTimeMs: 20,
      maxTimeMs: 25,
      executionCount: 3,
      timestamp: new Date(baseTime.getTime() + 1 * 60000),
    });
    await ctx.executionMetricsService.store({
      routeId: "1",
      type: "execution",
      avgTimeMs: 5,
      maxTimeMs: 5,
      executionCount: 1,
      timestamp: new Date(baseTime.getTime() + 2 * 60000),
    });

    const mostRecent = await ctx.executionMetricsService.getMostRecentByType("minute");
    expect(mostRecent).not.toBeNull();
    expect(mostRecent!.routeId).toBe("2");
    expect(mostRecent!.avgTimeMs).toBe(20);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("ExecutionMetricsService getMostRecentByType returns null when no metrics", async () => {
  const ctx = await TestSetupBuilder.create()
    .withExecutionMetricsService()
    .build();

  try {
    const mostRecent = await ctx.executionMetricsService.getMostRecentByType("hour");
    expect(mostRecent).toBeNull();
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("ExecutionMetricsService getOldestByType returns oldest metric", async () => {
  const ctx = await TestSetupBuilder.create()
    .withExecutionMetricsService()
    .build();

  try {
    const baseTime = new Date("2024-01-15T10:00:00.000Z");

    await ctx.executionMetricsService.store({
      routeId: "1",
      type: "execution",
      avgTimeMs: 10,
      maxTimeMs: 10,
      executionCount: 1,
      timestamp: new Date(baseTime.getTime() + 0 * 60000),
    });
    await ctx.executionMetricsService.store({
      routeId: "2",
      type: "execution",
      avgTimeMs: 20,
      maxTimeMs: 20,
      executionCount: 1,
      timestamp: new Date(baseTime.getTime() + 1 * 60000),
    });

    const oldest = await ctx.executionMetricsService.getOldestByType("execution");
    expect(oldest).not.toBeNull();
    expect(oldest!.routeId).toBe("1");
    expect(oldest!.avgTimeMs).toBe(10);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("ExecutionMetricsService deleteByTypeOlderThan deletes old metrics of type", async () => {
  const ctx = await TestSetupBuilder.create()
    .withExecutionMetricsService()
    .build();

  try {
    const oldTime = new Date("2024-01-01T10:00:00.000Z");
    const newTime = new Date("2024-01-15T10:00:00.000Z");

    await ctx.executionMetricsService.store({
      routeId: "1",
      type: "day",
      avgTimeMs: 10,
      maxTimeMs: 15,
      executionCount: 100,
      timestamp: oldTime,
    });
    await ctx.executionMetricsService.store({
      routeId: "1",
      type: "day",
      avgTimeMs: 20,
      maxTimeMs: 25,
      executionCount: 150,
      timestamp: newTime,
    });
    await ctx.executionMetricsService.store({
      routeId: "1",
      type: "hour",
      avgTimeMs: 5,
      maxTimeMs: 8,
      executionCount: 10,
      timestamp: oldTime, // Old but different type
    });

    // Delete day metrics older than 2024-01-10
    const cutoff = new Date("2024-01-10T00:00:00.000Z");
    const deleted = await ctx.executionMetricsService.deleteByTypeOlderThan("day", cutoff);

    expect(deleted).toBe(1);

    const dayMetrics = await ctx.executionMetricsService.getByRouteId("1", "day");
    expect(dayMetrics.length).toBe(1);
    expect(dayMetrics[0].avgTimeMs).toBe(20);

    // Hour metric should still exist
    const hourMetrics = await ctx.executionMetricsService.getByRouteId("1", "hour");
    expect(hourMetrics.length).toBe(1);
  } finally {
    await ctx.cleanup();
  }
});
