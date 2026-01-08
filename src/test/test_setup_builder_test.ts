/**
 * Tests for TestSetupBuilder to verify the builder creates valid test contexts.
 */

import { expect } from "@std/expect";
import { TestSetupBuilder } from "./test_setup_builder.ts";

Deno.test("TestSetupBuilder creates basic context with all services", async () => {
  // Use .withAll() explicitly for type safety - this is now required since
  // the builder returns BaseTestContext by default
  const ctx = await TestSetupBuilder.create().withAll().build();

  try {
    // Verify all services are initialized
    expect(ctx.db).toBeDefined();
    expect(ctx.encryptionService).toBeDefined();
    expect(ctx.hashService).toBeDefined();
    expect(ctx.settingsService).toBeDefined();
    expect(ctx.apiKeyService).toBeDefined();
    expect(ctx.routesService).toBeDefined();
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

    // Verify database is open and migrations ran (check for a table)
    const result = await ctx.db.queryOne<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='apiKeyGroups'"
    );
    expect(result).toBeDefined();
    expect(result?.name).toBe("apiKeyGroups");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("TestSetupBuilder.withApiKeyGroup creates group", async () => {
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

Deno.test("TestSetupBuilder.withApiKey creates key in group", async () => {
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

Deno.test("TestSetupBuilder.withRoute creates route", async () => {
  const ctx = await TestSetupBuilder.create()
    .withRoute("/test", "test.ts", { methods: ["GET", "POST"] })
    .build();

  try {
    const routes = await ctx.routesService.getAll();
    expect(routes.length).toBe(1);
    expect(routes[0].route).toBe("/test");
    expect(routes[0].handler).toBe("test.ts");
    expect(routes[0].methods).toContain("GET");
    expect(routes[0].methods).toContain("POST");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("TestSetupBuilder.withFile creates file", async () => {
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

Deno.test("TestSetupBuilder.withSetting sets global setting", async () => {
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

Deno.test("TestSetupBuilder.withAdminUser creates user", async () => {
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

Deno.test("TestSetupBuilder.withConsoleLog seeds log data", async () => {
  // First create a route to have a valid routeId
  const ctx = await TestSetupBuilder.create()
    .withRoute("/test", "test.ts")
    .withConsoleLog({
      requestId: "test-request-123",
      routeId: 1, // Will match the created route
      level: "info",
      message: "Test log message",
    })
    .build();

  try {
    const logs = await ctx.consoleLogService.getByRequestId("test-request-123");
    expect(logs.length).toBe(1);
    expect(logs[0].message).toBe("Test log message");
    expect(logs[0].level).toBe("info");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("TestSetupBuilder.withMetric seeds metric data", async () => {
  const ctx = await TestSetupBuilder.create()
    .withRoute("/test", "test.ts")
    .withMetric({
      routeId: 1,
      type: "execution",
      avgTimeMs: 100,
      maxTimeMs: 150,
      executionCount: 10,
    })
    .build();

  try {
    // Query directly since service may not have a direct getter for raw metrics
    const metrics = await ctx.db.queryAll<{ avgTimeMs: number; executionCount: number }>(
      "SELECT avgTimeMs, executionCount FROM executionMetrics WHERE routeId = 1"
    );
    expect(metrics.length).toBe(1);
    expect(metrics[0].avgTimeMs).toBe(100);
    expect(metrics[0].executionCount).toBe(10);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("TestSetupBuilder full integration", async () => {
  const ctx = await TestSetupBuilder.create()
    .withAdminUser("admin@example.com", "securepassword", ["userMgmt", "permanent"])
    .withApiKeyGroup("management", "Management keys")
    .withApiKey("management", "mgmt-key-123", "admin-key")
    .withRoute("/hello", "hello.ts", {
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

    // Verify route
    const routes = await ctx.routesService.getAll();
    expect(routes.some((r) => r.route === "/hello")).toBe(true);

    // Verify file
    expect(await ctx.fileService.fileExists("hello.ts")).toBe(true);

    // Verify setting
    expect(await ctx.settingsService.getGlobalSetting("log.level")).toBe("debug");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("TestSetupBuilder cleanup removes temp directory", async () => {
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
