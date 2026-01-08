import { expect } from "@std/expect";
import { Hono } from "@hono/hono";
import { createRoutesRoutes } from "./routes_routes.ts";
import { TestSetupBuilder } from "../test/test_setup_builder.ts";
import type { BaseTestContext, RoutesContext } from "../test/types.ts";

interface TestRoute {
  name: string;
  handler: string;
  route: string;
  methods: string[];
  description?: string;
  keys?: string[];
}

function createTestApp(ctx: BaseTestContext & RoutesContext): Hono {
  const app = new Hono();
  app.route("/api/routes", createRoutesRoutes(ctx.routesService));
  return app;
}

async function buildTestContext(routes: TestRoute[] = []) {
  const builder = TestSetupBuilder.create().withRoutes();
  for (const r of routes) {
    builder.withRoute(r.route, r.handler, {
      name: r.name,
      methods: r.methods,
      description: r.description,
      keys: r.keys,
    });
  }
  return await builder.build();
}

// GET /api/routes tests
Deno.test("GET /api/routes returns empty array for empty database", async () => {
  const ctx = await buildTestContext();
  const app = createTestApp(ctx);

  try {
    const res = await app.request("/api/routes");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.routes).toEqual([]);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("GET /api/routes returns all routes", async () => {
  const routes = [
    { name: "hello", handler: "hello.ts", route: "/hello", methods: ["GET"] },
    { name: "users", handler: "users.ts", route: "/users", methods: ["GET", "POST"] },
  ];
  const ctx = await buildTestContext(routes);
  const app = createTestApp(ctx);

  try {
    const res = await app.request("/api/routes");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.routes.length).toBe(2);
    expect(json.routes[0].name).toBe("hello");
    expect(json.routes[1].name).toBe("users");
  } finally {
    await ctx.cleanup();
  }
});

// GET /api/routes/:name tests
Deno.test("GET /api/routes/:name returns route for existing name", async () => {
  const routes = [
    { name: "hello", handler: "hello.ts", route: "/hello", methods: ["GET"], description: "Greeting" },
  ];
  const ctx = await buildTestContext(routes);
  const app = createTestApp(ctx);

  try {
    const res = await app.request("/api/routes/hello");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.route.name).toBe("hello");
    expect(json.route.description).toBe("Greeting");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("GET /api/routes/:name returns 404 for non-existent name", async () => {
  const routes = [
    { name: "hello", handler: "hello.ts", route: "/hello", methods: ["GET"] },
  ];
  const ctx = await buildTestContext(routes);
  const app = createTestApp(ctx);

  try {
    const res = await app.request("/api/routes/nonexistent");
    expect(res.status).toBe(404);

    const json = await res.json();
    expect(json.error).toBeDefined();
  } finally {
    await ctx.cleanup();
  }
});

// POST /api/routes tests
Deno.test("POST /api/routes adds new route", async () => {
  const ctx = await buildTestContext();
  const app = createTestApp(ctx);

  try {
    const res = await app.request("/api/routes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "new-route",
        handler: "new.ts",
        route: "/new",
        methods: ["POST"],
        description: "A new route",
      }),
    });

    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.success).toBe(true);

    // Verify route was added
    const route = await ctx.routesService.getByName("new-route");
    expect(route).not.toBe(null);
    expect(route!.handler).toBe("new.ts");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("POST /api/routes rejects missing required fields", async () => {
  const ctx = await buildTestContext();
  const app = createTestApp(ctx);

  try {
    const res = await app.request("/api/routes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "incomplete",
        // missing handler, route, methods
      }),
    });

    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toBeDefined();
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("POST /api/routes rejects invalid route path", async () => {
  const ctx = await buildTestContext();
  const app = createTestApp(ctx);

  try {
    const res = await app.request("/api/routes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "bad-route",
        handler: "bad.ts",
        route: "no-leading-slash", // invalid
        methods: ["GET"],
      }),
    });

    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain("route");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("POST /api/routes rejects invalid methods", async () => {
  const ctx = await buildTestContext();
  const app = createTestApp(ctx);

  try {
    const res = await app.request("/api/routes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "bad-methods",
        handler: "bad.ts",
        route: "/bad",
        methods: ["INVALID"],
      }),
    });

    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain("method");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("POST /api/routes returns 409 on duplicate name", async () => {
  const routes = [
    { name: "existing", handler: "existing.ts", route: "/existing", methods: ["GET"] },
  ];
  const ctx = await buildTestContext(routes);
  const app = createTestApp(ctx);

  try {
    const res = await app.request("/api/routes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "existing", // duplicate
        handler: "other.ts",
        route: "/other",
        methods: ["POST"],
      }),
    });

    expect(res.status).toBe(409);

    const json = await res.json();
    expect(json.error).toContain("exists");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("POST /api/routes returns 409 on duplicate route+method", async () => {
  const routes = [
    { name: "existing", handler: "existing.ts", route: "/users", methods: ["GET", "POST"] },
  ];
  const ctx = await buildTestContext(routes);
  const app = createTestApp(ctx);

  try {
    const res = await app.request("/api/routes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "different-name",
        handler: "other.ts",
        route: "/users", // same route
        methods: ["GET"], // conflicting method
      }),
    });

    expect(res.status).toBe(409);
  } finally {
    await ctx.cleanup();
  }
});

