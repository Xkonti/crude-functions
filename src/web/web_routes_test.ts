import { expect } from "@std/expect";
import { Hono } from "@hono/hono";
import { createWebRoutes } from "./web_routes.ts";
import { DatabaseService } from "../database/database_service.ts";
import { ApiKeyService } from "../keys/api_key_service.ts";
import { RoutesService } from "../routes/routes_service.ts";
import { ConsoleLogService } from "../logs/console_log_service.ts";
import { ExecutionMetricsService } from "../metrics/execution_metrics_service.ts";
import { EncryptionService } from "../encryption/encryption_service.ts";
import { HashService } from "../encryption/hash_service.ts";
import { SettingsService } from "../settings/settings_service.ts";
import { UserService } from "../users/user_service.ts";
import { SharedSurrealManager, type SharedSurrealTestContext } from "../test/shared_surreal_manager.ts";
import { SurrealMigrationService } from "../database/surreal_migration_service.ts";
import { recordIdToString } from "../database/surreal_helpers.ts";
import type { Auth } from "../auth/auth.ts";
import type { CodeSourceService } from "../sources/code_source_service.ts";
import type { SourceFileService } from "../files/source_file_service.ts";
import type { CodeSource } from "../sources/types.ts";

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

/**
 * Creates a mock CodeSourceService for testing.
 * Returns empty sources by default.
 */
