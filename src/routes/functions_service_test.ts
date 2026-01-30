import { expect } from "@std/expect";
import type { FunctionDefinition } from "./functions_service.ts";
import {
  validateFunctionName,
  validateFunctionPath,
  validateMethods,
} from "../validation/routes.ts";
import { TestSetupBuilder } from "../test/test_setup_builder.ts";
import { integrationTest } from "../test/test_helpers.ts";
import { recordIdToString } from "../database/surreal_helpers.ts";

// ============== Validation Function Tests ==============

// Validation tests - route name
integrationTest("validateFunctionName accepts valid names", () => {
  expect(validateFunctionName("hello")).toBe(true);
  expect(validateFunctionName("user-create")).toBe(true);
  expect(validateFunctionName("get_users")).toBe(true);
  expect(validateFunctionName("route123")).toBe(true);
  expect(validateFunctionName("a")).toBe(true);
});

integrationTest("validateFunctionName rejects empty/whitespace names", () => {
  expect(validateFunctionName("")).toBe(false);
  expect(validateFunctionName("  ")).toBe(false);
  expect(validateFunctionName("\t")).toBe(false);
});

// Validation tests - route path
integrationTest("validateFunctionPath accepts valid paths", () => {
  expect(validateFunctionPath("/")).toBe(true);
  expect(validateFunctionPath("/users")).toBe(true);
  expect(validateFunctionPath("/users/:id")).toBe(true);
  expect(validateFunctionPath("/api/v1/users")).toBe(true);
  expect(validateFunctionPath("/users/:id/posts/:postId")).toBe(true);
});

integrationTest("validateFunctionPath rejects invalid paths", () => {
  expect(validateFunctionPath("")).toBe(false);
  expect(validateFunctionPath("users")).toBe(false); // must start with /
  expect(validateFunctionPath("//users")).toBe(false); // double slash
});

// Validation tests - methods
integrationTest("validateMethods accepts valid HTTP methods", () => {
  expect(validateMethods(["GET"])).toBe(true);
  expect(validateMethods(["POST"])).toBe(true);
  expect(validateMethods(["PUT"])).toBe(true);
  expect(validateMethods(["DELETE"])).toBe(true);
  expect(validateMethods(["PATCH"])).toBe(true);
  expect(validateMethods(["HEAD"])).toBe(true);
  expect(validateMethods(["OPTIONS"])).toBe(true);
  expect(validateMethods(["GET", "POST", "PUT"])).toBe(true);
});

integrationTest("validateMethods rejects empty array", () => {
  expect(validateMethods([])).toBe(false);
});

integrationTest("validateMethods rejects invalid methods", () => {
  expect(validateMethods(["INVALID"])).toBe(false);
  expect(validateMethods(["get"])).toBe(false); // lowercase
  expect(validateMethods(["GET", "INVALID"])).toBe(false);
});

// ============== FunctionsService Tests ==============

