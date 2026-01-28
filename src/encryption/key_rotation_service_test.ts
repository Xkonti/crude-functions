import { integrationTest } from "../test/test_helpers.ts";
import { expect } from "@std/expect";
import { RecordId } from "surrealdb";
import { TestSetupBuilder } from "../test/test_setup_builder.ts";
import { KeyRotationService } from "./key_rotation_service.ts";
import { KeyStorageService } from "./key_storage_service.ts";
import { VersionedEncryptionService } from "./versioned_encryption_service.ts";
import type { HashService } from "./hash_service.ts";
import type { SurrealConnectionFactory } from "../database/surreal_connection_factory.ts";
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

/**
 * Test context for key rotation tests.
 * Uses simple helper pattern for custom encryption setup with mock key generator.
 */
interface TestContext {
  tempDir: string;
  surrealFactory: SurrealConnectionFactory;
  keyStorage: KeyStorageService;
  encryptionService: VersionedEncryptionService;
  hashService: HashService;
  config: KeyRotationConfig;
  cleanup: () => Promise<void>;
}

/**
 * Creates a test context for key rotation tests.
 * Uses TestSetupBuilder for database/migrations, then creates custom encryption
 * services with mock key generator for deterministic/predictable test keys.
 *
 * Follows the "Simple Helper Functions" pattern from the testing skill for
 * tests requiring custom service configuration.
 */
async function createTestContext(
  keysOverride?: Partial<EncryptionKeyFile>
): Promise<TestContext> {
  // Build base context with database and migrations
  const baseCtx = await TestSetupBuilder.create()
    .withEncryption()
    .build();

  // Create custom key storage with mock key generator for deterministic test keys
  const keyFilePath = `${baseCtx.tempDir}/custom-encryption-keys.json`;
  const keyStorage = new KeyStorageService({
    keyFilePath,
    keyGenerator: createMockKeyGenerator(),
  });

  // Create custom encryption keys with overrides
  const keys: EncryptionKeyFile = {
    current_key: TEST_KEY_A,
    current_version: "A",
    phased_out_key: null,
    phased_out_version: null,
    last_rotation_finished_at: new Date().toISOString(),
    better_auth_secret: baseCtx.encryptionKeys.better_auth_secret,
    hash_key: baseCtx.encryptionKeys.hash_key,
    ...keysOverride,
  };
  await keyStorage.saveKeys(keys);

  // Create custom encryption service with our test keys
  const encryptionService = new VersionedEncryptionService({
    currentKey: keys.current_key,
    currentVersion: keys.current_version,
    phasedOutKey: keys.phased_out_key ?? undefined,
    phasedOutVersion: keys.phased_out_version ?? undefined,
  });

  // Fast config for testing
  const config: KeyRotationConfig = {
    rotationIntervalDays: 0,
    batchSize: 10,
    batchSleepMs: 1,
  };

  return {
    tempDir: baseCtx.tempDir,
    surrealFactory: baseCtx.surrealFactory,
    keyStorage,
    encryptionService,
    hashService: baseCtx.hashService,
    config,
    cleanup: baseCtx.cleanup,
  };
}

// Helper to insert encrypted secrets
async function insertSecret(
  ctx: TestContext,
  name: string,
  plaintext: string
): Promise<RecordId> {
  const encrypted = await ctx.encryptionService.encrypt(plaintext);

  return await ctx.surrealFactory.withSystemConnection({}, async (db) => {
    const [rows] = await db.query<[{ id: RecordId }[]]>(
      `CREATE secret SET
        name = $name,
        value = $value,
        scopeType = "global",
        scopeRef = NONE`,
      { name, value: encrypted }
    );
    return rows[0].id;
  });
}

