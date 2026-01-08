/**
 * Tests for route toggle functionality using TestSetupBuilder.
 *
 * This tests the end-to-end behavior of the toggle feature:
 * - Disabled routes return 404 from /run/*
 * - Enabled routes work normally
 * - Toggle persists across router rebuilds
 */

import { expect } from "@std/expect";
import { Hono } from "@hono/hono";
import { TestSetupBuilder } from "../test/test_setup_builder.ts";
import { FunctionRouter } from "../functions/function_router.ts";
import type { TestContext } from "../test/types.ts";

const simpleHandler = `
export default async function (c, ctx) {
  return c.json({ route: ctx.route.name, requestId: ctx.requestId });
}
`;

/** Helper to create a FunctionRouter with all required services */
function createFunctionRouterWithContext(ctx: TestContext) {
  return new FunctionRouter({
    routesService: ctx.routesService,
    apiKeyService: ctx.apiKeyService,
    consoleLogService: ctx.consoleLogService,
    executionMetricsService: ctx.executionMetricsService,
    secretsService: ctx.secretsService,
    codeDirectory: ctx.codeDir,
  });
}

Deno.test("Disabled route returns 404 from /run/*", async () => {
  const ctx = await TestSetupBuilder.create()
    .withAll()
    .withRoute("/hello", "hello.ts", { methods: ["GET"] })
    .withFile("hello.ts", simpleHandler)
    .build();

  try {
    // Create FunctionRouter and mount it
    const functionRouter = createFunctionRouterWithContext(ctx);
    const app = new Hono();
    app.all("/run/*", (c) => functionRouter.handle(c));

    // Route works when enabled
    let res = await app.request("/run/hello");
    expect(res.status).toBe(200);

    // Disable the route
    const routes = await ctx.routesService.getAll();
    const route = routes.find((r) => r.route === "/hello");
    await ctx.routesService.setRouteEnabled(route!.id, false);

    // Route returns 404 when disabled
    res = await app.request("/run/hello");
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe("Function not found");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("Enabled route works normally", async () => {
  const ctx = await TestSetupBuilder.create()
    .withAll()
    .withRoute("/hello", "hello.ts", { methods: ["GET"] })
    .withFile("hello.ts", simpleHandler)
    .build();

  try {
    const functionRouter = createFunctionRouterWithContext(ctx);

    const app = new Hono();
    app.all("/run/*", (c) => functionRouter.handle(c));

    // Route is enabled by default
    const res = await app.request("/run/hello");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.route).toBe("hello");
    expect(json.requestId).toBeDefined();
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("Re-enabling disabled route makes it work again", async () => {
  const ctx = await TestSetupBuilder.create()
    .withAll()
    .withRoute("/hello", "hello.ts", { methods: ["GET"] })
    .withFile("hello.ts", simpleHandler)
    .build();

  try {
    const functionRouter = createFunctionRouterWithContext(ctx);

    const app = new Hono();
    app.all("/run/*", (c) => functionRouter.handle(c));

    const routes = await ctx.routesService.getAll();
    const route = routes.find((r) => r.route === "/hello");

    // Disable
    await ctx.routesService.setRouteEnabled(route!.id, false);
    let res = await app.request("/run/hello");
    expect(res.status).toBe(404);

    // Re-enable
    await ctx.routesService.setRouteEnabled(route!.id, true);
    res = await app.request("/run/hello");
    expect(res.status).toBe(200);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("Disabled route does not execute handler", async () => {
  // Handler that would fail if executed
  const failingHandler = `
export default async function (c, ctx) {
  throw new Error("This should not execute!");
}
`;

  const ctx = await TestSetupBuilder.create()
    .withAll()
    .withRoute("/fail", "fail.ts", { methods: ["GET"] })
    .withFile("fail.ts", failingHandler)
    .build();

  try {
    const functionRouter = createFunctionRouterWithContext(ctx);

    const app = new Hono();
    app.all("/run/*", (c) => functionRouter.handle(c));

    const routes = await ctx.routesService.getAll();
    const route = routes.find((r) => r.route === "/fail");

    // Disable the route
    await ctx.routesService.setRouteEnabled(route!.id, false);

    // Should get 404, not handler error
    const res = await app.request("/run/fail");
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe("Function not found");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("Multiple routes can be independently toggled", async () => {
  const ctx = await TestSetupBuilder.create()
    .withAll()
    .withRoute("/hello", "hello.ts", { methods: ["GET"] })
    .withRoute("/goodbye", "goodbye.ts", { methods: ["GET"] })
    .withFile("hello.ts", simpleHandler)
    .withFile("goodbye.ts", simpleHandler)
    .build();

  try {
    const functionRouter = createFunctionRouterWithContext(ctx);

    const app = new Hono();
    app.all("/run/*", (c) => functionRouter.handle(c));

    const routes = await ctx.routesService.getAll();
    const helloRoute = routes.find((r) => r.route === "/hello");
    const goodbyeRoute = routes.find((r) => r.route === "/goodbye");

    // Both enabled initially
    expect((await app.request("/run/hello")).status).toBe(200);
    expect((await app.request("/run/goodbye")).status).toBe(200);

    // Disable hello only
    await ctx.routesService.setRouteEnabled(helloRoute!.id, false);
    expect((await app.request("/run/hello")).status).toBe(404);
    expect((await app.request("/run/goodbye")).status).toBe(200);

    // Disable goodbye only (re-enable hello)
    await ctx.routesService.setRouteEnabled(helloRoute!.id, true);
    await ctx.routesService.setRouteEnabled(goodbyeRoute!.id, false);
    expect((await app.request("/run/hello")).status).toBe(200);
    expect((await app.request("/run/goodbye")).status).toBe(404);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("Disabled route with API key protection returns 404, not 401", async () => {
  const ctx = await TestSetupBuilder.create()
    .withAll()
    .withApiKeyGroup("test-group", "Test group")
    .withApiKey("test-group", "test-key-123")
    .withRoute("/protected", "protected.ts", {
      methods: ["GET"],
      keys: ["test-group"],
    })
    .withFile("protected.ts", simpleHandler)
    .build();

  try {
    const functionRouter = createFunctionRouterWithContext(ctx);

    const app = new Hono();
    app.all("/run/*", (c) => functionRouter.handle(c));

    const routes = await ctx.routesService.getAll();
    const route = routes.find((r) => r.route === "/protected");

    // Disable the route
    await ctx.routesService.setRouteEnabled(route!.id, false);

    // Should get 404 even with valid API key
    const res = await app.request("/run/protected", {
      headers: { "X-API-Key": "test-key-123" },
    });
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe("Function not found");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("New routes are enabled by default", async () => {
  const ctx = await TestSetupBuilder.create().withAll().build();

  try {
    // Add a route programmatically
    await ctx.routesService.addRoute({
      name: "new-route",
      handler: "new.ts",
      route: "/new",
      methods: ["GET"],
    });

    // Verify it's enabled
    const route = await ctx.routesService.getByName("new-route");
    expect(route!.enabled).toBe(true);
  } finally {
    await ctx.cleanup();
  }
});