function createMockCodeSourceService(): CodeSourceService {
  const sources: CodeSource[] = [];

  return {
    getAll: () => Promise.resolve(sources),
    // ID is now the source name (string)
    getById: (id: string) => Promise.resolve(sources.find((s) => s.id === id) ?? null),
    getByName: (name: string) => Promise.resolve(sources.find((s) => s.name === name) ?? null),
    create: (input: { name: string; type: "manual" | "git"; typeSettings?: object; syncSettings?: object; enabled?: boolean }) => {
      const source: CodeSource = {
        id: input.name, // ID is now the source name
        name: input.name,
        type: input.type,
        typeSettings: input.typeSettings ?? {},
        syncSettings: input.syncSettings ?? {},
        lastSyncStartedAt: null,
        lastSyncAt: null,
        lastSyncError: null,
        enabled: input.enabled ?? true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      sources.push(source);
      return Promise.resolve(source);
    },
    // ID is now the source name (string)
    update: (id: string, updates: { typeSettings?: object; syncSettings?: object; enabled?: boolean }) => {
      const source = sources.find((s) => s.id === id);
      if (!source) return Promise.reject(new Error("Source not found"));
      if (updates.typeSettings !== undefined) source.typeSettings = updates.typeSettings;
      if (updates.syncSettings !== undefined) source.syncSettings = updates.syncSettings;
      if (updates.enabled !== undefined) source.enabled = updates.enabled;
      source.updatedAt = new Date();
      return Promise.resolve(source);
    },
    // ID is now the source name (string)
    delete: (id: string) => {
      const index = sources.findIndex((s) => s.id === id);
      if (index === -1) return Promise.reject(new Error("Source not found"));
      sources.splice(index, 1);
      return Promise.resolve();
    },
    isSyncable: () => Promise.resolve(false),
    isEditable: () => Promise.resolve(true),
    triggerManualSync: () => Promise.resolve(null),
    registerProvider: () => {},
    isValidSourceName: (name: string) => /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(name),
  } as unknown as CodeSourceService;
}

/**
 * Creates a mock SourceFileService for testing.
 * Returns empty file lists by default.
 */
function createMockSourceFileService(): SourceFileService {
  return {
    listFiles: () => Promise.resolve([]),
    listFilesWithMetadata: () => Promise.resolve([]),
    getFile: () => Promise.resolve(""),
    writeFile: () => Promise.resolve(),
    deleteFile: () => Promise.resolve(),
    fileExists: () => Promise.resolve(false),
    getFileMetadata: () => Promise.resolve(null),
  } as unknown as SourceFileService;
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
    enabled INTEGER NOT NULL DEFAULT 1,
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
  routePath: string;
  methods: string[];
  description?: string;
  keys?: string[];
}

interface TestContext {
  app: Hono;
  tempDir: string;
  db: DatabaseService;
  surrealTestContext: SharedSurrealTestContext;
  apiKeyService: ApiKeyService;
  routesService: RoutesService;
  codeSourceService: CodeSourceService;
  sourceFileService: SourceFileService;
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

  // Set up SQLite database
  const db = new DatabaseService({ databasePath: `${tempDir}/test.db` });
  await db.open();
  await db.exec(API_KEYS_SCHEMA);
  await db.exec(ROUTES_SCHEMA);
  await db.exec(EXECUTION_LOGS_SCHEMA);
  await db.exec(EXECUTION_METRICS_SCHEMA);
  await db.exec(SETTINGS_SCHEMA);

  // Set up SurrealDB for SettingsService
  const surrealManager = SharedSurrealManager.getInstance();
  const surrealTestContext = await surrealManager.createTestContext();
  surrealTestContext.factory.initializePool({ idleTimeoutMs: 30000 });

  // Run SurrealDB migrations
  const surrealMigrationService = new SurrealMigrationService({
    connectionFactory: surrealTestContext.factory,
    migrationsDir: "./migrations",
  });
  await surrealMigrationService.migrate();

  await Deno.mkdir(codePath);

  const encryptionService = new EncryptionService({
    encryptionKey: TEST_ENCRYPTION_KEY,
  });
  const hashService = new HashService({
    hashKey: TEST_HASH_KEY,
  });
  const apiKeyService = new ApiKeyService({ surrealFactory: surrealTestContext.factory, encryptionService, hashService });
  await apiKeyService.bootstrapManagementGroup();

  // Add default management key via service (which handles group creation)
  await apiKeyService.addKey("management", "test-key", "testkey123", "admin");
  const routesService = new RoutesService({ surrealFactory: surrealTestContext.factory });
  const settingsService = new SettingsService({ surrealFactory: surrealTestContext.factory, encryptionService });
  await settingsService.bootstrapGlobalSettings();
  const consoleLogService = new ConsoleLogService({ surrealFactory: surrealTestContext.factory, settingsService });
  const executionMetricsService = new ExecutionMetricsService({ surrealFactory: surrealTestContext.factory });

  // Create mock code source service (returns empty sources by default)
  const codeSourceService = createMockCodeSourceService();

  // Create mock source file service
  const sourceFileService = createMockSourceFileService();

  // Add initial routes
  for (const route of initialRoutes) {
    await routesService.addRoute(route);
  }

  const app = new Hono();
  const auth = createMockAuth({ authenticated });
  const userService = new UserService({ surrealFactory: surrealTestContext.factory, auth });
  app.route(
    "/web",
    createWebRoutes({ auth, db, surrealFactory: surrealTestContext.factory, userService, routesService, apiKeyService, consoleLogService, executionMetricsService, encryptionService, settingsService, codeSourceService, sourceFileService })
  );

  return { app, tempDir, db, surrealTestContext, apiKeyService, routesService, codeSourceService, sourceFileService, consoleLogService, executionMetricsService, settingsService };
}

async function cleanup(
  db: DatabaseService,
  tempDir: string,
  surrealTestContext: SharedSurrealTestContext,
  consoleLogService: ConsoleLogService
) {
  // Shutdown console log service first (flush pending logs)
  await consoleLogService.shutdown();

  // Close SurrealDB pool and delete namespace
  await surrealTestContext.factory.closePool();
  const surrealManager = SharedSurrealManager.getInstance();
  await surrealManager.deleteTestContext(surrealTestContext.namespace, surrealTestContext.db);

  // Close SQLite and remove temp directory
  await db.close();
  await Deno.remove(tempDir, { recursive: true });
}

// Authentication tests
Deno.test({ name: "GET /web redirects to login without session", sanitizeResources: false, sanitizeOps: false }, async () => {
  const { app, db, tempDir, surrealTestContext, consoleLogService } = await createTestApp({ authenticated: false });
  try {
    const res = await app.request("/web");
    expect(res.status).toBe(302);
    const location = res.headers.get("Location");
    // Middleware redirects to login with callbackUrl
    expect(location?.startsWith("/web/login")).toBe(true);
  } finally {
    await cleanup(db, tempDir, surrealTestContext, consoleLogService);
  }
});

Deno.test({ name: "GET /web returns 200 with valid session", sanitizeResources: false, sanitizeOps: false }, async () => {
  const { app, db, tempDir, surrealTestContext, consoleLogService } = await createTestApp({ authenticated: true });
  try {
    const res = await app.request("/web");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Dashboard");
  } finally {
    await cleanup(db, tempDir, surrealTestContext, consoleLogService);
  }
});

// Dashboard tests
Deno.test({ name: "Dashboard contains links to all sections", sanitizeResources: false, sanitizeOps: false }, async () => {
  const { app, db, tempDir, surrealTestContext, consoleLogService } = await createTestApp();
  try {
    const res = await app.request("/web");
    const html = await res.text();
    expect(html).toContain('href="/web/code"');
    expect(html).toContain('href="/web/functions"');
    expect(html).toContain('href="/web/keys"');
  } finally {
    await cleanup(db, tempDir, surrealTestContext, consoleLogService);
  }
});

// Code sources pages tests
Deno.test({ name: "GET /web/code lists sources", sanitizeResources: false, sanitizeOps: false }, async () => {
  const { app, db, tempDir, surrealTestContext, consoleLogService } = await createTestApp();
  try {
    const res = await app.request("/web/code");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Code Sources");
    expect(html).toContain("New Code Source");
  } finally {
    await cleanup(db, tempDir, surrealTestContext, consoleLogService);
  }
});

Deno.test({ name: "GET /web/code/sources/new shows type selection", sanitizeResources: false, sanitizeOps: false }, async () => {
  const { app, db, tempDir, surrealTestContext, consoleLogService } = await createTestApp();
  try {
    const res = await app.request("/web/code/sources/new");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("New Code Source");
    expect(html).toContain("Manual Source");
    expect(html).toContain("Git Source");
  } finally {
    await cleanup(db, tempDir, surrealTestContext, consoleLogService);
  }
});

Deno.test({ name: "GET /web/code/sources/new/manual shows manual source form", sanitizeResources: false, sanitizeOps: false }, async () => {
  const { app, db, tempDir, surrealTestContext, consoleLogService } = await createTestApp();
  try {
    const res = await app.request("/web/code/sources/new/manual");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Create Manual Source");
    expect(html).toContain('name="name"');
  } finally {
    await cleanup(db, tempDir, surrealTestContext, consoleLogService);
  }
});

Deno.test({ name: "GET /web/code/sources/new/git shows git source form", sanitizeResources: false, sanitizeOps: false }, async () => {
  const { app, db, tempDir, surrealTestContext, consoleLogService } = await createTestApp();
  try {
    const res = await app.request("/web/code/sources/new/git");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Create Git Source");
    expect(html).toContain('name="name"');
    expect(html).toContain('name="url"');
  } finally {
    await cleanup(db, tempDir, surrealTestContext, consoleLogService);
  }
});

// Functions pages tests
Deno.test({ name: "GET /web/functions lists functions", sanitizeResources: false, sanitizeOps: false }, async () => {
  const initialRoutes = [
    {
      name: "test-fn",
      handler: "test.ts",
      routePath: "/test",
      methods: ["GET"],
      description: "Test function",
    },
  ];
  const { app, db, tempDir, surrealTestContext, consoleLogService } = await createTestApp({ initialRoutes });
  try {
    const res = await app.request("/web/functions");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("test-fn");
    expect(html).toContain("/test");
    expect(html).toContain("GET");
  } finally {
    await cleanup(db, tempDir, surrealTestContext, consoleLogService);
  }
});

Deno.test({ name: "GET /web/functions/create shows form", sanitizeResources: false, sanitizeOps: false }, async () => {
  const { app, db, tempDir, surrealTestContext, consoleLogService } = await createTestApp();
  try {
    const res = await app.request("/web/functions/create");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Create Function");
    expect(html).toContain('name="name"');
    expect(html).toContain('name="handler"');
    expect(html).toContain('name="route"');
  } finally {
    await cleanup(db, tempDir, surrealTestContext, consoleLogService);
  }
});

Deno.test({ name: "POST /web/functions/create creates function", sanitizeResources: false, sanitizeOps: false }, async () => {
  const { app, db, tempDir, surrealTestContext, consoleLogService, routesService } = await createTestApp();
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
    expect(fn!.routePath).toBe("/api/new");
    expect(fn!.methods).toContain("GET");
    expect(fn!.methods).toContain("POST");
  } finally {
    await cleanup(db, tempDir, surrealTestContext, consoleLogService);
  }
});

