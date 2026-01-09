import { expect } from "@std/expect";
import { Hono } from "@hono/hono";
import type { Context } from "@hono/hono";
import { ApiKeyValidator } from "./api_key_validator.ts";
import type { ApiKeyExtractor, ApiKeyExtractResult } from "./extractors/mod.ts";
import type { ApiKeyService } from "../keys/api_key_service.ts";
import { TestSetupBuilder } from "../test/test_setup_builder.ts";

// Helper to create a mock context from a Request (same pattern as extractors_test.ts)
async function createContext(request: Request): Promise<Context> {
  const app = new Hono();
  let capturedContext: Context | null = null;

  app.all("*", (c) => {
    capturedContext = c;
    return c.text("ok");
  });

  await app.fetch(request);
  return capturedContext!;
}

// Mock extractor that returns a fixed result
function createMockExtractor(
  name: string,
  result: ApiKeyExtractResult | null
): ApiKeyExtractor {
  return {
    name,
    extract: () => result,
  };
}

// Mock ApiKeyService with configurable behavior using group IDs
// keyGroups maps groupId -> Map<keyValue, keyInfo>
function createMockApiKeyService(
  keyGroups: Map<number, Map<string, { keyId: number; groupId: number; keyName: string; groupName: string }>>
): ApiKeyService {
  return {
    getKeyByValueInGroup: (
      groupId: number,
      keyValue: string
    ): Promise<{ keyId: number; groupId: number; keyName: string; groupName: string } | null> => {
      const groupKeys = keyGroups.get(groupId);
      if (!groupKeys) return Promise.resolve(null);
      return Promise.resolve(groupKeys.get(keyValue) ?? null);
    },
  } as unknown as ApiKeyService;
}

// =====================
// Missing API Key Tests
// =====================

Deno.test("ApiKeyValidator returns error when no API key found", async () => {
  const mockApiKeyService = createMockApiKeyService(new Map());
  const validator = new ApiKeyValidator({
    apiKeyService: mockApiKeyService,
    extractors: [
      createMockExtractor("empty1", null),
      createMockExtractor("empty2", null),
    ],
  });

  const c = await createContext(new Request("http://localhost/test"));
  const result = await validator.validate(c, [1]); // Use numeric group ID

  expect(result.valid).toBe(false);
  expect(result.error).toBe("Missing API key");
  expect(result.keyGroup).toBeUndefined();
  expect(result.source).toBeUndefined();
});

Deno.test("ApiKeyValidator returns error when no extractors provided", async () => {
  const mockApiKeyService = createMockApiKeyService(new Map());
  const validator = new ApiKeyValidator({
    apiKeyService: mockApiKeyService,
    extractors: [],
  });

  const c = await createContext(
    new Request("http://localhost/test", {
      headers: { "X-API-Key": "some-key" },
    })
  );
  const result = await validator.validate(c, [1]); // Use numeric group ID

  expect(result.valid).toBe(false);
  expect(result.error).toBe("Missing API key");
});

// =====================
// Invalid API Key Tests
// =====================

Deno.test("ApiKeyValidator returns error when API key not in any allowed group", async () => {
  const mockApiKeyService = createMockApiKeyService(new Map());
  const validator = new ApiKeyValidator({
    apiKeyService: mockApiKeyService,
    extractors: [
      createMockExtractor("test", { key: "invalid-key", source: "test source" }),
    ],
  });

  const c = await createContext(new Request("http://localhost/test"));
  const result = await validator.validate(c, [1, 2]); // Use numeric group IDs

  expect(result.valid).toBe(false);
  expect(result.error).toBe("Invalid API key");
  expect(result.keyGroup).toBeUndefined();
});

