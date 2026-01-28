import { integrationTest } from "../test/test_helpers.ts";
import { expect } from "@std/expect";
import { Hono } from "@hono/hono";
import { TestSetupBuilder } from "../test/test_setup_builder.ts";
import { FunctionRouter } from "./function_router.ts";
import type { TestContext } from "../test/types.ts";
import { recordIdToString } from "../database/surreal_helpers.ts";

/** Creates a FunctionRouter with all required services from TestSetupBuilder context */
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

/** Creates Hono app with FunctionRouter mounted at /run */
function createAppWithRouter(ctx: TestContext) {
  const functionRouter = createFunctionRouterWithContext(ctx);
  const app = new Hono();
  app.all("/run/*", (c) => functionRouter.handle(c));
  app.all("/run", (c) => functionRouter.handle(c));
  return app;
}

// Simple handler that returns JSON
const simpleHandler = `
import type { Context } from "@hono/hono";

export default async function(c, ctx) {
  return c.json({
    route: ctx.route.name,
    params: ctx.params,
    query: ctx.query,
    requestId: ctx.requestId,
  });
}
`;

// Handler that echoes request body
const echoHandler = `
export default async function(c, ctx) {
  const body = await c.req.json();
  return c.json({ received: body, route: ctx.route.name });
}
`;

// Handler that throws an error
const errorHandler = `
export default async function(c, ctx) {
  throw new Error("Handler error!");
}
`;

// Invalid handler (no default export)
const noExportHandler = `
export function handler(c, ctx) {
  return c.json({ message: "hello" });
}
`;

// Invalid handler (default export is not a function)
const notFunctionHandler = `
export default "not a function";
`;

// =====================
// Router building tests
// =====================

