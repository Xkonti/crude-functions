import { expect } from "@std/expect";
import { Hono } from "@hono/hono";
import { DatabaseService } from "../database/database_service.ts";
import { RoutesService } from "../routes/routes_service.ts";
import { ApiKeyService } from "../keys/api_key_service.ts";
import { ConsoleLogService } from "../logs/console_log_service.ts";
import { ExecutionMetricsService } from "../metrics/execution_metrics_service.ts";
import { FunctionRouter } from "./function_router.ts";

const API_KEYS_SCHEMA = `
CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key_group TEXT NOT NULL,
  value TEXT NOT NULL,
  description TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_group_value ON api_keys(key_group, value);
CREATE INDEX IF NOT EXISTS idx_api_keys_group ON api_keys(key_group);
`;

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

const CONSOLE_LOGS_SCHEMA = `
CREATE TABLE IF NOT EXISTS console_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL,
  route_id INTEGER,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  args TEXT,
  timestamp TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_console_logs_request_id ON console_logs(request_id);
`;

const EXECUTION_METRICS_SCHEMA = `
CREATE TABLE IF NOT EXISTS execution_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  route_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('execution', 'minute', 'hour', 'day')),
  avg_time_ms REAL NOT NULL,
  max_time_ms INTEGER NOT NULL,
  execution_count INTEGER NOT NULL DEFAULT 1,
  timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_execution_metrics_route_id ON execution_metrics(route_id);
CREATE INDEX IF NOT EXISTS idx_execution_metrics_type_route_timestamp ON execution_metrics(type, route_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_execution_metrics_timestamp ON execution_metrics(timestamp);
`;

interface TestRoute {
  name: string;
  handler: string;
  route: string;
  methods: string[];
  description?: string;
  keys?: string[];
}

interface TestKey {
  group: string;
  value: string;
  description?: string;
}

async function createTestSetup(
  initialRoutes: TestRoute[] = [],
  initialKeys: TestKey[] = []
) {
  const tempDir = await Deno.makeTempDir();
  const codeDir = `${tempDir}/code`;

  await Deno.mkdir(codeDir);

  // Create in-memory database for testing
  const db = new DatabaseService({ databasePath: ":memory:" });
  await db.open();
  await db.exec(API_KEYS_SCHEMA);
  await db.exec(ROUTES_SCHEMA);
  await db.exec(CONSOLE_LOGS_SCHEMA);
  await db.exec(EXECUTION_METRICS_SCHEMA);

  const routesService = new RoutesService({ db });
  const apiKeyService = new ApiKeyService({ db });
  const consoleLogService = new ConsoleLogService({ db });
  const executionMetricsService = new ExecutionMetricsService({ db });

  // Add initial routes
  for (const route of initialRoutes) {
    await routesService.addRoute(route);
  }

  // Add initial keys
  for (const key of initialKeys) {
    await apiKeyService.addKey(key.group, key.value, key.description);
  }

  const functionRouter = new FunctionRouter({
    routesService,
    apiKeyService,
    consoleLogService,
    executionMetricsService,
    codeDirectory: tempDir,
  });

  // Create a wrapper app that mounts the function router at /run
  const app = new Hono();
  app.all("/run/*", (c) => functionRouter.handle(c));
  app.all("/run", (c) => functionRouter.handle(c));

  return {
    app,
    tempDir,
    codeDir,
    db,
    routesService,
    apiKeyService,
    consoleLogService,
    executionMetricsService,
    functionRouter,
  };
}

async function cleanup(tempDir: string, db: DatabaseService) {
  await db.close();
  await Deno.remove(tempDir, { recursive: true });
}

async function writeHandler(codeDir: string, filename: string, code: string) {
  await Deno.writeTextFile(`${codeDir}/${filename}`, code);
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

Deno.test("FunctionRouter returns 404 for empty routes", async () => {
  const { app, tempDir, db } = await createTestSetup([]);

  try {
    const res = await app.request("/run/anything");
    expect(res.status).toBe(404);

    const json = await res.json();
    expect(json.error).toBe("Function not found");
  } finally {
    await cleanup(tempDir, db);
  }
});

Deno.test("FunctionRouter executes handler for matching route", async () => {
  const routes = [
    { name: "hello", handler: "code/hello.ts", route: "/hello", methods: ["GET"] },
  ];
  const { app, tempDir, codeDir, db } = await createTestSetup(routes);

  try {
    await writeHandler(codeDir, "hello.ts", simpleHandler);

    const res = await app.request("/run/hello");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.route).toBe("hello");
    expect(json.requestId).toBeDefined();
  } finally {
    await cleanup(tempDir, db);
  }
});

