import { expect } from "@std/expect";
import type { FunctionRoute } from "./routes_service.ts";
import {
  validateRouteName,
  validateRoutePath,
  validateMethods,
} from "../validation/routes.ts";
import { TestSetupBuilder } from "../test/test_setup_builder.ts";

// ============== Validation Function Tests ==============

// Validation tests - route name
Deno.test("validateRouteName accepts valid names", () => {
  expect(validateRouteName("hello")).toBe(true);
  expect(validateRouteName("user-create")).toBe(true);
  expect(validateRouteName("get_users")).toBe(true);
  expect(validateRouteName("route123")).toBe(true);
  expect(validateRouteName("a")).toBe(true);
});

Deno.test("validateRouteName rejects empty/whitespace names", () => {
  expect(validateRouteName("")).toBe(false);
  expect(validateRouteName("  ")).toBe(false);
  expect(validateRouteName("\t")).toBe(false);
});

// Validation tests - route path
Deno.test("validateRoutePath accepts valid paths", () => {
  expect(validateRoutePath("/")).toBe(true);
  expect(validateRoutePath("/users")).toBe(true);
  expect(validateRoutePath("/users/:id")).toBe(true);
  expect(validateRoutePath("/api/v1/users")).toBe(true);
  expect(validateRoutePath("/users/:id/posts/:postId")).toBe(true);
});

Deno.test("validateRoutePath rejects invalid paths", () => {
  expect(validateRoutePath("")).toBe(false);
  expect(validateRoutePath("users")).toBe(false); // must start with /
  expect(validateRoutePath("//users")).toBe(false); // double slash
});

// Validation tests - methods
Deno.test("validateMethods accepts valid HTTP methods", () => {
  expect(validateMethods(["GET"])).toBe(true);
  expect(validateMethods(["POST"])).toBe(true);
  expect(validateMethods(["PUT"])).toBe(true);
  expect(validateMethods(["DELETE"])).toBe(true);
  expect(validateMethods(["PATCH"])).toBe(true);
  expect(validateMethods(["HEAD"])).toBe(true);
  expect(validateMethods(["OPTIONS"])).toBe(true);
  expect(validateMethods(["GET", "POST", "PUT"])).toBe(true);
});

Deno.test("validateMethods rejects empty array", () => {
  expect(validateMethods([])).toBe(false);
});

Deno.test("validateMethods rejects invalid methods", () => {
  expect(validateMethods(["INVALID"])).toBe(false);
  expect(validateMethods(["get"])).toBe(false); // lowercase
  expect(validateMethods(["GET", "INVALID"])).toBe(false);
});

// ============== RoutesService Tests ==============

