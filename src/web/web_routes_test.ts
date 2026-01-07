import { expect } from "@std/expect";
import { Hono } from "@hono/hono";
import { createWebRoutes } from "./web_routes.ts";
import { DatabaseService } from "../database/database_service.ts";
import { ApiKeyService } from "../keys/api_key_service.ts";
import { RoutesService } from "../routes/routes_service.ts";
import { FileService } from "../files/file_service.ts";
import { ConsoleLogService } from "../logs/console_log_service.ts";
import { ExecutionMetricsService } from "../metrics/execution_metrics_service.ts";
import { EncryptionService } from "../encryption/encryption_service.ts";
import { HashService } from "../encryption/hash_service.ts";
import { SettingsService } from "../settings/settings_service.ts";
import { UserService } from "../users/user_service.ts";
import type { Auth } from "../auth/auth.ts";

// Test encryption key (32 bytes base64-encoded)
const TEST_ENCRYPTION_KEY = "YzJhNGY2ZDhiMWU3YzNhOGYyZDZiNGU4YzFhN2YzZDk=";
// Test hash key (32 bytes base64-encoded)
const TEST_HASH_KEY = "aGFzaGtleWhhc2hrZXloYXNoa2V5aGFzaGtleWhhc2g=";

/**
 * Creates a mock Auth object for testing.
 * The mock always returns a valid session for authenticated tests.
 */
function createMockAuth(options: { authenticated: boolean } = { authenticated: true }): Auth {
  return {
    api: {
      getSession: () => {
        if (options.authenticated) {
          return {
            user: { id: "test-user", email: "test@example.com", name: "Test User", emailVerified: true },
            session: { id: "test-session", token: "test-token", userId: "test-user", expiresAt: new Date(Date.now() + 86400000) },
          };
        }
        return null;
      },
      signOut: async () => {},
    },
    handler: () => new Response("OK"),
  } as unknown as Auth;
}

const API_KEYS_SCHEMA = `
  CREATE TABLE apiKeyGroups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE apiKeys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    groupId INTEGER NOT NULL REFERENCES apiKeyGroups(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    value TEXT NOT NULL,
    valueHash TEXT,
    description TEXT,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
    updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE UNIQUE INDEX idx_api_keys_group_name ON apiKeys(groupId, name);
  CREATE INDEX idx_api_keys_group ON apiKeys(groupId);
  CREATE INDEX idx_api_keys_hash ON apiKeys(groupId, valueHash);
`;

const ROUTES_SCHEMA = `
  CREATE TABLE routes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    handler TEXT NOT NULL,
    route TEXT NOT NULL,
    methods TEXT NOT NULL,
    keys TEXT,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX idx_routes_route ON routes(route);
`;

const EXECUTION_LOGS_SCHEMA = `
  CREATE TABLE executionLogs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requestId TEXT NOT NULL,
    routeId INTEGER,
    level TEXT NOT NULL,
    message TEXT NOT NULL,
    args TEXT,
    timestamp TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX idx_executionLogs_requestId ON executionLogs(requestId);
  CREATE INDEX idx_executionLogs_routeId ON executionLogs(routeId, id);
`;

const EXECUTION_METRICS_SCHEMA = `
  CREATE TABLE executionMetrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    routeId INTEGER NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('execution', 'minute', 'hour', 'day')),
    avgTimeMs REAL NOT NULL,
    maxTimeMs INTEGER NOT NULL,
    executionCount INTEGER NOT NULL DEFAULT 1,
    timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX idx_executionMetrics_routeId ON executionMetrics(routeId);
  CREATE INDEX idx_executionMetrics_type_route_timestamp ON executionMetrics(type, routeId, timestamp);
  CREATE INDEX idx_executionMetrics_timestamp ON executionMetrics(timestamp);
`;

