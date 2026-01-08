import { expect } from "@std/expect";
import { TestSetupBuilder } from "../test/test_setup_builder.ts";
import { SecretsService } from "./secrets_service.ts";
import { SecretScope } from "./types.ts";

/**
 * Helper to create SecretsService from TestSetupBuilder context.
 * SecretsService depends on db + encryptionService, which TestSetupBuilder provides
 * when using .withEncryption() or any service that depends on encryption.
 */
function createSecretsService(ctx: {
  db: import("../database/database_service.ts").DatabaseService;
  encryptionService: import("../encryption/types.ts").IEncryptionService;
}): SecretsService {
  return new SecretsService({
    db: ctx.db,
    encryptionService: ctx.encryptionService,
  });
}

// =====================
// Name Validation Tests (tested via create methods that call validateSecretName)
// =====================

Deno.test("SecretsService.createGlobalSecret rejects empty name", async () => {
  const ctx = await TestSetupBuilder.create().withEncryption().build();

  try {
    const service = createSecretsService(ctx);
    await expect(service.createGlobalSecret("", "value")).rejects.toThrow(
      "Secret name cannot be empty"
    );
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SecretsService.createGlobalSecret rejects whitespace-only name", async () => {
  const ctx = await TestSetupBuilder.create().withEncryption().build();

  try {
    const service = createSecretsService(ctx);
    await expect(service.createGlobalSecret("   ", "value")).rejects.toThrow(
      "Secret name cannot be empty"
    );
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SecretsService.createGlobalSecret rejects names with spaces", async () => {
  const ctx = await TestSetupBuilder.create().withEncryption().build();

  try {
    const service = createSecretsService(ctx);
    await expect(
      service.createGlobalSecret("my secret", "value")
    ).rejects.toThrow("Secret name can only contain");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SecretsService.createGlobalSecret rejects names with special chars", async () => {
  const ctx = await TestSetupBuilder.create().withEncryption().build();

  try {
    const service = createSecretsService(ctx);
    await expect(
      service.createGlobalSecret("my.secret", "value")
    ).rejects.toThrow("Secret name can only contain");
    await expect(
      service.createGlobalSecret("my@secret", "value")
    ).rejects.toThrow("Secret name can only contain");
    await expect(
      service.createGlobalSecret("my/secret", "value")
    ).rejects.toThrow("Secret name can only contain");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SecretsService.createGlobalSecret accepts valid names", async () => {
  const ctx = await TestSetupBuilder.create().withEncryption().build();

  try {
    const service = createSecretsService(ctx);

    // Valid names: letters, numbers, underscores, dashes
    await service.createGlobalSecret("MY_SECRET", "value1");
    await service.createGlobalSecret("my-secret", "value2");
    await service.createGlobalSecret("mySecret123", "value3");
    await service.createGlobalSecret("_private", "value4");
    await service.createGlobalSecret("API-KEY-1", "value5");

    const secrets = await service.getGlobalSecrets();
    expect(secrets.length).toBe(5);
  } finally {
    await ctx.cleanup();
  }
});

// =====================
// Global Secrets CRUD Tests
// =====================

Deno.test("SecretsService.getGlobalSecrets returns empty array initially", async () => {
  const ctx = await TestSetupBuilder.create().withEncryption().build();

  try {
    const service = createSecretsService(ctx);
    const secrets = await service.getGlobalSecrets();
    expect(secrets).toEqual([]);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SecretsService.createGlobalSecret creates secret and returns in list", async () => {
  const ctx = await TestSetupBuilder.create().withEncryption().build();

  try {
    const service = createSecretsService(ctx);
    await service.createGlobalSecret("API_KEY", "secret-value", "Test comment");

    const secrets = await service.getGlobalSecrets();
    expect(secrets.length).toBe(1);
    expect(secrets[0].name).toBe("API_KEY");
    expect(secrets[0].comment).toBe("Test comment");
    // getGlobalSecrets doesn't return values
    expect("value" in secrets[0]).toBe(false);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SecretsService.getGlobalSecretById returns secret with decrypted value", async () => {
  const ctx = await TestSetupBuilder.create().withEncryption().build();

  try {
    const service = createSecretsService(ctx);
    await service.createGlobalSecret("API_KEY", "my-secret-value", "Comment");

    const secrets = await service.getGlobalSecrets();
    const secret = await service.getGlobalSecretById(secrets[0].id);

    expect(secret).not.toBeNull();
    expect(secret!.name).toBe("API_KEY");
    expect(secret!.value).toBe("my-secret-value");
    expect(secret!.comment).toBe("Comment");
    expect(secret!.scope).toBe(SecretScope.Global);
    expect(secret!.functionId).toBeNull();
    expect(secret!.apiGroupId).toBeNull();
    expect(secret!.apiKeyId).toBeNull();
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SecretsService.getGlobalSecretById returns null for nonexistent ID", async () => {
  const ctx = await TestSetupBuilder.create().withEncryption().build();

  try {
    const service = createSecretsService(ctx);
    const secret = await service.getGlobalSecretById(9999);
    expect(secret).toBeNull();
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SecretsService.getGlobalSecretsWithValues returns all secrets with decrypted values", async () => {
  const ctx = await TestSetupBuilder.create().withEncryption().build();

  try {
    const service = createSecretsService(ctx);
    await service.createGlobalSecret("SECRET_1", "value-1", "First");
    await service.createGlobalSecret("SECRET_2", "value-2", "Second");

    const secrets = await service.getGlobalSecretsWithValues();
    expect(secrets.length).toBe(2);

    // Sorted by name
    expect(secrets[0].name).toBe("SECRET_1");
    expect(secrets[0].value).toBe("value-1");
    expect(secrets[1].name).toBe("SECRET_2");
    expect(secrets[1].value).toBe("value-2");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SecretsService.createGlobalSecret rejects duplicate names", async () => {
  const ctx = await TestSetupBuilder.create().withEncryption().build();

  try {
    const service = createSecretsService(ctx);
    await service.createGlobalSecret("DUPLICATE", "value1");

    await expect(
      service.createGlobalSecret("DUPLICATE", "value2")
    ).rejects.toThrow("A global secret with name 'DUPLICATE' already exists");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SecretsService.updateGlobalSecret updates value and comment", async () => {
  const ctx = await TestSetupBuilder.create().withEncryption().build();

  try {
    const service = createSecretsService(ctx);
    await service.createGlobalSecret("MY_SECRET", "old-value", "Old comment");

    const secrets = await service.getGlobalSecrets();
    await service.updateGlobalSecret(secrets[0].id, "new-value", "New comment");

    const updated = await service.getGlobalSecretById(secrets[0].id);
    expect(updated!.value).toBe("new-value");
    expect(updated!.comment).toBe("New comment");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SecretsService.updateGlobalSecret throws for nonexistent ID", async () => {
  const ctx = await TestSetupBuilder.create().withEncryption().build();

  try {
    const service = createSecretsService(ctx);
    await expect(
      service.updateGlobalSecret(9999, "value")
    ).rejects.toThrow("Secret with ID 9999 not found");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SecretsService.deleteGlobalSecret removes secret", async () => {
  const ctx = await TestSetupBuilder.create().withEncryption().build();

  try {
    const service = createSecretsService(ctx);
    await service.createGlobalSecret("TO_DELETE", "value");

    const secrets = await service.getGlobalSecrets();
    expect(secrets.length).toBe(1);

    await service.deleteGlobalSecret(secrets[0].id);

    const afterDelete = await service.getGlobalSecrets();
    expect(afterDelete.length).toBe(0);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SecretsService.deleteGlobalSecret throws for nonexistent ID", async () => {
  const ctx = await TestSetupBuilder.create().withEncryption().build();

  try {
    const service = createSecretsService(ctx);
    await expect(service.deleteGlobalSecret(9999)).rejects.toThrow(
      "Secret with ID 9999 not found"
    );
  } finally {
    await ctx.cleanup();
  }
});

// =====================
// Function Secrets CRUD Tests
// =====================

Deno.test("SecretsService.getFunctionSecrets returns empty array initially", async () => {
  const ctx = await TestSetupBuilder.create()
    .withEncryption()
    .withRoute("/test", "test.ts")
    .build();

  try {
    const service = createSecretsService(ctx);
    const routes = await ctx.routesService.getAll();
    const secrets = await service.getFunctionSecrets(routes[0].id);
    expect(secrets).toEqual([]);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SecretsService.createFunctionSecret creates function-scoped secret", async () => {
  const ctx = await TestSetupBuilder.create()
    .withEncryption()
    .withRoute("/test", "test.ts")
    .build();

  try {
    const service = createSecretsService(ctx);
    const routes = await ctx.routesService.getAll();
    const functionId = routes[0].id;

    await service.createFunctionSecret(functionId, "FUNC_SECRET", "value", "Comment");

    const secrets = await service.getFunctionSecrets(functionId);
    expect(secrets.length).toBe(1);
    expect(secrets[0].name).toBe("FUNC_SECRET");
    expect(secrets[0].value).toBe("value");
    expect(secrets[0].functionId).toBe(functionId);
    expect(secrets[0].scope).toBe(SecretScope.Function);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SecretsService.createFunctionSecret allows same name in different functions", async () => {
  const ctx = await TestSetupBuilder.create()
    .withEncryption()
    .withRoute("/func1", "func1.ts")
    .withRoute("/func2", "func2.ts")
    .build();

  try {
    const service = createSecretsService(ctx);
    const routes = await ctx.routesService.getAll();

    // Same secret name in two different functions - should be allowed
    await service.createFunctionSecret(routes[0].id, "SHARED_NAME", "value1");
    await service.createFunctionSecret(routes[1].id, "SHARED_NAME", "value2");

    const secrets1 = await service.getFunctionSecrets(routes[0].id);
    const secrets2 = await service.getFunctionSecrets(routes[1].id);

    expect(secrets1[0].value).toBe("value1");
    expect(secrets2[0].value).toBe("value2");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SecretsService.createFunctionSecret rejects duplicate names in same function", async () => {
  const ctx = await TestSetupBuilder.create()
    .withEncryption()
    .withRoute("/test", "test.ts")
    .build();

  try {
    const service = createSecretsService(ctx);
    const routes = await ctx.routesService.getAll();
    const functionId = routes[0].id;

    await service.createFunctionSecret(functionId, "DUPLICATE", "value1");

    await expect(
      service.createFunctionSecret(functionId, "DUPLICATE", "value2")
    ).rejects.toThrow("A secret with name 'DUPLICATE' already exists for this function");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SecretsService.getFunctionSecretById returns correct secret", async () => {
  const ctx = await TestSetupBuilder.create()
    .withEncryption()
    .withRoute("/test", "test.ts")
    .build();

  try {
    const service = createSecretsService(ctx);
    const routes = await ctx.routesService.getAll();
    const functionId = routes[0].id;

    await service.createFunctionSecret(functionId, "MY_SECRET", "secret-value");

    const secrets = await service.getFunctionSecrets(functionId);
    const secret = await service.getFunctionSecretById(functionId, secrets[0].id);

    expect(secret!.value).toBe("secret-value");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SecretsService.updateFunctionSecret updates value", async () => {
  const ctx = await TestSetupBuilder.create()
    .withEncryption()
    .withRoute("/test", "test.ts")
    .build();

  try {
    const service = createSecretsService(ctx);
    const routes = await ctx.routesService.getAll();
    const functionId = routes[0].id;

    await service.createFunctionSecret(functionId, "MY_SECRET", "old");
    const secrets = await service.getFunctionSecrets(functionId);

    await service.updateFunctionSecret(functionId, secrets[0].id, "new", "Updated");

    const updated = await service.getFunctionSecretById(functionId, secrets[0].id);
    expect(updated!.value).toBe("new");
    expect(updated!.comment).toBe("Updated");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SecretsService.deleteFunctionSecret removes secret", async () => {
  const ctx = await TestSetupBuilder.create()
    .withEncryption()
    .withRoute("/test", "test.ts")
    .build();

  try {
    const service = createSecretsService(ctx);
    const routes = await ctx.routesService.getAll();
    const functionId = routes[0].id;

    await service.createFunctionSecret(functionId, "TO_DELETE", "value");
    const secrets = await service.getFunctionSecrets(functionId);

    await service.deleteFunctionSecret(functionId, secrets[0].id);

    const remaining = await service.getFunctionSecrets(functionId);
    expect(remaining.length).toBe(0);
  } finally {
    await ctx.cleanup();
  }
});

// =====================
// Group Secrets CRUD Tests
// =====================

Deno.test("SecretsService.getGroupSecrets returns empty array initially", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeyGroup("test-group")
    .build();

  try {
    const service = createSecretsService(ctx);
    const group = await ctx.apiKeyService.getGroupByName("test-group");
    const secrets = await service.getGroupSecrets(group!.id);
    expect(secrets).toEqual([]);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SecretsService.createGroupSecret creates group-scoped secret", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeyGroup("test-group")
    .build();

  try {
    const service = createSecretsService(ctx);
    const group = await ctx.apiKeyService.getGroupByName("test-group");

    await service.createGroupSecret(group!.id, "GROUP_SECRET", "value", "Comment");

    const secrets = await service.getGroupSecrets(group!.id);
    expect(secrets.length).toBe(1);
    expect(secrets[0].name).toBe("GROUP_SECRET");
    expect(secrets[0].value).toBe("value");
    expect(secrets[0].apiGroupId).toBe(group!.id);
    expect(secrets[0].scope).toBe(SecretScope.Group);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SecretsService.createGroupSecret allows same name in different groups", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeyGroup("group1")
    .withApiKeyGroup("group2")
    .build();

  try {
    const service = createSecretsService(ctx);
    const group1 = await ctx.apiKeyService.getGroupByName("group1");
    const group2 = await ctx.apiKeyService.getGroupByName("group2");

    await service.createGroupSecret(group1!.id, "SHARED_NAME", "value1");
    await service.createGroupSecret(group2!.id, "SHARED_NAME", "value2");

    const secrets1 = await service.getGroupSecrets(group1!.id);
    const secrets2 = await service.getGroupSecrets(group2!.id);

    expect(secrets1[0].value).toBe("value1");
    expect(secrets2[0].value).toBe("value2");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SecretsService.updateGroupSecret updates value", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeyGroup("test-group")
    .build();

  try {
    const service = createSecretsService(ctx);
    const group = await ctx.apiKeyService.getGroupByName("test-group");

    await service.createGroupSecret(group!.id, "MY_SECRET", "old");
    const secrets = await service.getGroupSecrets(group!.id);

    await service.updateGroupSecret(group!.id, secrets[0].id, "new", "Updated");

    const updated = await service.getGroupSecretById(group!.id, secrets[0].id);
    expect(updated!.value).toBe("new");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SecretsService.deleteGroupSecret removes secret", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeyGroup("test-group")
    .build();

  try {
    const service = createSecretsService(ctx);
    const group = await ctx.apiKeyService.getGroupByName("test-group");

    await service.createGroupSecret(group!.id, "TO_DELETE", "value");
    const secrets = await service.getGroupSecrets(group!.id);

    await service.deleteGroupSecret(group!.id, secrets[0].id);

    const remaining = await service.getGroupSecrets(group!.id);
    expect(remaining.length).toBe(0);
  } finally {
    await ctx.cleanup();
  }
});

// =====================
// Key Secrets CRUD Tests
// =====================

Deno.test("SecretsService.getKeySecrets returns empty array initially", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeyGroup("test-group")
    .withApiKey("test-group", "test-key-value")
    .build();

  try {
    const service = createSecretsService(ctx);
    const keys = await ctx.apiKeyService.getKeys("test-group");
    const secrets = await service.getKeySecrets(keys![0].id);
    expect(secrets).toEqual([]);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SecretsService.createKeySecret creates key-scoped secret", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeyGroup("test-group")
    .withApiKey("test-group", "test-key-value")
    .build();

  try {
    const service = createSecretsService(ctx);
    const keys = await ctx.apiKeyService.getKeys("test-group");
    const keyId = keys![0].id;

    await service.createKeySecret(keyId, "KEY_SECRET", "value", "Comment");

    const secrets = await service.getKeySecrets(keyId);
    expect(secrets.length).toBe(1);
    expect(secrets[0].name).toBe("KEY_SECRET");
    expect(secrets[0].value).toBe("value");
    expect(secrets[0].apiKeyId).toBe(keyId);
    expect(secrets[0].scope).toBe(SecretScope.Key);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SecretsService.createKeySecret allows same name on different keys", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeyGroup("test-group")
    .withApiKey("test-group", "key1")
    .withApiKey("test-group", "key2", "key-2")
    .build();

  try {
    const service = createSecretsService(ctx);
    const keys = await ctx.apiKeyService.getKeys("test-group");

    await service.createKeySecret(keys![0].id, "SHARED_NAME", "value1");
    await service.createKeySecret(keys![1].id, "SHARED_NAME", "value2");

    const secrets1 = await service.getKeySecrets(keys![0].id);
    const secrets2 = await service.getKeySecrets(keys![1].id);

    expect(secrets1[0].value).toBe("value1");
    expect(secrets2[0].value).toBe("value2");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SecretsService.updateKeySecret updates value", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeyGroup("test-group")
    .withApiKey("test-group", "test-key")
    .build();

  try {
    const service = createSecretsService(ctx);
    const keys = await ctx.apiKeyService.getKeys("test-group");
    const keyId = keys![0].id;

    await service.createKeySecret(keyId, "MY_SECRET", "old");
    const secrets = await service.getKeySecrets(keyId);

    await service.updateKeySecret(keyId, secrets[0].id, "new", "Updated");

    const updated = await service.getKeySecretById(keyId, secrets[0].id);
    expect(updated!.value).toBe("new");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SecretsService.deleteKeySecret removes secret", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeyGroup("test-group")
    .withApiKey("test-group", "test-key")
    .build();

  try {
    const service = createSecretsService(ctx);
    const keys = await ctx.apiKeyService.getKeys("test-group");
    const keyId = keys![0].id;

    await service.createKeySecret(keyId, "TO_DELETE", "value");
    const secrets = await service.getKeySecrets(keyId);

    await service.deleteKeySecret(keyId, secrets[0].id);

    const remaining = await service.getKeySecrets(keyId);
    expect(remaining.length).toBe(0);
  } finally {
    await ctx.cleanup();
  }
});

// =====================
// Hierarchical Resolution Tests
// =====================

Deno.test("SecretsService.getSecretByNameAndScope returns correct scope", async () => {
  const ctx = await TestSetupBuilder.create()
    .withEncryption()
    .withRoute("/test", "test.ts")
    .withApiKeyGroup("test-group")
    .withApiKey("test-group", "test-key")
    .build();

  try {
    const service = createSecretsService(ctx);
    const routes = await ctx.routesService.getAll();
    const functionId = routes[0].id;
    const group = await ctx.apiKeyService.getGroupByName("test-group");
    const keys = await ctx.apiKeyService.getKeys("test-group");

    // Create secrets in different scopes with same name
    await service.createGlobalSecret("API_KEY", "global-value");
    await service.createFunctionSecret(functionId, "API_KEY", "function-value");
    await service.createGroupSecret(group!.id, "API_KEY", "group-value");
    await service.createKeySecret(keys![0].id, "API_KEY", "key-value");

    // Query each scope explicitly
    const globalVal = await service.getSecretByNameAndScope("API_KEY", SecretScope.Global);
    expect(globalVal).toBe("global-value");

    const funcVal = await service.getSecretByNameAndScope("API_KEY", SecretScope.Function, functionId);
    expect(funcVal).toBe("function-value");

    const groupVal = await service.getSecretByNameAndScope("API_KEY", SecretScope.Group, undefined, group!.id);
    expect(groupVal).toBe("group-value");

    const keyVal = await service.getSecretByNameAndScope("API_KEY", SecretScope.Key, undefined, undefined, keys![0].id);
    expect(keyVal).toBe("key-value");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SecretsService.getSecretHierarchical returns most specific value (key > group > function > global)", async () => {
  const ctx = await TestSetupBuilder.create()
    .withEncryption()
    .withRoute("/test", "test.ts")
    .withApiKeyGroup("test-group")
    .withApiKey("test-group", "test-key")
    .build();

  try {
    const service = createSecretsService(ctx);
    const routes = await ctx.routesService.getAll();
    const functionId = routes[0].id;
    const group = await ctx.apiKeyService.getGroupByName("test-group");
    const keys = await ctx.apiKeyService.getKeys("test-group");

    // Create secret at all levels
    await service.createGlobalSecret("API_KEY", "global");
    await service.createFunctionSecret(functionId, "API_KEY", "function");
    await service.createGroupSecret(group!.id, "API_KEY", "group");
    await service.createKeySecret(keys![0].id, "API_KEY", "key");

    // Key is most specific
    const result = await service.getSecretHierarchical(
      "API_KEY",
      functionId,
      group!.id,
      keys![0].id
    );
    expect(result).toBe("key");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SecretsService.getSecretHierarchical falls back through hierarchy", async () => {
  const ctx = await TestSetupBuilder.create()
    .withEncryption()
    .withRoute("/test", "test.ts")
    .withApiKeyGroup("test-group")
    .withApiKey("test-group", "test-key")
    .build();

  try {
    const service = createSecretsService(ctx);
    const routes = await ctx.routesService.getAll();
    const functionId = routes[0].id;
    const group = await ctx.apiKeyService.getGroupByName("test-group");
    const keys = await ctx.apiKeyService.getKeys("test-group");

    // Only global and function exist
    await service.createGlobalSecret("API_KEY", "global");
    await service.createFunctionSecret(functionId, "API_KEY", "function");

    // Should return function (next most specific after missing key/group)
    const result = await service.getSecretHierarchical(
      "API_KEY",
      functionId,
      group!.id,
      keys![0].id
    );
    expect(result).toBe("function");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SecretsService.getSecretHierarchical returns global as fallback", async () => {
  const ctx = await TestSetupBuilder.create()
    .withEncryption()
    .withRoute("/test", "test.ts")
    .build();

  try {
    const service = createSecretsService(ctx);
    const routes = await ctx.routesService.getAll();

    await service.createGlobalSecret("API_KEY", "global");

    // Only functionId provided, no group/key
    const result = await service.getSecretHierarchical("API_KEY", routes[0].id);
    expect(result).toBe("global");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SecretsService.getSecretHierarchical returns undefined when not found", async () => {
  const ctx = await TestSetupBuilder.create()
    .withEncryption()
    .withRoute("/test", "test.ts")
    .build();

  try {
    const service = createSecretsService(ctx);
    const routes = await ctx.routesService.getAll();

    const result = await service.getSecretHierarchical("NONEXISTENT", routes[0].id);
    expect(result).toBeUndefined();
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SecretsService.getCompleteSecret returns all scopes", async () => {
  const ctx = await TestSetupBuilder.create()
    .withEncryption()
    .withRoute("/test", "test.ts")
    .withApiKeyGroup("test-group")
    .withApiKey("test-group", "test-key")
    .build();

  try {
    const service = createSecretsService(ctx);
    const routes = await ctx.routesService.getAll();
    const functionId = routes[0].id;
    const group = await ctx.apiKeyService.getGroupByName("test-group");
    const keys = await ctx.apiKeyService.getKeys("test-group");

    await service.createGlobalSecret("API_KEY", "global");
    await service.createFunctionSecret(functionId, "API_KEY", "function");
    await service.createGroupSecret(group!.id, "API_KEY", "group");
    await service.createKeySecret(keys![0].id, "API_KEY", "key");

    const result = await service.getCompleteSecret(
      "API_KEY",
      functionId,
      group!.id,
      keys![0].id
    );

    expect(result).not.toBeUndefined();
    expect(result!.global).toBe("global");
    expect(result!.function).toBe("function");
    expect(result!.group?.value).toBe("group");
    expect(result!.group?.groupName).toBe("test-group");
    expect(result!.key?.value).toBe("key");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SecretsService.getCompleteSecret returns undefined when secret doesn't exist", async () => {
  const ctx = await TestSetupBuilder.create()
    .withEncryption()
    .withRoute("/test", "test.ts")
    .build();

  try {
    const service = createSecretsService(ctx);
    const routes = await ctx.routesService.getAll();

    const result = await service.getCompleteSecret("NONEXISTENT", routes[0].id);
    expect(result).toBeUndefined();
  } finally {
    await ctx.cleanup();
  }
});

// =====================
// Preview Tests
// =====================

Deno.test("SecretsService.getSecretsPreviewForFunction returns aggregated secrets", async () => {
  const ctx = await TestSetupBuilder.create()
    .withEncryption()
    .withRoute("/test", "test.ts")
    .withApiKeyGroup("allowed-group")
    .withApiKey("allowed-group", "allowed-key")
    .build();

  try {
    const service = createSecretsService(ctx);
    const routes = await ctx.routesService.getAll();
    const functionId = routes[0].id;
    const group = await ctx.apiKeyService.getGroupByName("allowed-group");
    const keys = await ctx.apiKeyService.getKeys("allowed-group");

    // Create secrets at different scopes
    await service.createGlobalSecret("SHARED_SECRET", "global");
    await service.createFunctionSecret(functionId, "SHARED_SECRET", "function");
    await service.createGroupSecret(group!.id, "SHARED_SECRET", "group");
    await service.createKeySecret(keys![0].id, "SHARED_SECRET", "key");
    await service.createGlobalSecret("GLOBAL_ONLY", "global-only");

    const preview = await service.getSecretsPreviewForFunction(functionId, ["allowed-group"]);

    expect(preview.length).toBe(2);

    // Find SHARED_SECRET - should have 4 sources
    const shared = preview.find((p) => p.name === "SHARED_SECRET");
    expect(shared!.sources.length).toBe(4);
    expect(shared!.sources.map((s) => s.scope).sort()).toEqual(
      ["function", "global", "group", "key"].sort()
    );

    // Find GLOBAL_ONLY - should have 1 source
    const globalOnly = preview.find((p) => p.name === "GLOBAL_ONLY");
    expect(globalOnly!.sources.length).toBe(1);
    expect(globalOnly!.sources[0].scope).toBe("global");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SecretsService.getSecretsPreviewForFunction respects accepted groups", async () => {
  const ctx = await TestSetupBuilder.create()
    .withEncryption()
    .withRoute("/test", "test.ts")
    .withApiKeyGroup("allowed-group")
    .withApiKeyGroup("blocked-group")
    .build();

  try {
    const service = createSecretsService(ctx);
    const routes = await ctx.routesService.getAll();
    const allowed = await ctx.apiKeyService.getGroupByName("allowed-group");
    const blocked = await ctx.apiKeyService.getGroupByName("blocked-group");

    await service.createGroupSecret(allowed!.id, "ALLOWED_SECRET", "allowed");
    await service.createGroupSecret(blocked!.id, "BLOCKED_SECRET", "blocked");

    // Only allow "allowed-group"
    const preview = await service.getSecretsPreviewForFunction(routes[0].id, ["allowed-group"]);

    const names = preview.map((p) => p.name);
    expect(names).toContain("ALLOWED_SECRET");
    expect(names).not.toContain("BLOCKED_SECRET");
  } finally {
    await ctx.cleanup();
  }
});

// =====================
// Encryption at Rest Tests
// =====================

Deno.test("SecretsService stores values encrypted in database", async () => {
  const ctx = await TestSetupBuilder.create().withEncryption().build();

  try {
    const service = createSecretsService(ctx);
    await service.createGlobalSecret("MY_SECRET", "plaintext-value");

    // Query raw database value
    const row = await ctx.db.queryOne<{ value: string }>(
      "SELECT value FROM secrets LIMIT 1"
    );

    // Should NOT be plaintext
    expect(row!.value).not.toBe("plaintext-value");
    // Should be base64 (encrypted format)
    expect(row!.value).toMatch(/^[A-Za-z0-9+/=]+$/);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SecretsService decrypts values correctly", async () => {
  const ctx = await TestSetupBuilder.create().withEncryption().build();

  try {
    const service = createSecretsService(ctx);
    await service.createGlobalSecret("MY_SECRET", "plaintext-value");

    const secrets = await service.getGlobalSecretsWithValues();
    expect(secrets[0].value).toBe("plaintext-value");
    expect(secrets[0].decryptionError).toBeUndefined();
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SecretsService handles unicode and emoji correctly", async () => {
  const ctx = await TestSetupBuilder.create().withEncryption().build();

  try {
    const service = createSecretsService(ctx);
    const unicodeValue = "日本語 🎌 émojis 🚀 τέστ";

    await service.createGlobalSecret("UNICODE_SECRET", unicodeValue);

    const secrets = await service.getGlobalSecretsWithValues();
    expect(secrets[0].value).toBe(unicodeValue);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SecretsService handles long values correctly", async () => {
  const ctx = await TestSetupBuilder.create().withEncryption().build();

  try {
    const service = createSecretsService(ctx);
    const longValue = "x".repeat(10000);

    await service.createGlobalSecret("LONG_SECRET", longValue);

    const secrets = await service.getGlobalSecretsWithValues();
    expect(secrets[0].value).toBe(longValue);
    expect(secrets[0].value.length).toBe(10000);
  } finally {
    await ctx.cleanup();
  }
});