Deno.test("FunctionRouter handles POST request with body", async () => {
  const routes = [
    { name: "echo", handler: "code/echo.ts", route: "/echo", methods: ["POST"] },
  ];
  const { app, tempDir, codeDir, db } = await createTestSetup(routes);

  try {
    await writeHandler(codeDir, "echo.ts", echoHandler);

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
    await cleanup(tempDir, db);
  }
});

Deno.test("FunctionRouter handles multiple methods per route", async () => {
  const routes = [
    { name: "multi", handler: "code/multi.ts", route: "/multi", methods: ["GET", "POST", "PUT"] },
  ];
  const { app, tempDir, codeDir, db } = await createTestSetup(routes);

  try {
    await writeHandler(codeDir, "multi.ts", simpleHandler);

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
    await cleanup(tempDir, db);
  }
});

Deno.test("FunctionRouter returns 404 for wrong method", async () => {
  const routes = [
    { name: "hello", handler: "code/hello.ts", route: "/hello", methods: ["GET"] },
  ];
  const { app, tempDir, codeDir, db } = await createTestSetup(routes);

  try {
    await writeHandler(codeDir, "hello.ts", simpleHandler);

    const res = await app.request("/run/hello", { method: "POST" });
    expect(res.status).toBe(404);
  } finally {
    await cleanup(tempDir, db);
  }
});

// ======================
// Path parameters tests
// ======================

Deno.test("FunctionRouter handles path parameters", async () => {
  const routes = [
    { name: "get-user", handler: "code/user.ts", route: "/users/:id", methods: ["GET"] },
  ];
  const { app, tempDir, codeDir, db } = await createTestSetup(routes);

  try {
    await writeHandler(codeDir, "user.ts", simpleHandler);

    const res = await app.request("/run/users/123");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.route).toBe("get-user");
    expect(json.params.id).toBe("123");
  } finally {
    await cleanup(tempDir, db);
  }
});

Deno.test("FunctionRouter handles nested path parameters", async () => {
  const routes = [
    {
      name: "get-post",
      handler: "code/post.ts",
      route: "/users/:userId/posts/:postId",
      methods: ["GET"],
    },
  ];
  const { app, tempDir, codeDir, db } = await createTestSetup(routes);

  try {
    await writeHandler(codeDir, "post.ts", simpleHandler);

    const res = await app.request("/run/users/42/posts/99");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.params.userId).toBe("42");
    expect(json.params.postId).toBe("99");
  } finally {
    await cleanup(tempDir, db);
  }
});

Deno.test("FunctionRouter handles query parameters", async () => {
  const routes = [
    { name: "search", handler: "code/search.ts", route: "/search", methods: ["GET"] },
  ];
  const { app, tempDir, codeDir, db } = await createTestSetup(routes);

  try {
    await writeHandler(codeDir, "search.ts", simpleHandler);

    const res = await app.request("/run/search?q=test&page=2");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.query.q).toBe("test");
    expect(json.query.page).toBe("2");
  } finally {
    await cleanup(tempDir, db);
  }
});

Deno.test("FunctionRouter handles root route", async () => {
  const routes = [
    { name: "root", handler: "code/root.ts", route: "/", methods: ["GET"] },
  ];
  const { app, tempDir, codeDir, db } = await createTestSetup(routes);

  try {
    await writeHandler(codeDir, "root.ts", simpleHandler);

    const res = await app.request("/run");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.route).toBe("root");
  } finally {
    await cleanup(tempDir, db);
  }
});

// =======================
// API key validation tests
// =======================

Deno.test("FunctionRouter allows request without key when route has no keys", async () => {
  const routes = [
    { name: "public", handler: "code/public.ts", route: "/public", methods: ["GET"] },
  ];
  const { app, tempDir, codeDir, db } = await createTestSetup(routes);

  try {
    await writeHandler(codeDir, "public.ts", simpleHandler);

    const res = await app.request("/run/public");
    expect(res.status).toBe(200);
  } finally {
    await cleanup(tempDir, db);
  }
});

