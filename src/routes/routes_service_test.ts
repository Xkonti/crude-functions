import { expect } from "@std/expect";
import {
  parseRoutesFile,
  serializeRoutesFile,
  validateRouteName,
  validateRoutePath,
  validateMethods,
  hasDuplicateRouteMethod,
  type FunctionRoute,
} from "./routes_service.ts";

// Parsing tests
Deno.test("parseRoutesFile returns empty array for empty string", () => {
  const result = parseRoutesFile("");
  expect(result).toEqual([]);
});

Deno.test("parseRoutesFile returns empty array for empty JSON array", () => {
  const result = parseRoutesFile("[]");
  expect(result).toEqual([]);
});

Deno.test("parseRoutesFile parses valid routes", () => {
  const json = JSON.stringify([
    {
      name: "hello",
      handler: "code/hello.ts",
      route: "/hello",
      methods: ["GET"],
    },
  ]);

  const result = parseRoutesFile(json);
  expect(result.length).toBe(1);
  expect(result[0].name).toBe("hello");
  expect(result[0].handler).toBe("code/hello.ts");
  expect(result[0].route).toBe("/hello");
  expect(result[0].methods).toEqual(["GET"]);
});

Deno.test("parseRoutesFile handles optional fields", () => {
  const json = JSON.stringify([
    {
      name: "hello",
      handler: "code/hello.ts",
      route: "/hello",
      methods: ["GET"],
      description: "A greeting endpoint",
      keys: ["api-key"],
    },
  ]);

  const result = parseRoutesFile(json);
  expect(result[0].description).toBe("A greeting endpoint");
  expect(result[0].keys).toEqual(["api-key"]);
});

Deno.test("parseRoutesFile throws on invalid JSON", () => {
  expect(() => parseRoutesFile("not valid json")).toThrow();
});

Deno.test("parseRoutesFile throws on non-array JSON", () => {
  expect(() => parseRoutesFile('{"name": "test"}')).toThrow();
});

// Serialization tests
Deno.test("serializeRoutesFile produces valid JSON", () => {
  const routes: FunctionRoute[] = [
    {
      name: "hello",
      handler: "code/hello.ts",
      route: "/hello",
      methods: ["GET"],
    },
  ];

  const result = serializeRoutesFile(routes);
  const parsed = JSON.parse(result);
  expect(parsed.length).toBe(1);
  expect(parsed[0].name).toBe("hello");
});

Deno.test("serializeRoutesFile preserves optional fields", () => {
  const routes: FunctionRoute[] = [
    {
      name: "hello",
      handler: "code/hello.ts",
      route: "/hello",
      methods: ["GET"],
      description: "A greeting",
      keys: ["test-key"],
    },
  ];

  const result = serializeRoutesFile(routes);
  const parsed = JSON.parse(result);
  expect(parsed[0].description).toBe("A greeting");
  expect(parsed[0].keys).toEqual(["test-key"]);
});

Deno.test("serializeRoutesFile roundtrips with parseRoutesFile", () => {
  const original: FunctionRoute[] = [
    {
      name: "hello",
      handler: "code/hello.ts",
      route: "/hello",
      methods: ["GET", "POST"],
      description: "Test",
    },
    {
      name: "users",
      handler: "code/users.ts",
      route: "/users",
      methods: ["GET"],
      keys: ["user-api"],
    },
  ];

  const serialized = serializeRoutesFile(original);
  const reparsed = parseRoutesFile(serialized);
  expect(reparsed).toEqual(original);
});

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

// Duplicate detection tests
Deno.test("hasDuplicateRouteMethod detects conflict", () => {
  const routes: FunctionRoute[] = [
    { name: "a", handler: "a.ts", route: "/users", methods: ["GET", "POST"] },
  ];

  expect(hasDuplicateRouteMethod(routes, "/users", "GET")).toBe(true);
  expect(hasDuplicateRouteMethod(routes, "/users", "POST")).toBe(true);
  expect(hasDuplicateRouteMethod(routes, "/users", "DELETE")).toBe(false);
  expect(hasDuplicateRouteMethod(routes, "/other", "GET")).toBe(false);
});

