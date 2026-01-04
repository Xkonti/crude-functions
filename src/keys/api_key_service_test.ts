import { expect } from "@std/expect";
import { DatabaseService } from "../database/database_service.ts";
import {
  ApiKeyService,
  validateKeyGroup,
  validateKeyValue,
} from "./api_key_service.ts";
import { EncryptionService } from "../encryption/encryption_service.ts";

// Test encryption key (32 bytes base64-encoded)
// Generated with: openssl rand -base64 32
const TEST_ENCRYPTION_KEY = "YzJhNGY2ZDhiMWU3YzNhOGYyZDZiNGU4YzFhN2YzZDk=";

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
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE UNIQUE INDEX idx_api_keys_group_value ON api_keys(group_id, value);
  CREATE INDEX idx_api_keys_group ON api_keys(group_id);
`;

async function createTestSetup(managementKeyFromEnv?: string): Promise<{
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

  const service = new ApiKeyService({
    db,
    managementKeyFromEnv,
    encryptionService,
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
    await service.addKey("email", "newkey", "test description");

    // Verify it was added
    expect(await service.hasKey("email", "newkey")).toBe(true);

    // Check via getKeys
    const keys = await service.getKeys("email");
    expect(keys).not.toBeNull();
    expect(keys!.length).toBe(1);
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
    await service.addKey("email", "key1", "first");
    await service.addKey("email", "key1", "second"); // Duplicate

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
    await service.addKey("management", "key1", "admin key");
    await service.addKey("management", "key2");
    await service.addKey("email", "key3");

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
    await service.addKey("EMAIL", "key1");

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
    await service.addKey("management", "key1");

    expect(await service.hasKey("management", "key1")).toBe(true);
    expect(await service.hasKey("management", "wrongkey")).toBe(false);
    expect(await service.hasKey("nonexistent", "key1")).toBe(false);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("ApiKeyService.removeKey removes specific key", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    await service.addKey("management", "key1");
    await service.addKey("management", "key2");

    await service.removeKey("management", "key1");

    expect(await service.hasKey("management", "key1")).toBe(false);
    expect(await service.hasKey("management", "key2")).toBe(true);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("ApiKeyService.removeKeyById removes key by ID", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    await service.addKey("management", "key1");
    await service.addKey("management", "key2");

    const keys = await service.getKeys("management");
    const key1Id = keys!.find((k) => k.value === "key1")!.id;

    await service.removeKeyById(key1Id);

    expect(await service.hasKey("management", "key1")).toBe(false);
    expect(await service.hasKey("management", "key2")).toBe(true);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("ApiKeyService.removeGroup removes all keys in group", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    await service.addKey("management", "key1");
    await service.addKey("email", "key2");

    await service.removeGroup("email");

    const keys = await service.getAll();
    expect(keys.has("email")).toBe(false);
    expect(keys.has("management")).toBe(true);
  } finally {
    await cleanup(db, tempDir);
  }
});

// =====================
// Environment key tests
// =====================

Deno.test("ApiKeyService includes env management key in getAll", async () => {
  const { service, db, tempDir } = await createTestSetup("envkey");

  try {
    await service.addKey("management", "filekey");

    const all = await service.getAll();
    const mgmtKeys = all.get("management")!;

    expect(mgmtKeys.length).toBe(2);
    expect(mgmtKeys.some((k) => k.value === "filekey")).toBe(true);
    expect(mgmtKeys.some((k) => k.value === "envkey")).toBe(true);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("ApiKeyService includes env management key in getKeys", async () => {
  const { service, db, tempDir } = await createTestSetup("envkey");

  try {
    await service.addKey("management", "filekey");

    const keys = await service.getKeys("management");

    expect(keys!.length).toBe(2);
    expect(keys!.some((k) => k.value === "envkey" && k.id === -1)).toBe(true);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("ApiKeyService.hasKey returns true for env management key", async () => {
  const { service, db, tempDir } = await createTestSetup("envkey");

  try {
    expect(await service.hasKey("management", "envkey")).toBe(true);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("ApiKeyService cannot remove env management key by value", async () => {
  const { service, db, tempDir } = await createTestSetup("envkey");

  try {
    await expect(
      service.removeKey("management", "envkey")
    ).rejects.toThrow("Cannot remove environment-provided management key");

    // Env key should still exist
    expect(await service.hasKey("management", "envkey")).toBe(true);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("ApiKeyService cannot remove env management key by ID", async () => {
  const { service, db, tempDir } = await createTestSetup("envkey");

  try {
    await expect(service.removeKeyById(-1)).rejects.toThrow(
      "Cannot remove environment-provided management key"
    );

    // Env key should still exist
    expect(await service.hasKey("management", "envkey")).toBe(true);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("ApiKeyService env key appears only once even if duplicate in DB", async () => {
  const { service, db, tempDir } = await createTestSetup("envkey");

  try {
    // Try to add the same value as the env key to the database
    // (This shouldn't cause duplicates in getKeys/getAll)
    await service.addKey("management", "envkey", "from db");

    const keys = await service.getKeys("management");
    const envKeys = keys!.filter((k) => k.value === "envkey");

    // Should only appear once (the DB one, since env key is only added if not present)
    expect(envKeys.length).toBe(1);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("ApiKeyService returns env key even with no DB keys", async () => {
  const { service, db, tempDir } = await createTestSetup("envkey");

  try {
    // No keys added to DB
    const keys = await service.getKeys("management");

    expect(keys).not.toBeNull();
    expect(keys!.length).toBe(1);
    expect(keys![0].value).toBe("envkey");
    expect(keys![0].id).toBe(-1);
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
    await service.addKey("email", "key1");
    await service.addKey("email", "key2");

    const group = await service.getGroupByName("email");
    await service.deleteGroup(group!.id);

    // Keys should be gone due to cascade
    expect(await service.hasKey("email", "key1")).toBe(false);
    expect(await service.hasKey("email", "key2")).toBe(false);
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
    await service.addKey("newgroup", "key1");

    const group = await service.getGroupByName("newgroup");
    expect(group).not.toBeNull();
    expect(await service.hasKey("newgroup", "key1")).toBe(true);
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
      await service.addKey("test-group", "my-secret-key", "Test key");

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
      await service.addKey("test-group", "my-secret-key", "Test key");
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
      await service.addKey("test-group", "my-secret-key", "Test key");

      // Should validate against plaintext input
      const valid = await service.hasKey("test-group", "my-secret-key");
      expect(valid).toBe(true);

      const invalid = await service.hasKey("test-group", "wrong-key");
      expect(invalid).toBe(false);
    } finally {
      await cleanup(db, tempDir);
    }
  });

  await t.step("environment key remains unencrypted", async () => {
    const { service, db, tempDir } = await createTestSetup("env-provided-key");

    try {
      // Env key should validate (plaintext comparison)
      const valid = await service.hasKey("management", "env-provided-key");
      expect(valid).toBe(true);

      // Should NOT be in database
      const row = await db.queryOne<{ id: number }>(
        "SELECT id FROM api_keys WHERE value = ?",
        ["env-provided-key"]
      );
      expect(row).toBeNull();
    } finally {
      await cleanup(db, tempDir);
    }
  });

  await t.step("getAll returns decrypted keys", async () => {
    const { service, db, tempDir } = await createTestSetup();

    try {
      await service.addKey("group1", "key1", "First key");
      await service.addKey("group2", "key2", "Second key");

      const allKeys = await service.getAll();

      // Should return decrypted values
      expect(allKeys.get("group1")![0].value).toBe("key1");
      expect(allKeys.get("group2")![0].value).toBe("key2");
    } finally {
      await cleanup(db, tempDir);
    }
  });
});