Deno.test("ApiKeyValidator returns error when key exists in different group", async () => {
  // Key exists in group 10, not in groups 1 or 2
  const keyGroups = new Map([
    [
      10,
      new Map([["valid-key", { keyId: 1, groupId: 10, keyName: "test-key", groupName: "other-group" }]]),
    ],
  ]);
  const mockApiKeyService = createMockApiKeyService(keyGroups);

  const validator = new ApiKeyValidator({
    apiKeyService: mockApiKeyService,
    extractors: [
      createMockExtractor("test", { key: "valid-key", source: "header" }),
    ],
  });

  const c = await createContext(new Request("http://localhost/test"));
  const result = await validator.validate(c, [1, 2]); // Allowed groups 1 and 2, key is in group 10

  expect(result.valid).toBe(false);
  expect(result.error).toBe("Invalid API key");
});

// ===================
// Valid API Key Tests
// ===================

Deno.test("ApiKeyValidator validates key in first allowed group", async () => {
  // Key exists in group 100
  const keyGroups = new Map([
    [
      100,
      new Map([["my-api-key", { keyId: 42, groupId: 100, keyName: "prod-key", groupName: "group1" }]]),
    ],
  ]);
  const mockApiKeyService = createMockApiKeyService(keyGroups);

  const validator = new ApiKeyValidator({
    apiKeyService: mockApiKeyService,
    extractors: [
      createMockExtractor("header", { key: "my-api-key", source: "X-API-Key header" }),
    ],
  });

  const c = await createContext(new Request("http://localhost/test"));
  const result = await validator.validate(c, [100, 200]); // Allowed groups 100 and 200

  expect(result.valid).toBe(true);
  expect(result.keyGroup).toBe("group1");
  expect(result.keyGroupId).toBe(100);
  expect(result.keyId).toBe(42);
  expect(result.source).toBe("X-API-Key header");
  expect(result.error).toBeUndefined();
});

Deno.test("ApiKeyValidator validates key in second allowed group", async () => {
  // Key exists in group 200, not in group 100
  const keyGroups = new Map([
    [
      200,
      new Map([["my-api-key", { keyId: 5, groupId: 200, keyName: "backup-key", groupName: "group2" }]]),
    ],
  ]);
  const mockApiKeyService = createMockApiKeyService(keyGroups);

  const validator = new ApiKeyValidator({
    apiKeyService: mockApiKeyService,
    extractors: [
      createMockExtractor("auth", { key: "my-api-key", source: "Authorization Bearer" }),
    ],
  });

  const c = await createContext(new Request("http://localhost/test"));
  const result = await validator.validate(c, [100, 200]); // Allowed groups 100 and 200

  expect(result.valid).toBe(true);
  expect(result.keyGroup).toBe("group2");
  expect(result.keyGroupId).toBe(200);
  expect(result.keyId).toBe(5);
  expect(result.source).toBe("Authorization Bearer");
});

Deno.test("ApiKeyValidator returns first matching group when key exists in multiple groups", async () => {
  // Same key exists in both groups 10 and 20
  const keyGroups = new Map([
    [
      10,
      new Map([["shared-key", { keyId: 1, groupId: 10, keyName: "key1", groupName: "group1" }]]),
    ],
    [
      20,
      new Map([["shared-key", { keyId: 2, groupId: 20, keyName: "key2", groupName: "group2" }]]),
    ],
  ]);
  const mockApiKeyService = createMockApiKeyService(keyGroups);

  const validator = new ApiKeyValidator({
    apiKeyService: mockApiKeyService,
    extractors: [
      createMockExtractor("test", { key: "shared-key", source: "test source" }),
    ],
  });

  const c = await createContext(new Request("http://localhost/test"));
  const result = await validator.validate(c, [10, 20]); // Group 10 checked first

  expect(result.valid).toBe(true);
  expect(result.keyGroup).toBe("group1");
  expect(result.keyGroupId).toBe(10);
});

// ==========================
// Extractor Priority Tests
// ==========================

