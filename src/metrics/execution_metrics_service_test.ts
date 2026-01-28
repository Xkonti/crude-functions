import { integrationTest } from "../test/test_helpers.ts";
import { expect } from "@std/expect";
import { TestSetupBuilder } from "../test/test_setup_builder.ts";
import type { ExecutionMetric } from "./types.ts";

// =====================
// ExecutionMetricsService tests
// =====================

integrationTest("ExecutionMetricsService stores metric entry", async () => {
  const ctx = await TestSetupBuilder.create()
    .withMetrics()
    .withFunctions()
    .build();

  try {
    // Create a function to get a valid functionId
    const func = await ctx.functionsService.addFunction({
      name: "test-func",
      handler: "test.ts",
      routePath: "/test",
      methods: ["GET"],
    });

    await ctx.executionMetricsService.store({
      functionId: func.id,
      type: "execution",
      avgTimeUs: 45000, // 45ms in microseconds
      maxTimeUs: 45000,
      executionCount: 1,
    });

    const metrics = await ctx.executionMetricsService.getByFunctionId(func.id);
    expect(metrics.length).toBe(1);
    expect(metrics[0].functionId?.id).toBe(func.id.id);
    expect(metrics[0].type).toBe("execution");
    expect(metrics[0].avgTimeUs).toBe(45000);
    expect(metrics[0].maxTimeUs).toBe(45000);
    expect(metrics[0].executionCount).toBe(1);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("ExecutionMetricsService stores metric with custom timestamp", async () => {
  const ctx = await TestSetupBuilder.create()
    .withMetrics()
    .withFunctions()
    .build();

  try {
    const func = await ctx.functionsService.addFunction({
      name: "test-func",
      handler: "test.ts",
      routePath: "/test",
      methods: ["GET"],
    });

    const customTimestamp = new Date("2024-01-15T10:30:00.000Z");
    await ctx.executionMetricsService.store({
      functionId: func.id,
      type: "minute",
      avgTimeUs: 100000,
      maxTimeUs: 150000,
      executionCount: 5,
      timestamp: customTimestamp,
    });

    const metrics = await ctx.executionMetricsService.getByFunctionId(func.id);
    expect(metrics.length).toBe(1);
    expect(metrics[0].timestamp.toISOString()).toBe(customTimestamp.toISOString());
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("ExecutionMetricsService retrieves metrics by functionId", async () => {
  const ctx = await TestSetupBuilder.create()
    .withMetrics()
    .withFunctions()
    .build();

  try {
    const func1 = await ctx.functionsService.addFunction({
      name: "func1",
      handler: "test1.ts",
      routePath: "/test1",
      methods: ["GET"],
    });
    const func2 = await ctx.functionsService.addFunction({
      name: "func2",
      handler: "test2.ts",
      routePath: "/test2",
      methods: ["GET"],
    });

    // Store metrics for different functions with explicit timestamps to ensure deterministic ordering
    const baseTime = new Date("2024-01-15T10:00:00.000Z");
    await ctx.executionMetricsService.store({
      functionId: func1.id,
      type: "execution",
      avgTimeUs: 10000,
      maxTimeUs: 10000,
      executionCount: 1,
      timestamp: new Date(baseTime.getTime()),
    });
    await ctx.executionMetricsService.store({
      functionId: func2.id,
      type: "execution",
      avgTimeUs: 20000,
      maxTimeUs: 20000,
      executionCount: 1,
      timestamp: new Date(baseTime.getTime() + 60000),
    });
    await ctx.executionMetricsService.store({
      functionId: func1.id,
      type: "execution",
      avgTimeUs: 30000,
      maxTimeUs: 30000,
      executionCount: 1,
      timestamp: new Date(baseTime.getTime() + 120000),
    });

    const metrics = await ctx.executionMetricsService.getByFunctionId(func1.id);
    expect(metrics.length).toBe(2);
    // Newest first (DESC order)
    expect(metrics[0].avgTimeUs).toBe(30000);
    expect(metrics[1].avgTimeUs).toBe(10000);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("ExecutionMetricsService retrieves metrics by functionId with type filter", async () => {
  const ctx = await TestSetupBuilder.create()
    .withMetrics()
    .withFunctions()
    .build();

  try {
    const func = await ctx.functionsService.addFunction({
      name: "test-func",
      handler: "test.ts",
      routePath: "/test",
      methods: ["GET"],
    });

    await ctx.executionMetricsService.store({ functionId: func.id, type: "execution", avgTimeUs: 10000, maxTimeUs: 10000, executionCount: 1 });
    await ctx.executionMetricsService.store({ functionId: func.id, type: "minute", avgTimeUs: 15000, maxTimeUs: 20000, executionCount: 3 });
    await ctx.executionMetricsService.store({ functionId: func.id, type: "execution", avgTimeUs: 20000, maxTimeUs: 20000, executionCount: 1 });

    const metrics = await ctx.executionMetricsService.getByFunctionId(func.id, "execution");
    expect(metrics.length).toBe(2);
    expect(metrics.every((m: ExecutionMetric) => m.type === "execution")).toBe(true);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("ExecutionMetricsService retrieves metrics by functionId with limit", async () => {
  const ctx = await TestSetupBuilder.create()
    .withMetrics()
    .withFunctions()
    .build();

  try {
    const func = await ctx.functionsService.addFunction({
      name: "test-func",
      handler: "test.ts",
      routePath: "/test",
      methods: ["GET"],
    });

    const baseTime = new Date("2024-01-15T10:00:00.000Z");
    for (let i = 0; i < 5; i++) {
      await ctx.executionMetricsService.store({
        functionId: func.id,
        type: "execution",
        avgTimeUs: i * 10000,
        maxTimeUs: i * 10000,
        executionCount: 1,
        timestamp: new Date(baseTime.getTime() + i * 60000), // 1 minute apart
      });
    }

    const metrics = await ctx.executionMetricsService.getByFunctionId(func.id, undefined, 3);
    expect(metrics.length).toBe(3);
    // Newest first (DESC order): i=4, i=3, i=2
    expect(metrics[0].avgTimeUs).toBe(40000);
    expect(metrics[1].avgTimeUs).toBe(30000);
    expect(metrics[2].avgTimeUs).toBe(20000);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("ExecutionMetricsService getRecent returns most recent metrics", async () => {
  const ctx = await TestSetupBuilder.create()
    .withMetrics()
    .withFunctions()
    .build();

  try {
    const func = await ctx.functionsService.addFunction({
      name: "test-func",
      handler: "test.ts",
      routePath: "/test",
      methods: ["GET"],
    });

    const baseTime = new Date("2024-01-15T10:00:00.000Z");
    for (let i = 0; i < 5; i++) {
      await ctx.executionMetricsService.store({
        functionId: func.id,
        type: "execution",
        avgTimeUs: i * 10000,
        maxTimeUs: i * 10000,
        executionCount: 1,
        timestamp: new Date(baseTime.getTime() + i * 60000), // 1 minute apart
      });
    }

    const metrics = await ctx.executionMetricsService.getRecent(3);
    expect(metrics.length).toBe(3);
    // Most recent first (DESC order): i=4, i=3, i=2
    expect(metrics[0].avgTimeUs).toBe(40000);
    expect(metrics[1].avgTimeUs).toBe(30000);
    expect(metrics[2].avgTimeUs).toBe(20000);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("ExecutionMetricsService deletes metrics older than date", async () => {
  const ctx = await TestSetupBuilder.create()
    .withMetrics()
    .withFunctions()
    .build();

  try {
    const func = await ctx.functionsService.addFunction({
      name: "test-func",
      handler: "test.ts",
      routePath: "/test",
      methods: ["GET"],
    });

    await ctx.executionMetricsService.store({ functionId: func.id, type: "execution", avgTimeUs: 10000, maxTimeUs: 10000, executionCount: 1 });

    // Delete metrics older than 1 second from now
    const futureDate = new Date(Date.now() + 1000);
    const deleted = await ctx.executionMetricsService.deleteOlderThan(futureDate);

    expect(deleted).toBe(1);

    const metrics = await ctx.executionMetricsService.getByFunctionId(func.id);
    expect(metrics.length).toBe(0);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("ExecutionMetricsService deletes metrics by functionId", async () => {
  const ctx = await TestSetupBuilder.create()
    .withMetrics()
    .withFunctions()
    .build();

  try {
    const func1 = await ctx.functionsService.addFunction({
      name: "func1",
      handler: "test1.ts",
      routePath: "/test1",
      methods: ["GET"],
    });
    const func2 = await ctx.functionsService.addFunction({
      name: "func2",
      handler: "test2.ts",
      routePath: "/test2",
      methods: ["GET"],
    });

    await ctx.executionMetricsService.store({ functionId: func1.id, type: "execution", avgTimeUs: 10000, maxTimeUs: 10000, executionCount: 1 });
    await ctx.executionMetricsService.store({ functionId: func2.id, type: "execution", avgTimeUs: 20000, maxTimeUs: 20000, executionCount: 1 });

    const deleted = await ctx.executionMetricsService.deleteByFunctionId(func1.id);
    expect(deleted).toBe(1);

    const metricsFunc1 = await ctx.executionMetricsService.getByFunctionId(func1.id);
    expect(metricsFunc1.length).toBe(0);

    const metricsFunc2 = await ctx.executionMetricsService.getByFunctionId(func2.id);
    expect(metricsFunc2.length).toBe(1);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("ExecutionMetricsService stores all metric types", async () => {
  const ctx = await TestSetupBuilder.create()
    .withMetrics()
    .withFunctions()
    .build();

  try {
    const func = await ctx.functionsService.addFunction({
      name: "test-func",
      handler: "test.ts",
      routePath: "/test",
      methods: ["GET"],
    });

    const types = ["execution", "minute", "hour", "day"] as const;
    const baseTime = new Date("2024-01-15T10:00:00.000Z");

    for (let i = 0; i < types.length; i++) {
      await ctx.executionMetricsService.store({
        functionId: func.id,
        type: types[i],
        avgTimeUs: 100000,
        maxTimeUs: 100000,
        executionCount: 1,
        timestamp: new Date(baseTime.getTime() + i * 60000), // 1 minute apart
      });
    }

    const metrics = await ctx.executionMetricsService.getByFunctionId(func.id);
    expect(metrics.length).toBe(4);

    // Metrics are ordered DESC by timestamp, so newest (day) is first
    // Index 0 = day (created at +3 minutes), index 3 = execution (created at +0 minutes)
    expect(metrics[0].type).toBe("day");
    expect(metrics[1].type).toBe("hour");
    expect(metrics[2].type).toBe("minute");
    expect(metrics[3].type).toBe("execution");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("ExecutionMetricsService getDistinctFunctionIds returns all unique function IDs", async () => {
  const ctx = await TestSetupBuilder.create()
    .withMetrics()
    .withFunctions()
    .build();

  try {
    const func1 = await ctx.functionsService.addFunction({
      name: "func1",
      handler: "test1.ts",
      routePath: "/test1",
      methods: ["GET"],
    });
    const func2 = await ctx.functionsService.addFunction({
      name: "func2",
      handler: "test2.ts",
      routePath: "/test2",
      methods: ["GET"],
    });
    const func3 = await ctx.functionsService.addFunction({
      name: "func3",
      handler: "test3.ts",
      routePath: "/test3",
      methods: ["GET"],
    });

    await ctx.executionMetricsService.store({ functionId: func1.id, type: "execution", avgTimeUs: 10000, maxTimeUs: 10000, executionCount: 1 });
    await ctx.executionMetricsService.store({ functionId: func2.id, type: "execution", avgTimeUs: 20000, maxTimeUs: 20000, executionCount: 1 });
    await ctx.executionMetricsService.store({ functionId: func1.id, type: "minute", avgTimeUs: 15000, maxTimeUs: 20000, executionCount: 2 });
    await ctx.executionMetricsService.store({ functionId: func3.id, type: "hour", avgTimeUs: 25000, maxTimeUs: 30000, executionCount: 10 });

    const functionIds = await ctx.executionMetricsService.getDistinctFunctionIds();
    const idStrings = functionIds.map(id => String(id.id)).sort();
    expect(idStrings).toContain(String(func1.id.id));
    expect(idStrings).toContain(String(func2.id.id));
    expect(idStrings).toContain(String(func3.id.id));
    expect(functionIds.length).toBe(3);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("ExecutionMetricsService getDistinctFunctionIdsByType returns function IDs for specific type", async () => {
  const ctx = await TestSetupBuilder.create()
    .withMetrics()
    .withFunctions()
    .build();

  try {
    const func1 = await ctx.functionsService.addFunction({
      name: "func1",
      handler: "test1.ts",
      routePath: "/test1",
      methods: ["GET"],
    });
    const func2 = await ctx.functionsService.addFunction({
      name: "func2",
      handler: "test2.ts",
      routePath: "/test2",
      methods: ["GET"],
    });
    const func3 = await ctx.functionsService.addFunction({
      name: "func3",
      handler: "test3.ts",
      routePath: "/test3",
      methods: ["GET"],
    });

    await ctx.executionMetricsService.store({ functionId: func1.id, type: "execution", avgTimeUs: 10000, maxTimeUs: 10000, executionCount: 1 });
    await ctx.executionMetricsService.store({ functionId: func2.id, type: "execution", avgTimeUs: 20000, maxTimeUs: 20000, executionCount: 1 });
    await ctx.executionMetricsService.store({ functionId: func1.id, type: "minute", avgTimeUs: 15000, maxTimeUs: 20000, executionCount: 2 });
    await ctx.executionMetricsService.store({ functionId: func3.id, type: "minute", avgTimeUs: 25000, maxTimeUs: 30000, executionCount: 5 });

    const executionFunctionIds = await ctx.executionMetricsService.getDistinctFunctionIdsByType("execution");
    expect(executionFunctionIds.length).toBe(2);
    const execIdStrings = executionFunctionIds.map(id => String(id.id));
    expect(execIdStrings).toContain(String(func1.id.id));
    expect(execIdStrings).toContain(String(func2.id.id));

    const minuteFunctionIds = await ctx.executionMetricsService.getDistinctFunctionIdsByType("minute");
    expect(minuteFunctionIds.length).toBe(2);
    const minIdStrings = minuteFunctionIds.map(id => String(id.id));
    expect(minIdStrings).toContain(String(func1.id.id));
    expect(minIdStrings).toContain(String(func3.id.id));
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("ExecutionMetricsService getByFunctionIdTypeAndTimeRange returns metrics in range", async () => {
  const ctx = await TestSetupBuilder.create()
    .withMetrics()
    .withFunctions()
    .build();

  try {
    const func = await ctx.functionsService.addFunction({
      name: "test-func",
      handler: "test.ts",
      routePath: "/test",
      methods: ["GET"],
    });

    const baseTime = new Date("2024-01-15T10:00:00.000Z");

    // Store metrics at different times
    await ctx.executionMetricsService.store({
      functionId: func.id,
      type: "execution",
      avgTimeUs: 10000,
      maxTimeUs: 10000,
      executionCount: 1,
      timestamp: new Date(baseTime.getTime() + 0 * 60000), // 10:00
    });
    await ctx.executionMetricsService.store({
      functionId: func.id,
      type: "execution",
      avgTimeUs: 20000,
      maxTimeUs: 20000,
      executionCount: 1,
      timestamp: new Date(baseTime.getTime() + 1 * 60000), // 10:01
    });
    await ctx.executionMetricsService.store({
      functionId: func.id,
      type: "execution",
      avgTimeUs: 30000,
      maxTimeUs: 30000,
      executionCount: 1,
      timestamp: new Date(baseTime.getTime() + 2 * 60000), // 10:02
    });

    // Query for 10:00 to 10:02 (exclusive end)
    const start = new Date("2024-01-15T10:00:00.000Z");
    const end = new Date("2024-01-15T10:02:00.000Z");
    const metrics = await ctx.executionMetricsService.getByFunctionIdTypeAndTimeRange(func.id, "execution", start, end);

    expect(metrics.length).toBe(2);
    expect(metrics[0].avgTimeUs).toBe(10000);
    expect(metrics[1].avgTimeUs).toBe(20000);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("ExecutionMetricsService deleteByFunctionIdTypeAndTimeRange deletes metrics in range", async () => {
  const ctx = await TestSetupBuilder.create()
    .withMetrics()
    .withFunctions()
    .build();

  try {
    const func = await ctx.functionsService.addFunction({
      name: "test-func",
      handler: "test.ts",
      routePath: "/test",
      methods: ["GET"],
    });

    const baseTime = new Date("2024-01-15T10:00:00.000Z");

    await ctx.executionMetricsService.store({
      functionId: func.id,
      type: "execution",
      avgTimeUs: 10000,
      maxTimeUs: 10000,
      executionCount: 1,
      timestamp: new Date(baseTime.getTime() + 0 * 60000), // 10:00
    });
    await ctx.executionMetricsService.store({
      functionId: func.id,
      type: "execution",
      avgTimeUs: 20000,
      maxTimeUs: 20000,
      executionCount: 1,
      timestamp: new Date(baseTime.getTime() + 1 * 60000), // 10:01
    });
    await ctx.executionMetricsService.store({
      functionId: func.id,
      type: "execution",
      avgTimeUs: 30000,
      maxTimeUs: 30000,
      executionCount: 1,
      timestamp: new Date(baseTime.getTime() + 2 * 60000), // 10:02
    });

    // Delete 10:00 to 10:02 (exclusive end)
    const start = new Date("2024-01-15T10:00:00.000Z");
    const end = new Date("2024-01-15T10:02:00.000Z");
    const deleted = await ctx.executionMetricsService.deleteByFunctionIdTypeAndTimeRange(func.id, "execution", start, end);

    expect(deleted).toBe(2);

    const remaining = await ctx.executionMetricsService.getByFunctionId(func.id);
    expect(remaining.length).toBe(1);
    expect(remaining[0].avgTimeUs).toBe(30000);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("ExecutionMetricsService getMostRecentByType returns most recent metric", async () => {
  const ctx = await TestSetupBuilder.create()
    .withMetrics()
    .withFunctions()
    .build();

  try {
    const func1 = await ctx.functionsService.addFunction({
      name: "func1",
      handler: "test1.ts",
      routePath: "/test1",
      methods: ["GET"],
    });
    const func2 = await ctx.functionsService.addFunction({
      name: "func2",
      handler: "test2.ts",
      routePath: "/test2",
      methods: ["GET"],
    });

    const baseTime = new Date("2024-01-15T10:00:00.000Z");

    await ctx.executionMetricsService.store({
      functionId: func1.id,
      type: "minute",
      avgTimeUs: 10000,
      maxTimeUs: 15000,
      executionCount: 2,
      timestamp: new Date(baseTime.getTime() + 0 * 60000),
    });
    await ctx.executionMetricsService.store({
      functionId: func2.id,
      type: "minute",
      avgTimeUs: 20000,
      maxTimeUs: 25000,
      executionCount: 3,
      timestamp: new Date(baseTime.getTime() + 1 * 60000),
    });
    await ctx.executionMetricsService.store({
      functionId: func1.id,
      type: "execution",
      avgTimeUs: 5000,
      maxTimeUs: 5000,
      executionCount: 1,
      timestamp: new Date(baseTime.getTime() + 2 * 60000),
    });

    const mostRecent = await ctx.executionMetricsService.getMostRecentByType("minute");
    expect(mostRecent).not.toBeNull();
    expect(mostRecent!.functionId?.id).toBe(func2.id.id);
    expect(mostRecent!.avgTimeUs).toBe(20000);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("ExecutionMetricsService getMostRecentByType returns null when no metrics", async () => {
  const ctx = await TestSetupBuilder.create()
    .withMetrics()
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
    .withMetrics()
    .withFunctions()
    .build();

  try {
    const func1 = await ctx.functionsService.addFunction({
      name: "func1",
      handler: "test1.ts",
      routePath: "/test1",
      methods: ["GET"],
    });
    const func2 = await ctx.functionsService.addFunction({
      name: "func2",
      handler: "test2.ts",
      routePath: "/test2",
      methods: ["GET"],
    });

    const baseTime = new Date("2024-01-15T10:00:00.000Z");

    await ctx.executionMetricsService.store({
      functionId: func1.id,
      type: "execution",
      avgTimeUs: 10000,
      maxTimeUs: 10000,
      executionCount: 1,
      timestamp: new Date(baseTime.getTime() + 0 * 60000),
    });
    await ctx.executionMetricsService.store({
      functionId: func2.id,
      type: "execution",
      avgTimeUs: 20000,
      maxTimeUs: 20000,
      executionCount: 1,
      timestamp: new Date(baseTime.getTime() + 1 * 60000),
    });

    const oldest = await ctx.executionMetricsService.getOldestByType("execution");
    expect(oldest).not.toBeNull();
    expect(oldest!.functionId?.id).toBe(func1.id.id);
    expect(oldest!.avgTimeUs).toBe(10000);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("ExecutionMetricsService deleteByTypeOlderThan deletes old metrics of type", async () => {
  const ctx = await TestSetupBuilder.create()
    .withMetrics()
    .withFunctions()
    .build();

  try {
    const func = await ctx.functionsService.addFunction({
      name: "test-func",
      handler: "test.ts",
      routePath: "/test",
      methods: ["GET"],
    });

    const oldTime = new Date("2024-01-01T10:00:00.000Z");
    const newTime = new Date("2024-01-15T10:00:00.000Z");

    await ctx.executionMetricsService.store({
      functionId: func.id,
      type: "day",
      avgTimeUs: 10000,
      maxTimeUs: 15000,
      executionCount: 100,
      timestamp: oldTime,
    });
    await ctx.executionMetricsService.store({
      functionId: func.id,
      type: "day",
      avgTimeUs: 20000,
      maxTimeUs: 25000,
      executionCount: 150,
      timestamp: newTime,
    });
    await ctx.executionMetricsService.store({
      functionId: func.id,
      type: "hour",
      avgTimeUs: 5000,
      maxTimeUs: 8000,
      executionCount: 10,
      timestamp: oldTime, // Old but different type
    });

    // Delete day metrics older than 2024-01-10
    const cutoff = new Date("2024-01-10T00:00:00.000Z");
    const deleted = await ctx.executionMetricsService.deleteByTypeOlderThan("day", cutoff);

    expect(deleted).toBe(1);

    const dayMetrics = await ctx.executionMetricsService.getByFunctionId(func.id, "day");
    expect(dayMetrics.length).toBe(1);
    expect(dayMetrics[0].avgTimeUs).toBe(20000);

    // Hour metric should still exist
    const hourMetrics = await ctx.executionMetricsService.getByFunctionId(func.id, "hour");
    expect(hourMetrics.length).toBe(1);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("ExecutionMetricsService stores global metrics (null functionId)", async () => {
  const ctx = await TestSetupBuilder.create()
    .withMetrics()
    .build();

  try {
    // Store a global metric (functionId = null)
    await ctx.executionMetricsService.store({
      functionId: null,
      type: "minute",
      avgTimeUs: 50000,
      maxTimeUs: 100000,
      executionCount: 10,
    });

    const recentMetrics = await ctx.executionMetricsService.getRecent(1);
    expect(recentMetrics.length).toBe(1);
    expect(recentMetrics[0].functionId).toBeNull();
    expect(recentMetrics[0].avgTimeUs).toBe(50000);
  } finally {
    await ctx.cleanup();
  }
});
