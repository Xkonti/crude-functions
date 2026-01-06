import { expect } from "@std/expect";
import { Hono } from "@hono/hono";
import { DatabaseService } from "../database/database_service.ts";
import { ApiKeyService } from "../keys/api_key_service.ts";
import { SettingsService } from "../settings/settings_service.ts";
import { EncryptionService } from "../encryption/encryption_service.ts";
import { HashService } from "../encryption/hash_service.ts";
import { createHybridAuthMiddleware } from "./auth_middleware.ts";
import { SettingNames } from "../settings/types.ts";
import type { Auth } from "./auth.ts";

// Test encryption key (32 bytes base64-encoded)
const TEST_ENCRYPTION_KEY = "YzJhNGY2ZDhiMWU3YzNhOGYyZDZiNGU4YzFhN2YzZDk=";
// Test hash key (32 bytes base64-encoded)
const TEST_HASH_KEY = "aGFzaGtleWhhc2hrZXloYXNoa2V5aGFzaGtleWhhc2g=";

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

const SETTINGS_SCHEMA = `
  CREATE TABLE settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    user_id TEXT,
    value TEXT,
    is_encrypted INTEGER NOT NULL DEFAULT 0,
    updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE UNIQUE INDEX idx_settings_name_user ON settings(name, COALESCE(user_id, ''));
  CREATE INDEX idx_settings_name ON settings(name);
`;