Deno.test("ApiKeyValidator uses first extractor that finds a key", async () => {
  const keyGroups = new Map([
    [
      1,
      new Map([["first-key", { keyId: 1, groupId: 1, keyName: "first", groupName: "mygroup" }]]),
    ],
  ]);
  const mockApiKeyService = createMockApiKeyService(keyGroups);

  const validator = new ApiKeyValidator({
    apiKeyService: mockApiKeyService,
    extractors: [
      createMockExtractor("first", { key: "first-key", source: "first source" }),
      createMockExtractor("second", { key: "second-key", source: "second source" }),
    ],
  });

  const c = await createContext(new Request("http://localhost/test"));
  const result = await validator.validate(c, [1]);

  expect(result.valid).toBe(true);
  expect(result.source).toBe("first source");
});

Deno.test("ApiKeyValidator falls back to second extractor when first returns null", async () => {
  const keyGroups = new Map([
    [
      2,
      new Map([["second-key", { keyId: 2, groupId: 2, keyName: "second", groupName: "mygroup" }]]),
    ],
  ]);
  const mockApiKeyService = createMockApiKeyService(keyGroups);

  const validator = new ApiKeyValidator({
    apiKeyService: mockApiKeyService,
    extractors: [
      createMockExtractor("first", null),
      createMockExtractor("second", { key: "second-key", source: "second source" }),
    ],
  });

  const c = await createContext(new Request("http://localhost/test"));
  const result = await validator.validate(c, [2]);

  expect(result.valid).toBe(true);
  expect(result.source).toBe("second source");
});

// ==========================
// Default Extractors Tests
// ==========================

Deno.test("ApiKeyValidator uses default extractors when none provided", async () => {
  const keyGroups = new Map([
    [
      5,
      new Map([["header-key-123", { keyId: 10, groupId: 5, keyName: "header-key", groupName: "api-keys" }]]),
    ],
  ]);
  const mockApiKeyService = createMockApiKeyService(keyGroups);

  const validator = new ApiKeyValidator({
    apiKeyService: mockApiKeyService,
    // No extractors provided - should use defaults
  });

  const c = await createContext(
    new Request("http://localhost/test", {
      headers: { "X-API-Key": "header-key-123" },
    })
  );
  const result = await validator.validate(c, [5]);

  expect(result.valid).toBe(true);
  expect(result.keyGroup).toBe("api-keys");
  expect(result.source).toBe("X-API-Key header");
});

Deno.test("ApiKeyValidator default extractors work with Authorization Bearer", async () => {
  const keyGroups = new Map([
    [
      8,
      new Map([["bearer-token-xyz", { keyId: 20, groupId: 8, keyName: "bearer", groupName: "tokens" }]]),
    ],
  ]);
  const mockApiKeyService = createMockApiKeyService(keyGroups);

  const validator = new ApiKeyValidator({
    apiKeyService: mockApiKeyService,
  });

  const c = await createContext(
    new Request("http://localhost/test", {
      headers: { Authorization: "Bearer bearer-token-xyz" },
    })
  );
  const result = await validator.validate(c, [8]);

  expect(result.valid).toBe(true);
  expect(result.source).toBe("Authorization Bearer");
});

Deno.test("ApiKeyValidator default extractors work with query parameter", async () => {
  const keyGroups = new Map([
    [
      15,
      new Map([["query-key-abc", { keyId: 30, groupId: 15, keyName: "query", groupName: "query-keys" }]]),
    ],
  ]);
  const mockApiKeyService = createMockApiKeyService(keyGroups);

  const validator = new ApiKeyValidator({
    apiKeyService: mockApiKeyService,
  });

  const c = await createContext(
    new Request("http://localhost/test?api_key=query-key-abc")
  );
  const result = await validator.validate(c, [15]);

  expect(result.valid).toBe(true);
  expect(result.source).toBe("query:api_key");
});

// ==================================
// Integration Test with Real Service
// ==================================

