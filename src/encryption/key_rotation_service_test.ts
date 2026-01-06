import { expect } from "@std/expect";
import { DatabaseService } from "../database/database_service.ts";
import { KeyRotationService } from "./key_rotation_service.ts";
import { KeyStorageService } from "./key_storage_service.ts";
import { VersionedEncryptionService } from "./versioned_encryption_service.ts";
import type { EncryptionKeyFile } from "./key_storage_types.ts";
import type { KeyRotationConfig } from "./key_rotation_types.ts";

// Test keys (32 bytes base64-encoded)
const TEST_KEY_A = "YTJhNGY2ZDhiMWU3YzNhOGYyZDZiNGU4YzFhN2YzZDk=";
const TEST_KEY_B = "YjJiNGY2ZDhiMWU3YzNhOGYyZDZiNGU4YzFhN2YzZTA=";
const TEST_KEY_C = "YzJjNGY2ZDhiMWU3YzNhOGYyZDZiNGU4YzFhN2YzZTE=";
const TEST_KEY_D = "ZDJkNGY2ZDhiMWU3YzNhOGYyZDZiNGU4YzFhN2YzZTI=";

// Mock key generator that cycles through pre-defined keys
function createMockKeyGenerator() {
  const keys = [TEST_KEY_B, TEST_KEY_C, TEST_KEY_D, TEST_KEY_A];
  let index = 0;
  return () => {
    const key = keys[index % keys.length];
    index++;
    return Promise.resolve(key);
  };
}