integrationTest("FunctionRouter returns 404 for empty routes", async () => {
  const ctx = await TestSetupBuilder.create().withAll().build();

  try {
    const app = createAppWithRouter(ctx);
    const res = await app.request("/run/anything");
    expect(res.status).toBe(404);

    const json = await res.json();
    expect(json.error).toBe("Function not found");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("FunctionRouter executes handler for matching route", async () => {
  const ctx = await TestSetupBuilder.create()
    .withAll()
    .withRoute("/hello", "hello.ts", { methods: ["GET"] })
    .withFile("hello.ts", simpleHandler)
    .build();

  try {
    const app = createAppWithRouter(ctx);
    const res = await app.request("/run/hello");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.route).toBe("hello");
    expect(json.requestId).toBeDefined();
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("FunctionRouter handles POST request with body", async () => {
  const ctx = await TestSetupBuilder.create()
    .withAll()
    .withRoute("/echo", "echo.ts", { methods: ["POST"] })
    .withFile("echo.ts", echoHandler)
    .build();

  try {
    const app = createAppWithRouter(ctx);
    const res = await app.request("/run/echo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "hello" }),
    });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.received).toEqual({ message: "hello" });
    expect(json.route).toBe("echo");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("FunctionRouter handles multiple methods per route", async () => {
  const ctx = await TestSetupBuilder.create()
    .withAll()
    .withRoute("/multi", "multi.ts", { methods: ["GET", "POST", "PUT"] })
    .withFile("multi.ts", simpleHandler)
    .build();

  try {
    const app = createAppWithRouter(ctx);

    // Test GET
    const getRes = await app.request("/run/multi");
    expect(getRes.status).toBe(200);

    // Test POST
    const postRes = await app.request("/run/multi", { method: "POST" });
    expect(postRes.status).toBe(200);

    // Test PUT
    const putRes = await app.request("/run/multi", { method: "PUT" });
    expect(putRes.status).toBe(200);

    // Test DELETE - not allowed
    const deleteRes = await app.request("/run/multi", { method: "DELETE" });
    expect(deleteRes.status).toBe(404);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("FunctionRouter returns 404 for wrong method", async () => {
  const ctx = await TestSetupBuilder.create()
    .withAll()
    .withRoute("/hello", "hello.ts", { methods: ["GET"] })
    .withFile("hello.ts", simpleHandler)
    .build();

  try {
    const app = createAppWithRouter(ctx);
    const res = await app.request("/run/hello", { method: "POST" });
    expect(res.status).toBe(404);
  } finally {
    await ctx.cleanup();
  }
});

// ======================
// Path parameters tests
// ======================

integrationTest("FunctionRouter handles path parameters", async () => {
  const ctx = await TestSetupBuilder.create()
    .withAll()
    .withRoute("/users/:id", "user.ts", { name: "get-user", methods: ["GET"] })
    .withFile("user.ts", simpleHandler)
    .build();

  try {
    const app = createAppWithRouter(ctx);
    const res = await app.request("/run/users/123");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.route).toBe("get-user");
    expect(json.params.id).toBe("123");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("FunctionRouter handles nested path parameters", async () => {
  const ctx = await TestSetupBuilder.create()
    .withAll()
    .withRoute("/users/:userId/posts/:postId", "post.ts", { name: "get-post", methods: ["GET"] })
    .withFile("post.ts", simpleHandler)
    .build();

  try {
    const app = createAppWithRouter(ctx);
    const res = await app.request("/run/users/42/posts/99");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.params.userId).toBe("42");
    expect(json.params.postId).toBe("99");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("FunctionRouter handles query parameters", async () => {
  const ctx = await TestSetupBuilder.create()
    .withAll()
    .withRoute("/search", "search.ts", { methods: ["GET"] })
    .withFile("search.ts", simpleHandler)
    .build();

  try {
    const app = createAppWithRouter(ctx);
    const res = await app.request("/run/search?q=test&page=2");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.query.q).toBe("test");
    expect(json.query.page).toBe("2");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("FunctionRouter handles root route", async () => {
  const ctx = await TestSetupBuilder.create()
    .withAll()
    .withRoute("/", "root.ts", { name: "root", methods: ["GET"] })
    .withFile("root.ts", simpleHandler)
    .build();

  try {
    const app = createAppWithRouter(ctx);
    const res = await app.request("/run");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.route).toBe("root");
  } finally {
    await ctx.cleanup();
  }
});

// =======================
// API key validation tests
// =======================

integrationTest("FunctionRouter allows request without key when route has no keys", async () => {
  const ctx = await TestSetupBuilder.create()
    .withAll()
    .withRoute("/public", "public.ts", { methods: ["GET"] })
    .withFile("public.ts", simpleHandler)
    .build();

  try {
    const app = createAppWithRouter(ctx);
    const res = await app.request("/run/public");
    expect(res.status).toBe(200);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("FunctionRouter returns 401 when key is required but missing", async () => {
  const ctx = await TestSetupBuilder.create()
    .withAll()
    .withApiKeyGroup("api", "Test API group")
    .withApiKey("api", "secret123")
    .withRoute("/protected", "protected.ts", { methods: ["GET"], keys: ["api"] })
    .withFile("protected.ts", simpleHandler)
    .build();

  try {
    const app = createAppWithRouter(ctx);
    const res = await app.request("/run/protected");
    expect(res.status).toBe(401);

    const json = await res.json();
    expect(json.error).toBe("Unauthorized");
    expect(json.message).toBe("Missing API key");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("FunctionRouter returns 401 when key is invalid", async () => {
  const ctx = await TestSetupBuilder.create()
    .withAll()
    .withApiKeyGroup("api", "Test API group")
    .withApiKey("api", "secret123")
    .withRoute("/protected", "protected.ts", { methods: ["GET"], keys: ["api"] })
    .withFile("protected.ts", simpleHandler)
    .build();

  try {
    const app = createAppWithRouter(ctx);
    const res = await app.request("/run/protected", {
      headers: { "X-API-Key": "wrongkey" },
    });
    expect(res.status).toBe(401);

    const json = await res.json();
    expect(json.error).toBe("Unauthorized");
    expect(json.message).toBe("Invalid API key");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("FunctionRouter allows request with valid key", async () => {
  const ctx = await TestSetupBuilder.create()
    .withAll()
    .withApiKeyGroup("api", "Test API group")
    .withApiKey("api", "secret123")
    .withRoute("/protected", "protected.ts", { methods: ["GET"], keys: ["api"] })
    .withFile("protected.ts", simpleHandler)
    .build();

  try {
    const app = createAppWithRouter(ctx);
    const res = await app.request("/run/protected", {
      headers: { "X-API-Key": "secret123" },
    });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.route).toBe("protected");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("FunctionRouter accepts key from any allowed key name", async () => {
  const ctx = await TestSetupBuilder.create()
    .withAll()
    .withApiKeyGroup("admin", "Admin keys")
    .withApiKeyGroup("user", "User keys")
    .withApiKey("admin", "admin123")
    .withApiKey("user", "user456")
    .withRoute("/multi", "multi.ts", { name: "multi-key", methods: ["GET"], keys: ["admin", "user"] })
    .withFile("multi.ts", simpleHandler)
    .build();

  try {
    const app = createAppWithRouter(ctx);

    // Test with admin key
    const res1 = await app.request("/run/multi", {
      headers: { "X-API-Key": "admin123" },
    });
    expect(res1.status).toBe(200);

    // Test with user key
    const res2 = await app.request("/run/multi", {
      headers: { "X-API-Key": "user456" },
    });
    expect(res2.status).toBe(200);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("FunctionRouter accepts Authorization Bearer token", async () => {
  const ctx = await TestSetupBuilder.create()
    .withAll()
    .withApiKeyGroup("api", "Test API group")
    .withApiKey("api", "secret123")
    .withRoute("/protected", "protected.ts", { methods: ["GET"], keys: ["api"] })
    .withFile("protected.ts", simpleHandler)
    .build();

  try {
    const app = createAppWithRouter(ctx);
    const res = await app.request("/run/protected", {
      headers: { Authorization: "Bearer secret123" },
    });
    expect(res.status).toBe(200);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("FunctionRouter accepts Authorization plain value", async () => {
  const ctx = await TestSetupBuilder.create()
    .withAll()
    .withApiKeyGroup("api", "Test API group")
    .withApiKey("api", "secret123")
    .withRoute("/protected", "protected.ts", { methods: ["GET"], keys: ["api"] })
    .withFile("protected.ts", simpleHandler)
    .build();

  try {
    const app = createAppWithRouter(ctx);
    const res = await app.request("/run/protected", {
      headers: { Authorization: "secret123" },
    });
    expect(res.status).toBe(200);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("FunctionRouter accepts Authorization Basic (key as password)", async () => {
  const ctx = await TestSetupBuilder.create()
    .withAll()
    .withApiKeyGroup("api", "Test API group")
    .withApiKey("api", "secret123")
    .withRoute("/protected", "protected.ts", { methods: ["GET"], keys: ["api"] })
    .withFile("protected.ts", simpleHandler)
    .build();

  try {
    const app = createAppWithRouter(ctx);
    // Base64 of ":secret123" (empty username, key as password)
    const encoded = btoa(":secret123");
    const res = await app.request("/run/protected", {
      headers: { Authorization: `Basic ${encoded}` },
    });
    expect(res.status).toBe(200);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("FunctionRouter accepts X-Auth-Token header", async () => {
  const ctx = await TestSetupBuilder.create()
    .withAll()
    .withApiKeyGroup("api", "Test API group")
    .withApiKey("api", "secret123")
    .withRoute("/protected", "protected.ts", { methods: ["GET"], keys: ["api"] })
    .withFile("protected.ts", simpleHandler)
    .build();

  try {
    const app = createAppWithRouter(ctx);
    const res = await app.request("/run/protected", {
      headers: { "X-Auth-Token": "secret123" },
    });
    expect(res.status).toBe(200);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("FunctionRouter accepts api_key query parameter", async () => {
  const ctx = await TestSetupBuilder.create()
    .withAll()
    .withApiKeyGroup("api", "Test API group")
    .withApiKey("api", "secret123")
    .withRoute("/protected", "protected.ts", { methods: ["GET"], keys: ["api"] })
    .withFile("protected.ts", simpleHandler)
    .build();

  try {
    const app = createAppWithRouter(ctx);
    const res = await app.request("/run/protected?api_key=secret123");
    expect(res.status).toBe(200);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("FunctionRouter accepts apiKey query parameter", async () => {
  const ctx = await TestSetupBuilder.create()
    .withAll()
    .withApiKeyGroup("api", "Test API group")
    .withApiKey("api", "secret123")
    .withRoute("/protected", "protected.ts", { methods: ["GET"], keys: ["api"] })
    .withFile("protected.ts", simpleHandler)
    .build();

  try {
    const app = createAppWithRouter(ctx);
    const res = await app.request("/run/protected?apiKey=secret123");
    expect(res.status).toBe(200);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("FunctionRouter prioritizes Authorization over X-API-Key", async () => {
  const ctx = await TestSetupBuilder.create()
    .withAll()
    .withApiKeyGroup("api", "Test API group")
    .withApiKey("api", "bearer-key", "bearer-key-name")
    .withApiKey("api", "header-key", "header-key-name")
    .withRoute("/protected", "protected.ts", { methods: ["GET"], keys: ["api"] })
    .withFile("protected.ts", simpleHandler)
    .build();

  try {
    const app = createAppWithRouter(ctx);

    // Both headers present - Authorization Bearer should be used (it's first)
    const res = await app.request("/run/protected", {
      headers: {
        Authorization: "Bearer bearer-key",
        "X-API-Key": "header-key",
      },
    });
    expect(res.status).toBe(200);

    // Now test with wrong bearer but correct X-API-Key - should fail
    // because Authorization is checked first and "wrong-bearer" is not valid
    const res2 = await app.request("/run/protected", {
      headers: {
        Authorization: "Bearer wrong-bearer",
        "X-API-Key": "header-key",
      },
    });
    expect(res2.status).toBe(401);
  } finally {
    await ctx.cleanup();
  }
});

// ====================
// Error handling tests
// ====================

integrationTest("FunctionRouter returns 404 when handler file not found", async () => {
  const ctx = await TestSetupBuilder.create()
    .withAll()
    .withRoute("/missing", "nonexistent.ts", { name: "missing", methods: ["GET"] })
    // Note: intentionally NOT creating the file
    .build();

  try {
    const app = createAppWithRouter(ctx);
    const res = await app.request("/run/missing");
    expect(res.status).toBe(404);

    const json = await res.json();
    expect(json.error).toBe("Handler not found");
    expect(json.requestId).toBeDefined();
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("FunctionRouter returns 500 when handler has no default export", async () => {
  const ctx = await TestSetupBuilder.create()
    .withAll()
    .withRoute("/noexport", "noexport.ts", { name: "no-export", methods: ["GET"] })
    .withFile("noexport.ts", noExportHandler)
    .build();

  try {
    const app = createAppWithRouter(ctx);
    const res = await app.request("/run/noexport");
    expect(res.status).toBe(500);

    const json = await res.json();
    expect(json.error).toBe("Invalid handler");
    expect(json.requestId).toBeDefined();
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("FunctionRouter returns 500 when default export is not a function", async () => {
  const ctx = await TestSetupBuilder.create()
    .withAll()
    .withRoute("/notfunc", "notfunc.ts", { name: "not-func", methods: ["GET"] })
    .withFile("notfunc.ts", notFunctionHandler)
    .build();

  try {
    const app = createAppWithRouter(ctx);
    const res = await app.request("/run/notfunc");
    expect(res.status).toBe(500);

    const json = await res.json();
    expect(json.error).toBe("Invalid handler");
    expect(json.requestId).toBeDefined();
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("FunctionRouter returns 500 when handler throws error", async () => {
  const ctx = await TestSetupBuilder.create()
    .withAll()
    .withRoute("/error", "error.ts", { name: "error", methods: ["GET"] })
    .withFile("error.ts", errorHandler)
    .build();

  try {
    const app = createAppWithRouter(ctx);
    const res = await app.request("/run/error");
    expect(res.status).toBe(500);

    const json = await res.json();
    expect(json.error).toBe("Handler execution failed");
    expect(json.requestId).toBeDefined();
  } finally {
    await ctx.cleanup();
  }
});

// ========================
// Route hot-reload tests
// ========================

integrationTest("FunctionRouter rebuilds router when routes are added", async () => {
  const ctx = await TestSetupBuilder.create()
    .withAll()
    .withRoute("/hello", "hello.ts", { methods: ["GET"] })
    .withFile("hello.ts", simpleHandler)
    .withFile("goodbye.ts", simpleHandler) // Pre-create file for later
    .build();

  try {
    const app = createAppWithRouter(ctx);

    // First request - should work
    const res1 = await app.request("/run/hello");
    expect(res1.status).toBe(200);

    // Route doesn't exist yet
    const res2 = await app.request("/run/goodbye");
    expect(res2.status).toBe(404);

    // Add new route via service
    await ctx.routesService.addRoute({
      name: "goodbye",
      handler: "goodbye.ts",
      routePath: "/goodbye",
      methods: ["GET"],
    });

    // New route should now work (router rebuilt due to dirty flag)
    const res3 = await app.request("/run/goodbye");
    expect(res3.status).toBe(200);

    const json = await res3.json();
    expect(json.route).toBe("goodbye");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("FunctionRouter handles route removal", async () => {
  const ctx = await TestSetupBuilder.create()
    .withAll()
    .withRoute("/hello", "hello.ts", { methods: ["GET"] })
    .withRoute("/goodbye", "goodbye.ts", { methods: ["GET"] })
    .withFile("hello.ts", simpleHandler)
    .withFile("goodbye.ts", simpleHandler)
    .build();

  try {
    const app = createAppWithRouter(ctx);

    // Both routes work
    expect((await app.request("/run/hello")).status).toBe(200);
    expect((await app.request("/run/goodbye")).status).toBe(200);

    // Remove goodbye route via service
    await ctx.routesService.removeRoute("goodbye");

    // Hello still works
    expect((await app.request("/run/hello")).status).toBe(200);

    // Goodbye now returns 404
    expect((await app.request("/run/goodbye")).status).toBe(404);
  } finally {
    await ctx.cleanup();
  }
});

// ========================
// Multiple routes tests
// ========================

integrationTest("FunctionRouter handles multiple routes", async () => {
  const ctx = await TestSetupBuilder.create()
    .withAll()
    .withRoute("/hello", "hello.ts", { methods: ["GET"] })
    .withRoute("/users", "users.ts", { name: "users-list", methods: ["GET"] })
    .withRoute("/users", "users.ts", { name: "users-create", methods: ["POST"] })
    .withRoute("/users/:id", "user.ts", { name: "user-detail", methods: ["GET", "PUT", "DELETE"] })
    .withFile("hello.ts", simpleHandler)
    .withFile("users.ts", simpleHandler)
    .withFile("user.ts", simpleHandler)
    .build();

  try {
    const app = createAppWithRouter(ctx);

    // Test different routes
    const helloRes = await app.request("/run/hello");
    expect(helloRes.status).toBe(200);
    expect((await helloRes.json()).route).toBe("hello");

    const usersListRes = await app.request("/run/users");
    expect(usersListRes.status).toBe(200);
    expect((await usersListRes.json()).route).toBe("users-list");

    const usersCreateRes = await app.request("/run/users", { method: "POST" });
    expect(usersCreateRes.status).toBe(200);
    expect((await usersCreateRes.json()).route).toBe("users-create");

    const userDetailRes = await app.request("/run/users/123");
    expect(userDetailRes.status).toBe(200);
    expect((await userDetailRes.json()).route).toBe("user-detail");

    const userUpdateRes = await app.request("/run/users/123", { method: "PUT" });
    expect(userUpdateRes.status).toBe(200);
    expect((await userUpdateRes.json()).route).toBe("user-detail");
  } finally {
    await ctx.cleanup();
  }
});

// ========================
// Cascade deletion tests
// ========================

integrationTest("FunctionRouter - route deletion cascades to logs and secrets but orphans metrics", async () => {
  const ctx = await TestSetupBuilder.create()
    .withAll()
    .withRoute("/test", "test.ts", { name: "test-route", methods: ["GET"] })
    .withFile("test.ts", simpleHandler)
    .build();

  try {
    // Get the route ID
    const route = await ctx.routesService.getByName("test-route");
    expect(route).not.toBeNull();
    const routeId = recordIdToString(route!.id);

    // Add console logs for this route
    ctx.consoleLogService.store({
      requestId: "req-1",
      functionId: routeId,
      level: "log",
      message: "Test log 1",
    });
    ctx.consoleLogService.store({
      requestId: "req-2",
      functionId: routeId,
      level: "info",
      message: "Test log 2",
    });

    // Flush buffered logs before checking
    await ctx.consoleLogService.flush();

    // Use the shared secretsService from context (needed for cascade delete to work)
    const secretsService = ctx.secretsService;

    // Add function-specific secrets for this route
    await secretsService.createFunctionSecret(routeId, "SECRET_KEY", "secret-value", "Test secret");
    await secretsService.createFunctionSecret(routeId, "API_TOKEN", "token-value");

    // Add execution metrics for this route
    await ctx.executionMetricsService.store({
      functionId: route!.id,
      type: "execution",
      avgTimeUs: 100 * 1000,
      maxTimeUs: 150 * 1000,
      executionCount: 1,
    });
    await ctx.executionMetricsService.store({
      functionId: route!.id,
      type: "minute",
      avgTimeUs: 120 * 1000,
      maxTimeUs: 180 * 1000,
      executionCount: 5,
    });

    // Verify data exists before deletion
    const logsBefore = await ctx.consoleLogService.getByFunctionId(routeId);
    expect(logsBefore.length).toBe(2);

    const secretsBefore = await secretsService.getFunctionSecrets(routeId);
    expect(secretsBefore.length).toBe(2);

    const metricsBefore = await ctx.executionMetricsService.getByFunctionId(route!.id);
    expect(metricsBefore.length).toBe(2);

    // Delete the route
    await ctx.routesService.removeRoute("test-route");

    // Verify console logs are CASCADE deleted
    const logsAfter = await ctx.consoleLogService.getByFunctionId(routeId);
    expect(logsAfter.length).toBe(0);

    // Verify function-specific secrets are CASCADE deleted
    const secretsAfter = await secretsService.getFunctionSecrets(routeId);
    expect(secretsAfter.length).toBe(0);

    // Verify execution metrics are ORPHANED (not deleted, kept for global metrics aggregation)
    const metricsAfter = await ctx.executionMetricsService.getByFunctionId(route!.id);
    expect(metricsAfter.length).toBe(2);
    expect(recordIdToString(metricsAfter[0].functionId!)).toBe(routeId);
    expect(recordIdToString(metricsAfter[1].functionId!)).toBe(routeId);
  } finally {
    await ctx.cleanup();
  }
});
