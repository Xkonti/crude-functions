import { expect } from "@std/expect";
import {
  validateRouteName,
  validateRoutePath,
  validateMethods,
  RoutesService,
  type FunctionRoute,
} from "./routes_service.ts";
import { DatabaseService } from "../database/database_service.ts";

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

const ROUTES_SCHEMA = `
CREATE TABLE IF NOT EXISTS routes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  handler TEXT NOT NULL,
  route TEXT NOT NULL,
  methods TEXT NOT NULL,
  keys TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_routes_route ON routes(route);
`;

async function createTestService(): Promise<{
  service: RoutesService;
  db: DatabaseService;
}> {
  const db = new DatabaseService({ databasePath: ":memory:" });
  await db.open();
  await db.exec(ROUTES_SCHEMA);
  const service = new RoutesService({ db });
  return { service, db };
}

// Basic CRUD tests
Deno.test("RoutesService.getAll returns empty array initially", async () => {
  const { service, db } = await createTestService();
  try {
    const routes = await service.getAll();
    expect(routes).toEqual([]);
  } finally {
    await db.close();
  }
});

Deno.test("RoutesService.addRoute creates route with required fields", async () => {
  const { service, db } = await createTestService();
  try {
    await service.addRoute({
      name: "hello",
      handler: "hello.ts",
      route: "/hello",
      methods: ["GET"],
    });

    const routes = await service.getAll();
    expect(routes.length).toBe(1);
    expect(routes[0].name).toBe("hello");
    expect(routes[0].handler).toBe("hello.ts");
    expect(routes[0].route).toBe("/hello");
    expect(routes[0].methods).toEqual(["GET"]);
    expect(routes[0].description).toBeUndefined();
    expect(routes[0].keys).toBeUndefined();
  } finally {
    await db.close();
  }
});

Deno.test("RoutesService.addRoute creates route with all fields", async () => {
  const { service, db } = await createTestService();
  try {
    await service.addRoute({
      name: "test",
      description: "Test route",
      handler: "test.ts",
      route: "/test",
      methods: ["GET", "POST"],
      keys: ["api-key"],
    });

    const route = await service.getByName("test");
    expect(route?.name).toBe("test");
    expect(route?.description).toBe("Test route");
    expect(route?.methods).toContain("GET");
    expect(route?.methods).toContain("POST");
    expect(route?.keys).toContain("api-key");
  } finally {
    await db.close();
  }
});

Deno.test("RoutesService.getByName returns route or null", async () => {
  const { service, db } = await createTestService();
  try {
    await service.addRoute({
      name: "hello",
      handler: "hello.ts",
      route: "/hello",
      methods: ["GET"],
    });

    const hello = await service.getByName("hello");
    expect(hello?.name).toBe("hello");

    const notFound = await service.getByName("nonexistent");
    expect(notFound).toBe(null);
  } finally {
    await db.close();
  }
});

Deno.test("RoutesService.addRoute throws on duplicate name", async () => {
  const { service, db } = await createTestService();
  try {
    await service.addRoute({
      name: "hello",
      handler: "hello.ts",
      route: "/hello",
      methods: ["GET"],
    });

    await expect(
      service.addRoute({
        name: "hello", // duplicate name
        handler: "other.ts",
        route: "/other",
        methods: ["POST"],
      })
    ).rejects.toThrow("already exists");
  } finally {
    await db.close();
  }
});

Deno.test("RoutesService.addRoute throws on duplicate route+method", async () => {
  const { service, db } = await createTestService();
  try {
    await service.addRoute({
      name: "hello",
      handler: "hello.ts",
      route: "/users",
      methods: ["GET", "POST"],
    });

    await expect(
      service.addRoute({
        name: "different-name",
        handler: "other.ts",
        route: "/users", // same route
        methods: ["GET"], // conflicting method
      })
    ).rejects.toThrow("already exists");
  } finally {
    await db.close();
  }
});