Deno.test("FunctionRouter returns 401 when key is required but missing", async () => {
  const routes = [
    {
      name: "protected",
      handler: "code/protected.ts",
      route: "/protected",
      methods: ["GET"],
      keys: ["api"],
    },
  ];
  const keys = [{ group: "api", value: "secret123" }];
  const { app, tempDir, codeDir, db } = await createTestSetup(routes, keys);

  try {
    await writeHandler(codeDir, "protected.ts", simpleHandler);

    const res = await app.request("/run/protected");
    expect(res.status).toBe(401);

    const json = await res.json();
    expect(json.error).toBe("Unauthorized");
    expect(json.message).toBe("Missing API key");
  } finally {
    await cleanup(tempDir, db);
  }
});

Deno.test("FunctionRouter returns 401 when key is invalid", async () => {
  const routes = [
    {
      name: "protected",
      handler: "code/protected.ts",
      route: "/protected",
      methods: ["GET"],
      keys: ["api"],
    },
  ];
  const keys = [{ group: "api", value: "secret123" }];
  const { app, tempDir, codeDir, db } = await createTestSetup(routes, keys);

  try {
    await writeHandler(codeDir, "protected.ts", simpleHandler);

    const res = await app.request("/run/protected", {
      headers: { "X-API-Key": "wrongkey" },
    });
    expect(res.status).toBe(401);

    const json = await res.json();
    expect(json.error).toBe("Unauthorized");
    expect(json.message).toBe("Invalid API key");
  } finally {
    await cleanup(tempDir, db);
  }
});

Deno.test("FunctionRouter allows request with valid key", async () => {
  const routes = [
    {
      name: "protected",
      handler: "code/protected.ts",
      route: "/protected",
      methods: ["GET"],
      keys: ["api"],
    },
  ];
  const keys = [{ group: "api", value: "secret123" }];
  const { app, tempDir, codeDir, db } = await createTestSetup(routes, keys);

  try {
    await writeHandler(codeDir, "protected.ts", simpleHandler);

    const res = await app.request("/run/protected", {
      headers: { "X-API-Key": "secret123" },
    });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.route).toBe("protected");
  } finally {
    await cleanup(tempDir, db);
  }
});

Deno.test("FunctionRouter accepts key from any allowed key name", async () => {
  const routes = [
    {
      name: "multi-key",
      handler: "code/multi.ts",
      route: "/multi",
      methods: ["GET"],
      keys: ["admin", "user"],
    },
  ];
  const keys = [
    { group: "admin", value: "admin123" },
    { group: "user", value: "user456" },
  ];
  const { app, tempDir, codeDir, db } = await createTestSetup(routes, keys);

  try {
    await writeHandler(codeDir, "multi.ts", simpleHandler);

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
    await cleanup(tempDir, db);
  }
});

Deno.test("FunctionRouter accepts Authorization Bearer token", async () => {
  const routes = [
    {
      name: "protected",
      handler: "code/protected.ts",
      route: "/protected",
      methods: ["GET"],
      keys: ["api"],
    },
  ];
  const keys = [{ group: "api", value: "secret123" }];
  const { app, tempDir, codeDir, db } = await createTestSetup(routes, keys);

  try {
    await writeHandler(codeDir, "protected.ts", simpleHandler);

    const res = await app.request("/run/protected", {
      headers: { Authorization: "Bearer secret123" },
    });
    expect(res.status).toBe(200);
  } finally {
    await cleanup(tempDir, db);
  }
});

Deno.test("FunctionRouter accepts Authorization plain value", async () => {
  const routes = [
    {
      name: "protected",
      handler: "code/protected.ts",
      route: "/protected",
      methods: ["GET"],
      keys: ["api"],
    },
  ];
  const keys = [{ group: "api", value: "secret123" }];
  const { app, tempDir, codeDir, db } = await createTestSetup(routes, keys);

  try {
    await writeHandler(codeDir, "protected.ts", simpleHandler);

    const res = await app.request("/run/protected", {
      headers: { Authorization: "secret123" },
    });
    expect(res.status).toBe(200);
  } finally {
    await cleanup(tempDir, db);
  }
});

