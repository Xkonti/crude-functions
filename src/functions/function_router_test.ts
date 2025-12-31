import { expect } from "@std/expect";
import { Hono } from "@hono/hono";
import { RoutesService } from "../routes/routes_service.ts";
import { FunctionRouter } from "./function_router.ts";

async function createTestSetup(initialRoutes: object[] = []) {
  const tempDir = await Deno.makeTempDir();
  const configPath = `${tempDir}/routes.json`;
  await Deno.writeTextFile(configPath, JSON.stringify(initialRoutes));

  const routesService = new RoutesService({ configPath, refreshInterval: 50 });
  const functionRouter = new FunctionRouter({ routesService });

  // Create a wrapper app that mounts the function router at /run
  const app = new Hono();
  app.all("/run/*", (c) => functionRouter.handle(c));
  app.all("/run", (c) => functionRouter.handle(c));

  return { app, tempDir, routesService, functionRouter, configPath };
}

async function cleanup(tempDir: string) {
  await Deno.remove(tempDir, { recursive: true });
}

// Router building tests
Deno.test("FunctionRouter returns 404 for empty routes", async () => {
  const { app, tempDir } = await createTestSetup([]);

  try {
    const res = await app.request("/run/anything");
    expect(res.status).toBe(404);

    const json = await res.json();
    expect(json.error).toBe("Function not found");
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("FunctionRouter routes GET request to matching route", async () => {
  const routes = [
    { name: "hello", handler: "code/hello.ts", route: "/hello", methods: ["GET"] },
  ];
  const { app, tempDir } = await createTestSetup(routes);

  try {
    const res = await app.request("/run/hello");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.route.name).toBe("hello");
    expect(json.route.handler).toBe("code/hello.ts");
    expect(json.request.method).toBe("GET");
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("FunctionRouter routes POST request to matching route", async () => {
  const routes = [
    { name: "create-user", handler: "code/users.ts", route: "/users", methods: ["POST"] },
  ];
  const { app, tempDir } = await createTestSetup(routes);

  try {
    const res = await app.request("/run/users", { method: "POST" });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.route.name).toBe("create-user");
    expect(json.request.method).toBe("POST");
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("FunctionRouter handles multiple methods per route", async () => {
  const routes = [
    { name: "users", handler: "code/users.ts", route: "/users", methods: ["GET", "POST", "PUT"] },
  ];
  const { app, tempDir } = await createTestSetup(routes);

  try {
    // Test GET
    const getRes = await app.request("/run/users");
    expect(getRes.status).toBe(200);

    // Test POST
    const postRes = await app.request("/run/users", { method: "POST" });
    expect(postRes.status).toBe(200);

    // Test PUT
    const putRes = await app.request("/run/users", { method: "PUT" });
    expect(putRes.status).toBe(200);

    // Test DELETE - not allowed
    const deleteRes = await app.request("/run/users", { method: "DELETE" });
    expect(deleteRes.status).toBe(404);
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("FunctionRouter returns 404 for wrong method", async () => {
  const routes = [
    { name: "hello", handler: "code/hello.ts", route: "/hello", methods: ["GET"] },
  ];
  const { app, tempDir } = await createTestSetup(routes);

  try {
    const res = await app.request("/run/hello", { method: "POST" });
    expect(res.status).toBe(404);
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("FunctionRouter handles path parameters", async () => {
  const routes = [
    { name: "get-user", handler: "code/users.ts", route: "/users/:id", methods: ["GET"] },
  ];
  const { app, tempDir } = await createTestSetup(routes);

  try {
    const res = await app.request("/run/users/123");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.route.name).toBe("get-user");
    expect(json.request.params.id).toBe("123");
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("FunctionRouter handles nested path parameters", async () => {
  const routes = [
    { name: "get-post", handler: "code/posts.ts", route: "/users/:userId/posts/:postId", methods: ["GET"] },
  ];
  const { app, tempDir } = await createTestSetup(routes);

  try {
    const res = await app.request("/run/users/42/posts/99");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.request.params.userId).toBe("42");
    expect(json.request.params.postId).toBe("99");
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("FunctionRouter handles root route", async () => {
  const routes = [
    { name: "root", handler: "code/root.ts", route: "/", methods: ["GET"] },
  ];
  const { app, tempDir } = await createTestSetup(routes);

  try {
    const res = await app.request("/run");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.route.name).toBe("root");
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("FunctionRouter handles /run/ with trailing slash", async () => {
  const routes = [
    { name: "root", handler: "code/root.ts", route: "/", methods: ["GET"] },
  ];
  const { app, tempDir } = await createTestSetup(routes);

  try {
    const res = await app.request("/run/");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.route.name).toBe("root");
  } finally {
    await cleanup(tempDir);
  }
});

// Change detection tests
Deno.test("FunctionRouter rebuilds router when routes change", async () => {
  const routes = [
    { name: "hello", handler: "code/hello.ts", route: "/hello", methods: ["GET"] },
  ];
  const { app, tempDir, configPath } = await createTestSetup(routes);

  try {
    // First request - should work
    const res1 = await app.request("/run/hello");
    expect(res1.status).toBe(200);

    // Route doesn't exist yet
    const res2 = await app.request("/run/goodbye");
    expect(res2.status).toBe(404);

    // Wait for refresh interval
    await new Promise((resolve) => setTimeout(resolve, 60));

    // Add new route to file
    const newRoutes = [
      { name: "hello", handler: "code/hello.ts", route: "/hello", methods: ["GET"] },
      { name: "goodbye", handler: "code/goodbye.ts", route: "/goodbye", methods: ["GET"] },
    ];
    await Deno.writeTextFile(configPath, JSON.stringify(newRoutes));

    // New route should now work (router rebuilt)
    const res3 = await app.request("/run/goodbye");
    expect(res3.status).toBe(200);

    const json = await res3.json();
    expect(json.route.name).toBe("goodbye");
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("FunctionRouter handles route removal", async () => {
  const routes = [
    { name: "hello", handler: "code/hello.ts", route: "/hello", methods: ["GET"] },
    { name: "goodbye", handler: "code/goodbye.ts", route: "/goodbye", methods: ["GET"] },
  ];
  const { app, tempDir, configPath } = await createTestSetup(routes);

  try {
    // Both routes work
    expect((await app.request("/run/hello")).status).toBe(200);
    expect((await app.request("/run/goodbye")).status).toBe(200);

    // Wait for refresh interval
    await new Promise((resolve) => setTimeout(resolve, 60));

    // Remove goodbye route
    const newRoutes = [
      { name: "hello", handler: "code/hello.ts", route: "/hello", methods: ["GET"] },
    ];
    await Deno.writeTextFile(configPath, JSON.stringify(newRoutes));

    // Hello still works
    expect((await app.request("/run/hello")).status).toBe(200);

    // Goodbye now returns 404
    expect((await app.request("/run/goodbye")).status).toBe(404);
  } finally {
    await cleanup(tempDir);
  }
});

// Placeholder response tests
Deno.test("FunctionRouter placeholder response includes route info", async () => {
  const routes = [
    {
      name: "test-route",
      handler: "code/test.ts",
      route: "/test",
      methods: ["GET", "POST"],
      description: "A test route",
      keys: ["api-key"],
    },
  ];
  const { app, tempDir } = await createTestSetup(routes);

  try {
    const res = await app.request("/run/test");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.message).toBe("Function execution not yet implemented");
    expect(json.route.name).toBe("test-route");
    expect(json.route.handler).toBe("code/test.ts");
    expect(json.route.path).toBe("/test");
    expect(json.route.methods).toEqual(["GET", "POST"]);
    expect(json.route.keys).toEqual(["api-key"]);
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("FunctionRouter placeholder response includes request info", async () => {
  const routes = [
    { name: "users", handler: "code/users.ts", route: "/users/:id", methods: ["GET"] },
  ];
  const { app, tempDir } = await createTestSetup(routes);

  try {
    const res = await app.request("/run/users/456");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.request.method).toBe("GET");
    expect(json.request.path).toBe("/users/456");
    expect(json.request.params.id).toBe("456");
  } finally {
    await cleanup(tempDir);
  }
});

// Multiple routes tests
Deno.test("FunctionRouter handles multiple routes", async () => {
  const routes = [
    { name: "hello", handler: "code/hello.ts", route: "/hello", methods: ["GET"] },
    { name: "users-list", handler: "code/users.ts", route: "/users", methods: ["GET"] },
    { name: "users-create", handler: "code/users.ts", route: "/users", methods: ["POST"] },
    { name: "user-detail", handler: "code/users.ts", route: "/users/:id", methods: ["GET", "PUT", "DELETE"] },
  ];
  const { app, tempDir } = await createTestSetup(routes);

  try {
    // Test different routes
    const helloRes = await app.request("/run/hello");
    expect(helloRes.status).toBe(200);
    expect((await helloRes.json()).route.name).toBe("hello");

    const usersListRes = await app.request("/run/users");
    expect(usersListRes.status).toBe(200);
    expect((await usersListRes.json()).route.name).toBe("users-list");

    const usersCreateRes = await app.request("/run/users", { method: "POST" });
    expect(usersCreateRes.status).toBe(200);
    expect((await usersCreateRes.json()).route.name).toBe("users-create");

    const userDetailRes = await app.request("/run/users/123");
    expect(userDetailRes.status).toBe(200);
    expect((await userDetailRes.json()).route.name).toBe("user-detail");

    const userUpdateRes = await app.request("/run/users/123", { method: "PUT" });
    expect(userUpdateRes.status).toBe(200);
    expect((await userUpdateRes.json()).route.name).toBe("user-detail");
  } finally {
    await cleanup(tempDir);
  }
});