Deno.test("RoutesService.addRoute allows same route with different methods", async () => {
  const { service, db } = await createTestService();
  try {
    await service.addRoute({
      name: "users-get",
      handler: "users-get.ts",
      route: "/users",
      methods: ["GET"],
    });

    // Should succeed - same route but different method
    await service.addRoute({
      name: "users-post",
      handler: "users-post.ts",
      route: "/users",
      methods: ["POST"],
    });

    const routes = await service.getAll();
    expect(routes.length).toBe(2);
  } finally {
    await db.close();
  }
});

Deno.test("RoutesService.removeRoute removes by name", async () => {
  const { service, db } = await createTestService();
  try {
    await service.addRoute({
      name: "hello",
      handler: "hello.ts",
      route: "/hello",
      methods: ["GET"],
    });
    await service.addRoute({
      name: "users",
      handler: "users.ts",
      route: "/users",
      methods: ["GET"],
    });

    await service.removeRoute("hello");

    const result = await service.getAll();
    expect(result.length).toBe(1);
    expect(result[0].name).toBe("users");
  } finally {
    await db.close();
  }
});

Deno.test("RoutesService.removeRoute is no-op for non-existent name", async () => {
  const { service, db } = await createTestService();
  try {
    await service.addRoute({
      name: "hello",
      handler: "hello.ts",
      route: "/hello",
      methods: ["GET"],
    });

    await service.removeRoute("nonexistent");

    const result = await service.getAll();
    expect(result.length).toBe(1);
  } finally {
    await db.close();
  }
});

// ============== Dirty Flag & Rebuild Tests ==============

Deno.test("rebuildIfNeeded triggers rebuild on first call (starts dirty)", async () => {
  const { service, db } = await createTestService();
  try {
    await service.addRoute({
      name: "test",
      handler: "test.ts",
      route: "/test",
      methods: ["GET"],
    });

    let rebuildCount = 0;
    let receivedRoutes: FunctionRoute[] = [];

    await service.rebuildIfNeeded((routes) => {
      rebuildCount++;
      receivedRoutes = routes;
    });

    expect(rebuildCount).toBe(1);
    expect(receivedRoutes.length).toBe(1);
    expect(receivedRoutes[0].name).toBe("test");
  } finally {
    await db.close();
  }
});

Deno.test("rebuildIfNeeded skips rebuild when not dirty", async () => {
  const { service, db } = await createTestService();
  try {
    let rebuildCount = 0;

    // First call - should rebuild (starts dirty)
    await service.rebuildIfNeeded(() => rebuildCount++);
    expect(rebuildCount).toBe(1);

    // Second call - should NOT rebuild (not dirty)
    await service.rebuildIfNeeded(() => rebuildCount++);
    expect(rebuildCount).toBe(1); // Still 1
  } finally {
    await db.close();
  }
});

Deno.test("rebuildIfNeeded rebuilds after addRoute", async () => {
  const { service, db } = await createTestService();
  try {
    let rebuildCount = 0;

    // Initial rebuild
    await service.rebuildIfNeeded(() => rebuildCount++);
    expect(rebuildCount).toBe(1);

    // Add a route (marks dirty)
    await service.addRoute({
      name: "new",
      handler: "new.ts",
      route: "/new",
      methods: ["GET"],
    });

    // Should rebuild again
    await service.rebuildIfNeeded(() => rebuildCount++);
    expect(rebuildCount).toBe(2);
  } finally {
    await db.close();
  }
});

Deno.test("rebuildIfNeeded rebuilds after removeRoute", async () => {
  const { service, db } = await createTestService();
  try {
    await service.addRoute({
      name: "test",
      handler: "test.ts",
      route: "/test",
      methods: ["GET"],
    });

    let rebuildCount = 0;

    // Initial rebuild
    await service.rebuildIfNeeded(() => rebuildCount++);
    expect(rebuildCount).toBe(1);

    // Remove route (marks dirty)
    await service.removeRoute("test");

    // Should rebuild again
    let receivedRoutes: FunctionRoute[] = [];
    await service.rebuildIfNeeded((routes) => {
      rebuildCount++;
      receivedRoutes = routes;
    });

    expect(rebuildCount).toBe(2);
    expect(receivedRoutes.length).toBe(0);
  } finally {
    await db.close();
  }
});