// Basic CRUD tests
integrationTest("FunctionsService.getAll returns empty array initially", async () => {
  const ctx = await TestSetupBuilder.create().withFunctions().build();
  try {
    const routes = await ctx.functionsService.getAll();
    expect(routes).toEqual([]);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("FunctionsService.addRoute creates route with required fields", async () => {
  const ctx = await TestSetupBuilder.create().withFunctions().build();
  try {
    await ctx.functionsService.addFunction({
      name: "hello",
      handler: "hello.ts",
      routePath: "/hello",
      methods: ["GET"],
    });

    const routes = await ctx.functionsService.getAll();
    expect(routes.length).toBe(1);
    expect(routes[0].name).toBe("hello");
    expect(routes[0].handler).toBe("hello.ts");
    expect(routes[0].routePath).toBe("/hello");
    expect(routes[0].methods).toEqual(["GET"]);
    expect(routes[0].description).toBeUndefined();
    expect(routes[0].keys).toBeUndefined();
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("FunctionsService.addRoute creates route with all fields", async () => {
  const ctx = await TestSetupBuilder.create().withFunctions().build();
  try {
    // Use dummy group ID (no FK constraint in routes table)
    const testGroupId = "999";
    await ctx.functionsService.addFunction({
      name: "test",
      description: "Test route",
      handler: "test.ts",
      routePath: "/test",
      methods: ["GET", "POST"],
      keys: [testGroupId],
    });

    const route = await ctx.functionsService.getByName("test");
    expect(route?.name).toBe("test");
    expect(route?.description).toBe("Test route");
    expect(route?.methods).toContain("GET");
    expect(route?.methods).toContain("POST");
    expect(route?.keys).toContain(testGroupId);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("FunctionsService.getByName returns route or null", async () => {
  const ctx = await TestSetupBuilder.create().withFunctions().build();
  try {
    await ctx.functionsService.addFunction({
      name: "hello",
      handler: "hello.ts",
      routePath: "/hello",
      methods: ["GET"],
    });

    const hello = await ctx.functionsService.getByName("hello");
    expect(hello?.name).toBe("hello");

    const notFound = await ctx.functionsService.getByName("nonexistent");
    expect(notFound).toBe(null);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("FunctionsService.addRoute throws on duplicate name", async () => {
  const ctx = await TestSetupBuilder.create().withFunctions().build();
  try {
    await ctx.functionsService.addFunction({
      name: "hello",
      handler: "hello.ts",
      routePath: "/hello",
      methods: ["GET"],
    });

    await expect(
      ctx.functionsService.addFunction({
        name: "hello", // duplicate name
        handler: "other.ts",
        routePath: "/other",
        methods: ["POST"],
      })
    ).rejects.toThrow("already exists");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("FunctionsService.addRoute throws on duplicate route+method", async () => {
  const ctx = await TestSetupBuilder.create().withFunctions().build();
  try {
    await ctx.functionsService.addFunction({
      name: "hello",
      handler: "hello.ts",
      routePath: "/users",
      methods: ["GET", "POST"],
    });

    await expect(
      ctx.functionsService.addFunction({
        name: "different-name",
        handler: "other.ts",
        routePath: "/users", // same route
        methods: ["GET"], // conflicting method
      })
    ).rejects.toThrow("already exists");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("FunctionsService.addRoute allows same route with different methods", async () => {
  const ctx = await TestSetupBuilder.create().withFunctions().build();
  try {
    await ctx.functionsService.addFunction({
      name: "users-get",
      handler: "users-get.ts",
      routePath: "/users",
      methods: ["GET"],
    });

    // Should succeed - same route but different method
    await ctx.functionsService.addFunction({
      name: "users-post",
      handler: "users-post.ts",
      routePath: "/users",
      methods: ["POST"],
    });

    const routes = await ctx.functionsService.getAll();
    expect(routes.length).toBe(2);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("FunctionsService.removeRoute removes by name", async () => {
  const ctx = await TestSetupBuilder.create().withFunctions().build();
  try {
    await ctx.functionsService.addFunction({
      name: "hello",
      handler: "hello.ts",
      routePath: "/hello",
      methods: ["GET"],
    });
    await ctx.functionsService.addFunction({
      name: "users",
      handler: "users.ts",
      routePath: "/users",
      methods: ["GET"],
    });

    await ctx.functionsService.removeFunction("hello");

    const result = await ctx.functionsService.getAll();
    expect(result.length).toBe(1);
    expect(result[0].name).toBe("users");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("FunctionsService.removeRoute is no-op for non-existent name", async () => {
  const ctx = await TestSetupBuilder.create().withFunctions().build();
  try {
    await ctx.functionsService.addFunction({
      name: "hello",
      handler: "hello.ts",
      routePath: "/hello",
      methods: ["GET"],
    });

    await ctx.functionsService.removeFunction("nonexistent");

    const result = await ctx.functionsService.getAll();
    expect(result.length).toBe(1);
  } finally {
    await ctx.cleanup();
  }
});

// ============== Dirty Flag & Rebuild Tests ==============

integrationTest("rebuildIfNeeded triggers rebuild on first call (starts dirty)", async () => {
  const ctx = await TestSetupBuilder.create().withFunctions().build();
  try {
    await ctx.functionsService.addFunction({
      name: "test",
      handler: "test.ts",
      routePath: "/test",
      methods: ["GET"],
    });

    let rebuildCount = 0;
    let receivedRoutes: FunctionDefinition[] = [];

    await ctx.functionsService.rebuildIfNeeded((routes) => {
      rebuildCount++;
      receivedRoutes = routes;
    });

    expect(rebuildCount).toBe(1);
    expect(receivedRoutes.length).toBe(1);
    expect(receivedRoutes[0].name).toBe("test");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("rebuildIfNeeded skips rebuild when not dirty", async () => {
  const ctx = await TestSetupBuilder.create().withFunctions().build();
  try {
    let rebuildCount = 0;

    // First call - should rebuild (starts dirty)
    await ctx.functionsService.rebuildIfNeeded(() => rebuildCount++);
    expect(rebuildCount).toBe(1);

    // Second call - should NOT rebuild (not dirty)
    await ctx.functionsService.rebuildIfNeeded(() => rebuildCount++);
    expect(rebuildCount).toBe(1); // Still 1
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("rebuildIfNeeded rebuilds after addRoute", async () => {
  const ctx = await TestSetupBuilder.create().withFunctions().build();
  try {
    let rebuildCount = 0;

    // Initial rebuild
    await ctx.functionsService.rebuildIfNeeded(() => rebuildCount++);
    expect(rebuildCount).toBe(1);

    // Add a route (marks dirty)
    await ctx.functionsService.addFunction({
      name: "new",
      handler: "new.ts",
      routePath: "/new",
      methods: ["GET"],
    });

    // Should rebuild again
    await ctx.functionsService.rebuildIfNeeded(() => rebuildCount++);
    expect(rebuildCount).toBe(2);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("rebuildIfNeeded rebuilds after removeRoute", async () => {
  const ctx = await TestSetupBuilder.create().withFunctions().build();
  try {
    await ctx.functionsService.addFunction({
      name: "test",
      handler: "test.ts",
      routePath: "/test",
      methods: ["GET"],
    });

    let rebuildCount = 0;

    // Initial rebuild
    await ctx.functionsService.rebuildIfNeeded(() => rebuildCount++);
    expect(rebuildCount).toBe(1);

    // Remove route (marks dirty)
    await ctx.functionsService.removeFunction("test");

    // Should rebuild again
    let receivedRoutes: FunctionDefinition[] = [];
    await ctx.functionsService.rebuildIfNeeded((routes) => {
      rebuildCount++;
      receivedRoutes = routes;
    });

    expect(rebuildCount).toBe(2);
    expect(receivedRoutes.length).toBe(0);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("removeRoute does not mark dirty if nothing deleted", async () => {
  const ctx = await TestSetupBuilder.create().withFunctions().build();
  try {
    let rebuildCount = 0;

    // Initial rebuild (clears dirty flag)
    await ctx.functionsService.rebuildIfNeeded(() => rebuildCount++);
    expect(rebuildCount).toBe(1);

    // Remove non-existent route (should NOT mark dirty)
    await ctx.functionsService.removeFunction("nonexistent");

    // Should NOT rebuild
    await ctx.functionsService.rebuildIfNeeded(() => rebuildCount++);
    expect(rebuildCount).toBe(1); // Still 1
  } finally {
    await ctx.cleanup();
  }
});

// ============== Concurrency Tests ==============

integrationTest("concurrent rebuildIfNeeded calls share single rebuild", async () => {
  const ctx = await TestSetupBuilder.create().withFunctions().build();
  try {
    await ctx.functionsService.addFunction({
      name: "test",
      handler: "test.ts",
      routePath: "/test",
      methods: ["GET"],
    });

    let rebuildCount = 0;

    // Fire 5 concurrent rebuild requests
    const promises = Array(5)
      .fill(null)
      .map(() =>
        ctx.functionsService.rebuildIfNeeded(() => {
          rebuildCount++;
        })
      );

    await Promise.all(promises);

    // Should only rebuild once
    expect(rebuildCount).toBe(1);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("addRoute waits for in-progress rebuild", async () => {
  const ctx = await TestSetupBuilder.create().withFunctions().build();
  try {
    const events: string[] = [];

    // Use a signal to ensure rebuild has started before we try to add
    let signalRebuildStarted: () => void;
    const rebuildStartedPromise = new Promise<void>((resolve) => {
      signalRebuildStarted = resolve;
    });

    // Start a slow rebuild
    const rebuildPromise = ctx.functionsService.rebuildIfNeeded(async () => {
      events.push("rebuild-start");
      signalRebuildStarted(); // Signal that rebuild has started
      // Simulate some work with async delay
      await new Promise((r) => setTimeout(r, 100));
      events.push("rebuild-end");
    });

    // Wait for rebuild to actually start (not timing-based)
    await rebuildStartedPromise;

    // Try to add a route while rebuild is in progress
    const addPromise = (async () => {
      events.push("add-waiting");
      await ctx.functionsService.addFunction({
        name: "new",
        handler: "new.ts",
        routePath: "/new",
        methods: ["GET"],
      });
      events.push("add-done");
    })();

    await Promise.all([rebuildPromise, addPromise]);

    // Add should wait for rebuild to complete
    expect(events[0]).toBe("rebuild-start");
    expect(events.indexOf("rebuild-end")).toBeLessThan(events.indexOf("add-done"));
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("multiple writes are serialized", async () => {
  const ctx = await TestSetupBuilder.create().withFunctions().build();
  try {
    // Clear initial dirty flag
    await ctx.functionsService.rebuildIfNeeded(() => {});

    // Fire multiple concurrent adds
    const promises = Array(5)
      .fill(null)
      .map((_, i) =>
        ctx.functionsService.addFunction({
          name: `route-${i}`,
          handler: `route-${i}.ts`,
          routePath: `/route-${i}`,
          methods: ["GET"],
        })
      );

    await Promise.all(promises);

    // All routes should be added
    const routes = await ctx.functionsService.getAll();
    expect(routes.length).toBe(5);
  } finally {
    await ctx.cleanup();
  }
});

// ============== updateRoute Tests ==============

integrationTest("FunctionsService.updateRoute updates route in place", async () => {
  const ctx = await TestSetupBuilder.create().withFunctions().build();
  try {
    await ctx.functionsService.addFunction({
      name: "original",
      handler: "original.ts",
      routePath: "/original",
      methods: ["GET"],
    });

    const originalRoute = await ctx.functionsService.getByName("original");
    const originalId = recordIdToString(originalRoute!.id);

    await ctx.functionsService.updateFunction(originalId, {
      name: "updated",
      handler: "updated.ts",
      routePath: "/updated",
      methods: ["POST"],
      description: "Updated description",
    });

    // Original name should not exist
    const byOldName = await ctx.functionsService.getByName("original");
    expect(byOldName).toBe(null);

    // New name should exist with same ID
    const byNewName = await ctx.functionsService.getByName("updated");
    expect(recordIdToString(byNewName!.id)).toBe(originalId);
    expect(byNewName?.handler).toBe("updated.ts");
    expect(byNewName?.routePath).toBe("/updated");
    expect(byNewName?.methods).toEqual(["POST"]);
    expect(byNewName?.description).toBe("Updated description");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("FunctionsService.updateRoute throws on non-existent ID", async () => {
  const ctx = await TestSetupBuilder.create().withFunctions().build();
  try {
    await expect(
      ctx.functionsService.updateFunction("nonexistent-id-999", {
        name: "test",
        handler: "test.ts",
        routePath: "/test",
        methods: ["GET"],
      })
    ).rejects.toThrow("not found");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("FunctionsService.updateRoute throws on duplicate name", async () => {
  const ctx = await TestSetupBuilder.create().withFunctions().build();
  try {
    await ctx.functionsService.addFunction({
      name: "first",
      handler: "first.ts",
      routePath: "/first",
      methods: ["GET"],
    });
    await ctx.functionsService.addFunction({
      name: "second",
      handler: "second.ts",
      routePath: "/second",
      methods: ["POST"],
    });

    const secondRoute = await ctx.functionsService.getByName("second");

    await expect(
      ctx.functionsService.updateFunction(recordIdToString(secondRoute!.id), {
        name: "first", // duplicate
        handler: "second.ts",
        routePath: "/second",
        methods: ["POST"],
      })
    ).rejects.toThrow("already exists");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("FunctionsService.updateRoute allows keeping same name", async () => {
  const ctx = await TestSetupBuilder.create().withFunctions().build();
  try {
    await ctx.functionsService.addFunction({
      name: "test",
      handler: "test.ts",
      routePath: "/test",
      methods: ["GET"],
    });

    const route = await ctx.functionsService.getByName("test");

    // Should not throw - keeping same name
    await ctx.functionsService.updateFunction(recordIdToString(route!.id), {
      name: "test",
      handler: "updated.ts",
      routePath: "/test",
      methods: ["GET", "POST"],
    });

    const updated = await ctx.functionsService.getByName("test");
    expect(updated?.handler).toBe("updated.ts");
    expect(updated?.methods).toContain("POST");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("FunctionsService.updateRoute throws on duplicate route+method", async () => {
  const ctx = await TestSetupBuilder.create().withFunctions().build();
  try {
    await ctx.functionsService.addFunction({
      name: "first",
      handler: "first.ts",
      routePath: "/users",
      methods: ["GET"],
    });
    await ctx.functionsService.addFunction({
      name: "second",
      handler: "second.ts",
      routePath: "/other",
      methods: ["POST"],
    });

    const secondRoute = await ctx.functionsService.getByName("second");

    await expect(
      ctx.functionsService.updateFunction(recordIdToString(secondRoute!.id), {
        name: "second",
        handler: "second.ts",
        routePath: "/users", // same route as first
        methods: ["GET"], // conflicting method
      })
    ).rejects.toThrow("already exists");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("FunctionsService.updateRoute allows keeping same route+method", async () => {
  const ctx = await TestSetupBuilder.create().withFunctions().build();
  try {
    await ctx.functionsService.addFunction({
      name: "test",
      handler: "test.ts",
      routePath: "/test",
      methods: ["GET", "POST"],
    });

    const route = await ctx.functionsService.getByName("test");

    // Should not throw - same route/methods
    await ctx.functionsService.updateFunction(recordIdToString(route!.id), {
      name: "test-renamed",
      handler: "test.ts",
      routePath: "/test",
      methods: ["GET", "POST"],
    });

    const updated = await ctx.functionsService.getByName("test-renamed");
    expect(updated?.routePath).toBe("/test");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("FunctionsService.updateRoute marks dirty flag", async () => {
  const ctx = await TestSetupBuilder.create().withFunctions().build();
  try {
    await ctx.functionsService.addFunction({
      name: "test",
      handler: "test.ts",
      routePath: "/test",
      methods: ["GET"],
    });

    let rebuildCount = 0;
    await ctx.functionsService.rebuildIfNeeded(() => rebuildCount++);
    expect(rebuildCount).toBe(1);

    const route = await ctx.functionsService.getByName("test");
    await ctx.functionsService.updateFunction(recordIdToString(route!.id), {
      name: "test",
      handler: "updated.ts",
      routePath: "/test",
      methods: ["GET"],
    });

    // Should rebuild after update
    await ctx.functionsService.rebuildIfNeeded(() => rebuildCount++);
    expect(rebuildCount).toBe(2);
  } finally {
    await ctx.cleanup();
  }
});

// ============== removeRouteById Tests ==============

integrationTest("FunctionsService.removeRouteById removes by ID", async () => {
  const ctx = await TestSetupBuilder.create().withFunctions().build();
  try {
    await ctx.functionsService.addFunction({
      name: "test",
      handler: "test.ts",
      routePath: "/test",
      methods: ["GET"],
    });

    const route = await ctx.functionsService.getByName("test");
    await ctx.functionsService.removeFunctionById(recordIdToString(route!.id));

    const result = await ctx.functionsService.getByName("test");
    expect(result).toBe(null);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("FunctionsService.removeRouteById is no-op for non-existent ID", async () => {
  const ctx = await TestSetupBuilder.create().withFunctions().build();
  try {
    let rebuildCount = 0;
    await ctx.functionsService.rebuildIfNeeded(() => rebuildCount++);

    await ctx.functionsService.removeFunctionById("nonexistent-id-999");

    // Should NOT mark dirty
    await ctx.functionsService.rebuildIfNeeded(() => rebuildCount++);
    expect(rebuildCount).toBe(1);
  } finally {
    await ctx.cleanup();
  }
});

// ============== CORS Configuration Tests ==============

integrationTest("FunctionsService.addFunction creates route with CORS config", async () => {
  const ctx = await TestSetupBuilder.create().withFunctions().build();
  try {
    await ctx.functionsService.addFunction({
      name: "cors-test",
      handler: "cors.ts",
      routePath: "/cors-test",
      methods: ["GET", "POST"],
      cors: {
        origins: ["https://example.com", "https://app.example.com"],
        credentials: true,
        maxAge: 3600,
        allowHeaders: ["X-Custom-Header"],
        exposeHeaders: ["X-Request-Id"],
      },
    });

    const route = await ctx.functionsService.getByName("cors-test");
    expect(route?.cors).toBeDefined();
    expect(route?.cors?.origins).toEqual(["https://example.com", "https://app.example.com"]);
    expect(route?.cors?.credentials).toBe(true);
    expect(route?.cors?.maxAge).toBe(3600);
    expect(route?.cors?.allowHeaders).toEqual(["X-Custom-Header"]);
    expect(route?.cors?.exposeHeaders).toEqual(["X-Request-Id"]);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("FunctionsService.addFunction creates route without CORS config", async () => {
  const ctx = await TestSetupBuilder.create().withFunctions().build();
  try {
    await ctx.functionsService.addFunction({
      name: "no-cors",
      handler: "no-cors.ts",
      routePath: "/no-cors",
      methods: ["GET"],
      // No cors field
    });

    const route = await ctx.functionsService.getByName("no-cors");
    expect(route?.cors).toBeUndefined();
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("FunctionsService.updateFunction updates CORS config", async () => {
  const ctx = await TestSetupBuilder.create().withFunctions().build();
  try {
    await ctx.functionsService.addFunction({
      name: "cors-update-test",
      handler: "cors.ts",
      routePath: "/cors-update-test",
      methods: ["GET"],
      cors: {
        origins: ["https://old.example.com"],
      },
    });

    const route = await ctx.functionsService.getByName("cors-update-test");
    await ctx.functionsService.updateFunction(recordIdToString(route!.id), {
      name: "cors-update-test",
      handler: "cors.ts",
      routePath: "/cors-update-test",
      methods: ["GET"],
      cors: {
        origins: ["https://new.example.com"],
        credentials: true,
        maxAge: 7200,
      },
    });

    const updated = await ctx.functionsService.getByName("cors-update-test");
    expect(updated?.cors?.origins).toEqual(["https://new.example.com"]);
    expect(updated?.cors?.credentials).toBe(true);
    expect(updated?.cors?.maxAge).toBe(7200);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("FunctionsService.updateFunction can remove CORS config", async () => {
  const ctx = await TestSetupBuilder.create().withFunctions().build();
  try {
    await ctx.functionsService.addFunction({
      name: "cors-remove-test",
      handler: "cors.ts",
      routePath: "/cors-remove-test",
      methods: ["GET"],
      cors: {
        origins: ["https://example.com"],
      },
    });

    const route = await ctx.functionsService.getByName("cors-remove-test");
    expect(route?.cors).toBeDefined();

    // Update without cors config to remove it
    await ctx.functionsService.updateFunction(recordIdToString(route!.id), {
      name: "cors-remove-test",
      handler: "cors.ts",
      routePath: "/cors-remove-test",
      methods: ["GET"],
      // No cors field - should remove it
    });

    const updated = await ctx.functionsService.getByName("cors-remove-test");
    expect(updated?.cors).toBeUndefined();
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("FunctionsService.addFunction creates route with wildcard CORS origin", async () => {
  const ctx = await TestSetupBuilder.create().withFunctions().build();
  try {
    await ctx.functionsService.addFunction({
      name: "wildcard-cors",
      handler: "wildcard.ts",
      routePath: "/wildcard-cors",
      methods: ["GET"],
      cors: {
        origins: ["*"],
      },
    });

    const route = await ctx.functionsService.getByName("wildcard-cors");
    expect(route?.cors?.origins).toEqual(["*"]);
    expect(route?.cors?.credentials).toBeUndefined();
  } finally {
    await ctx.cleanup();
  }
});