// DELETE /api/routes/:name tests
Deno.test("DELETE /api/routes/:name removes route", async () => {
  const routes = [
    { name: "hello", handler: "hello.ts", route: "/hello", methods: ["GET"] },
    { name: "users", handler: "users.ts", route: "/users", methods: ["GET"] },
  ];
  const ctx = await buildTestContext(routes);
  const app = createTestApp(ctx);

  try {
    const res = await app.request("/api/routes/hello", {
      method: "DELETE",
    });

    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);

    // Verify route was removed
    const route = await ctx.routesService.getByName("hello");
    expect(route).toBe(null);

    // Other routes should remain
    const users = await ctx.routesService.getByName("users");
    expect(users).not.toBe(null);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("DELETE /api/routes/:name returns 404 for non-existent name", async () => {
  const routes = [
    { name: "hello", handler: "hello.ts", route: "/hello", methods: ["GET"] },
  ];
  const ctx = await buildTestContext(routes);
  const app = createTestApp(ctx);

  try {
    const res = await app.request("/api/routes/nonexistent", {
      method: "DELETE",
    });

    expect(res.status).toBe(404);
  } finally {
    await ctx.cleanup();
  }
});

// PUT /api/routes/:id tests
Deno.test("PUT /api/routes/:id updates route", async () => {
  const routes = [
    { name: "test", handler: "test.ts", route: "/test", methods: ["GET"] },
  ];
  const ctx = await buildTestContext(routes);
  const app = createTestApp(ctx);

  try {
    const route = await ctx.routesService.getByName("test");

    const res = await app.request(`/api/routes/${route!.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "updated",
        handler: "updated.ts",
        route: "/updated",
        methods: ["POST"],
      }),
    });

    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);

    // Verify update preserved ID
    const updated = await ctx.routesService.getById(route!.id);
    expect(updated?.name).toBe("updated");
    expect(updated?.handler).toBe("updated.ts");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("PUT /api/routes/:id returns 404 for non-existent ID", async () => {
  const ctx = await buildTestContext();
  const app = createTestApp(ctx);

  try {
    const res = await app.request("/api/routes/999", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "test",
        handler: "test.ts",
        route: "/test",
        methods: ["GET"],
      }),
    });

    expect(res.status).toBe(404);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("PUT /api/routes/:id returns 409 on duplicate name", async () => {
  const routes = [
    { name: "first", handler: "first.ts", route: "/first", methods: ["GET"] },
    { name: "second", handler: "second.ts", route: "/second", methods: ["POST"] },
  ];
  const ctx = await buildTestContext(routes);
  const app = createTestApp(ctx);

  try {
    const secondRoute = await ctx.routesService.getByName("second");

    const res = await app.request(`/api/routes/${secondRoute!.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "first", // duplicate
        handler: "second.ts",
        route: "/second",
        methods: ["POST"],
      }),
    });

    expect(res.status).toBe(409);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("PUT /api/routes/:id returns 400 for invalid ID", async () => {
  const ctx = await buildTestContext();
  const app = createTestApp(ctx);

  try {
    const res = await app.request("/api/routes/invalid", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "test",
        handler: "test.ts",
        route: "/test",
        methods: ["GET"],
      }),
    });

    expect(res.status).toBe(400);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("PUT /api/routes/:id returns 400 for missing fields", async () => {
  const routes = [
    { name: "test", handler: "test.ts", route: "/test", methods: ["GET"] },
  ];
  const ctx = await buildTestContext(routes);
  const app = createTestApp(ctx);

  try {
    const route = await ctx.routesService.getByName("test");

    const res = await app.request(`/api/routes/${route!.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "updated",
        // missing handler, route, methods
      }),
    });

    expect(res.status).toBe(400);
  } finally {
    await ctx.cleanup();
  }
});

// DELETE /api/routes/:id tests (numeric ID)
Deno.test("DELETE /api/routes/:id removes route by numeric ID", async () => {
  const routes = [
    { name: "test", handler: "test.ts", route: "/test", methods: ["GET"] },
  ];
  const ctx = await buildTestContext(routes);
  const app = createTestApp(ctx);

  try {
    const route = await ctx.routesService.getByName("test");

    const res = await app.request(`/api/routes/${route!.id}`, {
      method: "DELETE",
    });

    expect(res.status).toBe(200);

    const deleted = await ctx.routesService.getById(route!.id);
    expect(deleted).toBe(null);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("DELETE /api/routes/:id returns 404 for non-existent ID", async () => {
  const ctx = await buildTestContext();
  const app = createTestApp(ctx);

  try {
    const res = await app.request("/api/routes/999", {
      method: "DELETE",
    });

    expect(res.status).toBe(404);
  } finally {
    await ctx.cleanup();
  }
});

// PUT /api/routes/:id/enabled tests
Deno.test("PUT /api/routes/:id/enabled sets route to enabled", async () => {
  const routes = [
    { name: "test", handler: "test.ts", route: "/test", methods: ["GET"] },
  ];
  const ctx = await buildTestContext(routes);
  const app = createTestApp(ctx);

  try {
    const route = await ctx.routesService.getByName("test");

    // Set to enabled (should already be enabled by default)
    const res = await app.request(`/api/routes/${route!.id}/enabled`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });

    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.enabled).toBe(true);

    // Verify in database
    const updated = await ctx.routesService.getById(route!.id);
    expect(updated!.enabled).toBe(true);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("PUT /api/routes/:id/enabled sets route to disabled", async () => {
  const routes = [
    { name: "test", handler: "test.ts", route: "/test", methods: ["GET"] },
  ];
  const ctx = await buildTestContext(routes);
  const app = createTestApp(ctx);

  try {
    const route = await ctx.routesService.getByName("test");

    // Disable the route
    const res = await app.request(`/api/routes/${route!.id}/enabled`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });

    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.enabled).toBe(false);

    // Verify in database
    const updated = await ctx.routesService.getById(route!.id);
    expect(updated!.enabled).toBe(false);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("PUT /api/routes/:id/enabled toggles route state", async () => {
  const routes = [
    { name: "test", handler: "test.ts", route: "/test", methods: ["GET"] },
  ];
  const ctx = await buildTestContext(routes);
  const app = createTestApp(ctx);

  try {
    const route = await ctx.routesService.getByName("test");

    // Initially enabled
    expect((await ctx.routesService.getById(route!.id))!.enabled).toBe(true);

    // Disable
    await app.request(`/api/routes/${route!.id}/enabled`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    expect((await ctx.routesService.getById(route!.id))!.enabled).toBe(false);

    // Re-enable
    await app.request(`/api/routes/${route!.id}/enabled`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });
    expect((await ctx.routesService.getById(route!.id))!.enabled).toBe(true);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("PUT /api/routes/:id/enabled is idempotent", async () => {
  const routes = [
    { name: "test", handler: "test.ts", route: "/test", methods: ["GET"] },
  ];
  const ctx = await buildTestContext(routes);
  const app = createTestApp(ctx);

  try {
    const route = await ctx.routesService.getByName("test");

    // Disable multiple times
    for (let i = 0; i < 3; i++) {
      const res = await app.request(`/api/routes/${route!.id}/enabled`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: false }),
      });
      expect(res.status).toBe(200);
      expect((await ctx.routesService.getById(route!.id))!.enabled).toBe(false);
    }

    // Enable multiple times
    for (let i = 0; i < 3; i++) {
      const res = await app.request(`/api/routes/${route!.id}/enabled`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      });
      expect(res.status).toBe(200);
      expect((await ctx.routesService.getById(route!.id))!.enabled).toBe(true);
    }
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("PUT /api/routes/:id/enabled returns 400 for invalid ID", async () => {
  const ctx = await buildTestContext();
  const app = createTestApp(ctx);

  try {
    const res = await app.request("/api/routes/invalid/enabled", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });

    expect(res.status).toBe(400);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("PUT /api/routes/:id/enabled returns 404 for non-existent route", async () => {
  const ctx = await buildTestContext();
  const app = createTestApp(ctx);

  try {
    const res = await app.request("/api/routes/999/enabled", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });

    expect(res.status).toBe(404);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("PUT /api/routes/:id/enabled returns 400 for missing enabled field", async () => {
  const routes = [
    { name: "test", handler: "test.ts", route: "/test", methods: ["GET"] },
  ];
  const ctx = await buildTestContext(routes);
  const app = createTestApp(ctx);

  try {
    const route = await ctx.routesService.getByName("test");

    const res = await app.request(`/api/routes/${route!.id}/enabled`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("enabled");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("PUT /api/routes/:id/enabled returns 400 for non-boolean enabled field", async () => {
  const routes = [
    { name: "test", handler: "test.ts", route: "/test", methods: ["GET"] },
  ];
  const ctx = await buildTestContext(routes);
  const app = createTestApp(ctx);

  try {
    const route = await ctx.routesService.getByName("test");

    // Test with string
    let res = await app.request(`/api/routes/${route!.id}/enabled`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: "true" }),
    });
    expect(res.status).toBe(400);

    // Test with number
    res = await app.request(`/api/routes/${route!.id}/enabled`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: 1 }),
    });
    expect(res.status).toBe(400);

    // Test with null
    res = await app.request(`/api/routes/${route!.id}/enabled`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: null }),
    });
    expect(res.status).toBe(400);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("PUT /api/routes/:id/enabled returns 400 for invalid JSON", async () => {
  const routes = [
    { name: "test", handler: "test.ts", route: "/test", methods: ["GET"] },
  ];
  const ctx = await buildTestContext(routes);
  const app = createTestApp(ctx);

  try {
    const route = await ctx.routesService.getByName("test");

    const res = await app.request(`/api/routes/${route!.id}/enabled`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "invalid json{",
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("JSON");
  } finally {
    await ctx.cleanup();
  }
});