Deno.test("removeRoute does not mark dirty if nothing deleted", async () => {
  const { service, db } = await createTestService();
  try {
    let rebuildCount = 0;

    // Initial rebuild (clears dirty flag)
    await service.rebuildIfNeeded(() => rebuildCount++);
    expect(rebuildCount).toBe(1);

    // Remove non-existent route (should NOT mark dirty)
    await service.removeRoute("nonexistent");

    // Should NOT rebuild
    await service.rebuildIfNeeded(() => rebuildCount++);
    expect(rebuildCount).toBe(1); // Still 1
  } finally {
    await db.close();
  }
});

// ============== Concurrency Tests ==============

Deno.test("concurrent rebuildIfNeeded calls share single rebuild", async () => {
  const { service, db } = await createTestService();
  try {
    await service.addRoute({
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
        service.rebuildIfNeeded(() => {
          rebuildCount++;
        })
      );

    await Promise.all(promises);

    // Should only rebuild once
    expect(rebuildCount).toBe(1);
  } finally {
    await db.close();
  }
});

Deno.test("addRoute waits for in-progress rebuild", async () => {
  const { service, db } = await createTestService();
  try {
    const events: string[] = [];

    // Start a slow rebuild
    const rebuildPromise = service.rebuildIfNeeded(() => {
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
      await service.addRoute({
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
    await db.close();
  }
});

Deno.test("multiple writes are serialized", async () => {
  const { service, db } = await createTestService();
  try {
    // Clear initial dirty flag
    await service.rebuildIfNeeded(() => {});

    // Fire multiple concurrent adds
    const promises = Array(5)
      .fill(null)
      .map((_, i) =>
        service.addRoute({
          name: `route-${i}`,
          handler: `route-${i}.ts`,
          route: `/route-${i}`,
          methods: ["GET"],
        })
      );

    await Promise.all(promises);

    // All routes should be added
    const routes = await service.getAll();
    expect(routes.length).toBe(5);
  } finally {
    await db.close();
  }
});

// ============== updateRoute Tests ==============

Deno.test("RoutesService.updateRoute updates route in place", async () => {
  const { service, db } = await createTestService();
  try {
    await service.addRoute({
      name: "original",
      handler: "original.ts",
      route: "/original",
      methods: ["GET"],
    });

    const originalRoute = await service.getByName("original");
    const originalId = originalRoute!.id;

    await service.updateRoute(originalId, {
      name: "updated",
      handler: "updated.ts",
      route: "/updated",
      methods: ["POST"],
      description: "Updated description",
    });

    // Original name should not exist
    const byOldName = await service.getByName("original");
    expect(byOldName).toBe(null);

    // New name should exist with same ID
    const byNewName = await service.getByName("updated");
    expect(byNewName?.id).toBe(originalId);
    expect(byNewName?.handler).toBe("updated.ts");
    expect(byNewName?.route).toBe("/updated");
    expect(byNewName?.methods).toEqual(["POST"]);
    expect(byNewName?.description).toBe("Updated description");
  } finally {
    await db.close();
  }
});

Deno.test("RoutesService.updateRoute throws on non-existent ID", async () => {
  const { service, db } = await createTestService();
  try {
    await expect(
      service.updateRoute(999, {
        name: "test",
        handler: "test.ts",
        route: "/test",
        methods: ["GET"],
      })
    ).rejects.toThrow("not found");
  } finally {
    await db.close();
  }
});

Deno.test("RoutesService.updateRoute throws on duplicate name", async () => {
  const { service, db } = await createTestService();
  try {
    await service.addRoute({
      name: "first",
      handler: "first.ts",
      route: "/first",
      methods: ["GET"],
    });
    await service.addRoute({
      name: "second",
      handler: "second.ts",
      route: "/second",
      methods: ["POST"],
    });

    const secondRoute = await service.getByName("second");

    await expect(
      service.updateRoute(secondRoute!.id, {
        name: "first", // duplicate
        handler: "second.ts",
        route: "/second",
        methods: ["POST"],
      })
    ).rejects.toThrow("already exists");
  } finally {
    await db.close();
  }
});

Deno.test("RoutesService.updateRoute allows keeping same name", async () => {
  const { service, db } = await createTestService();
  try {
    await service.addRoute({
      name: "test",
      handler: "test.ts",
      route: "/test",
      methods: ["GET"],
    });

    const route = await service.getByName("test");

    // Should not throw - keeping same name
    await service.updateRoute(route!.id, {
      name: "test",
      handler: "updated.ts",
      route: "/test",
      methods: ["GET", "POST"],
    });

    const updated = await service.getByName("test");
    expect(updated?.handler).toBe("updated.ts");
    expect(updated?.methods).toContain("POST");
  } finally {
    await db.close();
  }
});

Deno.test("RoutesService.updateRoute throws on duplicate route+method", async () => {
  const { service, db } = await createTestService();
  try {
    await service.addRoute({
      name: "first",
      handler: "first.ts",
      route: "/users",
      methods: ["GET"],
    });
    await service.addRoute({
      name: "second",
      handler: "second.ts",
      route: "/other",
      methods: ["POST"],
    });

    const secondRoute = await service.getByName("second");

    await expect(
      service.updateRoute(secondRoute!.id, {
        name: "second",
        handler: "second.ts",
        route: "/users", // same route as first
        methods: ["GET"], // conflicting method
      })
    ).rejects.toThrow("already exists");
  } finally {
    await db.close();
  }
});

Deno.test("RoutesService.updateRoute allows keeping same route+method", async () => {
  const { service, db } = await createTestService();
  try {
    await service.addRoute({
      name: "test",
      handler: "test.ts",
      route: "/test",
      methods: ["GET", "POST"],
    });

    const route = await service.getByName("test");

    // Should not throw - same route/methods
    await service.updateRoute(route!.id, {
      name: "test-renamed",
      handler: "test.ts",
      route: "/test",
      methods: ["GET", "POST"],
    });

    const updated = await service.getByName("test-renamed");
    expect(updated?.route).toBe("/test");
  } finally {
    await db.close();
  }
});

Deno.test("RoutesService.updateRoute marks dirty flag", async () => {
  const { service, db } = await createTestService();
  try {
    await service.addRoute({
      name: "test",
      handler: "test.ts",
      route: "/test",
      methods: ["GET"],
    });

    let rebuildCount = 0;
    await service.rebuildIfNeeded(() => rebuildCount++);
    expect(rebuildCount).toBe(1);

    const route = await service.getByName("test");
    await service.updateRoute(route!.id, {
      name: "test",
      handler: "updated.ts",
      route: "/test",
      methods: ["GET"],
    });

    // Should rebuild after update
    await service.rebuildIfNeeded(() => rebuildCount++);
    expect(rebuildCount).toBe(2);
  } finally {
    await db.close();
  }
});

// ============== removeRouteById Tests ==============

Deno.test("RoutesService.removeRouteById removes by ID", async () => {
  const { service, db } = await createTestService();
  try {
    await service.addRoute({
      name: "test",
      handler: "test.ts",
      route: "/test",
      methods: ["GET"],
    });

    const route = await service.getByName("test");
    await service.removeRouteById(route!.id);

    const result = await service.getByName("test");
    expect(result).toBe(null);
  } finally {
    await db.close();
  }
});

Deno.test("RoutesService.removeRouteById is no-op for non-existent ID", async () => {
  const { service, db } = await createTestService();
  try {
    let rebuildCount = 0;
    await service.rebuildIfNeeded(() => rebuildCount++);

    await service.removeRouteById(999);

    // Should NOT mark dirty
    await service.rebuildIfNeeded(() => rebuildCount++);
    expect(rebuildCount).toBe(1);
  } finally {
    await db.close();
  }
});