/**
 * Creates a mock Auth object for testing.
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
    },
  } as unknown as Auth;
}

interface TestApp {
  app: Hono;
  apiKeyService: ApiKeyService;
  settingsService: SettingsService;
  db: DatabaseService;
  tempDir: string;
}

async function createTestApp(options: { authenticated?: boolean } = {}): Promise<TestApp> {
  const tempDir = await Deno.makeTempDir();
  const db = new DatabaseService({ databasePath: `${tempDir}/test.db` });
  await db.open();
  await db.exec(API_KEYS_SCHEMA);
  await db.exec(SETTINGS_SCHEMA);

  const encryptionService = new EncryptionService({
    encryptionKey: TEST_ENCRYPTION_KEY,
  });

  const hashService = new HashService({
    hashKey: TEST_HASH_KEY,
  });

  const apiKeyService = new ApiKeyService({
    db,
    encryptionService,
    hashService,
  });

  const settingsService = new SettingsService({
    db,
    encryptionService,
  });

  await settingsService.bootstrapGlobalSettings();

  const auth = createMockAuth({ authenticated: options.authenticated ?? false });
  const hybridAuth = createHybridAuthMiddleware({ auth, apiKeyService, settingsService });

  const app = new Hono();

  // Protected test endpoint
  app.get("/api/test", hybridAuth, (c) => {
    // deno-lint-ignore no-explicit-any
    const authMethod = (c as any).get("authMethod");
    // deno-lint-ignore no-explicit-any
    const apiKeyGroup = (c as any).get("apiKeyGroup");
    return c.json({
      success: true,
      authMethod,
      apiKeyGroup,
    });
  });

  return { app, apiKeyService, settingsService, db, tempDir };
}

async function cleanup(db: DatabaseService, tempDir: string): Promise<void> {
  await db.close();
  await Deno.remove(tempDir, { recursive: true });
}

// HybridAuthMiddleware Tests

Deno.test("HybridAuth: rejects request without API key or session", async () => {
  const { app, db, tempDir } = await createTestApp({ authenticated: false });

  try {
    const res = await app.request("/api/test");
    expect(res.status).toBe(401);

    const json = await res.json();
    expect(json.error).toBe("Unauthorized");
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("HybridAuth: accepts valid session without API key", async () => {
  const { app, db, tempDir } = await createTestApp({ authenticated: true });

  try {
    const res = await app.request("/api/test");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.authMethod).toBe("session");
    expect(json.apiKeyGroup).toBeUndefined();
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("HybridAuth: rejects API key when no access groups configured", async () => {
  const { app, apiKeyService, db, tempDir } = await createTestApp({ authenticated: false });

  try {
    // Create a key but don't configure access groups
    await apiKeyService.addKey("test-group", "test-key", "test-key-123");

    const res = await app.request("/api/test", {
      headers: {
        "X-API-Key": "test-key-123",
      },
    });

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Unauthorized");
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("HybridAuth: rejects API key from non-allowed group", async () => {
  const { app, apiKeyService, settingsService, db, tempDir } = await createTestApp({ authenticated: false });

  try {
    // Create two groups
    const allowedGroupId = await apiKeyService.createGroup("allowed-group", "Allowed");
    await apiKeyService.createGroup("forbidden-group", "Forbidden");

    // Add keys to both groups
    await apiKeyService.addKey("allowed-group", "allowed-key", "allowed-key-value");
    await apiKeyService.addKey("forbidden-group", "forbidden-key", "forbidden-key-value");

    // Configure only the allowed group
    await settingsService.setGlobalSetting(SettingNames.API_ACCESS_GROUPS, String(allowedGroupId));

    // Try to use key from forbidden group
    const res = await app.request("/api/test", {
      headers: {
        "X-API-Key": "forbidden-key",
      },
    });

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Unauthorized");
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("HybridAuth: accepts API key from single allowed group", async () => {
  const { app, apiKeyService, settingsService, db, tempDir } = await createTestApp({ authenticated: false });

  try {
    // Create management group and key
    const mgmtGroupId = await apiKeyService.createGroup("management", "Management keys");
    await apiKeyService.addKey("management", "mgmt-key", "mgmt-key-123");

    // Configure access groups
    await settingsService.setGlobalSetting(SettingNames.API_ACCESS_GROUPS, String(mgmtGroupId));

    const res = await app.request("/api/test", {
      headers: {
        "X-API-Key": "mgmt-key-123",
      },
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.authMethod).toBe("api-key");
    expect(json.apiKeyGroup).toBe("management");
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("HybridAuth: accepts API key from multiple allowed groups (first group)", async () => {
  const { app, apiKeyService, settingsService, db, tempDir } = await createTestApp({ authenticated: false });

  try {
    // Create multiple groups
    const adminGroupId = await apiKeyService.createGroup("admin", "Admin keys");
    const serviceGroupId = await apiKeyService.createGroup("service", "Service keys");

    // Add keys to both groups
    await apiKeyService.addKey("admin", "admin-key", "admin-key-value");
    await apiKeyService.addKey("service", "service-key", "service-key-value");

    // Configure both groups (comma-separated IDs)
    await settingsService.setGlobalSetting(
      SettingNames.API_ACCESS_GROUPS,
      `${adminGroupId},${serviceGroupId}`
    );

    // Test key from first group
    const res = await app.request("/api/test", {
      headers: {
        "X-API-Key": "admin-key-value",
      },
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.authMethod).toBe("api-key");
    expect(json.apiKeyGroup).toBe("admin");
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("HybridAuth: accepts API key from multiple allowed groups (second group)", async () => {
  const { app, apiKeyService, settingsService, db, tempDir } = await createTestApp({ authenticated: false });

  try {
    // Create multiple groups
    const adminGroupId = await apiKeyService.createGroup("admin", "Admin keys");
    const serviceGroupId = await apiKeyService.createGroup("service", "Service keys");

    // Add keys to both groups
    await apiKeyService.addKey("admin", "admin-key", "admin-key-value");
    await apiKeyService.addKey("service", "service-key", "service-key-value");

    // Configure both groups (comma-separated IDs)
    await settingsService.setGlobalSetting(
      SettingNames.API_ACCESS_GROUPS,
      `${adminGroupId},${serviceGroupId}`
    );

    // Test key from second group
    const res = await app.request("/api/test", {
      headers: {
        "X-API-Key": "service-key-value",
      },
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.authMethod).toBe("api-key");
    expect(json.apiKeyGroup).toBe("service");
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("HybridAuth: rejects invalid API key even when access groups configured", async () => {
  const { app, apiKeyService, settingsService, db, tempDir } = await createTestApp({ authenticated: false });

  try {
    const mgmtGroupId = await apiKeyService.createGroup("management", "Management");
    await apiKeyService.addKey("management", "valid-key", "valid-key-value");
    await settingsService.setGlobalSetting(SettingNames.API_ACCESS_GROUPS, String(mgmtGroupId));

    const res = await app.request("/api/test", {
      headers: {
        "X-API-Key": "invalid-key-xyz",
      },
    });

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Unauthorized");
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("HybridAuth: handles malformed access groups setting gracefully", async () => {
  const { app, apiKeyService, settingsService, db, tempDir } = await createTestApp({ authenticated: false });

  try {
    await apiKeyService.addKey("test", "test-key", "test-key-value");

    // Set malformed setting (non-numeric values)
    await settingsService.setGlobalSetting(SettingNames.API_ACCESS_GROUPS, "abc,xyz,123invalid");

    const res = await app.request("/api/test", {
      headers: {
        "X-API-Key": "test-key",
      },
    });

    // Should reject because no valid group IDs could be parsed
    expect(res.status).toBe(401);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("HybridAuth: handles empty access groups setting", async () => {
  const { app, apiKeyService, settingsService, db, tempDir } = await createTestApp({ authenticated: false });

  try {
    await apiKeyService.addKey("test", "test-key", "test-key-value");
    await settingsService.setGlobalSetting(SettingNames.API_ACCESS_GROUPS, "");

    const res = await app.request("/api/test", {
      headers: {
        "X-API-Key": "test-key",
      },
    });

    // Should reject because no groups are allowed
    expect(res.status).toBe(401);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("HybridAuth: prioritizes session over API key when both present", async () => {
  const { app, apiKeyService, settingsService, db, tempDir } = await createTestApp({ authenticated: true });

  try {
    const mgmtGroupId = await apiKeyService.createGroup("management", "Management");
    await apiKeyService.addKey("management", "test-key", "test-key-value");
    await settingsService.setGlobalSetting(SettingNames.API_ACCESS_GROUPS, String(mgmtGroupId));

    const res = await app.request("/api/test", {
      headers: {
        "X-API-Key": "test-key",
      },
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.authMethod).toBe("session"); // Session should be preferred
    expect(json.apiKeyGroup).toBeUndefined();
  } finally {
    await cleanup(db, tempDir);
  }
});