// Helper to insert encrypted api key
async function insertApiKey(
  ctx: TestContext,
  groupId: RecordId,
  plaintext: string,
  name?: string
): Promise<RecordId> {
  const encrypted = await ctx.encryptionService.encrypt(plaintext);
  const keyName = name ?? `test-key-${Date.now()}-${Math.random()}`;
  const hash = await ctx.hashService.computeHash(plaintext);

  return await ctx.surrealFactory.withSystemConnection({}, async (db) => {
    const [rows] = await db.query<[{ id: RecordId }[]]>(
      `CREATE apiKey SET
        groupId = $groupId,
        name = $name,
        value = $value,
        valueHash = $hash,
        description = "test"`,
      {
        groupId: groupId,
        name: keyName,
        value: encrypted,
        hash: hash
      }
    );
    return rows[0].id;
  });
}

// =====================
// Basic service tests
// =====================

integrationTest("KeyRotationService - performRotationCheck completes successfully", async () => {
  const ctx = await createTestContext();

  try {
    const service = new KeyRotationService({
      surrealFactory: ctx.surrealFactory,
      encryptionService: ctx.encryptionService,
      keyStorage: ctx.keyStorage,
      config: { ...ctx.config, rotationIntervalDays: 365 }, // Don't trigger rotation
    });

    // performRotationCheck should complete without error
    const result = await service.performRotationCheck();

    // Should indicate no rotation was performed (interval not reached)
    expect(result.rotationPerformed).toBe(false);
    expect(result.resumedIncomplete).toBe(false);
    expect(result.nextRunAt).toBeInstanceOf(Date);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("KeyRotationService - concurrent performRotationCheck calls are serialized", async () => {
  const ctx = await createTestContext({
    last_rotation_finished_at: new Date().toISOString(),
  });

  try {
    const service = new KeyRotationService({
      surrealFactory: ctx.surrealFactory,
      encryptionService: ctx.encryptionService,
      keyStorage: ctx.keyStorage,
      config: { ...ctx.config, rotationIntervalDays: 365 },
    });

    // Call performRotationCheck multiple times concurrently
    const results = await Promise.all([
      service.performRotationCheck(),
      service.performRotationCheck(),
      service.performRotationCheck(),
    ]);

    // All should complete without error
    for (const result of results) {
      expect(result.nextRunAt).toBeInstanceOf(Date);
    }
  } finally {
    await ctx.cleanup();
  }
});

// =====================
// Rotation trigger tests
// =====================

integrationTest("KeyRotationService - does not rotate when interval not reached", async () => {
  // Set last_rotation to now
  const ctx = await createTestContext({
    last_rotation_finished_at: new Date().toISOString(),
  });

  try {
    // Insert a secret
    await insertSecret(ctx, "test-secret", "secret-value");

    const service = new KeyRotationService({
      surrealFactory: ctx.surrealFactory,
      encryptionService: ctx.encryptionService,
      keyStorage: ctx.keyStorage,
      config: { ...ctx.config, rotationIntervalDays: 365 }, // Far in future
    });

    const result = await service.performRotationCheck();

    // Should not have rotated
    expect(result.rotationPerformed).toBe(false);

    // Secret should still be version A
    const row = await ctx.surrealFactory.withSystemConnection({}, async (db) => {
      const [rows] = await db.query<[{ value: string }[]]>(
        "SELECT `value` FROM secret WHERE name = $name LIMIT 1",
        { name: "test-secret" }
      );
      return rows?.[0] ?? null;
    });
    expect(row!.value.charAt(0)).toBe("A");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("KeyRotationService - triggers rotation when interval exceeded", async () => {
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
      surrealFactory: ctx.surrealFactory,
      encryptionService: ctx.encryptionService,
      keyStorage: ctx.keyStorage,
      config: { ...ctx.config, rotationIntervalDays: 90 }, // 90 days < 100 days ago
    });

    const result = await service.performRotationCheck();

    // Should have rotated
    expect(result.rotationPerformed).toBe(true);
    expect(result.resumedIncomplete).toBe(false);

    // Secret should now be version B
    const row = await ctx.surrealFactory.withSystemConnection({}, async (db) => {
      const [rows] = await db.query<[{ value: string }[]]>(
        "SELECT `value` FROM secret WHERE name = $name LIMIT 1",
        { name: "test-secret" }
      );
      return rows?.[0] ?? null;
    });
    expect(row!.value.charAt(0)).toBe("B");

    // Keys file should be updated
    const keys = await ctx.keyStorage.loadKeys();
    expect(keys!.current_version).toBe("B");
    expect(keys!.phased_out_key).toBe(null);
  } finally {
    await ctx.cleanup();
  }
});

// =====================
// Resume incomplete rotation tests
// =====================

integrationTest("KeyRotationService - resumes incomplete rotation", async () => {
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

    await ctx.surrealFactory.withSystemConnection({}, async (db) => {
      await db.query(
        `CREATE secret SET
          name = $name,
          value = $value,
          scopeType = "global",
          scopeRef = NONE`,
        { name: "old-secret", value: encryptedA }
      );
    });

    const service = new KeyRotationService({
      surrealFactory: ctx.surrealFactory,
      encryptionService: ctx.encryptionService,
      keyStorage: ctx.keyStorage,
      config: ctx.config,
    });

    const result = await service.performRotationCheck();

    // Should have resumed incomplete rotation
    expect(result.rotationPerformed).toBe(true);
    expect(result.resumedIncomplete).toBe(true);

    // Secret should now be version B
    const row = await ctx.surrealFactory.withSystemConnection({}, async (db) => {
      const [rows] = await db.query<[{ value: string }[]]>(
        "SELECT `value` FROM secret WHERE name = $name LIMIT 1",
        { name: "old-secret" }
      );
      return rows?.[0] ?? null;
    });
    expect(row!.value.charAt(0)).toBe("B");

    // Keys file should have phased_out cleared
    const keys = await ctx.keyStorage.loadKeys();
    expect(keys!.phased_out_key).toBe(null);
    expect(keys!.phased_out_version).toBe(null);
  } finally {
    await ctx.cleanup();
  }
});

// =====================
// Batch processing tests
// =====================

integrationTest("KeyRotationService - processes multiple secrets in batches", async () => {
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
      surrealFactory: ctx.surrealFactory,
      encryptionService: ctx.encryptionService,
      keyStorage: ctx.keyStorage,
      config: { ...ctx.config, batchSize: 10, rotationIntervalDays: 1 }, // 10 per batch = 3 batches
    });

    const result = await service.performRotationCheck();

    // Should have rotated
    expect(result.rotationPerformed).toBe(true);

    // All secrets should be version B
    const rows = await ctx.surrealFactory.withSystemConnection({}, async (db) => {
      const [results] = await db.query<[{ name: string; value: string }[]]>(
        "SELECT name, `value` FROM secret"
      );
      return results ?? [];
    });

    expect(rows.length).toBe(25);
    for (const row of rows) {
      expect(row.value.charAt(0)).toBe("B");
    }
  } finally {
    await ctx.cleanup();
  }
});

