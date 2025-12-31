import { expect } from "@std/expect";
import { Hono } from "@hono/hono";
import { RoutesService } from "./routes_service.ts";
import { createRoutesRoutes } from "./routes_routes.ts";

async function createTestApp(initialRoutes: object[] = []) {
  const tempDir = await Deno.makeTempDir();
  const configPath = `${tempDir}/routes.json`;
  await Deno.writeTextFile(configPath, JSON.stringify(initialRoutes));

  const service = new RoutesService({ configPath });
  const app = new Hono();
  app.route("/api/routes", createRoutesRoutes(service));

  return { app, tempDir, service };
}

async function cleanup(tempDir: string) {
  await Deno.remove(tempDir, { recursive: true });
}

// GET /api/routes tests
Deno.test("GET /api/routes returns empty array for empty file", async () => {
  const { app, tempDir } = await createTestApp();

  try {
    const res = await app.request("/api/routes");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.routes).toEqual([]);
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("GET /api/routes returns all routes", async () => {
  const routes = [
    { name: "hello", handler: "hello.ts", route: "/hello", methods: ["GET"] },
    { name: "users", handler: "users.ts", route: "/users", methods: ["GET", "POST"] },
  ];
  const { app, tempDir } = await createTestApp(routes);

  try {
    const res = await app.request("/api/routes");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.routes.length).toBe(2);
    expect(json.routes[0].name).toBe("hello");
    expect(json.routes[1].name).toBe("users");
  } finally {
    await cleanup(tempDir);
  }
});

// GET /api/routes/:name tests
Deno.test("GET /api/routes/:name returns route for existing name", async () => {
  const routes = [
    { name: "hello", handler: "hello.ts", route: "/hello", methods: ["GET"], description: "Greeting" },
  ];
  const { app, tempDir } = await createTestApp(routes);

  try {
    const res = await app.request("/api/routes/hello");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.route.name).toBe("hello");
    expect(json.route.description).toBe("Greeting");
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("GET /api/routes/:name returns 404 for non-existent name", async () => {
  const routes = [
    { name: "hello", handler: "hello.ts", route: "/hello", methods: ["GET"] },
  ];
  const { app, tempDir } = await createTestApp(routes);

  try {
    const res = await app.request("/api/routes/nonexistent");
    expect(res.status).toBe(404);

    const json = await res.json();
    expect(json.error).toBeDefined();
  } finally {
    await cleanup(tempDir);
  }
});

// POST /api/routes tests
Deno.test("POST /api/routes adds new route", async () => {
  const { app, tempDir, service } = await createTestApp();

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
    await cleanup(tempDir);
  }
});

Deno.test("POST /api/routes rejects missing required fields", async () => {
  const { app, tempDir } = await createTestApp();

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
    await cleanup(tempDir);
  }
});

Deno.test("POST /api/routes rejects invalid route path", async () => {
  const { app, tempDir } = await createTestApp();

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
    await cleanup(tempDir);
  }
});

Deno.test("POST /api/routes rejects invalid methods", async () => {
  const { app, tempDir } = await createTestApp();

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
    await cleanup(tempDir);
  }
});

Deno.test("POST /api/routes returns 409 on duplicate name", async () => {
  const routes = [
    { name: "existing", handler: "existing.ts", route: "/existing", methods: ["GET"] },
  ];
  const { app, tempDir } = await createTestApp(routes);

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
    await cleanup(tempDir);
  }
});

Deno.test("POST /api/routes returns 409 on duplicate route+method", async () => {
  const routes = [
    { name: "existing", handler: "existing.ts", route: "/users", methods: ["GET", "POST"] },
  ];
  const { app, tempDir } = await createTestApp(routes);

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
    await cleanup(tempDir);
  }
});

// DELETE /api/routes/:name tests
Deno.test("DELETE /api/routes/:name removes route", async () => {
  const routes = [
    { name: "hello", handler: "hello.ts", route: "/hello", methods: ["GET"] },
    { name: "users", handler: "users.ts", route: "/users", methods: ["GET"] },
  ];
  const { app, tempDir, service } = await createTestApp(routes);

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
    await cleanup(tempDir);
  }
});

Deno.test("DELETE /api/routes/:name returns 404 for non-existent name", async () => {
  const routes = [
    { name: "hello", handler: "hello.ts", route: "/hello", methods: ["GET"] },
  ];
  const { app, tempDir } = await createTestApp(routes);

  try {
    const res = await app.request("/api/routes/nonexistent", {
      method: "DELETE",
    });

    expect(res.status).toBe(404);
  } finally {
    await cleanup(tempDir);
  }
});
