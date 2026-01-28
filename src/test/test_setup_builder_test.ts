/**
 * Tests for TestSetupBuilder to verify the builder creates valid test contexts.
 */

import { expect } from "@std/expect";
import { TestSetupBuilder } from "./test_setup_builder.ts";
import { integrationTest } from "./test_helpers.ts";
import type { FullTestContext } from "./types.ts";

integrationTest("TestSetupBuilder creates basic context with all services", async () => {
  // Use .withAll() explicitly for type safety - this is now required since
  // the builder returns BaseTestContext by default
  const ctx = await TestSetupBuilder.create().withAll().build();

  try {
    // Verify all services are initialized
    expect(ctx.encryptionService).toBeDefined();
    expect(ctx.hashService).toBeDefined();
    expect(ctx.settingsService).toBeDefined();
    expect(ctx.apiKeyService).toBeDefined();
    expect(ctx.functionsService).toBeDefined();
    expect(ctx.fileService).toBeDefined();
    expect(ctx.consoleLogService).toBeDefined();
    expect(ctx.executionMetricsService).toBeDefined();
    expect(ctx.auth).toBeDefined();
    expect(ctx.userService).toBeDefined();

    // Verify directories exist
    expect(ctx.tempDir).toBeDefined();
    expect(ctx.codeDir).toBeDefined();

    // Verify encryption keys were generated
    expect(ctx.encryptionKeys.current_key).toBeDefined();
    expect(ctx.encryptionKeys.hash_key).toBeDefined();
    expect(ctx.encryptionKeys.better_auth_secret).toBeDefined();

    // Verify SurrealDB connection is working
    expect(ctx.surrealDb).toBeDefined();
    expect(ctx.surrealFactory).toBeDefined();
    expect(ctx.surrealNamespace).toBeDefined();
    expect(ctx.surrealDatabase).toBeDefined();
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("TestSetupBuilder.withApiKeyGroup creates group", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeyGroup("test-group", "Test description")
    .build();

  try {
    const group = await ctx.apiKeyService.getGroupByName("test-group");
    expect(group).toBeDefined();
    expect(group?.name).toBe("test-group");
    expect(group?.description).toBe("Test description");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("TestSetupBuilder.withApiKey creates key in group", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeyGroup("test-group")
    .withApiKey("test-group", "my-secret-key", "key-name", "Key description")
    .build();

  try {
    // Verify key exists and can be verified
    const hasKey = await ctx.apiKeyService.hasKey("test-group", "my-secret-key");
    expect(hasKey).toBe(true);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("TestSetupBuilder.withFunction creates function", async () => {
  const ctx = await TestSetupBuilder.create()
    .withFunction("/test", "test.ts", { methods: ["GET", "POST"] })
    .build();

  try {
    const functions = await ctx.functionsService.getAll();
    expect(functions.length).toBe(1);
    expect(functions[0].routePath).toBe("/test");
    expect(functions[0].handler).toBe("test.ts");
    expect(functions[0].methods).toContain("GET");
    expect(functions[0].methods).toContain("POST");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("TestSetupBuilder.withFile creates file", async () => {
  const ctx = await TestSetupBuilder.create()
    .withFile("hello.ts", `export default async (c) => c.json({ ok: true })`)
    .build();

  try {
    const exists = await ctx.fileService.fileExists("hello.ts");
    expect(exists).toBe(true);

    const content = await ctx.fileService.getFile("hello.ts");
    expect(content).toContain("export default");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("TestSetupBuilder.withSetting sets global setting", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSetting("log.level", "debug")
    .build();

  try {
    const value = await ctx.settingsService.getGlobalSetting("log.level");
    expect(value).toBe("debug");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("TestSetupBuilder.withAdminUser creates user", async () => {
  const ctx = await TestSetupBuilder.create()
    .withAdminUser("admin@test.com", "password123")
    .build();

  try {
    const user = await ctx.userService.getByEmail("admin@test.com");
    expect(user).toBeDefined();
    expect(user?.email).toBe("admin@test.com");
    expect(user?.roles).toContain("userMgmt");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("TestSetupBuilder.withConsoleLog seeds log data", async () => {
  // First create a function to have a valid functionId
  const ctx = await TestSetupBuilder.create()
    .withFunction("/test", "test.ts")
    .withLogs()
    .build();

  try {
    // Get the functionId from the created function
    const func = await ctx.functionsService.getByName("test");
    const { recordIdToString } = await import("../database/surreal_helpers.ts");
    const functionId = recordIdToString(func!.id);

    // Now seed the log with the actual functionId
    ctx.consoleLogService.store({
      requestId: "test-request-123",
      functionId,
      level: "info",
      message: "Test log message",
    });
    await ctx.consoleLogService.flush();

    const logs = await ctx.consoleLogService.getByRequestId("test-request-123");
    expect(logs.length).toBe(1);
    expect(logs[0].message).toBe("Test log message");
    expect(logs[0].level).toBe("info");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("TestSetupBuilder.withMetric seeds metric data", async () => {
  const ctx = await TestSetupBuilder.create()
    .withFunction("/test", "test.ts")
    .withMetric({
      functionId: null, // Global metric
      type: "execution",
      avgTimeMs: 100,
      maxTimeMs: 150,
      executionCount: 10,
    })
    .build();

  try {
    // Use service to fetch metrics (stored in microseconds, converted from milliseconds)
    // Add 1 second to end time to ensure the metric is captured (timestamps might be identical)
    const endTime = new Date(Date.now() + 1000);
    const metrics = await ctx.executionMetricsService.getGlobalMetricsByTypeAndTimeRange(
      "execution",
      new Date(0),
      endTime
    );
    expect(metrics.length).toBe(1);
    expect(metrics[0].avgTimeUs).toBe(100000); // 100ms = 100000us
    expect(metrics[0].executionCount).toBe(10);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("TestSetupBuilder full integration", async () => {
  const ctx = await TestSetupBuilder.create()
    .withAdminUser("admin@example.com", "securepassword", ["userMgmt", "permanent"])
    .withApiKeyGroup("management", "Management keys")
    .withApiKey("management", "mgmt-key-123", "admin-key")
    .withFunction("/hello", "hello.ts", {
      methods: ["GET"],
      name: "Hello World",
      description: "A simple hello endpoint",
    })
    .withFile("hello.ts", `
      export default async function(c, ctx) {
        return c.json({ message: "Hello, World!" });
      }
    `)
    .withSetting("log.level", "debug")
    .build();

  try {
    // Verify user
    const user = await ctx.userService.getByEmail("admin@example.com");
    expect(user?.roles).toContain("permanent");

    // Verify API key
    expect(await ctx.apiKeyService.hasKey("management", "mgmt-key-123")).toBe(true);

    // Verify function
    const functions = await ctx.functionsService.getAll();
    expect(functions.some((f) => f.routePath === "/hello")).toBe(true);

    // Verify file
    expect(await ctx.fileService.fileExists("hello.ts")).toBe(true);

    // Verify setting
    expect(await ctx.settingsService.getGlobalSetting("log.level")).toBe("debug");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("TestSetupBuilder cleanup removes temp directory", async () => {
  const ctx = await TestSetupBuilder.create().withAll().build();
  const tempDir = ctx.tempDir;

  // Verify temp dir exists
  const statBefore = await Deno.stat(tempDir);
  expect(statBefore.isDirectory).toBe(true);

  // Cleanup
  await ctx.cleanup();

  // Verify temp dir is removed
  try {
    await Deno.stat(tempDir);
    // Should not reach here
    expect(true).toBe(false);
  } catch (error) {
    expect(error instanceof Deno.errors.NotFound).toBe(true);
  }
});

integrationTest("TestSetupBuilder.withSecrets creates secrets service", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSecrets()
    .build();

  try {
    expect(ctx.secretsService).toBeDefined();
    // Verify encryption dependencies were auto-enabled
    expect(ctx.encryptionService).toBeDefined();
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("TestSetupBuilder auto-enables dependencies", async () => {
  // withSettings() should auto-enable encryption + hash
  const ctx = await TestSetupBuilder.create()
    .withSettings()
    .build();

  try {
    expect(ctx.settingsService).toBeDefined();
    expect(ctx.encryptionService).toBeDefined();
    expect(ctx.hashService).toBeDefined();
    expect(ctx.encryptionKeys).toBeDefined();
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("TestSetupBuilder.create().build() enables all services by default", async () => {
  // When no with* methods are called, build() enables all services at runtime
  // Cast to FullTestContext to verify runtime behavior
  const ctx = await TestSetupBuilder.create().build() as unknown as FullTestContext;

  try {
    // All services should be available at runtime
    expect(ctx.functionsService).toBeDefined();
    expect(ctx.fileService).toBeDefined();
    expect(ctx.apiKeyService).toBeDefined();
    expect(ctx.secretsService).toBeDefined();
    expect(ctx.userService).toBeDefined();
    expect(ctx.settingsService).toBeDefined();
    expect(ctx.consoleLogService).toBeDefined();
    expect(ctx.executionMetricsService).toBeDefined();
    expect(ctx.metricsStateService).toBeDefined();
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("TestSetupBuilder.withMetrics creates minimal context without unrelated services", async () => {
  const ctx = await TestSetupBuilder.create()
    .withMetrics()
    .build();

  try {
    // Should have metrics services
    expect(ctx.executionMetricsService).toBeDefined();
    expect(ctx.metricsStateService).toBeDefined();

    // Should NOT have unrelated services
    expect("userService" in ctx).toBe(false);
    expect("auth" in ctx).toBe(false);
    expect("apiKeyService" in ctx).toBe(false);
    expect("secretsService" in ctx).toBe(false);
    expect("settingsService" in ctx).toBe(false);
  } finally {
    await ctx.cleanup();
  }
});
