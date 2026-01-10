import { expect } from "@std/expect";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { createTestApp as createBaseApp } from "../test/openapi_test_app.ts";
import { createFunctionsRoutes } from "./functions_routes.ts";
import { TestSetupBuilder } from "../test/test_setup_builder.ts";
import type { BaseTestContext, RoutesContext } from "../test/types.ts";

interface TestFunction {
  name: string;
  handler: string;
  route: string;
  methods: string[];
  description?: string;
  keys?: (number | string)[];
}

function createTestApp(ctx: BaseTestContext & RoutesContext): OpenAPIHono {
  const app = createBaseApp();
  app.route("/api/functions", createFunctionsRoutes(ctx.routesService));
  return app;
}

async function buildTestContext(functions: TestFunction[] = []) {
  const builder = TestSetupBuilder.create().withRoutes();
  for (const f of functions) {
    builder.withRoute(f.route, f.handler, {
      name: f.name,
      methods: f.methods,
      description: f.description,
      keys: f.keys,
    });
  }
  return await builder.build();
}

// ============== GET /api/functions ==============

Deno.test("GET /api/functions returns empty array for empty database", async () => {
  const ctx = await buildTestContext();
  const app = createTestApp(ctx);

  try {
    const res = await app.request("/api/functions");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.functions).toEqual([]);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("GET /api/functions returns all functions", async () => {
  const functions = [
    { name: "hello", handler: "hello.ts", route: "/hello", methods: ["GET"] },
    { name: "users", handler: "users.ts", route: "/users", methods: ["GET", "POST"] },
  ];
  const ctx = await buildTestContext(functions);
  const app = createTestApp(ctx);

  try {
    const res = await app.request("/api/functions");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.functions.length).toBe(2);
    expect(json.functions[0].name).toBe("hello");
    expect(json.functions[1].name).toBe("users");
  } finally {
    await ctx.cleanup();
  }
});

// ============== GET /api/functions/:id ==============

Deno.test("GET /api/functions/:id returns function for existing ID", async () => {
  const functions = [
    { name: "hello", handler: "hello.ts", route: "/hello", methods: ["GET"], description: "Greeting" },
  ];
  const ctx = await buildTestContext(functions);
  const app = createTestApp(ctx);

  try {
    const allFunctions = await ctx.routesService.getAll();
    const funcId = allFunctions[0].id;

    const res = await app.request(`/api/functions/${funcId}`);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.function.name).toBe("hello");
    expect(json.function.description).toBe("Greeting");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("GET /api/functions/:id returns 404 for non-existent ID", async () => {
  const ctx = await buildTestContext();
  const app = createTestApp(ctx);

  try {
    const res = await app.request("/api/functions/999");
    expect(res.status).toBe(404);

    const json = await res.json();
    expect(json.error).toBeDefined();
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("GET /api/functions/:id returns 400 for invalid ID", async () => {
  const ctx = await buildTestContext();
  const app = createTestApp(ctx);

  try {
    const res = await app.request("/api/functions/invalid");
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain("Invalid function ID");
  } finally {
    await ctx.cleanup();
  }
});

// ============== POST /api/functions ==============

Deno.test("POST /api/functions creates function and returns it", async () => {
  const ctx = await buildTestContext();
  const app = createTestApp(ctx);

  try {
    const res = await app.request("/api/functions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "new-function",
        handler: "new.ts",
        route: "/new",
        methods: ["POST"],
        description: "A new function",
      }),
    });

    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.function).toBeDefined();
    expect(json.function.id).toBeDefined();
    expect(json.function.name).toBe("new-function");
    expect(json.function.handler).toBe("new.ts");
    expect(json.function.route).toBe("/new");
    expect(json.function.methods).toEqual(["POST"]);
    expect(json.function.description).toBe("A new function");
    expect(json.function.enabled).toBe(true);

    // Verify function was added
    const func = await ctx.routesService.getById(json.function.id);
    expect(func).not.toBe(null);
    expect(func!.handler).toBe("new.ts");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("POST /api/functions rejects missing required fields", async () => {
  const ctx = await buildTestContext();
  const app = createTestApp(ctx);

  try {
    const res = await app.request("/api/functions", {
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

Deno.test("POST /api/functions rejects invalid route path", async () => {
  const ctx = await buildTestContext();
  const app = createTestApp(ctx);

  try {
    const res = await app.request("/api/functions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "bad-function",
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

Deno.test("POST /api/functions rejects invalid methods", async () => {
  const ctx = await buildTestContext();
  const app = createTestApp(ctx);

  try {
    const res = await app.request("/api/functions", {
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

Deno.test("POST /api/functions returns 409 on duplicate name", async () => {
  const functions = [
    { name: "existing", handler: "existing.ts", route: "/existing", methods: ["GET"] },
  ];
  const ctx = await buildTestContext(functions);
  const app = createTestApp(ctx);

  try {
    const res = await app.request("/api/functions", {
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

Deno.test("POST /api/functions returns 409 on duplicate route+method", async () => {
  const functions = [
    { name: "existing", handler: "existing.ts", route: "/users", methods: ["GET", "POST"] },
  ];
  const ctx = await buildTestContext(functions);
  const app = createTestApp(ctx);

  try {
    const res = await app.request("/api/functions", {
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

Deno.test("POST /api/functions rejects invalid JSON", async () => {
  const ctx = await buildTestContext();
  const app = createTestApp(ctx);

  try {
    const res = await app.request("/api/functions", {
      method: "POST",
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

// ============== PUT /api/functions/:id ==============

Deno.test("PUT /api/functions/:id updates function and returns it", async () => {
  const functions = [
    { name: "test", handler: "test.ts", route: "/test", methods: ["GET"] },
  ];
  const ctx = await buildTestContext(functions);
  const app = createTestApp(ctx);

  try {
    const func = await ctx.routesService.getByName("test");

    const res = await app.request(`/api/functions/${func!.id}`, {
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
    expect(json.function).toBeDefined();
    expect(json.function.id).toBe(func!.id); // ID preserved
    expect(json.function.name).toBe("updated");
    expect(json.function.handler).toBe("updated.ts");
    expect(json.function.route).toBe("/updated");
    expect(json.function.methods).toEqual(["POST"]);

    // Verify update persisted
    const updated = await ctx.routesService.getById(func!.id);
    expect(updated?.name).toBe("updated");
    expect(updated?.handler).toBe("updated.ts");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("PUT /api/functions/:id returns 404 for non-existent ID", async () => {
  const ctx = await buildTestContext();
  const app = createTestApp(ctx);

  try {
    const res = await app.request("/api/functions/999", {
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

Deno.test("PUT /api/functions/:id returns 409 on duplicate name", async () => {
  const functions = [
    { name: "first", handler: "first.ts", route: "/first", methods: ["GET"] },
    { name: "second", handler: "second.ts", route: "/second", methods: ["POST"] },
  ];
  const ctx = await buildTestContext(functions);
  const app = createTestApp(ctx);

  try {
    const secondFunc = await ctx.routesService.getByName("second");

    const res = await app.request(`/api/functions/${secondFunc!.id}`, {
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

Deno.test("PUT /api/functions/:id returns 400 for invalid ID", async () => {
  const ctx = await buildTestContext();
  const app = createTestApp(ctx);

  try {
    const res = await app.request("/api/functions/invalid", {
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

Deno.test("PUT /api/functions/:id returns 400 for missing fields", async () => {
  const functions = [
    { name: "test", handler: "test.ts", route: "/test", methods: ["GET"] },
  ];
  const ctx = await buildTestContext(functions);
  const app = createTestApp(ctx);

  try {
    const func = await ctx.routesService.getByName("test");

    const res = await app.request(`/api/functions/${func!.id}`, {
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

// ============== DELETE /api/functions/:id ==============

Deno.test("DELETE /api/functions/:id removes function and returns 204", async () => {
  const functions = [
    { name: "test", handler: "test.ts", route: "/test", methods: ["GET"] },
  ];
  const ctx = await buildTestContext(functions);
  const app = createTestApp(ctx);

  try {
    const func = await ctx.routesService.getByName("test");

    const res = await app.request(`/api/functions/${func!.id}`, {
      method: "DELETE",
    });

    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");

    const deleted = await ctx.routesService.getById(func!.id);
    expect(deleted).toBe(null);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("DELETE /api/functions/:id returns 404 for non-existent ID", async () => {
  const ctx = await buildTestContext();
  const app = createTestApp(ctx);

  try {
    const res = await app.request("/api/functions/999", {
      method: "DELETE",
    });

    expect(res.status).toBe(404);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("DELETE /api/functions/:id returns 400 for invalid ID", async () => {
  const ctx = await buildTestContext();
  const app = createTestApp(ctx);

  try {
    const res = await app.request("/api/functions/invalid", {
      method: "DELETE",
    });

    expect(res.status).toBe(400);
  } finally {
    await ctx.cleanup();
  }
});

// ============== PUT /api/functions/:id/enable ==============

Deno.test("PUT /api/functions/:id/enable enables function and returns it", async () => {
  const functions = [
    { name: "test", handler: "test.ts", route: "/test", methods: ["GET"] },
  ];
  const ctx = await buildTestContext(functions);
  const app = createTestApp(ctx);

  try {
    const func = await ctx.routesService.getByName("test");
    // First disable it
    await ctx.routesService.setRouteEnabled(func!.id, false);

    const res = await app.request(`/api/functions/${func!.id}/enable`, {
      method: "PUT",
    });

    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.function).toBeDefined();
    expect(json.function.enabled).toBe(true);

    // Verify in database
    const updated = await ctx.routesService.getById(func!.id);
    expect(updated!.enabled).toBe(true);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("PUT /api/functions/:id/enable is idempotent", async () => {
  const functions = [
    { name: "test", handler: "test.ts", route: "/test", methods: ["GET"] },
  ];
  const ctx = await buildTestContext(functions);
  const app = createTestApp(ctx);

  try {
    const func = await ctx.routesService.getByName("test");

    // Enable multiple times (already enabled by default)
    for (let i = 0; i < 3; i++) {
      const res = await app.request(`/api/functions/${func!.id}/enable`, {
        method: "PUT",
      });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.function.enabled).toBe(true);
    }
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("PUT /api/functions/:id/enable returns 404 for non-existent function", async () => {
  const ctx = await buildTestContext();
  const app = createTestApp(ctx);

  try {
    const res = await app.request("/api/functions/999/enable", {
      method: "PUT",
    });

    expect(res.status).toBe(404);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("PUT /api/functions/:id/enable returns 400 for invalid ID", async () => {
  const ctx = await buildTestContext();
  const app = createTestApp(ctx);

  try {
    const res = await app.request("/api/functions/invalid/enable", {
      method: "PUT",
    });

    expect(res.status).toBe(400);
  } finally {
    await ctx.cleanup();
  }
});

// ============== PUT /api/functions/:id/disable ==============

Deno.test("PUT /api/functions/:id/disable disables function and returns it", async () => {
  const functions = [
    { name: "test", handler: "test.ts", route: "/test", methods: ["GET"] },
  ];
  const ctx = await buildTestContext(functions);
  const app = createTestApp(ctx);

  try {
    const func = await ctx.routesService.getByName("test");

    const res = await app.request(`/api/functions/${func!.id}/disable`, {
      method: "PUT",
    });

    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.function).toBeDefined();
    expect(json.function.enabled).toBe(false);

    // Verify in database
    const updated = await ctx.routesService.getById(func!.id);
    expect(updated!.enabled).toBe(false);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("PUT /api/functions/:id/disable is idempotent", async () => {
  const functions = [
    { name: "test", handler: "test.ts", route: "/test", methods: ["GET"] },
  ];
  const ctx = await buildTestContext(functions);
  const app = createTestApp(ctx);

  try {
    const func = await ctx.routesService.getByName("test");

    // Disable multiple times
    for (let i = 0; i < 3; i++) {
      const res = await app.request(`/api/functions/${func!.id}/disable`, {
        method: "PUT",
      });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.function.enabled).toBe(false);
    }
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("PUT /api/functions/:id/disable returns 404 for non-existent function", async () => {
  const ctx = await buildTestContext();
  const app = createTestApp(ctx);

  try {
    const res = await app.request("/api/functions/999/disable", {
      method: "PUT",
    });

    expect(res.status).toBe(404);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("PUT /api/functions/:id/disable returns 400 for invalid ID", async () => {
  const ctx = await buildTestContext();
  const app = createTestApp(ctx);

  try {
    const res = await app.request("/api/functions/invalid/disable", {
      method: "PUT",
    });

    expect(res.status).toBe(400);
  } finally {
    await ctx.cleanup();
  }
});

// ============== Enable/Disable Toggle Behavior ==============

Deno.test("enable and disable toggle function state correctly", async () => {
  const functions = [
    { name: "test", handler: "test.ts", route: "/test", methods: ["GET"] },
  ];
  const ctx = await buildTestContext(functions);
  const app = createTestApp(ctx);

  try {
    const func = await ctx.routesService.getByName("test");

    // Initially enabled
    expect((await ctx.routesService.getById(func!.id))!.enabled).toBe(true);

    // Disable
    let res = await app.request(`/api/functions/${func!.id}/disable`, {
      method: "PUT",
    });
    expect(res.status).toBe(200);
    expect((await ctx.routesService.getById(func!.id))!.enabled).toBe(false);

    // Re-enable
    res = await app.request(`/api/functions/${func!.id}/enable`, {
      method: "PUT",
    });
    expect(res.status).toBe(200);
    expect((await ctx.routesService.getById(func!.id))!.enabled).toBe(true);
  } finally {
    await ctx.cleanup();
  }
});