// Basic CRUD tests
Deno.test("RoutesService.getAll returns empty array initially", async () => {
  const ctx = await TestSetupBuilder.create().build();
  try {
    const routes = await ctx.routesService.getAll();
    expect(routes).toEqual([]);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("RoutesService.addRoute creates route with required fields", async () => {
  const ctx = await TestSetupBuilder.create().build();
  try {
    await ctx.routesService.addRoute({
      name: "hello",
      handler: "hello.ts",
      route: "/hello",
      methods: ["GET"],
    });

    const routes = await ctx.routesService.getAll();
    expect(routes.length).toBe(1);
    expect(routes[0].name).toBe("hello");
    expect(routes[0].handler).toBe("hello.ts");
    expect(routes[0].route).toBe("/hello");
    expect(routes[0].methods).toEqual(["GET"]);
    expect(routes[0].description).toBeUndefined();
    expect(routes[0].keys).toBeUndefined();
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("RoutesService.addRoute creates route with all fields", async () => {
  const ctx = await TestSetupBuilder.create().build();
  try {
    await ctx.routesService.addRoute({
      name: "test",
      description: "Test route",
      handler: "test.ts",
      route: "/test",
      methods: ["GET", "POST"],
      keys: ["api-key"],
    });

    const route = await ctx.routesService.getByName("test");
    expect(route?.name).toBe("test");
    expect(route?.description).toBe("Test route");
    expect(route?.methods).toContain("GET");
    expect(route?.methods).toContain("POST");
    expect(route?.keys).toContain("api-key");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("RoutesService.getByName returns route or null", async () => {
  const ctx = await TestSetupBuilder.create().build();
  try {
    await ctx.routesService.addRoute({
      name: "hello",
      handler: "hello.ts",
      route: "/hello",
      methods: ["GET"],
    });

    const hello = await ctx.routesService.getByName("hello");
    expect(hello?.name).toBe("hello");

    const notFound = await ctx.routesService.getByName("nonexistent");
    expect(notFound).toBe(null);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("RoutesService.addRoute throws on duplicate name", async () => {
  const ctx = await TestSetupBuilder.create().build();
  try {
    await ctx.routesService.addRoute({
      name: "hello",
      handler: "hello.ts",
      route: "/hello",
      methods: ["GET"],
    });

    await expect(
      ctx.routesService.addRoute({
        name: "hello", // duplicate name
        handler: "other.ts",
        route: "/other",
        methods: ["POST"],
      })
    ).rejects.toThrow("already exists");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("RoutesService.addRoute throws on duplicate route+method", async () => {
  const ctx = await TestSetupBuilder.create().build();
  try {
    await ctx.routesService.addRoute({
      name: "hello",
      handler: "hello.ts",
      route: "/users",
      methods: ["GET", "POST"],
    });

    await expect(
      ctx.routesService.addRoute({
        name: "different-name",
        handler: "other.ts",
        route: "/users", // same route
        methods: ["GET"], // conflicting method
      })
    ).rejects.toThrow("already exists");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("RoutesService.addRoute allows same route with different methods", async () => {
  const ctx = await TestSetupBuilder.create().build();
  try {
    await ctx.routesService.addRoute({
      name: "users-get",
      handler: "users-get.ts",
      route: "/users",
      methods: ["GET"],
    });

    // Should succeed - same route but different method
    await ctx.routesService.addRoute({
      name: "users-post",
      handler: "users-post.ts",
      route: "/users",
      methods: ["POST"],
    });

    const routes = await ctx.routesService.getAll();
    expect(routes.length).toBe(2);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("RoutesService.removeRoute removes by name", async () => {
  const ctx = await TestSetupBuilder.create().build();
  try {
    await ctx.routesService.addRoute({
      name: "hello",
      handler: "hello.ts",
      route: "/hello",
      methods: ["GET"],
    });
    await ctx.routesService.addRoute({
      name: "users",
      handler: "users.ts",
      route: "/users",
      methods: ["GET"],
    });

    await ctx.routesService.removeRoute("hello");

    const result = await ctx.routesService.getAll();
    expect(result.length).toBe(1);
    expect(result[0].name).toBe("users");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("RoutesService.removeRoute is no-op for non-existent name", async () => {
  const ctx = await TestSetupBuilder.create().build();
  try {
    await ctx.routesService.addRoute({
      name: "hello",
      handler: "hello.ts",
      route: "/hello",
      methods: ["GET"],
    });

    await ctx.routesService.removeRoute("nonexistent");

    const result = await ctx.routesService.getAll();
    expect(result.length).toBe(1);
  } finally {
    await ctx.cleanup();
  }
});

// ============== Dirty Flag & Rebuild Tests ==============

Deno.test("rebuildIfNeeded triggers rebuild on first call (starts dirty)", async () => {
  const ctx = await TestSetupBuilder.create().build();
  try {
    await ctx.routesService.addRoute({
      name: "test",
      handler: "test.ts",
      route: "/test",
      methods: ["GET"],
    });

    let rebuildCount = 0;
    let receivedRoutes: FunctionRoute[] = [];

    await ctx.routesService.rebuildIfNeeded((routes) => {
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

Deno.test("rebuildIfNeeded skips rebuild when not dirty", async () => {
  const ctx = await TestSetupBuilder.create().build();
  try {
    let rebuildCount = 0;

    // First call - should rebuild (starts dirty)
    await ctx.routesService.rebuildIfNeeded(() => rebuildCount++);
    expect(rebuildCount).toBe(1);

    // Second call - should NOT rebuild (not dirty)
    await ctx.routesService.rebuildIfNeeded(() => rebuildCount++);
    expect(rebuildCount).toBe(1); // Still 1
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("rebuildIfNeeded rebuilds after addRoute", async () => {
  const ctx = await TestSetupBuilder.create().build();
  try {
    let rebuildCount = 0;

    // Initial rebuild
    await ctx.routesService.rebuildIfNeeded(() => rebuildCount++);
    expect(rebuildCount).toBe(1);

    // Add a route (marks dirty)
    await ctx.routesService.addRoute({
      name: "new",
      handler: "new.ts",
      route: "/new",
      methods: ["GET"],
    });

    // Should rebuild again
    await ctx.routesService.rebuildIfNeeded(() => rebuildCount++);
    expect(rebuildCount).toBe(2);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("rebuildIfNeeded rebuilds after removeRoute", async () => {
  const ctx = await TestSetupBuilder.create().build();
  try {
    await ctx.routesService.addRoute({
      name: "test",
      handler: "test.ts",
      route: "/test",
      methods: ["GET"],
    });

    let rebuildCount = 0;

    // Initial rebuild
    await ctx.routesService.rebuildIfNeeded(() => rebuildCount++);
    expect(rebuildCount).toBe(1);

    // Remove route (marks dirty)
    await ctx.routesService.removeRoute("test");

    // Should rebuild again
    let receivedRoutes: FunctionRoute[] = [];
    await ctx.routesService.rebuildIfNeeded((routes) => {
      rebuildCount++;
      receivedRoutes = routes;
    });

    expect(rebuildCount).toBe(2);
    expect(receivedRoutes.length).toBe(0);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("removeRoute does not mark dirty if nothing deleted", async () => {
  const ctx = await TestSetupBuilder.create().build();
  try {
    let rebuildCount = 0;

    // Initial rebuild (clears dirty flag)
    await ctx.routesService.rebuildIfNeeded(() => rebuildCount++);
    expect(rebuildCount).toBe(1);

    // Remove non-existent route (should NOT mark dirty)
    await ctx.routesService.removeRoute("nonexistent");

    // Should NOT rebuild
    await ctx.routesService.rebuildIfNeeded(() => rebuildCount++);
    expect(rebuildCount).toBe(1); // Still 1
  } finally {
    await ctx.cleanup();
  }
});

// ============== Concurrency Tests ==============

Deno.test("concurrent rebuildIfNeeded calls share single rebuild", async () => {
  const ctx = await TestSetupBuilder.create().build();
  try {
    await ctx.routesService.addRoute({
      name: "test",
      handler: "test.ts",
      route: "/test",
      methods: ["GET"],
    });

    let rebuildCount = 0;

    // Fire 5 concurrent rebuild requests
    const promises = Array(5)
      .fill(null)
      .map(() =>
        ctx.routesService.rebuildIfNeeded(() => {
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

Deno.test("addRoute waits for in-progress rebuild", async () => {
  const ctx = await TestSetupBuilder.create().build();
  try {
    const events: string[] = [];

    // Start a slow rebuild
    const rebuildPromise = ctx.routesService.rebuildIfNeeded(() => {
      events.push("rebuild-start");
      // Simulate some work (synchronous for test simplicity)
      const start = Date.now();
      while (Date.now() - start < 50) {
        // busy wait
      }
      events.push("rebuild-end");
    });

    // Small delay to ensure rebuild starts first
    await new Promise((r) => setTimeout(r, 10));

    // Try to add a route while rebuild is in progress
    const addPromise = (async () => {
      events.push("add-waiting");
      await ctx.routesService.addRoute({
        name: "new",
        handler: "new.ts",
        route: "/new",
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

Deno.test("multiple writes are serialized", async () => {
  const ctx = await TestSetupBuilder.create().build();
  try {
    // Clear initial dirty flag
    await ctx.routesService.rebuildIfNeeded(() => {});

    // Fire multiple concurrent adds
    const promises = Array(5)
      .fill(null)
      .map((_, i) =>
        ctx.routesService.addRoute({
          name: `route-${i}`,
          handler: `route-${i}.ts`,
          route: `/route-${i}`,
          methods: ["GET"],
        })
      );

    await Promise.all(promises);

    // All routes should be added
    const routes = await ctx.routesService.getAll();
    expect(routes.length).toBe(5);
  } finally {
    await ctx.cleanup();
  }
});

// ============== updateRoute Tests ==============

Deno.test("RoutesService.updateRoute updates route in place", async () => {
  const ctx = await TestSetupBuilder.create().build();
  try {
    await ctx.routesService.addRoute({
      name: "original",
      handler: "original.ts",
      route: "/original",
      methods: ["GET"],
    });

    const originalRoute = await ctx.routesService.getByName("original");
    const originalId = originalRoute!.id;

    await ctx.routesService.updateRoute(originalId, {
      name: "updated",
      handler: "updated.ts",
      route: "/updated",
      methods: ["POST"],
      description: "Updated description",
    });

    // Original name should not exist
    const byOldName = await ctx.routesService.getByName("original");
    expect(byOldName).toBe(null);

    // New name should exist with same ID
    const byNewName = await ctx.routesService.getByName("updated");
    expect(byNewName?.id).toBe(originalId);
    expect(byNewName?.handler).toBe("updated.ts");
    expect(byNewName?.route).toBe("/updated");
    expect(byNewName?.methods).toEqual(["POST"]);
    expect(byNewName?.description).toBe("Updated description");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("RoutesService.updateRoute throws on non-existent ID", async () => {
  const ctx = await TestSetupBuilder.create().build();
  try {
    await expect(
      ctx.routesService.updateRoute(999, {
        name: "test",
        handler: "test.ts",
        route: "/test",
        methods: ["GET"],
      })
    ).rejects.toThrow("not found");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("RoutesService.updateRoute throws on duplicate name", async () => {
  const ctx = await TestSetupBuilder.create().build();
  try {
    await ctx.routesService.addRoute({
      name: "first",
      handler: "first.ts",
      route: "/first",
      methods: ["GET"],
    });
    await ctx.routesService.addRoute({
      name: "second",
      handler: "second.ts",
      route: "/second",
      methods: ["POST"],
    });

    const secondRoute = await ctx.routesService.getByName("second");

    await expect(
      ctx.routesService.updateRoute(secondRoute!.id, {
        name: "first", // duplicate
        handler: "second.ts",
        route: "/second",
        methods: ["POST"],
      })
    ).rejects.toThrow("already exists");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("RoutesService.updateRoute allows keeping same name", async () => {
  const ctx = await TestSetupBuilder.create().build();
  try {
    await ctx.routesService.addRoute({
      name: "test",
      handler: "test.ts",
      route: "/test",
      methods: ["GET"],
    });

    const route = await ctx.routesService.getByName("test");

    // Should not throw - keeping same name
    await ctx.routesService.updateRoute(route!.id, {
      name: "test",
      handler: "updated.ts",
      route: "/test",
      methods: ["GET", "POST"],
    });

    const updated = await ctx.routesService.getByName("test");
    expect(updated?.handler).toBe("updated.ts");
    expect(updated?.methods).toContain("POST");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("RoutesService.updateRoute throws on duplicate route+method", async () => {
  const ctx = await TestSetupBuilder.create().build();
  try {
    await ctx.routesService.addRoute({
      name: "first",
      handler: "first.ts",
      route: "/users",
      methods: ["GET"],
    });
    await ctx.routesService.addRoute({
      name: "second",
      handler: "second.ts",
      route: "/other",
      methods: ["POST"],
    });

    const secondRoute = await ctx.routesService.getByName("second");

    await expect(
      ctx.routesService.updateRoute(secondRoute!.id, {
        name: "second",
        handler: "second.ts",
        route: "/users", // same route as first
        methods: ["GET"], // conflicting method
      })
    ).rejects.toThrow("already exists");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("RoutesService.updateRoute allows keeping same route+method", async () => {
  const ctx = await TestSetupBuilder.create().build();
  try {
    await ctx.routesService.addRoute({
      name: "test",
      handler: "test.ts",
      route: "/test",
      methods: ["GET", "POST"],
    });

    const route = await ctx.routesService.getByName("test");

    // Should not throw - same route/methods
    await ctx.routesService.updateRoute(route!.id, {
      name: "test-renamed",
      handler: "test.ts",
      route: "/test",
      methods: ["GET", "POST"],
    });

    const updated = await ctx.routesService.getByName("test-renamed");
    expect(updated?.route).toBe("/test");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("RoutesService.updateRoute marks dirty flag", async () => {
  const ctx = await TestSetupBuilder.create().build();
  try {
    await ctx.routesService.addRoute({
      name: "test",
      handler: "test.ts",
      route: "/test",
      methods: ["GET"],
    });

    let rebuildCount = 0;
    await ctx.routesService.rebuildIfNeeded(() => rebuildCount++);
    expect(rebuildCount).toBe(1);

    const route = await ctx.routesService.getByName("test");
    await ctx.routesService.updateRoute(route!.id, {
      name: "test",
      handler: "updated.ts",
      route: "/test",
      methods: ["GET"],
    });

    // Should rebuild after update
    await ctx.routesService.rebuildIfNeeded(() => rebuildCount++);
    expect(rebuildCount).toBe(2);
  } finally {
    await ctx.cleanup();
  }
});

// ============== removeRouteById Tests ==============

Deno.test("RoutesService.removeRouteById removes by ID", async () => {
  const ctx = await TestSetupBuilder.create().build();
  try {
    await ctx.routesService.addRoute({
      name: "test",
      handler: "test.ts",
      route: "/test",
      methods: ["GET"],
    });

    const route = await ctx.routesService.getByName("test");
    await ctx.routesService.removeRouteById(route!.id);

    const result = await ctx.routesService.getByName("test");
    expect(result).toBe(null);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("RoutesService.removeRouteById is no-op for non-existent ID", async () => {
  const ctx = await TestSetupBuilder.create().build();
  try {
    let rebuildCount = 0;
    await ctx.routesService.rebuildIfNeeded(() => rebuildCount++);

    await ctx.routesService.removeRouteById(999);

    // Should NOT mark dirty
    await ctx.routesService.rebuildIfNeeded(() => rebuildCount++);
    expect(rebuildCount).toBe(1);
  } finally {
    await ctx.cleanup();
  }
});