const SETTINGS_SCHEMA = `
  CREATE TABLE settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    userId TEXT,
    value TEXT,
    isEncrypted INTEGER NOT NULL DEFAULT 0,
    updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE UNIQUE INDEX idx_settings_name_user ON settings(name, COALESCE(userId, ''));
  CREATE INDEX idx_settings_name ON settings(name);
`;

interface TestRoute {
  name: string;
  handler: string;
  route: string;
  methods: string[];
  description?: string;
  keys?: string[];
}

interface TestContext {
  app: Hono;
  tempDir: string;
  db: DatabaseService;
  apiKeyService: ApiKeyService;
  routesService: RoutesService;
  fileService: FileService;
  consoleLogService: ConsoleLogService;
  executionMetricsService: ExecutionMetricsService;
  settingsService: SettingsService;
}

interface CreateTestAppOptions {
  initialRoutes?: TestRoute[];
  authenticated?: boolean;
}

async function createTestApp(
  options: CreateTestAppOptions = {}
): Promise<TestContext> {
  const { initialRoutes = [], authenticated = true } = options;
  const tempDir = await Deno.makeTempDir();
  const codePath = `${tempDir}/code`;

  // Set up database
  const db = new DatabaseService({ databasePath: `${tempDir}/test.db` });
  await db.open();
  await db.exec(API_KEYS_SCHEMA);
  await db.exec(ROUTES_SCHEMA);
  await db.exec(EXECUTION_LOGS_SCHEMA);
  await db.exec(EXECUTION_METRICS_SCHEMA);
  await db.exec(SETTINGS_SCHEMA);

  await Deno.mkdir(codePath);

  const encryptionService = new EncryptionService({
    encryptionKey: TEST_ENCRYPTION_KEY,
  });
  const hashService = new HashService({
    hashKey: TEST_HASH_KEY,
  });
  const apiKeyService = new ApiKeyService({ db, encryptionService, hashService });

  // Add default management key via service (which handles group creation)
  await apiKeyService.addKey("management", "test-key", "testkey123", "admin");
  const routesService = new RoutesService({ db });
  const fileService = new FileService({ basePath: codePath });
  const settingsService = new SettingsService({ db, encryptionService });
  await settingsService.bootstrapGlobalSettings();
  const consoleLogService = new ConsoleLogService({ db, settingsService });
  const executionMetricsService = new ExecutionMetricsService({ db });

  // Add initial routes
  for (const route of initialRoutes) {
    await routesService.addRoute(route);
  }

  const app = new Hono();
  const auth = createMockAuth({ authenticated });
  const userService = new UserService({ db, auth });
  app.route(
    "/web",
    createWebRoutes({ auth, db, userService, fileService, routesService, apiKeyService, consoleLogService, executionMetricsService, encryptionService, settingsService })
  );

  return { app, tempDir, db, apiKeyService, routesService, fileService, consoleLogService, executionMetricsService, settingsService };
}

async function cleanup(db: DatabaseService, tempDir: string) {
  await db.close();
  await Deno.remove(tempDir, { recursive: true });
}

