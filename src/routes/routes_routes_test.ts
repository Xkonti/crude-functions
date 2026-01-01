import { expect } from "@std/expect";
import { Hono } from "@hono/hono";
import { DatabaseService } from "../database/database_service.ts";
import { RoutesService } from "./routes_service.ts";
import { createRoutesRoutes } from "./routes_routes.ts";

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

interface TestRoute {
  name: string;
  handler: string;
  route: string;
  methods: string[];
  description?: string;
  keys?: string[];
}

async function createTestApp(initialRoutes: TestRoute[] = []) {
  const db = new DatabaseService({ databasePath: ":memory:" });
  await db.open();
  await db.exec(ROUTES_SCHEMA);

  const service = new RoutesService({ db });

  // Add initial routes
  for (const route of initialRoutes) {
    await service.addRoute(route);
  }

  const app = new Hono();
  app.route("/api/routes", createRoutesRoutes(service));

  return { app, db, service };
}

async function cleanup(db: DatabaseService) {
  await db.close();
}

// GET /api/routes tests
Deno.test("GET /api/routes returns empty array for empty database", async () => {
  const { app, db } = await createTestApp();

  try {
    const res = await app.request("/api/routes");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.routes).toEqual([]);
  } finally {
    await cleanup(db);
  }
});

Deno.test("GET /api/routes returns all routes", async () => {
  const routes = [
    { name: "hello", handler: "hello.ts", route: "/hello", methods: ["GET"] },
    { name: "users", handler: "users.ts", route: "/users", methods: ["GET", "POST"] },
  ];
  const { app, db } = await createTestApp(routes);

  try {
    const res = await app.request("/api/routes");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.routes.length).toBe(2);
    expect(json.routes[0].name).toBe("hello");
    expect(json.routes[1].name).toBe("users");
  } finally {
    await cleanup(db);
  }
});

// GET /api/routes/:name tests
Deno.test("GET /api/routes/:name returns route for existing name", async () => {
  const routes = [
    { name: "hello", handler: "hello.ts", route: "/hello", methods: ["GET"], description: "Greeting" },
  ];
  const { app, db } = await createTestApp(routes);

  try {
    const res = await app.request("/api/routes/hello");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.route.name).toBe("hello");
    expect(json.route.description).toBe("Greeting");
  } finally {
    await cleanup(db);
  }
});

Deno.test("GET /api/routes/:name returns 404 for non-existent name", async () => {
  const routes = [
    { name: "hello", handler: "hello.ts", route: "/hello", methods: ["GET"] },
  ];
  const { app, db } = await createTestApp(routes);

  try {
    const res = await app.request("/api/routes/nonexistent");
    expect(res.status).toBe(404);

    const json = await res.json();
    expect(json.error).toBeDefined();
  } finally {
    await cleanup(db);
  }
});

// POST /api/routes tests
Deno.test("POST /api/routes adds new route", async () => {
  const { app, db, service } = await createTestApp();

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
    const route = await service.getByName("new-route");
    expect(route).not.toBe(null);
    expect(route!.handler).toBe("new.ts");
  } finally {
    await cleanup(db);
  }
});

Deno.test("POST /api/routes rejects missing required fields", async () => {
  const { app, db } = await createTestApp();

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
    await cleanup(db);
  }
});

Deno.test("POST /api/routes rejects invalid route path", async () => {
  const { app, db } = await createTestApp();

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
    await cleanup(db);
  }
});

Deno.test("POST /api/routes rejects invalid methods", async () => {
  const { app, db } = await createTestApp();

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
    await cleanup(db);
  }
});

Deno.test("POST /api/routes returns 409 on duplicate name", async () => {
  const routes = [
    { name: "existing", handler: "existing.ts", route: "/existing", methods: ["GET"] },
  ];
  const { app, db } = await createTestApp(routes);

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
    await cleanup(db);
  }
});

Deno.test("POST /api/routes returns 409 on duplicate route+method", async () => {
  const routes = [
    { name: "existing", handler: "existing.ts", route: "/users", methods: ["GET", "POST"] },
  ];
  const { app, db } = await createTestApp(routes);

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
    await cleanup(db);
  }
});

// DELETE /api/routes/:name tests
Deno.test("DELETE /api/routes/:name removes route", async () => {
  const routes = [
    { name: "hello", handler: "hello.ts", route: "/hello", methods: ["GET"] },
    { name: "users", handler: "users.ts", route: "/users", methods: ["GET"] },
  ];
  const { app, db, service } = await createTestApp(routes);

  try {
    const res = await app.request("/api/routes/hello", {
      method: "DELETE",
    });

    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);

    // Verify route was removed
    const route = await service.getByName("hello");
    expect(route).toBe(null);

    // Other routes should remain
    const users = await service.getByName("users");
    expect(users).not.toBe(null);
  } finally {
    await cleanup(db);
  }
});

Deno.test("DELETE /api/routes/:name returns 404 for non-existent name", async () => {
  const routes = [
    { name: "hello", handler: "hello.ts", route: "/hello", methods: ["GET"] },
  ];
  const { app, db } = await createTestApp(routes);

  try {
    const res = await app.request("/api/routes/nonexistent", {
      method: "DELETE",
    });

    expect(res.status).toBe(404);
  } finally {
    await cleanup(db);
  }
});
