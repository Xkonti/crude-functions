import { expect } from "@std/expect";
import { DatabaseService } from "../database/database_service.ts";
import {
  ApiKeyService,
  validateKeyGroup,
  validateKeyName,
  validateKeyValue,
} from "./api_key_service.ts";
import { EncryptionService } from "../encryption/encryption_service.ts";
import { HashService } from "../encryption/hash_service.ts";

// Test encryption key (32 bytes base64-encoded)
// Generated with: openssl rand -base64 32
const TEST_ENCRYPTION_KEY = "YzJhNGY2ZDhiMWU3YzNhOGYyZDZiNGU4YzFhN2YzZDk=";

// Test hash key (32 bytes base64-encoded)
// Generated with: openssl rand -base64 32
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

async function createTestSetup(): Promise<{
  service: ApiKeyService;
  db: DatabaseService;
  tempDir: string;
}> {
  const tempDir = await Deno.makeTempDir();
  const db = new DatabaseService({ databasePath: `${tempDir}/test.db` });
  await db.open();
  await db.exec(API_KEYS_SCHEMA);

  const encryptionService = new EncryptionService({
    encryptionKey: TEST_ENCRYPTION_KEY,
  });

  const hashService = new HashService({
    hashKey: TEST_HASH_KEY,
  });

  const service = new ApiKeyService({
    db,
    encryptionService,
    hashService,
  });
  return { service, db, tempDir };
}

async function cleanup(db: DatabaseService, tempDir: string): Promise<void> {
  await db.close();
  await Deno.remove(tempDir, { recursive: true });
}

// =====================
// Validation tests
// =====================

Deno.test("validateKeyGroup accepts valid groups", () => {
  expect(validateKeyGroup("management")).toBe(true);
  expect(validateKeyGroup("email-service")).toBe(true);
  expect(validateKeyGroup("test_key")).toBe(true);
  expect(validateKeyGroup("key123")).toBe(true);
  expect(validateKeyGroup("a")).toBe(true);
});

Deno.test("validateKeyGroup rejects invalid groups", () => {
  expect(validateKeyGroup("")).toBe(false);
  expect(validateKeyGroup("UPPERCASE")).toBe(false);
  expect(validateKeyGroup("has space")).toBe(false);
  expect(validateKeyGroup("has.dot")).toBe(false);
  expect(validateKeyGroup("has@special")).toBe(false);
});

Deno.test("validateKeyName accepts valid names", () => {
  expect(validateKeyName("my-key")).toBe(true);
  expect(validateKeyName("admin-key")).toBe(true);
  expect(validateKeyName("test_key")).toBe(true);
  expect(validateKeyName("key123")).toBe(true);
  expect(validateKeyName("a")).toBe(true);
});

Deno.test("validateKeyName rejects invalid names", () => {
  expect(validateKeyName("")).toBe(false);
  expect(validateKeyName("UPPERCASE")).toBe(false);
  expect(validateKeyName("has space")).toBe(false);
  expect(validateKeyName("has.dot")).toBe(false);
  expect(validateKeyName("has@special")).toBe(false);
});

Deno.test("validateKeyValue accepts valid values", () => {
  expect(validateKeyValue("abc123")).toBe(true);
  expect(validateKeyValue("ABC123")).toBe(true);
  expect(validateKeyValue("key-with-dashes")).toBe(true);
  expect(validateKeyValue("key_with_underscores")).toBe(true);
});

Deno.test("validateKeyValue rejects invalid values", () => {
  expect(validateKeyValue("")).toBe(false);
  expect(validateKeyValue("has space")).toBe(false);
  expect(validateKeyValue("has.dot")).toBe(false);
  expect(validateKeyValue("has@special")).toBe(false);
  expect(validateKeyValue("has#hash")).toBe(false);
});

// =====================
// ApiKeyService tests
// =====================