// Authentication tests
Deno.test("GET /web redirects to login without session", async () => {
  const { app, db, tempDir } = await createTestApp({ authenticated: false });
  try {
    const res = await app.request("/web");
    expect(res.status).toBe(302);
    const location = res.headers.get("Location");
    // Middleware redirects to login with callbackUrl
    expect(location?.startsWith("/web/login")).toBe(true);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("GET /web returns 200 with valid session", async () => {
  const { app, db, tempDir } = await createTestApp({ authenticated: true });
  try {
    const res = await app.request("/web");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Dashboard");
  } finally {
    await cleanup(db, tempDir);
  }
});

// Dashboard tests
Deno.test("Dashboard contains links to all sections", async () => {
  const { app, db, tempDir } = await createTestApp();
  try {
    const res = await app.request("/web");
    const html = await res.text();
    expect(html).toContain('href="/web/code"');
    expect(html).toContain('href="/web/functions"');
    expect(html).toContain('href="/web/keys"');
  } finally {
    await cleanup(db, tempDir);
  }
});

// Code pages tests
Deno.test("GET /web/code lists files", async () => {
  const { app, db, tempDir, fileService } = await createTestApp();
  try {
    await fileService.writeFile("test.ts", "console.log('test');");

    const res = await app.request("/web/code");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("test.ts");
    expect(html).toContain("Upload New File");
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("GET /web/code/edit shows file content", async () => {
  const { app, db, tempDir, fileService } = await createTestApp();
  try {
    await fileService.writeFile("hello.ts", "export default () => 'hello';");

    const res = await app.request("/web/code/edit?path=hello.ts");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("export default () =&gt; &#039;hello&#039;;");
    expect(html).toContain("hello.ts");
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("POST /web/code/edit saves file and redirects", async () => {
  const { app, db, tempDir, fileService } = await createTestApp();
  try {
    await fileService.writeFile("test.ts", "old content");

    const formData = new FormData();
    formData.append("content", "new content");

    const res = await app.request("/web/code/edit?path=test.ts", {
      method: "POST",
      body: formData,
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/web/code?success=");

    const content = await fileService.getFile("test.ts");
    expect(content).toBe("new content");
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("GET /web/code/upload shows form", async () => {
  const { app, db, tempDir } = await createTestApp();
  try {
    const res = await app.request("/web/code/upload");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Upload New File");
    expect(html).toContain('name="path"');
    expect(html).toContain('name="content"');
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("POST /web/code/upload creates file", async () => {
  const { app, db, tempDir, fileService } = await createTestApp();
  try {
    const formData = new FormData();
    formData.append("path", "new-file.ts");
    formData.append("content", "export default 'new';");

    const res = await app.request("/web/code/upload", {
      method: "POST",
      body: formData,
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/web/code?success=");

    const content = await fileService.getFile("new-file.ts");
    expect(content).toBe("export default 'new';");
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("POST /web/code/delete removes file", async () => {
  const { app, db, tempDir, fileService } = await createTestApp();
  try {
    await fileService.writeFile("delete-me.ts", "content");

    const res = await app.request("/web/code/delete?path=delete-me.ts", {
      method: "POST",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/web/code?success=");

    const exists = await fileService.fileExists("delete-me.ts");
    expect(exists).toBe(false);
  } finally {
    await cleanup(db, tempDir);
  }
});

// Functions pages tests
Deno.test("GET /web/functions lists functions", async () => {
  const initialRoutes = [
    {
      name: "test-fn",
      handler: "test.ts",
      route: "/test",
      methods: ["GET"],
      description: "Test function",
    },
  ];
  const { app, db, tempDir } = await createTestApp({ initialRoutes });
  try {
    const res = await app.request("/web/functions");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("test-fn");
    expect(html).toContain("/test");
    expect(html).toContain("GET");
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("GET /web/functions/create shows form", async () => {
  const { app, db, tempDir } = await createTestApp();
  try {
    const res = await app.request("/web/functions/create");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Create Function");
    expect(html).toContain('name="name"');
    expect(html).toContain('name="handler"');
    expect(html).toContain('name="route"');
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("POST /web/functions/create creates function", async () => {
  const { app, db, tempDir, routesService } = await createTestApp();
  try {
    const formData = new FormData();
    formData.append("name", "new-fn");
    formData.append("handler", "handler.ts");
    formData.append("route", "/api/new");
    formData.append("methods", "GET");
    formData.append("methods", "POST");

    const res = await app.request("/web/functions/create", {
      method: "POST",
      body: formData,
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/web/functions?success=");

    const fn = await routesService.getByName("new-fn");
    expect(fn).not.toBeNull();
    expect(fn!.route).toBe("/api/new");
    expect(fn!.methods).toContain("GET");
    expect(fn!.methods).toContain("POST");
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("POST /web/functions/delete/:id removes function", async () => {
  const initialRoutes = [
    { name: "to-delete", handler: "t.ts", route: "/del", methods: ["GET"] },
  ];
  const { app, db, tempDir, routesService } = await createTestApp({ initialRoutes });
  try {
    const route = await routesService.getByName("to-delete");

    const res = await app.request(`/web/functions/delete/${route!.id}`, {
      method: "POST",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/web/functions?success=");

    const fn = await routesService.getById(route!.id);
    expect(fn).toBeNull();
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("GET /web/functions/edit/:id shows edit form", async () => {
  const initialRoutes = [
    { name: "test-fn", handler: "test.ts", route: "/test", methods: ["GET"], description: "Test" },
  ];
  const { app, db, tempDir, routesService } = await createTestApp({ initialRoutes });
  try {
    const route = await routesService.getByName("test-fn");

    const res = await app.request(`/web/functions/edit/${route!.id}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Edit");
    expect(html).toContain("test-fn");
    // Name field should now be editable (not readonly)
    expect(html).not.toContain("readonly");
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("POST /web/functions/edit/:id updates function and allows name change", async () => {
  const initialRoutes = [
    { name: "old-name", handler: "old.ts", route: "/old", methods: ["GET"] },
  ];
  const { app, db, tempDir, routesService } = await createTestApp({ initialRoutes });
  try {
    const route = await routesService.getByName("old-name");
    const originalId = route!.id;

    const formData = new FormData();
    formData.append("name", "new-name");
    formData.append("handler", "new.ts");
    formData.append("route", "/new");
    formData.append("methods", "POST");

    const res = await app.request(`/web/functions/edit/${originalId}`, {
      method: "POST",
      body: formData,
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/web/functions?success=");

    // Verify ID preserved
    const updated = await routesService.getById(originalId);
    expect(updated?.name).toBe("new-name");
    expect(updated?.handler).toBe("new.ts");
    expect(updated?.route).toBe("/new");
    expect(updated?.methods).toContain("POST");

    // Old name should not exist
    const oldName = await routesService.getByName("old-name");
    expect(oldName).toBeNull();
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("GET /web/functions/edit/:id returns error for invalid ID", async () => {
  const { app, db, tempDir } = await createTestApp();
  try {
    const res = await app.request("/web/functions/edit/invalid");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("error=");
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("GET /web/functions/edit/:id returns error for non-existent ID", async () => {
  const { app, db, tempDir } = await createTestApp();
  try {
    const res = await app.request("/web/functions/edit/999");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("error=");
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("GET /web/functions/delete/:id shows confirmation", async () => {
  const initialRoutes = [
    { name: "to-delete", handler: "t.ts", route: "/del", methods: ["GET"] },
  ];
  const { app, db, tempDir, routesService } = await createTestApp({ initialRoutes });
  try {
    const route = await routesService.getByName("to-delete");

    const res = await app.request(`/web/functions/delete/${route!.id}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Delete Function");
    expect(html).toContain("to-delete");
  } finally {
    await cleanup(db, tempDir);
  }
});

// Keys pages tests
Deno.test("GET /web/keys lists keys grouped by group", async () => {
  const { app, db, tempDir, apiKeyService } = await createTestApp();
  try {
    // Add additional key
    await apiKeyService.addKey("api", "key-1", "key1", "user");

    const res = await app.request("/web/keys");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("management");
    expect(html).toContain("testkey123");
    expect(html).toContain("api");
    expect(html).toContain("key1");
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("GET /web/keys/create shows form", async () => {
  const { app, db, tempDir } = await createTestApp();
  try {
    const res = await app.request("/web/keys/create");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Create API Key");
    expect(html).toContain('name="group"');
    expect(html).toContain('name="value"');
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("GET /web/keys/create with group param prefills form", async () => {
  const { app, db, tempDir } = await createTestApp();
  try {
    const res = await app.request("/web/keys/create?group=mykey");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('value="mykey"');
    expect(html).toContain("readonly");
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("POST /web/keys/create creates key", async () => {
  const { app, db, tempDir, apiKeyService } = await createTestApp();
  try {
    const formData = new FormData();
    formData.append("group", "newkey");
    formData.append("name", "newkey-name");
    formData.append("value", "newvalue123");
    formData.append("description", "test description");

    const res = await app.request("/web/keys/create", {
      method: "POST",
      body: formData,
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/web/keys?success=");

    const keys = await apiKeyService.getKeys("newkey");
    expect(keys).not.toBeNull();
    expect(keys!.some((k) => k.value === "newvalue123")).toBe(true);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("POST /web/keys/delete removes key by ID", async () => {
  const { app, db, tempDir, apiKeyService } = await createTestApp();
  try {
    await apiKeyService.addKey("mykey", "key-1", "val1");
    await apiKeyService.addKey("mykey", "key-2", "val2");

    const keys = await apiKeyService.getKeys("mykey");
    const val1Key = keys!.find((k) => k.value === "val1")!;

    const res = await app.request(`/web/keys/delete?id=${val1Key.id}`, {
      method: "POST",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/web/keys?success=");

    const updatedKeys = await apiKeyService.getKeys("mykey");
    expect(updatedKeys).not.toBeNull();
    expect(updatedKeys!.some((k) => k.value === "val1")).toBe(false);
    expect(updatedKeys!.some((k) => k.value === "val2")).toBe(true);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("POST /web/keys/delete-group removes all keys for group", async () => {
  const { app, db, tempDir, apiKeyService } = await createTestApp();
  try {
    await apiKeyService.addKey("toremove", "key-1", "val1");
    await apiKeyService.addKey("toremove", "key-2", "val2");

    const res = await app.request("/web/keys/delete-group?group=toremove", {
      method: "POST",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/web/keys?success=");

    const keys = await apiKeyService.getKeys("toremove");
    expect(keys).toBeNull();
  } finally {
    await cleanup(db, tempDir);
  }
});

// Error handling tests
Deno.test("GET /web/code/edit without path redirects with error", async () => {
  const { app, db, tempDir } = await createTestApp();
  try {
    const res = await app.request("/web/code/edit");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("error=");
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("POST /web/code/upload rejects path traversal", async () => {
  const { app, db, tempDir } = await createTestApp();
  try {
    const formData = new FormData();
    formData.append("path", "../escape.ts");
    formData.append("content", "evil code");

    const res = await app.request("/web/code/upload", {
      method: "POST",
      body: formData,
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("error=");
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("POST /web/keys/create rejects invalid key group", async () => {
  const { app, db, tempDir } = await createTestApp();
  try {
    const formData = new FormData();
    formData.append("group", "Invalid Group!");
    formData.append("value", "validvalue");

    const res = await app.request("/web/keys/create", {
      method: "POST",
      body: formData,
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("error=");
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("GET /web/keys/delete-group blocks deleting all management keys", async () => {
  const { app, db, tempDir } = await createTestApp();
  try {
    const res = await app.request("/web/keys/delete-group?group=management");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("error=");
  } finally {
    await cleanup(db, tempDir);
  }
});

// Metrics pages tests
Deno.test("GET /web/functions/metrics/:id shows metrics page", async () => {
  const initialRoutes = [
    { name: "test-fn", handler: "test.ts", route: "/test", methods: ["GET"] },
  ];
  const { app, db, tempDir, routesService } = await createTestApp({ initialRoutes });
  try {
    const route = await routesService.getByName("test-fn");

    const res = await app.request(`/web/functions/metrics/${route!.id}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Metrics: test-fn");
    expect(html).toContain("Last Hour");
    expect(html).toContain("Last 24 Hours");
    expect(html).toContain("metrics-tabs"); // Mode switching tabs
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("GET /web/functions/metrics/:id with mode=day shows day view", async () => {
  const initialRoutes = [
    { name: "test-fn", handler: "test.ts", route: "/test", methods: ["GET"] },
  ];
  const { app, db, tempDir, routesService } = await createTestApp({ initialRoutes });
  try {
    const route = await routesService.getByName("test-fn");

    const res = await app.request(`/web/functions/metrics/${route!.id}?mode=day`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Last 24 Hours");
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("GET /web/functions/metrics/:id shows no data message for new function", async () => {
  const initialRoutes = [
    { name: "test-fn", handler: "test.ts", route: "/test", methods: ["GET"] },
  ];
  const { app, db, tempDir, routesService } = await createTestApp({ initialRoutes });
  try {
    const route = await routesService.getByName("test-fn");

    const res = await app.request(`/web/functions/metrics/${route!.id}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("No metrics recorded");
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("GET /web/functions/metrics/:id with data shows charts", async () => {
  const initialRoutes = [
    { name: "test-fn", handler: "test.ts", route: "/test", methods: ["GET"] },
  ];
  const { app, db, tempDir, routesService, executionMetricsService } = await createTestApp({ initialRoutes });
  try {
    const route = await routesService.getByName("test-fn");

    // Add some minute-level metrics
    const now = new Date();
    for (let i = 0; i < 5; i++) {
      const timestamp = new Date(now.getTime() - i * 60 * 1000);
      timestamp.setUTCSeconds(0, 0);
      await executionMetricsService.store({
        routeId: route!.id,
        type: "minute",
        avgTimeMs: 100 + i * 10,
        maxTimeMs: 150 + i * 10,
        executionCount: 5 + i,
        timestamp,
      });
    }

    const res = await app.request(`/web/functions/metrics/${route!.id}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("executionTimeChart");
    expect(html).toContain("requestCountChart");
    expect(html).toContain("Avg Execution Time");
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("GET /web/functions/metrics/:id returns error for invalid ID", async () => {
  const { app, db, tempDir } = await createTestApp();
  try {
    const res = await app.request("/web/functions/metrics/invalid");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("error=");
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("GET /web/functions/metrics/:id returns error for non-existent ID", async () => {
  const { app, db, tempDir } = await createTestApp();
  try {
    const res = await app.request("/web/functions/metrics/999");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("error=");
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("Functions list includes Metrics link", async () => {
  const initialRoutes = [
    { name: "test-fn", handler: "test.ts", route: "/test", methods: ["GET"] },
  ];
  const { app, db, tempDir } = await createTestApp({ initialRoutes });
  try {
    const res = await app.request("/web/functions");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("/web/functions/metrics/");
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("GET /web/functions/metrics/:id shows current period from raw execution data", async () => {
  const initialRoutes = [
    { name: "test-fn", handler: "test.ts", route: "/test", methods: ["GET"] },
  ];
  const { app, db, tempDir, routesService, executionMetricsService } = await createTestApp({ initialRoutes });
  try {
    const route = await routesService.getByName("test-fn");

    // Add raw execution records (not yet aggregated into minute records)
    const now = new Date();
    await executionMetricsService.store({
      routeId: route!.id,
      type: "execution",
      avgTimeMs: 50,
      maxTimeMs: 50,
      executionCount: 1,
      timestamp: now,
    });
    await executionMetricsService.store({
      routeId: route!.id,
      type: "execution",
      avgTimeMs: 100,
      maxTimeMs: 100,
      executionCount: 1,
      timestamp: now,
    });

    // Metrics page should show data even without aggregation running
    const res = await app.request(`/web/functions/metrics/${route!.id}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    // Should show charts because we have execution data
    expect(html).toContain("executionTimeChart");
    expect(html).toContain("requestCountChart");
    // Should NOT show "no data" message
    expect(html).not.toContain("No metrics recorded");
  } finally {
    await cleanup(db, tempDir);
  }
});