Deno.test("FunctionRouter accepts Authorization Basic (key as password)", async () => {
  const routes = [
    {
      name: "protected",
      handler: "code/protected.ts",
      route: "/protected",
      methods: ["GET"],
      keys: ["api"],
    },
  ];
  const keys = [{ group: "api", value: "secret123" }];
  const { app, tempDir, codeDir, db } = await createTestSetup(routes, keys);

  try {
    await writeHandler(codeDir, "protected.ts", simpleHandler);

    // Base64 of ":secret123" (empty username, key as password)
    const encoded = btoa(":secret123");
    const res = await app.request("/run/protected", {
      headers: { Authorization: `Basic ${encoded}` },
    });
    expect(res.status).toBe(200);
  } finally {
    await cleanup(tempDir, db);
  }
});

Deno.test("FunctionRouter accepts X-Auth-Token header", async () => {
  const routes = [
    {
      name: "protected",
      handler: "code/protected.ts",
      route: "/protected",
      methods: ["GET"],
      keys: ["api"],
    },
  ];
  const keys = [{ group: "api", value: "secret123" }];
  const { app, tempDir, codeDir, db } = await createTestSetup(routes, keys);

  try {
    await writeHandler(codeDir, "protected.ts", simpleHandler);

    const res = await app.request("/run/protected", {
      headers: { "X-Auth-Token": "secret123" },
    });
    expect(res.status).toBe(200);
  } finally {
    await cleanup(tempDir, db);
  }
});

Deno.test("FunctionRouter accepts api_key query parameter", async () => {
  const routes = [
    {
      name: "protected",
      handler: "code/protected.ts",
      route: "/protected",
      methods: ["GET"],
      keys: ["api"],
    },
  ];
  const keys = [{ group: "api", value: "secret123" }];
  const { app, tempDir, codeDir, db } = await createTestSetup(routes, keys);

  try {
    await writeHandler(codeDir, "protected.ts", simpleHandler);

    const res = await app.request("/run/protected?api_key=secret123");
    expect(res.status).toBe(200);
  } finally {
    await cleanup(tempDir, db);
  }
});

Deno.test("FunctionRouter accepts apiKey query parameter", async () => {
  const routes = [
    {
      name: "protected",
      handler: "code/protected.ts",
      route: "/protected",
      methods: ["GET"],
      keys: ["api"],
    },
  ];
  const keys = [{ group: "api", value: "secret123" }];
  const { app, tempDir, codeDir, db } = await createTestSetup(routes, keys);

  try {
    await writeHandler(codeDir, "protected.ts", simpleHandler);

    const res = await app.request("/run/protected?apiKey=secret123");
    expect(res.status).toBe(200);
  } finally {
    await cleanup(tempDir, db);
  }
});

Deno.test("FunctionRouter prioritizes Authorization over X-API-Key", async () => {
  const routes = [
    {
      name: "protected",
      handler: "code/protected.ts",
      route: "/protected",
      methods: ["GET"],
      keys: ["api"],
    },
  ];
  const keys = [
    { group: "api", value: "bearer-key" },
    { group: "api", value: "header-key" },
  ];
  const { app, tempDir, codeDir, db } = await createTestSetup(routes, keys);

  try {
    await writeHandler(codeDir, "protected.ts", simpleHandler);

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
    await cleanup(tempDir, db);
  }
});

// ====================
// Error handling tests
// ====================

Deno.test("FunctionRouter returns 404 when handler file not found", async () => {
  const routes = [
    { name: "missing", handler: "code/nonexistent.ts", route: "/missing", methods: ["GET"] },
  ];
  const { app, tempDir, db } = await createTestSetup(routes);

  try {
    const res = await app.request("/run/missing");
    expect(res.status).toBe(404);

    const json = await res.json();
    expect(json.error).toBe("Handler not found");
    expect(json.requestId).toBeDefined();
  } finally {
    await cleanup(tempDir, db);
  }
});

Deno.test("FunctionRouter returns 500 when handler has no default export", async () => {
  const routes = [
    { name: "no-export", handler: "code/noexport.ts", route: "/noexport", methods: ["GET"] },
  ];
  const { app, tempDir, codeDir, db } = await createTestSetup(routes);

  try {
    await writeHandler(codeDir, "noexport.ts", noExportHandler);

    const res = await app.request("/run/noexport");
    expect(res.status).toBe(500);

    const json = await res.json();
    expect(json.error).toBe("Invalid handler");
    expect(json.requestId).toBeDefined();
  } finally {
    await cleanup(tempDir, db);
  }
});

