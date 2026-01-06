import { expect } from "@std/expect";
import { DatabaseService } from "./database/database_service.ts";
import { ApiKeyService } from "./keys/api_key_service.ts";
import { SettingsService } from "./settings/settings_service.ts";
import { EncryptionService } from "./encryption/encryption_service.ts";
import { HashService } from "./encryption/hash_service.ts";
import { SettingNames } from "./settings/types.ts";

// Test encryption key (32 bytes base64-encoded)
const TEST_ENCRYPTION_KEY = "YzJhNGY2ZDhiMWU3YzNhOGYyZDZiNGU4YzFhN2YzZDk=";
// Test hash key (32 bytes base64-encoded)
const TEST_HASH_KEY = "aGFzaGtleWhhc2hrZXloYXNoa2V5aGFzaGtleWhhc2g=";

const API_KEYS_SCHEMA = `
  CREATE TABLE api_key_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL REFERENCES api_key_groups(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    value TEXT NOT NULL,
    value_hash TEXT,
    description TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    modified_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE UNIQUE INDEX idx_api_keys_group_name ON api_keys(group_id, name);
  CREATE INDEX idx_api_keys_group ON api_keys(group_id);
  CREATE INDEX idx_api_keys_hash ON api_keys(group_id, value_hash);
`;

const SETTINGS_SCHEMA = `
  CREATE TABLE settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    user_id TEXT,
    value TEXT,
    is_encrypted INTEGER NOT NULL DEFAULT 0,
    modified_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE UNIQUE INDEX idx_settings_name_user ON settings(name, COALESCE(user_id, ''));
  CREATE INDEX idx_settings_name ON settings(name);
`;

interface TestContext {
  db: DatabaseService;
  apiKeyService: ApiKeyService;
  settingsService: SettingsService;
  tempDir: string;
}

async function createTestContext(): Promise<TestContext> {
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

  return { db, apiKeyService, settingsService, tempDir };
}

async function cleanup(db: DatabaseService, tempDir: string): Promise<void> {
  await db.close();
  await Deno.remove(tempDir, { recursive: true });
}

/**
 * Simulates the bootstrap logic from main.ts lines 216-221
 */
async function bootstrapApiAccess(
  apiKeyService: ApiKeyService,
  settingsService: SettingsService
): Promise<void> {
  // Ensure management group exists and set default access groups
  const mgmtGroupId = await apiKeyService.getOrCreateGroup("management", "Management API keys");
  const currentAccessGroups = await settingsService.getGlobalSetting(SettingNames.API_ACCESS_GROUPS);
  if (!currentAccessGroups) {
    await settingsService.setGlobalSetting(SettingNames.API_ACCESS_GROUPS, String(mgmtGroupId));
  }
}

// Bootstrap Tests

Deno.test("Bootstrap: creates management group on first startup", async () => {
  const { db, apiKeyService, settingsService, tempDir } = await createTestContext();

  try {
    // Verify no groups exist initially
    const groupsBefore = await apiKeyService.getGroups();
    expect(groupsBefore).toEqual([]);

    // Run bootstrap
    await bootstrapApiAccess(apiKeyService, settingsService);

    // Verify management group was created
    const groupsAfter = await apiKeyService.getGroups();
    expect(groupsAfter).toHaveLength(1);
    expect(groupsAfter[0].name).toBe("management");
    expect(groupsAfter[0].description).toBe("Management API keys");
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("Bootstrap: management group has no keys by default", async () => {
  const { db, apiKeyService, settingsService, tempDir } = await createTestContext();

  try {
    // Run bootstrap
    await bootstrapApiAccess(apiKeyService, settingsService);

    // Verify management group has no keys
    const keys = await apiKeyService.getKeys("management");
    expect(keys).toEqual([]);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("Bootstrap: sets api.access-groups to management group ID", async () => {
  const { db, apiKeyService, settingsService, tempDir } = await createTestContext();

  try {
    // Run bootstrap
    await bootstrapApiAccess(apiKeyService, settingsService);

    // Get the management group ID
    const mgmtGroup = await apiKeyService.getGroupByName("management");
    expect(mgmtGroup).toBeDefined();

    // Verify setting was configured correctly
    const accessGroups = await settingsService.getGlobalSetting(SettingNames.API_ACCESS_GROUPS);
    expect(accessGroups).toBe(String(mgmtGroup!.id));
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("Bootstrap: does not override existing api.access-groups setting", async () => {
  const { db, apiKeyService, settingsService, tempDir } = await createTestContext();

  try {
    // Create a custom group and set it as the access group
    const customGroupId = await apiKeyService.createGroup("custom", "Custom access");
    await settingsService.setGlobalSetting(SettingNames.API_ACCESS_GROUPS, String(customGroupId));

    // Run bootstrap
    await bootstrapApiAccess(apiKeyService, settingsService);

    // Verify setting was NOT overridden
    const accessGroups = await settingsService.getGlobalSetting(SettingNames.API_ACCESS_GROUPS);
    expect(accessGroups).toBe(String(customGroupId));

    // Verify it's not the management group ID
    const mgmtGroup = await apiKeyService.getGroupByName("management");
    expect(accessGroups).not.toBe(String(mgmtGroup!.id));
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("Bootstrap: is idempotent (can run multiple times safely)", async () => {
  const { db, apiKeyService, settingsService, tempDir } = await createTestContext();

  try {
    // Run bootstrap multiple times
    await bootstrapApiAccess(apiKeyService, settingsService);
    await bootstrapApiAccess(apiKeyService, settingsService);
    await bootstrapApiAccess(apiKeyService, settingsService);

    // Verify only one management group exists
    const groups = await apiKeyService.getGroups();
    const managementGroups = groups.filter((g) => g.name === "management");
    expect(managementGroups).toHaveLength(1);

    // Verify setting is still correct
    const mgmtGroup = await apiKeyService.getGroupByName("management");
    const accessGroups = await settingsService.getGlobalSetting(SettingNames.API_ACCESS_GROUPS);
    expect(accessGroups).toBe(String(mgmtGroup!.id));
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("Bootstrap: management group can receive keys after creation", async () => {
  const { db, apiKeyService, settingsService, tempDir } = await createTestContext();

  try {
    // Run bootstrap
    await bootstrapApiAccess(apiKeyService, settingsService);

    // Add a key to management group
    await apiKeyService.addKey("management", "test-key", "test-key-123", "Test key");

    // Verify key was added successfully
    const keys = await apiKeyService.getKeys("management");
    expect(keys).not.toBeNull();
    expect(keys).toHaveLength(1);
    expect(keys![0].value).toBe("test-key-123");
    expect(keys![0].description).toBe("Test key");
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("Bootstrap: management group in access-groups setting enables API access", async () => {
  const { db, apiKeyService, settingsService, tempDir } = await createTestContext();

  try {
    // Run bootstrap
    await bootstrapApiAccess(apiKeyService, settingsService);

    // Add a key to management group
    await apiKeyService.addKey("management", "test-key-456", "test-key-value-456", "Test key description");

    // Verify the key can be used for authentication
    const mgmtGroup = await apiKeyService.getGroupByName("management");
    expect(mgmtGroup).toBeDefined();

    // Check that the key exists in the management group
    const hasKey = await apiKeyService.hasKey("management", "test-key-value-456");
    expect(hasKey).toBe(true);

    // Verify the management group ID is in the access groups setting
    const accessGroups = await settingsService.getGlobalSetting(SettingNames.API_ACCESS_GROUPS);
    expect(accessGroups).toContain(String(mgmtGroup!.id));
  } finally {
    await cleanup(db, tempDir);
  }
});