Deno.test({ name: "POST /web/functions/delete/:id removes function", sanitizeResources: false, sanitizeOps: false }, async () => {
  const initialRoutes = [
    { name: "to-delete", handler: "t.ts", routePath: "/del", methods: ["GET"] },
  ];
  const { app, db, tempDir, surrealTestContext, consoleLogService, routesService } = await createTestApp({ initialRoutes });
  try {
    const route = await routesService.getByName("to-delete");
    const routeId = recordIdToString(route!.id);

    const res = await app.request(`/web/functions/delete/${routeId}`, {
      method: "POST",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/web/functions?success=");

    const fn = await routesService.getById(routeId);
    expect(fn).toBeNull();
  } finally {
    await cleanup(db, tempDir, surrealTestContext, consoleLogService);
  }
});

Deno.test({ name: "GET /web/functions/edit/:id shows edit form", sanitizeResources: false, sanitizeOps: false }, async () => {
  const initialRoutes = [
    { name: "test-fn", handler: "test.ts", routePath: "/test", methods: ["GET"], description: "Test" },
  ];
  const { app, db, tempDir, surrealTestContext, consoleLogService, routesService } = await createTestApp({ initialRoutes });
  try {
    const route = await routesService.getByName("test-fn");
    const routeId = recordIdToString(route!.id);

    const res = await app.request(`/web/functions/edit/${routeId}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Edit");
    expect(html).toContain("test-fn");
    // Name field should now be editable (not readonly)
    expect(html).not.toContain("readonly");
  } finally {
    await cleanup(db, tempDir, surrealTestContext, consoleLogService);
  }
});

Deno.test({ name: "POST /web/functions/edit/:id updates function and allows name change", sanitizeResources: false, sanitizeOps: false }, async () => {
  const initialRoutes = [
    { name: "old-name", handler: "old.ts", routePath: "/old", methods: ["GET"] },
  ];
  const { app, db, tempDir, surrealTestContext, consoleLogService, routesService } = await createTestApp({ initialRoutes });
  try {
    const route = await routesService.getByName("old-name");
    const originalId = recordIdToString(route!.id);

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
    expect(updated?.routePath).toBe("/new");
    expect(updated?.methods).toContain("POST");

    // Old name should not exist
    const oldName = await routesService.getByName("old-name");
    expect(oldName).toBeNull();
  } finally {
    await cleanup(db, tempDir, surrealTestContext, consoleLogService);
  }
});

Deno.test({ name: "GET /web/functions/edit/:id returns error for invalid ID", sanitizeResources: false, sanitizeOps: false }, async () => {
  const { app, db, tempDir, surrealTestContext, consoleLogService } = await createTestApp();
  try {
    const res = await app.request("/web/functions/edit/invalid");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("error=");
  } finally {
    await cleanup(db, tempDir, surrealTestContext, consoleLogService);
  }
});

Deno.test({ name: "GET /web/functions/edit/:id returns error for non-existent ID", sanitizeResources: false, sanitizeOps: false }, async () => {
  const { app, db, tempDir, surrealTestContext, consoleLogService } = await createTestApp();
  try {
    const res = await app.request("/web/functions/edit/999");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("error=");
  } finally {
    await cleanup(db, tempDir, surrealTestContext, consoleLogService);
  }
});

Deno.test({ name: "GET /web/functions/delete/:id shows confirmation", sanitizeResources: false, sanitizeOps: false }, async () => {
  const initialRoutes = [
    { name: "to-delete", handler: "t.ts", routePath: "/del", methods: ["GET"] },
  ];
  const { app, db, tempDir, surrealTestContext, consoleLogService, routesService } = await createTestApp({ initialRoutes });
  try {
    const route = await routesService.getByName("to-delete");
    const routeId = recordIdToString(route!.id);

    const res = await app.request(`/web/functions/delete/${routeId}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Delete Function");
    expect(html).toContain("to-delete");
  } finally {
    await cleanup(db, tempDir, surrealTestContext, consoleLogService);
  }
});

// Keys pages tests
Deno.test({ name: "GET /web/keys lists keys grouped by group", sanitizeResources: false, sanitizeOps: false }, async () => {
  const { app, db, tempDir, surrealTestContext, consoleLogService, apiKeyService } = await createTestApp();
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
    await cleanup(db, tempDir, surrealTestContext, consoleLogService);
  }
});

Deno.test({ name: "GET /web/keys/create shows form", sanitizeResources: false, sanitizeOps: false }, async () => {
  const { app, db, tempDir, surrealTestContext, consoleLogService } = await createTestApp();
  try {
    const res = await app.request("/web/keys/create");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Create API Key");
    expect(html).toContain('name="groupId"');
    expect(html).toContain('name="value"');
  } finally {
    await cleanup(db, tempDir, surrealTestContext, consoleLogService);
  }
});

Deno.test({ name: "GET /web/keys/create with group param prefills form", sanitizeResources: false, sanitizeOps: false }, async () => {
  const { app, db, tempDir, surrealTestContext, consoleLogService, apiKeyService } = await createTestApp();
  try {
    // Create a group and get its ID
    const groupRecordId = await apiKeyService.createGroup("mykey");
    const groupId = recordIdToString(groupRecordId);

    const res = await app.request(`/web/keys/create?group=${groupId}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('value="mykey"');
    expect(html).toContain("readonly");
  } finally {
    await cleanup(db, tempDir, surrealTestContext, consoleLogService);
  }
});

Deno.test({ name: "POST /web/keys/create creates key", sanitizeResources: false, sanitizeOps: false }, async () => {
  const { app, db, tempDir, surrealTestContext, consoleLogService, apiKeyService } = await createTestApp();
  try {
    // Create group first and get its ID
    const groupRecordId = await apiKeyService.createGroup("newkey");
    const groupId = recordIdToString(groupRecordId);

    const formData = new FormData();
    formData.append("groupId", groupId);
    formData.append("name", "newkey-name");
    formData.append("value", "newvalue123");
    formData.append("description", "test description");

    const res = await app.request("/web/keys/create", {
      method: "POST",
      body: formData,
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/web/keys?success=");

    const keys = await apiKeyService.getKeysByGroupId(groupId);
    expect(keys).not.toBeNull();
    expect(keys!.some((k) => k.value === "newvalue123")).toBe(true);
  } finally {
    await cleanup(db, tempDir, surrealTestContext, consoleLogService);
  }
});

Deno.test({ name: "POST /web/keys/delete removes key by ID", sanitizeResources: false, sanitizeOps: false }, async () => {
  const { app, db, tempDir, surrealTestContext, consoleLogService, apiKeyService } = await createTestApp();
  try {
    await apiKeyService.addKey("mykey", "key-1", "val1");
    await apiKeyService.addKey("mykey", "key-2", "val2");

    const keys = await apiKeyService.getKeys("mykey");
    const val1Key = keys!.find((k) => k.value === "val1")!;
    const val1KeyId = recordIdToString(val1Key.id);

    const res = await app.request(`/web/keys/delete?id=${val1KeyId}`, {
      method: "POST",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/web/keys?success=");

    const updatedKeys = await apiKeyService.getKeys("mykey");
    expect(updatedKeys).not.toBeNull();
    expect(updatedKeys!.some((k) => k.value === "val1")).toBe(false);
    expect(updatedKeys!.some((k) => k.value === "val2")).toBe(true);
  } finally {
    await cleanup(db, tempDir, surrealTestContext, consoleLogService);
  }
});

Deno.test({ name: "POST /web/keys/delete-group removes empty group", sanitizeResources: false, sanitizeOps: false }, async () => {
  const { app, db, tempDir, surrealTestContext, consoleLogService, apiKeyService } = await createTestApp();
  try {
    // Create empty group (no keys)
    await apiKeyService.createGroup("toremove", "Group to remove");
    const group = await apiKeyService.getGroupByName("toremove");
    const groupId = recordIdToString(group!.id);

    const res = await app.request(`/web/keys/delete-group?id=${groupId}`, {
      method: "POST",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/web/keys?success=");

    // Group should be gone
    const deletedGroup = await apiKeyService.getGroupByName("toremove");
    expect(deletedGroup).toBeNull();
  } finally {
    await cleanup(db, tempDir, surrealTestContext, consoleLogService);
  }
});

Deno.test({ name: "POST /web/keys/delete-group rejects group with keys", sanitizeResources: false, sanitizeOps: false }, async () => {
  const { app, db, tempDir, surrealTestContext, consoleLogService, apiKeyService } = await createTestApp();
  try {
    await apiKeyService.addKey("haskeys", "key-1", "val1");
    const group = await apiKeyService.getGroupByName("haskeys");
    const groupId = recordIdToString(group!.id);

    const res = await app.request(`/web/keys/delete-group?id=${groupId}`, {
      method: "POST",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("error=");
    expect(res.headers.get("Location")).toContain("Delete%20keys%20first");

    // Group should still exist
    const existingGroup = await apiKeyService.getGroupByName("haskeys");
    expect(existingGroup).not.toBeNull();
  } finally {
    await cleanup(db, tempDir, surrealTestContext, consoleLogService);
  }
});

// Error handling tests
Deno.test({ name: "GET /web/code/sources/999 returns error for non-existent source", sanitizeResources: false, sanitizeOps: false }, async () => {
  const { app, db, tempDir, surrealTestContext, consoleLogService } = await createTestApp();
  try {
    const res = await app.request("/web/code/sources/999");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("error=");
  } finally {
    await cleanup(db, tempDir, surrealTestContext, consoleLogService);
  }
});

Deno.test({ name: "POST /web/keys/create rejects invalid groupId", sanitizeResources: false, sanitizeOps: false }, async () => {
  const { app, db, tempDir, surrealTestContext, consoleLogService } = await createTestApp();
  try {
    const formData = new FormData();
    formData.append("groupId", "not-a-number");
    formData.append("name", "test-key");
    formData.append("value", "validvalue");

    const res = await app.request("/web/keys/create", {
      method: "POST",
      body: formData,
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("error=");
  } finally {
    await cleanup(db, tempDir, surrealTestContext, consoleLogService);
  }
});

Deno.test({ name: "GET /web/keys/delete-group blocks deleting management group", sanitizeResources: false, sanitizeOps: false }, async () => {
  const { app, db, tempDir, surrealTestContext, consoleLogService, apiKeyService } = await createTestApp();
  try {
    const group = await apiKeyService.getGroupByName("management");
    const groupId = recordIdToString(group!.id);
    const res = await app.request(`/web/keys/delete-group?id=${groupId}`);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("error=");
    expect(res.headers.get("Location")).toContain("management");
  } finally {
    await cleanup(db, tempDir, surrealTestContext, consoleLogService);
  }
});

// Metrics pages tests
Deno.test({ name: "GET /web/functions/metrics/:id shows metrics page", sanitizeResources: false, sanitizeOps: false }, async () => {
  const initialRoutes = [
    { name: "test-fn", handler: "test.ts", routePath: "/test", methods: ["GET"] },
  ];
  const { app, db, tempDir, surrealTestContext, consoleLogService, routesService } = await createTestApp({ initialRoutes });
  try {
    const route = await routesService.getByName("test-fn");
    const routeId = recordIdToString(route!.id);

    const res = await app.request(`/web/functions/metrics/${routeId}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Metrics: test-fn");
    expect(html).toContain("Last Hour");
    expect(html).toContain("Last 24 Hours");
    expect(html).toContain("metrics-tabs"); // Mode switching tabs
  } finally {
    await cleanup(db, tempDir, surrealTestContext, consoleLogService);
  }
});

Deno.test({ name: "GET /web/functions/metrics/:id with mode=day shows day view", sanitizeResources: false, sanitizeOps: false }, async () => {
  const initialRoutes = [
    { name: "test-fn", handler: "test.ts", routePath: "/test", methods: ["GET"] },
  ];
  const { app, db, tempDir, surrealTestContext, consoleLogService, routesService } = await createTestApp({ initialRoutes });
  try {
    const route = await routesService.getByName("test-fn");
    const routeId = recordIdToString(route!.id);

    const res = await app.request(`/web/functions/metrics/${routeId}?mode=day`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Last 24 Hours");
  } finally {
    await cleanup(db, tempDir, surrealTestContext, consoleLogService);
  }
});

Deno.test({ name: "GET /web/functions/metrics/:id shows no data message for new function", sanitizeResources: false, sanitizeOps: false }, async () => {
  const initialRoutes = [
    { name: "test-fn", handler: "test.ts", routePath: "/test", methods: ["GET"] },
  ];
  const { app, db, tempDir, surrealTestContext, consoleLogService, routesService } = await createTestApp({ initialRoutes });
  try {
    const route = await routesService.getByName("test-fn");
    const routeId = recordIdToString(route!.id);

    const res = await app.request(`/web/functions/metrics/${routeId}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("No metrics recorded");
  } finally {
    await cleanup(db, tempDir, surrealTestContext, consoleLogService);
  }
});

Deno.test({ name: "GET /web/functions/metrics/:id with data shows charts", sanitizeResources: false, sanitizeOps: false }, async () => {
  const initialRoutes = [
    { name: "test-fn", handler: "test.ts", routePath: "/test", methods: ["GET"] },
  ];
  const { app, db, tempDir, surrealTestContext, consoleLogService, routesService, executionMetricsService } = await createTestApp({ initialRoutes });
  try {
    const route = await routesService.getByName("test-fn");
    const routeId = recordIdToString(route!.id);

    // Add some minute-level metrics
    const now = new Date();
    for (let i = 0; i < 5; i++) {
      const timestamp = new Date(now.getTime() - i * 60 * 1000);
      timestamp.setUTCSeconds(0, 0);
      await executionMetricsService.store({
        functionId: route!.id,
        type: "minute",
        avgTimeUs: (100 + i * 10) * 1000,
        maxTimeUs: (150 + i * 10) * 1000,
        executionCount: 5 + i,
        timestamp,
      });
    }

    const res = await app.request(`/web/functions/metrics/${routeId}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("executionTimeChart");
    expect(html).toContain("requestCountChart");
    expect(html).toContain("Avg Execution Time");
  } finally {
    await cleanup(db, tempDir, surrealTestContext, consoleLogService);
  }
});

Deno.test({ name: "GET /web/functions/metrics/:id returns error for invalid ID", sanitizeResources: false, sanitizeOps: false }, async () => {
  const { app, db, tempDir, surrealTestContext, consoleLogService } = await createTestApp();
  try {
    const res = await app.request("/web/functions/metrics/invalid");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("error=");
  } finally {
    await cleanup(db, tempDir, surrealTestContext, consoleLogService);
  }
});

Deno.test({ name: "GET /web/functions/metrics/:id returns error for non-existent ID", sanitizeResources: false, sanitizeOps: false }, async () => {
  const { app, db, tempDir, surrealTestContext, consoleLogService } = await createTestApp();
  try {
    const res = await app.request("/web/functions/metrics/999");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("error=");
  } finally {
    await cleanup(db, tempDir, surrealTestContext, consoleLogService);
  }
});

Deno.test({ name: "Functions list includes Metrics link", sanitizeResources: false, sanitizeOps: false }, async () => {
  const initialRoutes = [
    { name: "test-fn", handler: "test.ts", routePath: "/test", methods: ["GET"] },
  ];
  const { app, db, tempDir, surrealTestContext, consoleLogService } = await createTestApp({ initialRoutes });
  try {
    const res = await app.request("/web/functions");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("/web/functions/metrics/");
  } finally {
    await cleanup(db, tempDir, surrealTestContext, consoleLogService);
  }
});

Deno.test({ name: "GET /web/functions/metrics/:id shows current period from raw execution data", sanitizeResources: false, sanitizeOps: false }, async () => {
  const initialRoutes = [
    { name: "test-fn", handler: "test.ts", routePath: "/test", methods: ["GET"] },
  ];
  const { app, db, tempDir, surrealTestContext, consoleLogService, routesService, executionMetricsService } = await createTestApp({ initialRoutes });
  try {
    const route = await routesService.getByName("test-fn");
    const routeId = recordIdToString(route!.id);

    // Add raw execution records (not yet aggregated into minute records)
    const now = new Date();
    await executionMetricsService.store({
      functionId: route!.id,
      type: "execution",
      avgTimeUs: 50 * 1000,
      maxTimeUs: 50 * 1000,
      executionCount: 1,
      timestamp: now,
    });
    await executionMetricsService.store({
      functionId: route!.id,
      type: "execution",
      avgTimeUs: 100 * 1000,
      maxTimeUs: 100 * 1000,
      executionCount: 1,
      timestamp: now,
    });

    // Metrics page should show data even without aggregation running
    const res = await app.request(`/web/functions/metrics/${routeId}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    // Should show charts because we have execution data
    expect(html).toContain("executionTimeChart");
    expect(html).toContain("requestCountChart");
    // Should NOT show "no data" message
    expect(html).not.toContain("No metrics recorded");
  } finally {
    await cleanup(db, tempDir, surrealTestContext, consoleLogService);
  }
});