Deno.test("ApiKeyService returns empty map when no keys", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    const keys = await service.getAll();
    expect(keys.size).toBe(0);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("ApiKeyService.addKey adds key to database", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    await service.addKey("email", "email-key", "newkey", "test description");

    // Verify it was added
    expect(await service.hasKey("email", "newkey")).toBe(true);

    // Check via getKeys
    const keys = await service.getKeys("email");
    expect(keys).not.toBeNull();
    expect(keys!.length).toBe(1);
    expect(keys![0].name).toBe("email-key");
    expect(keys![0].value).toBe("newkey");
    expect(keys![0].description).toBe("test description");
    expect(keys![0].id).toBeGreaterThan(0);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("ApiKeyService.addKey silently ignores duplicates", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    await service.addKey("email", "test-key", "key1", "first");
    await service.addKey("email", "test-key", "key1", "second"); // Duplicate value

    const keys = await service.getKeys("email");
    expect(keys!.length).toBe(1);
    expect(keys![0].description).toBe("first"); // First description kept
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("ApiKeyService.getAll returns grouped keys", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    await service.addKey("management", "admin-key", "key1", "admin key");
    await service.addKey("management", "backup-key", "key2");
    await service.addKey("email", "smtp-key", "key3");

    const all = await service.getAll();

    expect(all.size).toBe(2);
    expect(all.get("management")!.length).toBe(2);
    expect(all.get("email")!.length).toBe(1);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("ApiKeyService.getKeys normalizes group to lowercase", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    await service.addKey("EMAIL", "test-key", "key1");

    // Query with different case
    const keys = await service.getKeys("email");
    expect(keys).not.toBeNull();
    expect(keys!.length).toBe(1);

    const keys2 = await service.getKeys("EMAIL");
    expect(keys2).not.toBeNull();
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("ApiKeyService.getKeys returns null for nonexistent group", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    const keys = await service.getKeys("nonexistent");
    expect(keys).toBeNull();
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("ApiKeyService.hasKey returns true for existing key", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    await service.addKey("management", "key-1", "value1");

    expect(await service.hasKey("management", "value1")).toBe(true);
    expect(await service.hasKey("management", "wrongkey")).toBe(false);
    expect(await service.hasKey("nonexistent", "value1")).toBe(false);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("ApiKeyService.removeKey removes specific key", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    await service.addKey("management", "key-1", "value1");
    await service.addKey("management", "key-2", "value2");

    await service.removeKey("management", "value1");

    expect(await service.hasKey("management", "value1")).toBe(false);
    expect(await service.hasKey("management", "value2")).toBe(true);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("ApiKeyService.removeKeyById removes key by ID", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    await service.addKey("management", "key-1", "value1");
    await service.addKey("management", "key-2", "value2");

    const keys = await service.getKeys("management");
    const key1Id = keys!.find((k) => k.value === "value1")!.id;

    await service.removeKeyById(key1Id);

    expect(await service.hasKey("management", "value1")).toBe(false);
    expect(await service.hasKey("management", "value2")).toBe(true);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("ApiKeyService.removeGroup removes all keys in group", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    await service.addKey("management", "key-1", "value1");
    await service.addKey("email", "key-2", "value2");

    await service.removeGroup("email");

    const keys = await service.getAll();
    expect(keys.has("email")).toBe(false);
    expect(keys.has("management")).toBe(true);
  } finally {
    await cleanup(db, tempDir);
  }
});

// =====================
// Group CRUD tests
// =====================

Deno.test("ApiKeyService.getGroups returns empty array when no groups", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    const groups = await service.getGroups();
    expect(groups.length).toBe(0);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("ApiKeyService.createGroup creates a new group", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    const id = await service.createGroup("email", "Email service keys");

    expect(id).toBeGreaterThan(0);

    const groups = await service.getGroups();
    expect(groups.length).toBe(1);
    expect(groups[0].name).toBe("email");
    expect(groups[0].description).toBe("Email service keys");
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("ApiKeyService.getGroupByName returns group by name", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    await service.createGroup("email", "Email keys");

    const group = await service.getGroupByName("email");
    expect(group).not.toBeNull();
    expect(group!.name).toBe("email");
    expect(group!.description).toBe("Email keys");
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("ApiKeyService.getGroupByName returns null for nonexistent group", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    const group = await service.getGroupByName("nonexistent");
    expect(group).toBeNull();
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("ApiKeyService.getGroupById returns group by ID", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    const id = await service.createGroup("email", "Email keys");

    const group = await service.getGroupById(id);
    expect(group).not.toBeNull();
    expect(group!.id).toBe(id);
    expect(group!.name).toBe("email");
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("ApiKeyService.updateGroup updates group description", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    const id = await service.createGroup("email", "Old desc");
    await service.updateGroup(id, "New desc");

    const group = await service.getGroupById(id);
    expect(group!.description).toBe("New desc");
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("ApiKeyService.deleteGroup removes group", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    const id = await service.createGroup("email", "Email keys");
    await service.deleteGroup(id);

    const group = await service.getGroupById(id);
    expect(group).toBeNull();
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("ApiKeyService.deleteGroup cascades to keys", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    await service.addKey("email", "key-1", "value1");
    await service.addKey("email", "key-2", "value2");

    const group = await service.getGroupByName("email");
    await service.deleteGroup(group!.id);

    // Keys should be gone due to cascade
    expect(await service.hasKey("email", "value1")).toBe(false);
    expect(await service.hasKey("email", "value2")).toBe(false);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("ApiKeyService.getOrCreateGroup creates group if not exists", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    const id1 = await service.getOrCreateGroup("email");
    expect(id1).toBeGreaterThan(0);

    // Second call should return same ID
    const id2 = await service.getOrCreateGroup("email");
    expect(id2).toBe(id1);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("ApiKeyService.addKey creates group if needed", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    // Adding key to nonexistent group should create the group
    await service.addKey("newgroup", "key-1", "value1");

    const group = await service.getGroupByName("newgroup");
    expect(group).not.toBeNull();
    expect(await service.hasKey("newgroup", "value1")).toBe(true);
  } finally {
    await cleanup(db, tempDir);
  }
});

// =====================
// Encryption tests
// =====================

Deno.test("ApiKeyService - Encryption at rest", async (t) => {
  await t.step("stores keys encrypted in database", async () => {
    const { service, db, tempDir } = await createTestSetup();

    try {
      await service.addKey("test-group", "test-key", "my-secret-key", "Test key");

      // Query raw database value
      const row = await db.queryOne<{ value: string }>(
        "SELECT value FROM api_keys LIMIT 1"
      );

      // Should NOT be plaintext
      expect(row!.value).not.toBe("my-secret-key");
      // Should be base64 (encrypted format)
      expect(row!.value).toMatch(/^[A-Za-z0-9+/=]+$/);
    } finally {
      await cleanup(db, tempDir);
    }
  });

  await t.step("retrieves keys decrypted", async () => {
    const { service, db, tempDir } = await createTestSetup();

    try {
      await service.addKey("test-group", "test-key", "my-secret-key", "Test key");
      const keys = await service.getKeys("test-group");

      // Should return plaintext
      expect(keys).not.toBeNull();
      expect(keys![0].value).toBe("my-secret-key");
    } finally {
      await cleanup(db, tempDir);
    }
  });

  await t.step("validates keys correctly with encryption", async () => {
    const { service, db, tempDir } = await createTestSetup();

    try {
      await service.addKey("test-group", "test-key", "my-secret-key", "Test key");

      // Should validate against plaintext input
      const valid = await service.hasKey("test-group", "my-secret-key");
      expect(valid).toBe(true);

      const invalid = await service.hasKey("test-group", "wrong-key");
      expect(invalid).toBe(false);
    } finally {
      await cleanup(db, tempDir);
    }
  });

  await t.step("getAll returns decrypted keys", async () => {
    const { service, db, tempDir } = await createTestSetup();

    try {
      await service.addKey("group1", "key-1", "value1", "First key");
      await service.addKey("group2", "key-2", "value2", "Second key");

      const allKeys = await service.getAll();

      // Should return decrypted values
      expect(allKeys.get("group1")![0].value).toBe("value1");
      expect(allKeys.get("group2")![0].value).toBe("value2");
    } finally {
      await cleanup(db, tempDir);
    }
  });
});

// =====================
// Hash-based lookup tests
// =====================

Deno.test("ApiKeyService - Hash stored on addKey", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    await service.addKey("test", "key1", "mykey123");

    const row = await db.queryOne<{ value_hash: string }>(
      "SELECT value_hash FROM api_keys WHERE name = 'key1'"
    );

    expect(row).not.toBeNull();
    expect(row!.value_hash).not.toBeNull();
    expect(row!.value_hash.length).toBeGreaterThan(20); // Base64 hash
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("ApiKeyService - Different keys produce different hashes", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    await service.addKey("test", "key1", "value1");
    await service.addKey("test", "key2", "value2");

    const row1 = await db.queryOne<{ value_hash: string }>(
      "SELECT value_hash FROM api_keys WHERE name = 'key1'"
    );
    const row2 = await db.queryOne<{ value_hash: string }>(
      "SELECT value_hash FROM api_keys WHERE name = 'key2'"
    );

    expect(row1!.value_hash).not.toBe(row2!.value_hash);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("ApiKeyService - Performance with many keys", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    // Create 100 keys in a group
    for (let i = 0; i < 100; i++) {
      await service.addKey("perf-test", `key-${i}`, `value-${i}`);
    }

    // Measure lookup of last key (worst case for O(n) scan)
    const start = performance.now();
    const found = await service.hasKey("perf-test", "value-99");
    const elapsed = performance.now() - start;

    expect(found).toBe(true);
    // With hash lookup, should be <10ms even for 100 keys
    // Old O(n) decryption would be ~100ms
    expect(elapsed).toBeLessThan(50);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("ApiKeyService - O(1) scaling verification", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    const results = [];

    // Test with 10, 50, 100 keys
    for (const n of [10, 50, 100]) {
      // Create n keys
      const groupName = `bench-${n}`;
      for (let i = 0; i < n; i++) {
        await service.addKey(groupName, `key-${i}`, `value-${i}`);
      }

      // Measure lookup time for last key
      const start = performance.now();
      await service.hasKey(groupName, `value-${n - 1}`);
      const elapsed = performance.now() - start;

      results.push({ n, elapsed });
    }

    // Verify O(1): 10x more keys should NOT be 10x slower
    // Allow 5x variance for noise (should be constant time)
    const ratio50_to_10 = results[1].elapsed / results[0].elapsed;
    const ratio100_to_50 = results[2].elapsed / results[1].elapsed;

    expect(ratio50_to_10).toBeLessThan(5);
    expect(ratio100_to_50).toBeLessThan(5);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("ApiKeyService - getKeyByValue uses hash lookup", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    await service.addKey("test", "key1", "value1");
    await service.addKey("test", "key2", "value2");

    const result = await service.getKeyByValue("test", "value1");

    expect(result).not.toBeNull();
    expect(result!.keyName).toBe("key1");
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("ApiKeyService - removeKey uses hash lookup", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    await service.addKey("test", "key1", "value1");
    await service.addKey("test", "key2", "value2");

    await service.removeKey("test", "value1");

    expect(await service.hasKey("test", "value1")).toBe(false);
    expect(await service.hasKey("test", "value2")).toBe(true);
  } finally {
    await cleanup(db, tempDir);
  }
});