// =====================
// API keys rotation tests
// =====================

integrationTest("KeyRotationService - rotates apiKeys table", async () => {
  const pastDate = new Date();
  pastDate.setDate(pastDate.getDate() - 100);

  const ctx = await createTestContext({
    last_rotation_finished_at: pastDate.toISOString(),
  });

  try {
    // Create a group and add API keys
    const groupId = await ctx.surrealFactory.withSystemConnection({}, async (db) => {
      const [rows] = await db.query<[{ id: RecordId }[]]>(
        `CREATE apiKeyGroup SET
          name = $name,
          description = $description`,
        { name: "test-group", description: "Test" }
      );
      return rows[0].id;
    });
    await insertApiKey(ctx, groupId, "api-key-value-1");
    await insertApiKey(ctx, groupId, "api-key-value-2");

    const service = new KeyRotationService({
      surrealFactory: ctx.surrealFactory,
      encryptionService: ctx.encryptionService,
      keyStorage: ctx.keyStorage,
      config: ctx.config,
    });

    const result = await service.performRotationCheck();

    // Should have rotated
    expect(result.rotationPerformed).toBe(true);

    // All API keys should be version B
    const rows = await ctx.surrealFactory.withSystemConnection({}, async (db) => {
      const [results] = await db.query<[{ value: string }[]]>(
        "SELECT `value` FROM apiKey"
      );
      return results ?? [];
    });

    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row.value.charAt(0)).toBe("B");
    }
  } finally {
    await ctx.cleanup();
  }
});