Deno.test("FunctionRouter returns 500 when default export is not a function", async () => {
  const routes = [
    { name: "not-func", handler: "code/notfunc.ts", route: "/notfunc", methods: ["GET"] },
  ];
  const { app, tempDir, codeDir, db } = await createTestSetup(routes);

  try {
    await writeHandler(codeDir, "notfunc.ts", notFunctionHandler);

    const res = await app.request("/run/notfunc");
    expect(res.status).toBe(500);

    const json = await res.json();
    expect(json.error).toBe("Invalid handler");
    expect(json.requestId).toBeDefined();
  } finally {
    await cleanup(tempDir, db);
  }
});

Deno.test("FunctionRouter returns 500 when handler throws error", async () => {
  const routes = [
    { name: "error", handler: "code/error.ts", route: "/error", methods: ["GET"] },
  ];
  const { app, tempDir, codeDir, db } = await createTestSetup(routes);

  try {
    await writeHandler(codeDir, "error.ts", errorHandler);

    const res = await app.request("/run/error");
    expect(res.status).toBe(500);

    const json = await res.json();
    expect(json.error).toBe("Handler execution failed");
    expect(json.requestId).toBeDefined();
  } finally {
    await cleanup(tempDir, db);
  }
});

// ========================
// Route hot-reload tests
// ========================

Deno.test("FunctionRouter rebuilds router when routes are added", async () => {
  const routes = [
    { name: "hello", handler: "code/hello.ts", route: "/hello", methods: ["GET"] },
  ];
  const { app, tempDir, codeDir, db, routesService } = await createTestSetup(routes);

  try {
    await writeHandler(codeDir, "hello.ts", simpleHandler);
    await writeHandler(codeDir, "goodbye.ts", simpleHandler);

    // First request - should work
    const res1 = await app.request("/run/hello");
    expect(res1.status).toBe(200);

    // Route doesn't exist yet
    const res2 = await app.request("/run/goodbye");
    expect(res2.status).toBe(404);

    // Add new route via service
    await routesService.addRoute({
      name: "goodbye",
      handler: "code/goodbye.ts",
      route: "/goodbye",
      methods: ["GET"],
    });

    // New route should now work (router rebuilt due to dirty flag)
    const res3 = await app.request("/run/goodbye");
    expect(res3.status).toBe(200);

    const json = await res3.json();
    expect(json.route).toBe("goodbye");
  } finally {
    await cleanup(tempDir, db);
  }
});

Deno.test("FunctionRouter handles route removal", async () => {
  const routes = [
    { name: "hello", handler: "code/hello.ts", route: "/hello", methods: ["GET"] },
    { name: "goodbye", handler: "code/goodbye.ts", route: "/goodbye", methods: ["GET"] },
  ];
  const { app, tempDir, codeDir, db, routesService } = await createTestSetup(routes);

  try {
    await writeHandler(codeDir, "hello.ts", simpleHandler);
    await writeHandler(codeDir, "goodbye.ts", simpleHandler);

    // Both routes work
    expect((await app.request("/run/hello")).status).toBe(200);
    expect((await app.request("/run/goodbye")).status).toBe(200);

    // Remove goodbye route via service
    await routesService.removeRoute("goodbye");

    // Hello still works
    expect((await app.request("/run/hello")).status).toBe(200);

    // Goodbye now returns 404
    expect((await app.request("/run/goodbye")).status).toBe(404);
  } finally {
    await cleanup(tempDir, db);
  }
});

// ========================
// Multiple routes tests
// ========================

Deno.test("FunctionRouter handles multiple routes", async () => {
  const routes = [
    { name: "hello", handler: "code/hello.ts", route: "/hello", methods: ["GET"] },
    { name: "users-list", handler: "code/users.ts", route: "/users", methods: ["GET"] },
    { name: "users-create", handler: "code/users.ts", route: "/users", methods: ["POST"] },
    { name: "user-detail", handler: "code/user.ts", route: "/users/:id", methods: ["GET", "PUT", "DELETE"] },
  ];
  const { app, tempDir, codeDir, db } = await createTestSetup(routes);

  try {
    await writeHandler(codeDir, "hello.ts", simpleHandler);
    await writeHandler(codeDir, "users.ts", simpleHandler);
    await writeHandler(codeDir, "user.ts", simpleHandler);

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
    await cleanup(tempDir, db);
  }
});
