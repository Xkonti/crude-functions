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

// Mock ApiKeyService with configurable behavior
function createMockApiKeyService(
  keyGroups: Map<string, Map<string, { keyId: number; groupId: number; keyName: string }>>
): ApiKeyService {
  return {
    getKeyByValue: (
      group: string,
      keyValue: string
    ): Promise<{ keyId: number; groupId: number; keyName: string } | null> => {
      const groupKeys = keyGroups.get(group.toLowerCase());
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
  const result = await validator.validate(c, ["group1"]);

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
  const result = await validator.validate(c, ["group1"]);

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
  const result = await validator.validate(c, ["group1", "group2"]);

  expect(result.valid).toBe(false);
  expect(result.error).toBe("Invalid API key");
  expect(result.keyGroup).toBeUndefined();
});

Deno.test("ApiKeyValidator returns error when key exists in different group", async () => {
  const keyGroups = new Map([
    [
      "other-group",
      new Map([["valid-key", { keyId: 1, groupId: 10, keyName: "test-key" }]]),
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
  const result = await validator.validate(c, ["group1", "group2"]);

  expect(result.valid).toBe(false);
  expect(result.error).toBe("Invalid API key");
});

// ===================
// Valid API Key Tests
// ===================

Deno.test("ApiKeyValidator validates key in first allowed group", async () => {
  const keyGroups = new Map([
    [
      "group1",
      new Map([["my-api-key", { keyId: 42, groupId: 100, keyName: "prod-key" }]]),
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
  const result = await validator.validate(c, ["group1", "group2"]);

  expect(result.valid).toBe(true);
  expect(result.keyGroup).toBe("group1");
  expect(result.keyGroupId).toBe(100);
  expect(result.keyId).toBe(42);
  expect(result.source).toBe("X-API-Key header");
  expect(result.error).toBeUndefined();
});

Deno.test("ApiKeyValidator validates key in second allowed group", async () => {
  const keyGroups = new Map([
    [
      "group2",
      new Map([["my-api-key", { keyId: 5, groupId: 200, keyName: "backup-key" }]]),
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
  const result = await validator.validate(c, ["group1", "group2"]);

  expect(result.valid).toBe(true);
  expect(result.keyGroup).toBe("group2");
  expect(result.keyGroupId).toBe(200);
  expect(result.keyId).toBe(5);
  expect(result.source).toBe("Authorization Bearer");
});

Deno.test("ApiKeyValidator returns first matching group when key exists in multiple groups", async () => {
  const keyGroups = new Map([
    [
      "group1",
      new Map([["shared-key", { keyId: 1, groupId: 10, keyName: "key1" }]]),
    ],
    [
      "group2",
      new Map([["shared-key", { keyId: 2, groupId: 20, keyName: "key2" }]]),
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
  const result = await validator.validate(c, ["group1", "group2"]);

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
      "mygroup",
      new Map([["first-key", { keyId: 1, groupId: 1, keyName: "first" }]]),
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
  const result = await validator.validate(c, ["mygroup"]);

  expect(result.valid).toBe(true);
  expect(result.source).toBe("first source");
});

Deno.test("ApiKeyValidator falls back to second extractor when first returns null", async () => {
  const keyGroups = new Map([
    [
      "mygroup",
      new Map([["second-key", { keyId: 2, groupId: 2, keyName: "second" }]]),
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
  const result = await validator.validate(c, ["mygroup"]);

  expect(result.valid).toBe(true);
  expect(result.source).toBe("second source");
});

// ==========================
// Default Extractors Tests
// ==========================

Deno.test("ApiKeyValidator uses default extractors when none provided", async () => {
  const keyGroups = new Map([
    [
      "api-keys",
      new Map([["header-key-123", { keyId: 10, groupId: 5, keyName: "header-key" }]]),
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
  const result = await validator.validate(c, ["api-keys"]);

  expect(result.valid).toBe(true);
  expect(result.keyGroup).toBe("api-keys");
  expect(result.source).toBe("X-API-Key header");
});

Deno.test("ApiKeyValidator default extractors work with Authorization Bearer", async () => {
  const keyGroups = new Map([
    [
      "tokens",
      new Map([["bearer-token-xyz", { keyId: 20, groupId: 8, keyName: "bearer" }]]),
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
  const result = await validator.validate(c, ["tokens"]);

  expect(result.valid).toBe(true);
  expect(result.source).toBe("Authorization Bearer");
});

Deno.test("ApiKeyValidator default extractors work with query parameter", async () => {
  const keyGroups = new Map([
    [
      "query-keys",
      new Map([["query-key-abc", { keyId: 30, groupId: 15, keyName: "query" }]]),
    ],
  ]);
  const mockApiKeyService = createMockApiKeyService(keyGroups);

  const validator = new ApiKeyValidator({
    apiKeyService: mockApiKeyService,
  });

  const c = await createContext(
    new Request("http://localhost/test?api_key=query-key-abc")
  );
  const result = await validator.validate(c, ["query-keys"]);

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
    const validator = new ApiKeyValidator({
      apiKeyService: ctx.apiKeyService,
    });

    // Test with valid key
    const validContext = await createContext(
      new Request("http://localhost/test", {
        headers: { "X-API-Key": "real-api-key-123" },
      })
    );
    const validResult = await validator.validate(validContext, ["production"]);

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
    const invalidResult = await validator.validate(invalidContext, ["production"]);

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
    const validator = new ApiKeyValidator({
      apiKeyService: ctx.apiKeyService,
    });

    // Try to use admin key but only allow user group
    const c = await createContext(
      new Request("http://localhost/test", {
        headers: { "X-API-Key": "admin-secret-key" },
      })
    );
    const result = await validator.validate(c, ["user"]);

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
    const validator = new ApiKeyValidator({
      apiKeyService: ctx.apiKeyService,
    });

    // Key exists in secondary, both primary and secondary are allowed
    const c = await createContext(
      new Request("http://localhost/test", {
        headers: { "X-API-Key": "secondary-key-value" },
      })
    );
    const result = await validator.validate(c, ["primary", "secondary"]);

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
      "somegroup",
      new Map([["my-key", { keyId: 1, groupId: 1, keyName: "key" }]]),
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