// =====================
// Data integrity tests
// =====================

integrationTest("KeyRotationService - preserves data integrity after rotation", async () => {
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
      surrealFactory: ctx.surrealFactory,
      encryptionService: ctx.encryptionService,
      keyStorage: ctx.keyStorage,
      config: ctx.config,
    });

    const result = await service.performRotationCheck();

    // Should have rotated
    expect(result.rotationPerformed).toBe(true);

    // Verify all values are preserved
    for (let i = 0; i < originalValues.length; i++) {
      const row = await ctx.surrealFactory.withSystemConnection({}, async (db) => {
        const [rows] = await db.query<[{ value: string }[]]>(
          "SELECT `value` FROM secret WHERE name = $name LIMIT 1",
          { name: `secret-${i}` }
        );
        return rows?.[0] ?? null;
      });

      const decrypted = await ctx.encryptionService.decrypt(row!.value);
      expect(decrypted).toBe(originalValues[i]);
    }
  } finally {
    await ctx.cleanup();
  }
});

// =====================
// Version wrapping tests
// =====================

integrationTest("KeyStorageService.getNextVersion wraps correctly through rotation", () => {
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
// Manual rotation tests
// =====================

integrationTest("KeyRotationService - triggerManualRotation forces rotation", async () => {
  // Set last_rotation to now (so scheduled rotation wouldn't trigger)
  const ctx = await createTestContext({
    last_rotation_finished_at: new Date().toISOString(),
  });

  try {
    await insertSecret(ctx, "test-secret", "secret-value");

    const service = new KeyRotationService({
      surrealFactory: ctx.surrealFactory,
      encryptionService: ctx.encryptionService,
      keyStorage: ctx.keyStorage,
      config: { ...ctx.config, rotationIntervalDays: 365 }, // Would not trigger scheduled rotation
    });

    // Manual rotation should always trigger
    await service.triggerManualRotation();

    // Secret should now be version B
    const row = await ctx.surrealFactory.withSystemConnection({}, async (db) => {
      const [rows] = await db.query<[{ value: string }[]]>(
        "SELECT `value` FROM secret WHERE name = $name LIMIT 1",
        { name: "test-secret" }
      );
      return rows?.[0] ?? null;
    });
    expect(row!.value.charAt(0)).toBe("B");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("KeyRotationService - triggerManualRotation rejects when rotation in progress", async () => {
  const ctx = await createTestContext();

  try {
    // Insert enough secrets to make rotation take some time
    for (let i = 0; i < 50; i++) {
      await insertSecret(ctx, `secret-${i}`, `value-${i}`);
    }

    const service = new KeyRotationService({
      surrealFactory: ctx.surrealFactory,
      encryptionService: ctx.encryptionService,
      keyStorage: ctx.keyStorage,
      config: { ...ctx.config, batchSize: 5, batchSleepMs: 50 }, // Small batches with sleep
    });

    // Start a manual rotation in the background (don't await)
    const rotation1Promise = service.triggerManualRotation();

    // Small delay to ensure rotation has started
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Try to start another while first is in progress - should fail
    await expect(service.triggerManualRotation()).rejects.toThrow(
      "Key rotation is already in progress"
    );

    // Wait for first rotation to complete
    await rotation1Promise;
  } finally {
    await ctx.cleanup();
  }
});

// =====================
// Status tests
// =====================

integrationTest("KeyRotationService - getRotationStatus returns current state", async () => {
  const ctx = await createTestContext();

  try {
    const service = new KeyRotationService({
      surrealFactory: ctx.surrealFactory,
      encryptionService: ctx.encryptionService,
      keyStorage: ctx.keyStorage,
      config: ctx.config,
    });

    const status = await service.getRotationStatus();

    expect(status.isRotating).toBe(false);
    expect(status.hasIncompleteRotation).toBe(false);
  } finally {
    await ctx.cleanup();
  }
});
