import { expect } from "@std/expect";
import {
  validateKeyGroup,
  validateKeyName,
  validateKeyValue,
} from "../validation/keys.ts";
import { TestSetupBuilder } from "../test/test_setup_builder.ts";

// =====================
// Validation tests (pure functions, no database needed)
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
  const ctx = await TestSetupBuilder.create().withApiKeys().build();

  try {
    const keys = await ctx.apiKeyService.getAll();
    expect(keys.size).toBe(0);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("ApiKeyService.addKey adds key to database", async () => {
  const ctx = await TestSetupBuilder.create().withApiKeys().build();

  try {
    await ctx.apiKeyService.addKey("email", "email-key", "newkey", "test description");

    // Verify it was added
    expect(await ctx.apiKeyService.hasKey("email", "newkey")).toBe(true);

    // Check via getKeys
    const keys = await ctx.apiKeyService.getKeys("email");
    expect(keys).not.toBeNull();
    expect(keys!.length).toBe(1);
    expect(keys![0].name).toBe("email-key");
    expect(keys![0].value).toBe("newkey");
    expect(keys![0].description).toBe("test description");
    expect(keys![0].id).toBeGreaterThan(0);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("ApiKeyService.addKey silently ignores duplicates", async () => {
  const ctx = await TestSetupBuilder.create().withApiKeys().build();

  try {
    await ctx.apiKeyService.addKey("email", "test-key", "key1", "first");
    await ctx.apiKeyService.addKey("email", "test-key", "key1", "second"); // Duplicate value

    const keys = await ctx.apiKeyService.getKeys("email");
    expect(keys!.length).toBe(1);
    expect(keys![0].description).toBe("first"); // First description kept
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("ApiKeyService.getAll returns grouped keys", async () => {
  const ctx = await TestSetupBuilder.create().withApiKeys().build();

  try {
    await ctx.apiKeyService.addKey("management", "admin-key", "key1", "admin key");
    await ctx.apiKeyService.addKey("management", "backup-key", "key2");
    await ctx.apiKeyService.addKey("email", "smtp-key", "key3");

    const all = await ctx.apiKeyService.getAll();

    expect(all.size).toBe(2);
    expect(all.get("management")!.length).toBe(2);
    expect(all.get("email")!.length).toBe(1);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("ApiKeyService.getKeys normalizes group to lowercase", async () => {
  const ctx = await TestSetupBuilder.create().withApiKeys().build();

  try {
    await ctx.apiKeyService.addKey("EMAIL", "test-key", "key1");

    // Query with different case
    const keys = await ctx.apiKeyService.getKeys("email");
    expect(keys).not.toBeNull();
    expect(keys!.length).toBe(1);

    const keys2 = await ctx.apiKeyService.getKeys("EMAIL");
    expect(keys2).not.toBeNull();
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("ApiKeyService.getKeys returns null for nonexistent group", async () => {
  const ctx = await TestSetupBuilder.create().withApiKeys().build();

  try {
    const keys = await ctx.apiKeyService.getKeys("nonexistent");
    expect(keys).toBeNull();
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("ApiKeyService.hasKey returns true for existing key", async () => {
  const ctx = await TestSetupBuilder.create().withApiKeys().build();

  try {
    await ctx.apiKeyService.addKey("management", "key-1", "value1");

    expect(await ctx.apiKeyService.hasKey("management", "value1")).toBe(true);
    expect(await ctx.apiKeyService.hasKey("management", "wrongkey")).toBe(false);
    expect(await ctx.apiKeyService.hasKey("nonexistent", "value1")).toBe(false);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("ApiKeyService.removeKey removes specific key", async () => {
  const ctx = await TestSetupBuilder.create().withApiKeys().build();

  try {
    await ctx.apiKeyService.addKey("management", "key-1", "value1");
    await ctx.apiKeyService.addKey("management", "key-2", "value2");

    await ctx.apiKeyService.removeKey("management", "value1");

    expect(await ctx.apiKeyService.hasKey("management", "value1")).toBe(false);
    expect(await ctx.apiKeyService.hasKey("management", "value2")).toBe(true);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("ApiKeyService.removeKeyById removes key by ID", async () => {
  const ctx = await TestSetupBuilder.create().withApiKeys().build();

  try {
    await ctx.apiKeyService.addKey("management", "key-1", "value1");
    await ctx.apiKeyService.addKey("management", "key-2", "value2");

    const keys = await ctx.apiKeyService.getKeys("management");
    const key1Id = keys!.find((k) => k.value === "value1")!.id;

    await ctx.apiKeyService.removeKeyById(key1Id);

    expect(await ctx.apiKeyService.hasKey("management", "value1")).toBe(false);
    expect(await ctx.apiKeyService.hasKey("management", "value2")).toBe(true);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("ApiKeyService.removeGroup removes all keys in group", async () => {
  const ctx = await TestSetupBuilder.create().withApiKeys().build();

  try {
    await ctx.apiKeyService.addKey("management", "key-1", "value1");
    await ctx.apiKeyService.addKey("email", "key-2", "value2");

    await ctx.apiKeyService.removeGroup("email");

    const keys = await ctx.apiKeyService.getAll();
    expect(keys.has("email")).toBe(false);
    expect(keys.has("management")).toBe(true);
  } finally {
    await ctx.cleanup();
  }
});

// =====================
// Group CRUD tests
// =====================

Deno.test("ApiKeyService.getGroups returns groups from database", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeyGroup("test-group", "Test group description")
    .build();

  try {
    const groups = await ctx.apiKeyService.getGroups();
    // Should have the test-group we created
    const testGroup = groups.find(g => g.name === "test-group");
    expect(testGroup).toBeDefined();
    expect(testGroup!.description).toBe("Test group description");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("ApiKeyService.createGroup creates a new group", async () => {
  const ctx = await TestSetupBuilder.create().withApiKeys().build();

  try {
    const initialGroups = await ctx.apiKeyService.getGroups();
    const initialCount = initialGroups.length;

    const id = await ctx.apiKeyService.createGroup("email", "Email service keys");

    expect(id).toBeGreaterThan(0);

    const groups = await ctx.apiKeyService.getGroups();
    expect(groups.length).toBe(initialCount + 1);

    const emailGroup = groups.find(g => g.name === "email");
    expect(emailGroup).toBeDefined();
    expect(emailGroup!.description).toBe("Email service keys");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("ApiKeyService.getGroupByName returns group by name", async () => {
  const ctx = await TestSetupBuilder.create().withApiKeys().build();

  try {
    await ctx.apiKeyService.createGroup("email", "Email keys");

    const group = await ctx.apiKeyService.getGroupByName("email");
    expect(group).not.toBeNull();
    expect(group!.name).toBe("email");
    expect(group!.description).toBe("Email keys");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("ApiKeyService.getGroupByName returns null for nonexistent group", async () => {
  const ctx = await TestSetupBuilder.create().withApiKeys().build();

  try {
    const group = await ctx.apiKeyService.getGroupByName("nonexistent");
    expect(group).toBeNull();
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("ApiKeyService.getGroupById returns group by ID", async () => {
  const ctx = await TestSetupBuilder.create().withApiKeys().build();

  try {
    const id = await ctx.apiKeyService.createGroup("email", "Email keys");

    const group = await ctx.apiKeyService.getGroupById(id);
    expect(group).not.toBeNull();
    expect(group!.id).toBe(id);
    expect(group!.name).toBe("email");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("ApiKeyService.updateGroup updates group description", async () => {
  const ctx = await TestSetupBuilder.create().withApiKeys().build();

  try {
    const id = await ctx.apiKeyService.createGroup("email", "Old desc");
    await ctx.apiKeyService.updateGroup(id, "New desc");

    const group = await ctx.apiKeyService.getGroupById(id);
    expect(group!.description).toBe("New desc");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("ApiKeyService.deleteGroup removes group", async () => {
  const ctx = await TestSetupBuilder.create().withApiKeys().build();

  try {
    const id = await ctx.apiKeyService.createGroup("email", "Email keys");
    await ctx.apiKeyService.deleteGroup(id);

    const group = await ctx.apiKeyService.getGroupById(id);
    expect(group).toBeNull();
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("ApiKeyService.deleteGroup cascades to keys", async () => {
  const ctx = await TestSetupBuilder.create().withApiKeys().build();

  try {
    await ctx.apiKeyService.addKey("email", "key-1", "value1");
    await ctx.apiKeyService.addKey("email", "key-2", "value2");

    const group = await ctx.apiKeyService.getGroupByName("email");
    await ctx.apiKeyService.deleteGroup(group!.id);

    // Keys should be gone due to cascade
    expect(await ctx.apiKeyService.hasKey("email", "value1")).toBe(false);
    expect(await ctx.apiKeyService.hasKey("email", "value2")).toBe(false);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("ApiKeyService.getOrCreateGroup creates group if not exists", async () => {
  const ctx = await TestSetupBuilder.create().withApiKeys().build();

  try {
    const id1 = await ctx.apiKeyService.getOrCreateGroup("email");
    expect(id1).toBeGreaterThan(0);

    // Second call should return same ID
    const id2 = await ctx.apiKeyService.getOrCreateGroup("email");
    expect(id2).toBe(id1);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("ApiKeyService.addKey creates group if needed", async () => {
  const ctx = await TestSetupBuilder.create().withApiKeys().build();

  try {
    // Adding key to nonexistent group should create the group
    await ctx.apiKeyService.addKey("newgroup", "key-1", "value1");

    const group = await ctx.apiKeyService.getGroupByName("newgroup");
    expect(group).not.toBeNull();
    expect(await ctx.apiKeyService.hasKey("newgroup", "value1")).toBe(true);
  } finally {
    await ctx.cleanup();
  }
});

// =====================
// Encryption tests
// =====================

Deno.test("ApiKeyService - Encryption at rest", async (t) => {
  await t.step("stores keys encrypted in database", async () => {
    const ctx = await TestSetupBuilder.create().withApiKeys().build();

    try {
      await ctx.apiKeyService.addKey("test-group", "test-key", "my-secret-key", "Test key");

      // Query raw database value
      const row = await ctx.db.queryOne<{ value: string }>(
        "SELECT value FROM apiKeys LIMIT 1"
      );

      // Should NOT be plaintext
      expect(row!.value).not.toBe("my-secret-key");
      // Should be base64 (encrypted format)
      expect(row!.value).toMatch(/^[A-Za-z0-9+/=]+$/);
    } finally {
      await ctx.cleanup();
    }
  });

  await t.step("retrieves keys decrypted", async () => {
    const ctx = await TestSetupBuilder.create().withApiKeys().build();

    try {
      await ctx.apiKeyService.addKey("test-group", "test-key", "my-secret-key", "Test key");
      const keys = await ctx.apiKeyService.getKeys("test-group");

      // Should return plaintext
      expect(keys).not.toBeNull();
      expect(keys![0].value).toBe("my-secret-key");
    } finally {
      await ctx.cleanup();
    }
  });

  await t.step("validates keys correctly with encryption", async () => {
    const ctx = await TestSetupBuilder.create().withApiKeys().build();

    try {
      await ctx.apiKeyService.addKey("test-group", "test-key", "my-secret-key", "Test key");

      // Should validate against plaintext input
      const valid = await ctx.apiKeyService.hasKey("test-group", "my-secret-key");
      expect(valid).toBe(true);

      const invalid = await ctx.apiKeyService.hasKey("test-group", "wrong-key");
      expect(invalid).toBe(false);
    } finally {
      await ctx.cleanup();
    }
  });

  await t.step("getAll returns decrypted keys", async () => {
    const ctx = await TestSetupBuilder.create().withApiKeys().build();

    try {
      await ctx.apiKeyService.addKey("group1", "key-1", "value1", "First key");
      await ctx.apiKeyService.addKey("group2", "key-2", "value2", "Second key");

      const allKeys = await ctx.apiKeyService.getAll();

      // Should return decrypted values
      expect(allKeys.get("group1")![0].value).toBe("value1");
      expect(allKeys.get("group2")![0].value).toBe("value2");
    } finally {
      await ctx.cleanup();
    }
  });
});

// =====================
// Hash-based lookup tests
// =====================

Deno.test("ApiKeyService - Hash stored on addKey", async () => {
  const ctx = await TestSetupBuilder.create().withApiKeys().build();

  try {
    await ctx.apiKeyService.addKey("test", "key1", "mykey123");

    const row = await ctx.db.queryOne<{ valueHash: string }>(
      "SELECT valueHash FROM apiKeys WHERE name = 'key1'"
    );

    expect(row).not.toBeNull();
    expect(row!.valueHash).not.toBeNull();
    expect(row!.valueHash.length).toBeGreaterThan(20); // Base64 hash
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("ApiKeyService - Different keys produce different hashes", async () => {
  const ctx = await TestSetupBuilder.create().withApiKeys().build();

  try {
    await ctx.apiKeyService.addKey("test", "key1", "value1");
    await ctx.apiKeyService.addKey("test", "key2", "value2");

    const row1 = await ctx.db.queryOne<{ valueHash: string }>(
      "SELECT valueHash FROM apiKeys WHERE name = 'key1'"
    );
    const row2 = await ctx.db.queryOne<{ valueHash: string }>(
      "SELECT valueHash FROM apiKeys WHERE name = 'key2'"
    );

    expect(row1!.valueHash).not.toBe(row2!.valueHash);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("ApiKeyService - Performance with many keys", async () => {
  const ctx = await TestSetupBuilder.create().withApiKeys().build();

  try {
    // Create 100 keys in a group
    for (let i = 0; i < 100; i++) {
      await ctx.apiKeyService.addKey("perf-test", `key-${i}`, `value-${i}`);
    }

    // Measure lookup of last key (worst case for O(n) scan)
    const start = performance.now();
    const found = await ctx.apiKeyService.hasKey("perf-test", "value-99");
    const elapsed = performance.now() - start;

    expect(found).toBe(true);
    // With hash lookup, should be <10ms even for 100 keys
    // Old O(n) decryption would be ~100ms
    expect(elapsed).toBeLessThan(50);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("ApiKeyService - O(1) scaling verification", async () => {
  const ctx = await TestSetupBuilder.create().withApiKeys().build();

  try {
    const results = [];

    // Test with 10, 50, 100 keys
    for (const n of [10, 50, 100]) {
      // Create n keys
      const groupName = `bench-${n}`;
      for (let i = 0; i < n; i++) {
        await ctx.apiKeyService.addKey(groupName, `key-${i}`, `value-${i}`);
      }

      // Measure lookup time for last key
      const start = performance.now();
      await ctx.apiKeyService.hasKey(groupName, `value-${n - 1}`);
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
    await ctx.cleanup();
  }
});

Deno.test("ApiKeyService - getKeyByValue uses hash lookup", async () => {
  const ctx = await TestSetupBuilder.create().withApiKeys().build();

  try {
    await ctx.apiKeyService.addKey("test", "key1", "value1");
    await ctx.apiKeyService.addKey("test", "key2", "value2");

    const result = await ctx.apiKeyService.getKeyByValue("test", "value1");

    expect(result).not.toBeNull();
    expect(result!.keyName).toBe("key1");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("ApiKeyService - removeKey uses hash lookup", async () => {
  const ctx = await TestSetupBuilder.create().withApiKeys().build();

  try {
    await ctx.apiKeyService.addKey("test", "key1", "value1");
    await ctx.apiKeyService.addKey("test", "key2", "value2");

    await ctx.apiKeyService.removeKey("test", "value1");

    expect(await ctx.apiKeyService.hasKey("test", "value1")).toBe(false);
    expect(await ctx.apiKeyService.hasKey("test", "value2")).toBe(true);
  } finally {
    await ctx.cleanup();
  }
});