const SECRETS_SCHEMA = `
  CREATE TABLE secrets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    value TEXT NOT NULL,
    comment TEXT,
    scope INTEGER NOT NULL DEFAULT 0,
    function_id INTEGER,
    api_group_id INTEGER,
    api_key_id INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    modified_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`;

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
    value TEXT NOT NULL,
    description TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    modified_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`;

interface TestContext {
  tempDir: string;
  db: DatabaseService;
  keyStorage: KeyStorageService;
  encryptionService: VersionedEncryptionService;
  config: KeyRotationConfig;
}

async function createTestContext(
  keysOverride?: Partial<EncryptionKeyFile>
): Promise<TestContext> {
  const tempDir = await Deno.makeTempDir();
  const keyFilePath = `${tempDir}/encryption-keys.json`;

  // Create key storage with mock key generator (avoids spawning openssl)
  const keyStorage = new KeyStorageService({
    keyFilePath,
    keyGenerator: createMockKeyGenerator(),
  });
  const keys: EncryptionKeyFile = {
    current_key: TEST_KEY_A,
    current_version: "A",
    phased_out_key: null,
    phased_out_version: null,
    last_rotation_finished_at: new Date().toISOString(),
    better_auth_secret: "YXV0aHNlY3JldGF1dGhzZWNyZXRhdXRoc2VjcmV0YXV0",
    hash_key: "aGFzaGtleWhhc2hrZXloYXNoa2V5aGFzaGtleWhhc2g=",
    ...keysOverride,
  };
  await keyStorage.saveKeys(keys);

  // Create database
  const db = new DatabaseService({ databasePath: `${tempDir}/test.db` });
  await db.open();
  await db.exec(SECRETS_SCHEMA);
  await db.exec(API_KEYS_SCHEMA);

  // Create encryption service
  const encryptionService = new VersionedEncryptionService({
    currentKey: keys.current_key,
    currentVersion: keys.current_version,
    phasedOutKey: keys.phased_out_key ?? undefined,
    phasedOutVersion: keys.phased_out_version ?? undefined,
  });

  // Fast config for testing
  const config: KeyRotationConfig = {
    checkIntervalSeconds: 1,
    rotationIntervalDays: 0, // Immediate rotation for testing
    batchSize: 10,
    batchSleepMs: 1,
  };

  return { tempDir, db, keyStorage, encryptionService, config };
}

async function cleanup(ctx: TestContext): Promise<void> {
  await ctx.db.close();
  await Deno.remove(ctx.tempDir, { recursive: true });
}

// Helper to insert encrypted secrets
async function insertSecret(
  ctx: TestContext,
  name: string,
  plaintext: string
): Promise<number> {
  const encrypted = await ctx.encryptionService.encrypt(plaintext);
  const result = await ctx.db.execute(
    "INSERT INTO secrets (name, value, scope) VALUES (?, ?, 0)",
    [name, encrypted]
  );
  return result.lastInsertRowId;
}

// Helper to insert encrypted api key
async function insertApiKey(
  ctx: TestContext,
  groupId: number,
  plaintext: string
): Promise<number> {
  const encrypted = await ctx.encryptionService.encrypt(plaintext);
  const result = await ctx.db.execute(
    "INSERT INTO api_keys (group_id, value, description) VALUES (?, ?, 'test')",
    [groupId, encrypted]
  );
  return result.lastInsertRowId;
}

// =====================
// Basic service tests
// =====================

Deno.test("KeyRotationService - start and stop", async () => {
  const ctx = await createTestContext();

  try {
    const service = new KeyRotationService({
      db: ctx.db,
      encryptionService: ctx.encryptionService,
      keyStorage: ctx.keyStorage,
      config: { ...ctx.config, rotationIntervalDays: 365 }, // Don't trigger rotation
    });

    // Start should set up timer
    service.start();

    // Give it a moment
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Stop should complete
    await service.stop();
  } finally {
    await cleanup(ctx);
  }
});

Deno.test("KeyRotationService - start is idempotent", async () => {
  const ctx = await createTestContext();

  try {
    const service = new KeyRotationService({
      db: ctx.db,
      encryptionService: ctx.encryptionService,
      keyStorage: ctx.keyStorage,
      config: { ...ctx.config, rotationIntervalDays: 365 },
    });

    service.start();
    service.start(); // Should not throw or create duplicate timers
    service.start();

    await service.stop();
  } finally {
    await cleanup(ctx);
  }
});

// =====================
// Rotation trigger tests
// =====================

Deno.test("KeyRotationService - does not rotate when interval not reached", async () => {
  // Set last_rotation to now
  const ctx = await createTestContext({
    last_rotation_finished_at: new Date().toISOString(),
  });

  try {
    // Insert a secret
    await insertSecret(ctx, "test-secret", "secret-value");

    const service = new KeyRotationService({
      db: ctx.db,
      encryptionService: ctx.encryptionService,
      keyStorage: ctx.keyStorage,
      config: { ...ctx.config, rotationIntervalDays: 365 }, // Far in future
    });

    service.start();
    await new Promise((resolve) => setTimeout(resolve, 100));
    await service.stop();

    // Secret should still be version A
    const row = await ctx.db.queryOne<{ value: string }>(
      "SELECT value FROM secrets WHERE name = ?",
      ["test-secret"]
    );
    expect(row!.value.charAt(0)).toBe("A");
  } finally {
    await cleanup(ctx);
  }
});

Deno.test("KeyRotationService - triggers rotation when interval exceeded", async () => {
  // Set last_rotation to past
  const pastDate = new Date();
  pastDate.setDate(pastDate.getDate() - 100); // 100 days ago

  const ctx = await createTestContext({
    last_rotation_finished_at: pastDate.toISOString(),
  });

  try {
    // Insert a secret with version A
    await insertSecret(ctx, "test-secret", "secret-value");

    const service = new KeyRotationService({
      db: ctx.db,
      encryptionService: ctx.encryptionService,
      keyStorage: ctx.keyStorage,
      config: { ...ctx.config, rotationIntervalDays: 90 }, // 90 days < 100 days ago
    });

    service.start();

    // Wait for rotation to complete
    await new Promise((resolve) => setTimeout(resolve, 500));
    await service.stop();

    // Secret should now be version B
    const row = await ctx.db.queryOne<{ value: string }>(
      "SELECT value FROM secrets WHERE name = ?",
      ["test-secret"]
    );
    expect(row!.value.charAt(0)).toBe("B");

    // Keys file should be updated
    const keys = await ctx.keyStorage.loadKeys();
    expect(keys!.current_version).toBe("B");
    expect(keys!.phased_out_key).toBe(null);
  } finally {
    await cleanup(ctx);
  }
});

// =====================
// Resume incomplete rotation tests
// =====================

Deno.test("KeyRotationService - resumes incomplete rotation", async () => {
  // Create context with rotation in progress (both keys exist)
  const ctx = await createTestContext({
    current_key: TEST_KEY_B,
    current_version: "B",
    phased_out_key: TEST_KEY_A,
    phased_out_version: "A",
    last_rotation_finished_at: new Date().toISOString(), // Doesn't matter when in progress
  });

  // Update encryption service to know about both keys
  await ctx.encryptionService.updateKeys({
    currentKey: TEST_KEY_B,
    currentVersion: "B",
    phasedOutKey: TEST_KEY_A,
    phasedOutVersion: "A",
  });

  try {
    // Insert a secret with old version A (simulating incomplete rotation)
    const encryptedA =
      "A" +
      (await new VersionedEncryptionService({
        currentKey: TEST_KEY_A,
        currentVersion: "A",
      }).encrypt("secret-value")).slice(1);

    await ctx.db.execute(
      "INSERT INTO secrets (name, value, scope) VALUES (?, ?, 0)",
      ["old-secret", encryptedA]
    );

    const service = new KeyRotationService({
      db: ctx.db,
      encryptionService: ctx.encryptionService,
      keyStorage: ctx.keyStorage,
      config: ctx.config,
    });

    service.start();
    await new Promise((resolve) => setTimeout(resolve, 500));
    await service.stop();

    // Secret should now be version B
    const row = await ctx.db.queryOne<{ value: string }>(
      "SELECT value FROM secrets WHERE name = ?",
      ["old-secret"]
    );
    expect(row!.value.charAt(0)).toBe("B");

    // Keys file should have phased_out cleared
    const keys = await ctx.keyStorage.loadKeys();
    expect(keys!.phased_out_key).toBe(null);
    expect(keys!.phased_out_version).toBe(null);
  } finally {
    await cleanup(ctx);
  }
});

// =====================
// Batch processing tests
// =====================

Deno.test("KeyRotationService - processes multiple secrets in batches", async () => {
  const pastDate = new Date();
  pastDate.setDate(pastDate.getDate() - 100);

  const ctx = await createTestContext({
    last_rotation_finished_at: pastDate.toISOString(),
  });

  try {
    // Insert multiple secrets
    for (let i = 0; i < 25; i++) {
      await insertSecret(ctx, `secret-${i}`, `value-${i}`);
    }

    const service = new KeyRotationService({
      db: ctx.db,
      encryptionService: ctx.encryptionService,
      keyStorage: ctx.keyStorage,
      config: { ...ctx.config, batchSize: 10, rotationIntervalDays: 1 }, // 10 per batch = 3 batches
    });

    service.start();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await service.stop();

    // All secrets should be version B
    const rows = await ctx.db.queryAll<{ name: string; value: string }>(
      "SELECT name, value FROM secrets"
    );

    expect(rows.length).toBe(25);
    for (const row of rows) {
      expect(row.value.charAt(0)).toBe("B");
    }
  } finally {
    await cleanup(ctx);
  }
});

// =====================
// API keys rotation tests
// =====================

Deno.test("KeyRotationService - rotates api_keys table", async () => {
  const pastDate = new Date();
  pastDate.setDate(pastDate.getDate() - 100);

  const ctx = await createTestContext({
    last_rotation_finished_at: pastDate.toISOString(),
  });

  try {
    // Create a group and add API keys
    await ctx.db.execute(
      "INSERT INTO api_key_groups (name, description) VALUES (?, ?)",
      ["test-group", "Test"]
    );
    await insertApiKey(ctx, 1, "api-key-value-1");
    await insertApiKey(ctx, 1, "api-key-value-2");

    const service = new KeyRotationService({
      db: ctx.db,
      encryptionService: ctx.encryptionService,
      keyStorage: ctx.keyStorage,
      config: ctx.config,
    });

    service.start();
    await new Promise((resolve) => setTimeout(resolve, 500));
    await service.stop();

    // All API keys should be version B
    const rows = await ctx.db.queryAll<{ value: string }>(
      "SELECT value FROM api_keys"
    );

    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row.value.charAt(0)).toBe("B");
    }
  } finally {
    await cleanup(ctx);
  }
});

// =====================
// Data integrity tests
// =====================

Deno.test("KeyRotationService - preserves data integrity after rotation", async () => {
  const pastDate = new Date();
  pastDate.setDate(pastDate.getDate() - 100);

  const ctx = await createTestContext({
    last_rotation_finished_at: pastDate.toISOString(),
  });

  const originalValues = [
    "simple-value",
    "value with spaces",
    '{"json": "data", "nested": [1,2,3]}',
    "unicode: \u00e9\u00e0\u00fc",
  ];

  try {
    // Insert secrets with various values
    for (let i = 0; i < originalValues.length; i++) {
      await insertSecret(ctx, `secret-${i}`, originalValues[i]);
    }

    const service = new KeyRotationService({
      db: ctx.db,
      encryptionService: ctx.encryptionService,
      keyStorage: ctx.keyStorage,
      config: ctx.config,
    });

    service.start();
    await new Promise((resolve) => setTimeout(resolve, 500));
    await service.stop();

    // Verify all values are preserved
    for (let i = 0; i < originalValues.length; i++) {
      const row = await ctx.db.queryOne<{ value: string }>(
        "SELECT value FROM secrets WHERE name = ?",
        [`secret-${i}`]
      );

      const decrypted = await ctx.encryptionService.decrypt(row!.value);
      expect(decrypted).toBe(originalValues[i]);
    }
  } finally {
    await cleanup(ctx);
  }
});

// =====================
// Version wrapping tests
// =====================

Deno.test("KeyStorageService.getNextVersion wraps correctly through rotation", () => {
  const keyStorage = new KeyStorageService();

  // Test full cycle from A to Z and back to A
  let version = "A";
  for (let i = 0; i < 26; i++) {
    const expected = String.fromCharCode(65 + ((i + 1) % 26));
    version = keyStorage.getNextVersion(version);
    expect(version).toBe(expected);
  }

  // After 26 iterations, we should be back at A
  expect(version).toBe("A");
});

// =====================
// Concurrent operation tests
// =====================

Deno.test("KeyRotationService - handles concurrent checks safely", async () => {
  const pastDate = new Date();
  pastDate.setDate(pastDate.getDate() - 100);

  const ctx = await createTestContext({
    last_rotation_finished_at: pastDate.toISOString(),
  });

  try {
    await insertSecret(ctx, "test-secret", "value");

    const service = new KeyRotationService({
      db: ctx.db,
      encryptionService: ctx.encryptionService,
      keyStorage: ctx.keyStorage,
      // Use longer rotation interval to prevent multiple rotations during the test
      config: { ...ctx.config, checkIntervalSeconds: 0.05, rotationIntervalDays: 1 },
    });

    service.start();

    // Let multiple check cycles run
    await new Promise((resolve) => setTimeout(resolve, 300));

    await service.stop();

    // Should have completed rotation without errors
    const keys = await ctx.keyStorage.loadKeys();
    expect(keys!.current_version).toBe("B");
  } finally {
    await cleanup(ctx);
  }
});