Deno.test("hasDuplicateRouteMethod handles empty routes", () => {
  expect(hasDuplicateRouteMethod([], "/users", "GET")).toBe(false);
});

// RoutesService tests
import { RoutesService } from "./routes_service.ts";

Deno.test("RoutesService creates empty file if missing", async () => {
  const tempDir = await Deno.makeTempDir();
  const configPath = `${tempDir}/routes.json`;

  try {
    const service = new RoutesService({ configPath });
    const routes = await service.getAll();

    expect(routes).toEqual([]);
    // File should now exist
    const stat = await Deno.stat(configPath);
    expect(stat.isFile).toBe(true);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("RoutesService.getAll returns routes from file", async () => {
  const tempDir = await Deno.makeTempDir();
  const configPath = `${tempDir}/routes.json`;

  try {
    const routes = [
      { name: "hello", handler: "hello.ts", route: "/hello", methods: ["GET"] },
    ];
    await Deno.writeTextFile(configPath, JSON.stringify(routes));

    const service = new RoutesService({ configPath });
    const result = await service.getAll();

    expect(result.length).toBe(1);
    expect(result[0].name).toBe("hello");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("RoutesService.getByName returns route or null", async () => {
  const tempDir = await Deno.makeTempDir();
  const configPath = `${tempDir}/routes.json`;

  try {
    const routes = [
      { name: "hello", handler: "hello.ts", route: "/hello", methods: ["GET"] },
      { name: "users", handler: "users.ts", route: "/users", methods: ["GET"] },
    ];
    await Deno.writeTextFile(configPath, JSON.stringify(routes));

    const service = new RoutesService({ configPath });

    const hello = await service.getByName("hello");
    expect(hello?.name).toBe("hello");

    const notFound = await service.getByName("nonexistent");
    expect(notFound).toBe(null);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("RoutesService.addRoute adds new route", async () => {
  const tempDir = await Deno.makeTempDir();
  const configPath = `${tempDir}/routes.json`;

  try {
    await Deno.writeTextFile(configPath, "[]");

    const service = new RoutesService({ configPath });
    await service.addRoute({
      name: "new-route",
      handler: "new.ts",
      route: "/new",
      methods: ["POST"],
      description: "A new route",
    });

    const routes = await service.getAll();
    expect(routes.length).toBe(1);
    expect(routes[0].name).toBe("new-route");

    // Verify file was updated
    const content = await Deno.readTextFile(configPath);
    expect(content).toContain("new-route");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("RoutesService.addRoute throws on duplicate name", async () => {
  const tempDir = await Deno.makeTempDir();
  const configPath = `${tempDir}/routes.json`;

  try {
    const routes = [
      { name: "hello", handler: "hello.ts", route: "/hello", methods: ["GET"] },
    ];
    await Deno.writeTextFile(configPath, JSON.stringify(routes));

    const service = new RoutesService({ configPath });

    await expect(
      service.addRoute({
        name: "hello", // duplicate name
        handler: "other.ts",
        route: "/other",
        methods: ["POST"],
      })
    ).rejects.toThrow();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("RoutesService.addRoute throws on duplicate route+method", async () => {
  const tempDir = await Deno.makeTempDir();
  const configPath = `${tempDir}/routes.json`;

  try {
    const routes = [
      { name: "hello", handler: "hello.ts", route: "/users", methods: ["GET", "POST"] },
    ];
    await Deno.writeTextFile(configPath, JSON.stringify(routes));

    const service = new RoutesService({ configPath });

    await expect(
      service.addRoute({
        name: "different-name",
        handler: "other.ts",
        route: "/users", // same route
        methods: ["GET"], // conflicting method
      })
    ).rejects.toThrow();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("RoutesService.removeRoute removes by name", async () => {
  const tempDir = await Deno.makeTempDir();
  const configPath = `${tempDir}/routes.json`;

  try {
    const routes = [
      { name: "hello", handler: "hello.ts", route: "/hello", methods: ["GET"] },
      { name: "users", handler: "users.ts", route: "/users", methods: ["GET"] },
    ];
    await Deno.writeTextFile(configPath, JSON.stringify(routes));

    const service = new RoutesService({ configPath });
    await service.removeRoute("hello");

    const result = await service.getAll();
    expect(result.length).toBe(1);
    expect(result[0].name).toBe("users");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("RoutesService.removeRoute is no-op for non-existent name", async () => {
  const tempDir = await Deno.makeTempDir();
  const configPath = `${tempDir}/routes.json`;

  try {
    const routes = [
      { name: "hello", handler: "hello.ts", route: "/hello", methods: ["GET"] },
    ];
    await Deno.writeTextFile(configPath, JSON.stringify(routes));

    const service = new RoutesService({ configPath });
    await service.removeRoute("nonexistent");

    const result = await service.getAll();
    expect(result.length).toBe(1);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// loadIfChanged tests
Deno.test("RoutesService.loadIfChanged returns routes on first call", async () => {
  const tempDir = await Deno.makeTempDir();
  const configPath = `${tempDir}/routes.json`;

  try {
    const routes = [
      { name: "hello", handler: "hello.ts", route: "/hello", methods: ["GET"] },
    ];
    await Deno.writeTextFile(configPath, JSON.stringify(routes));

    const service = new RoutesService({ configPath, refreshInterval: 50 });
    const result = await service.loadIfChanged();

    expect(result).not.toBe(null);
    expect(result!.length).toBe(1);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("RoutesService.loadIfChanged returns null if unchanged", async () => {
  const tempDir = await Deno.makeTempDir();
  const configPath = `${tempDir}/routes.json`;

  try {
    const routes = [
      { name: "hello", handler: "hello.ts", route: "/hello", methods: ["GET"] },
    ];
    await Deno.writeTextFile(configPath, JSON.stringify(routes));

    const service = new RoutesService({ configPath, refreshInterval: 50 });

    // First call returns routes
    const first = await service.loadIfChanged();
    expect(first).not.toBe(null);

    // Second call within interval returns null
    const second = await service.loadIfChanged();
    expect(second).toBe(null);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("RoutesService.loadIfChanged returns routes after external modification", async () => {
  const tempDir = await Deno.makeTempDir();
  const configPath = `${tempDir}/routes.json`;

  try {
    const routes = [
      { name: "hello", handler: "hello.ts", route: "/hello", methods: ["GET"] },
    ];
    await Deno.writeTextFile(configPath, JSON.stringify(routes));

    const service = new RoutesService({ configPath, refreshInterval: 50 });

    // First call
    await service.loadIfChanged();

    // Wait for refresh interval
    await new Promise((resolve) => setTimeout(resolve, 60));

    // Modify file externally
    const newRoutes = [
      { name: "modified", handler: "mod.ts", route: "/mod", methods: ["POST"] },
    ];
    await Deno.writeTextFile(configPath, JSON.stringify(newRoutes));

    // Should detect change
    const result = await service.loadIfChanged();
    expect(result).not.toBe(null);
    expect(result![0].name).toBe("modified");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("RoutesService.loadIfChanged returns null after internal write", async () => {
  const tempDir = await Deno.makeTempDir();
  const configPath = `${tempDir}/routes.json`;

  try {
    await Deno.writeTextFile(configPath, "[]");

    const service = new RoutesService({ configPath, refreshInterval: 50 });

    // First call
    await service.loadIfChanged();

    // Wait for refresh interval
    await new Promise((resolve) => setTimeout(resolve, 60));

    // Internal write
    await service.addRoute({
      name: "new",
      handler: "new.ts",
      route: "/new",
      methods: ["GET"],
    });

    // Should return null (internal write refreshes watcher)
    const result = await service.loadIfChanged();
    expect(result).toBe(null);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