Deno.test("ApiKeyValidator integration with real ApiKeyService", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeyGroup("production", "Production API keys")
    .withApiKey("production", "real-api-key-123", "primary-key")
    .build();

  try {
    // Get the group ID for validation
    const productionGroup = await ctx.apiKeyService.getGroupByName("production");
    expect(productionGroup).not.toBeNull();
    const groupId = productionGroup!.id;

    const validator = new ApiKeyValidator({
      apiKeyService: ctx.apiKeyService,
    });

    // Test with valid key
    const validContext = await createContext(
      new Request("http://localhost/test", {
        headers: { "X-API-Key": "real-api-key-123" },
      })
    );
    const validResult = await validator.validate(validContext, [groupId]);

    expect(validResult.valid).toBe(true);
    expect(validResult.keyGroup).toBe("production");
    expect(validResult.source).toBe("X-API-Key header");
    expect(validResult.keyId).toBeGreaterThan(0);
    expect(validResult.keyGroupId).toBeGreaterThan(0);

    // Test with invalid key
    const invalidContext = await createContext(
      new Request("http://localhost/test", {
        headers: { "X-API-Key": "wrong-key" },
      })
    );
    const invalidResult = await validator.validate(invalidContext, [groupId]);

    expect(invalidResult.valid).toBe(false);
    expect(invalidResult.error).toBe("Invalid API key");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("ApiKeyValidator integration rejects key from wrong group", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeyGroup("admin", "Admin keys")
    .withApiKeyGroup("user", "User keys")
    .withApiKey("admin", "admin-secret-key", "admin-key")
    .withApiKey("user", "user-public-key", "user-key")
    .build();

  try {
    // Get the user group ID (we'll only allow user group)
    const userGroup = await ctx.apiKeyService.getGroupByName("user");
    expect(userGroup).not.toBeNull();
    const userGroupId = userGroup!.id;

    const validator = new ApiKeyValidator({
      apiKeyService: ctx.apiKeyService,
    });

    // Try to use admin key but only allow user group
    const c = await createContext(
      new Request("http://localhost/test", {
        headers: { "X-API-Key": "admin-secret-key" },
      })
    );
    const result = await validator.validate(c, [userGroupId]);

    expect(result.valid).toBe(false);
    expect(result.error).toBe("Invalid API key");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("ApiKeyValidator integration with multiple allowed groups", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeyGroup("primary", "Primary keys")
    .withApiKeyGroup("secondary", "Secondary keys")
    .withApiKey("secondary", "secondary-key-value", "backup-key")
    .build();

  try {
    // Get both group IDs
    const primaryGroup = await ctx.apiKeyService.getGroupByName("primary");
    const secondaryGroup = await ctx.apiKeyService.getGroupByName("secondary");
    expect(primaryGroup).not.toBeNull();
    expect(secondaryGroup).not.toBeNull();

    const validator = new ApiKeyValidator({
      apiKeyService: ctx.apiKeyService,
    });

    // Key exists in secondary, both primary and secondary are allowed
    const c = await createContext(
      new Request("http://localhost/test", {
        headers: { "X-API-Key": "secondary-key-value" },
      })
    );
    const result = await validator.validate(c, [primaryGroup!.id, secondaryGroup!.id]);

    expect(result.valid).toBe(true);
    expect(result.keyGroup).toBe("secondary");
  } finally {
    await ctx.cleanup();
  }
});

// ====================
// Empty Allowed Groups
// ====================

Deno.test("ApiKeyValidator rejects when allowed groups list is empty", async () => {
  const keyGroups = new Map([
    [
      1,
      new Map([["my-key", { keyId: 1, groupId: 1, keyName: "key", groupName: "somegroup" }]]),
    ],
  ]);
  const mockApiKeyService = createMockApiKeyService(keyGroups);

  const validator = new ApiKeyValidator({
    apiKeyService: mockApiKeyService,
    extractors: [
      createMockExtractor("test", { key: "my-key", source: "test" }),
    ],
  });

  const c = await createContext(new Request("http://localhost/test"));
  const result = await validator.validate(c, []);

  expect(result.valid).toBe(false);
  expect(result.error).toBe("Invalid API key");
});
