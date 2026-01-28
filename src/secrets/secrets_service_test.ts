import { expect } from "@std/expect";
import { TestSetupBuilder } from "../test/test_setup_builder.ts";
import { integrationTest } from "../test/test_helpers.ts";
import { SecretsService } from "./secrets_service.ts";
import { recordIdToString } from "../database/surreal_helpers.ts";

/**
 * Helper to create SecretsService from TestSetupBuilder context.
 * SecretsService depends on surrealFactory + encryptionService, which TestSetupBuilder provides
 * when using .withEncryption() or any service that depends on encryption.
 */
function createSecretsService(ctx: {
  surrealFactory: import("../database/surreal_connection_factory.ts").SurrealConnectionFactory;
  encryptionService: import("../encryption/types.ts").IEncryptionService;
}): SecretsService {
  return new SecretsService({
    surrealFactory: ctx.surrealFactory,
    encryptionService: ctx.encryptionService,
  });
}

// =====================
// Name Validation Tests (tested via create methods that call validateSecretName)
// =====================

integrationTest("SecretsService.createGlobalSecret rejects empty name", async () => {
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

integrationTest("SecretsService.createGlobalSecret rejects whitespace-only name", async () => {
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

integrationTest("SecretsService.createGlobalSecret rejects names with spaces", async () => {
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

integrationTest("SecretsService.createGlobalSecret rejects names with special chars", async () => {
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

integrationTest("SecretsService.createGlobalSecret accepts valid names", async () => {
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

integrationTest("SecretsService.getGlobalSecrets returns empty array initially", async () => {
  const ctx = await TestSetupBuilder.create().withEncryption().build();

  try {
    const service = createSecretsService(ctx);
    const secrets = await service.getGlobalSecrets();
    expect(secrets).toEqual([]);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("SecretsService.createGlobalSecret creates secret and returns in list", async () => {
  const ctx = await TestSetupBuilder.create().withEncryption().build();

  try {
    const service = createSecretsService(ctx);
    await service.createGlobalSecret("API_KEY", "secret-value", "Test comment");

    const secrets = await service.getGlobalSecrets();
    expect(secrets.length).toBe(1);
    expect(secrets[0].name).toBe("API_KEY");
    expect(secrets[0].comment).toBe("Test comment");
    expect(secrets[0].scopeType).toBe("global");
    expect(secrets[0].value).toBe("secret-value");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("SecretsService.getGlobalSecretById returns secret with decrypted value", async () => {
  const ctx = await TestSetupBuilder.create().withEncryption().build();

  try {
    const service = createSecretsService(ctx);
    await service.createGlobalSecret("API_KEY", "my-secret-value", "Comment");

    const secrets = await service.getGlobalSecrets();
    const secretId = recordIdToString(secrets[0].id);
    const secret = await service.getGlobalSecretById(secretId);

    expect(secret).not.toBeNull();
    expect(secret!.name).toBe("API_KEY");
    expect(secret!.value).toBe("my-secret-value");
    expect(secret!.comment).toBe("Comment");
    expect(secret!.scopeType).toBe("global");
    expect(secret!.scopeRef).toBeUndefined();
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("SecretsService.getGlobalSecretById returns null for nonexistent ID", async () => {
  const ctx = await TestSetupBuilder.create().withEncryption().build();

  try {
    const service = createSecretsService(ctx);
    const secret = await service.getGlobalSecretById("nonexistent");
    expect(secret).toBeNull();
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("SecretsService.getGlobalSecrets returns all secrets with decrypted values", async () => {
  const ctx = await TestSetupBuilder.create().withEncryption().build();

  try {
    const service = createSecretsService(ctx);
    await service.createGlobalSecret("SECRET_1", "value-1", "First");
    await service.createGlobalSecret("SECRET_2", "value-2", "Second");

    const secrets = await service.getGlobalSecrets();
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

integrationTest("SecretsService.createGlobalSecret rejects duplicate names", async () => {
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

integrationTest("SecretsService.updateGlobalSecret updates value and comment", async () => {
  const ctx = await TestSetupBuilder.create().withEncryption().build();

  try {
    const service = createSecretsService(ctx);
    await service.createGlobalSecret("MY_SECRET", "old-value", "Old comment");

    const secrets = await service.getGlobalSecrets();
    const secretId = recordIdToString(secrets[0].id);
    await service.updateGlobalSecret(secretId, "new-value", "New comment");

    const updated = await service.getGlobalSecretById(secretId);
    expect(updated!.value).toBe("new-value");
    expect(updated!.comment).toBe("New comment");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("SecretsService.updateGlobalSecret throws for nonexistent ID", async () => {
  const ctx = await TestSetupBuilder.create().withEncryption().build();

  try {
    const service = createSecretsService(ctx);
    await expect(
      service.updateGlobalSecret("nonexistent", "value")
    ).rejects.toThrow("Secret with ID nonexistent not found");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("SecretsService.deleteGlobalSecret removes secret", async () => {
  const ctx = await TestSetupBuilder.create().withEncryption().build();

  try {
    const service = createSecretsService(ctx);
    await service.createGlobalSecret("TO_DELETE", "value");

    const secrets = await service.getGlobalSecrets();
    expect(secrets.length).toBe(1);

    await service.deleteGlobalSecret(recordIdToString(secrets[0].id));

    const afterDelete = await service.getGlobalSecrets();
    expect(afterDelete.length).toBe(0);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("SecretsService.deleteGlobalSecret throws for nonexistent ID", async () => {
  const ctx = await TestSetupBuilder.create().withEncryption().build();

  try {
    const service = createSecretsService(ctx);
    await expect(service.deleteGlobalSecret("nonexistent")).rejects.toThrow(
      "Secret with ID nonexistent not found"
    );
  } finally {
    await ctx.cleanup();
  }
});

// =====================
// Function Secrets CRUD Tests
// =====================

integrationTest("SecretsService.getFunctionSecrets returns empty array initially", async () => {
  const ctx = await TestSetupBuilder.create()
    .withEncryption()
    .withFunction("/test", "test.ts")
    .build();

  try {
    const service = createSecretsService(ctx);
    const routes = await ctx.functionsService.getAll();
    const functionId = recordIdToString(routes[0].id);
    const secrets = await service.getFunctionSecrets(functionId);
    expect(secrets).toEqual([]);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("SecretsService.createFunctionSecret creates function-scoped secret", async () => {
  const ctx = await TestSetupBuilder.create()
    .withEncryption()
    .withFunction("/test", "test.ts")
    .build();

  try {
    const service = createSecretsService(ctx);
    const routes = await ctx.functionsService.getAll();
    const functionId = recordIdToString(routes[0].id);

    await service.createFunctionSecret(functionId, "FUNC_SECRET", "value", "Comment");

    const secrets = await service.getFunctionSecrets(functionId);
    expect(secrets.length).toBe(1);
    expect(secrets[0].name).toBe("FUNC_SECRET");
    expect(secrets[0].value).toBe("value");
    expect(secrets[0].scopeType).toBe("function");
    expect(secrets[0].scopeRef).not.toBeNull();
    expect(recordIdToString(secrets[0].scopeRef!)).toBe(functionId);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("SecretsService.createFunctionSecret allows same name in different functions", async () => {
  const ctx = await TestSetupBuilder.create()
    .withEncryption()
    .withFunction("/func1", "func1.ts")
    .withFunction("/func2", "func2.ts")
    .build();

  try {
    const service = createSecretsService(ctx);
    const routes = await ctx.functionsService.getAll();
    const functionId1 = recordIdToString(routes[0].id);
    const functionId2 = recordIdToString(routes[1].id);

    // Same secret name in two different functions - should be allowed
    await service.createFunctionSecret(functionId1, "SHARED_NAME", "value1");
    await service.createFunctionSecret(functionId2, "SHARED_NAME", "value2");

    const secrets1 = await service.getFunctionSecrets(functionId1);
    const secrets2 = await service.getFunctionSecrets(functionId2);

    expect(secrets1[0].value).toBe("value1");
    expect(secrets2[0].value).toBe("value2");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("SecretsService.createFunctionSecret rejects duplicate names in same function", async () => {
  const ctx = await TestSetupBuilder.create()
    .withEncryption()
    .withFunction("/test", "test.ts")
    .build();

  try {
    const service = createSecretsService(ctx);
    const routes = await ctx.functionsService.getAll();
    const functionId = recordIdToString(routes[0].id);

    await service.createFunctionSecret(functionId, "DUPLICATE", "value1");

    await expect(
      service.createFunctionSecret(functionId, "DUPLICATE", "value2")
    ).rejects.toThrow("A secret with name 'DUPLICATE' already exists for this function");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("SecretsService.getFunctionSecretById returns correct secret", async () => {
  const ctx = await TestSetupBuilder.create()
    .withEncryption()
    .withFunction("/test", "test.ts")
    .build();

  try {
    const service = createSecretsService(ctx);
    const routes = await ctx.functionsService.getAll();
    const functionId = recordIdToString(routes[0].id);

    await service.createFunctionSecret(functionId, "MY_SECRET", "secret-value");

    const secrets = await service.getFunctionSecrets(functionId);
    const secret = await service.getFunctionSecretById(functionId, recordIdToString(secrets[0].id));

    expect(secret!.value).toBe("secret-value");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("SecretsService.updateFunctionSecret updates value", async () => {
  const ctx = await TestSetupBuilder.create()
    .withEncryption()
    .withFunction("/test", "test.ts")
    .build();

  try {
    const service = createSecretsService(ctx);
    const routes = await ctx.functionsService.getAll();
    const functionId = recordIdToString(routes[0].id);

    await service.createFunctionSecret(functionId, "MY_SECRET", "old");
    const secrets = await service.getFunctionSecrets(functionId);
    const secretId = recordIdToString(secrets[0].id);

    await service.updateFunctionSecret(functionId, secretId, "new", "Updated");

    const updated = await service.getFunctionSecretById(functionId, secretId);
    expect(updated!.value).toBe("new");
    expect(updated!.comment).toBe("Updated");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("SecretsService.deleteFunctionSecret removes secret", async () => {
  const ctx = await TestSetupBuilder.create()
    .withEncryption()
    .withFunction("/test", "test.ts")
    .build();

  try {
    const service = createSecretsService(ctx);
    const routes = await ctx.functionsService.getAll();
    const functionId = recordIdToString(routes[0].id);

    await service.createFunctionSecret(functionId, "TO_DELETE", "value");
    const secrets = await service.getFunctionSecrets(functionId);

    await service.deleteFunctionSecret(functionId, recordIdToString(secrets[0].id));

    const remaining = await service.getFunctionSecrets(functionId);
    expect(remaining.length).toBe(0);
  } finally {
    await ctx.cleanup();
  }
});

// =====================
// Group Secrets CRUD Tests
// =====================

integrationTest("SecretsService.getGroupSecrets returns empty array initially", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeyGroup("test-group")
    .build();

  try {
    const service = createSecretsService(ctx);
    const group = await ctx.apiKeyService.getGroupByName("test-group");
    const secrets = await service.getGroupSecrets(recordIdToString(group!.id));
    expect(secrets).toEqual([]);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("SecretsService.createGroupSecret creates group-scoped secret", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeyGroup("test-group")
    .build();

  try {
    const service = createSecretsService(ctx);
    const group = await ctx.apiKeyService.getGroupByName("test-group");
    const groupIdStr = recordIdToString(group!.id);

    await service.createGroupSecret(groupIdStr, "GROUP_SECRET", "value", "Comment");

    const secrets = await service.getGroupSecrets(groupIdStr);
    expect(secrets.length).toBe(1);
    expect(secrets[0].name).toBe("GROUP_SECRET");
    expect(secrets[0].value).toBe("value");
    expect(secrets[0].scopeType).toBe("group");
    expect(secrets[0].scopeRef).not.toBeNull();
    expect(recordIdToString(secrets[0].scopeRef!)).toBe(groupIdStr);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("SecretsService.createGroupSecret allows same name in different groups", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeyGroup("group1")
    .withApiKeyGroup("group2")
    .build();

  try {
    const service = createSecretsService(ctx);
    const group1 = await ctx.apiKeyService.getGroupByName("group1");
    const group2 = await ctx.apiKeyService.getGroupByName("group2");
    const group1IdStr = recordIdToString(group1!.id);
    const group2IdStr = recordIdToString(group2!.id);

    await service.createGroupSecret(group1IdStr, "SHARED_NAME", "value1");
    await service.createGroupSecret(group2IdStr, "SHARED_NAME", "value2");

    const secrets1 = await service.getGroupSecrets(group1IdStr);
    const secrets2 = await service.getGroupSecrets(group2IdStr);

    expect(secrets1[0].value).toBe("value1");
    expect(secrets2[0].value).toBe("value2");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("SecretsService.updateGroupSecret updates value", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeyGroup("test-group")
    .build();

  try {
    const service = createSecretsService(ctx);
    const group = await ctx.apiKeyService.getGroupByName("test-group");
    const groupIdStr = recordIdToString(group!.id);

    await service.createGroupSecret(groupIdStr, "MY_SECRET", "old");
    const secrets = await service.getGroupSecrets(groupIdStr);
    const secretId = recordIdToString(secrets[0].id);

    await service.updateGroupSecret(groupIdStr, secretId, "new", "Updated");

    const updated = await service.getGroupSecretById(groupIdStr, secretId);
    expect(updated!.value).toBe("new");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("SecretsService.deleteGroupSecret removes secret", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeyGroup("test-group")
    .build();

  try {
    const service = createSecretsService(ctx);
    const group = await ctx.apiKeyService.getGroupByName("test-group");
    const groupIdStr = recordIdToString(group!.id);

    await service.createGroupSecret(groupIdStr, "TO_DELETE", "value");
    const secrets = await service.getGroupSecrets(groupIdStr);

    await service.deleteGroupSecret(groupIdStr, recordIdToString(secrets[0].id));

    const remaining = await service.getGroupSecrets(groupIdStr);
    expect(remaining.length).toBe(0);
  } finally {
    await ctx.cleanup();
  }
});

// =====================
// Key Secrets CRUD Tests
// =====================

integrationTest("SecretsService.getKeySecrets returns empty array initially", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeyGroup("test-group")
    .withApiKey("test-group", "test-key-value")
    .build();

  try {
    const service = createSecretsService(ctx);
    const keys = await ctx.apiKeyService.getKeys("test-group");
    const secrets = await service.getKeySecrets(recordIdToString(keys![0].id));
    expect(secrets).toEqual([]);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("SecretsService.createKeySecret creates key-scoped secret", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeyGroup("test-group")
    .withApiKey("test-group", "test-key-value")
    .build();

  try {
    const service = createSecretsService(ctx);
    const keys = await ctx.apiKeyService.getKeys("test-group");
    const keyId = recordIdToString(keys![0].id);

    await service.createKeySecret(keyId, "KEY_SECRET", "value", "Comment");

    const secrets = await service.getKeySecrets(keyId);
    expect(secrets.length).toBe(1);
    expect(secrets[0].name).toBe("KEY_SECRET");
    expect(secrets[0].value).toBe("value");
    expect(secrets[0].scopeType).toBe("key");
    expect(secrets[0].scopeRef).not.toBeNull();
    expect(recordIdToString(secrets[0].scopeRef!)).toBe(keyId);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("SecretsService.createKeySecret allows same name on different keys", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeyGroup("test-group")
    .withApiKey("test-group", "key1")
    .withApiKey("test-group", "key2", "key-2")
    .build();

  try {
    const service = createSecretsService(ctx);
    const keys = await ctx.apiKeyService.getKeys("test-group");
    const key1Id = recordIdToString(keys![0].id);
    const key2Id = recordIdToString(keys![1].id);

    await service.createKeySecret(key1Id, "SHARED_NAME", "value1");
    await service.createKeySecret(key2Id, "SHARED_NAME", "value2");

    const secrets1 = await service.getKeySecrets(key1Id);
    const secrets2 = await service.getKeySecrets(key2Id);

    expect(secrets1[0].value).toBe("value1");
    expect(secrets2[0].value).toBe("value2");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("SecretsService.updateKeySecret updates value", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeyGroup("test-group")
    .withApiKey("test-group", "test-key")
    .build();

  try {
    const service = createSecretsService(ctx);
    const keys = await ctx.apiKeyService.getKeys("test-group");
    const keyId = recordIdToString(keys![0].id);

    await service.createKeySecret(keyId, "MY_SECRET", "old");
    const secrets = await service.getKeySecrets(keyId);
    const secretId = recordIdToString(secrets[0].id);

    await service.updateKeySecret(keyId, secretId, "new", "Updated");

    const updated = await service.getKeySecretById(keyId, secretId);
    expect(updated!.value).toBe("new");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("SecretsService.deleteKeySecret removes secret", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeyGroup("test-group")
    .withApiKey("test-group", "test-key")
    .build();

  try {
    const service = createSecretsService(ctx);
    const keys = await ctx.apiKeyService.getKeys("test-group");
    const keyId = recordIdToString(keys![0].id);

    await service.createKeySecret(keyId, "TO_DELETE", "value");
    const secrets = await service.getKeySecrets(keyId);

    await service.deleteKeySecret(keyId, recordIdToString(secrets[0].id));

    const remaining = await service.getKeySecrets(keyId);
    expect(remaining.length).toBe(0);
  } finally {
    await ctx.cleanup();
  }
});

// =====================
// Hierarchical Resolution Tests
// =====================

integrationTest("SecretsService.getSecretByScope returns correct scope", async () => {
  const ctx = await TestSetupBuilder.create()
    .withEncryption()
    .withFunction("/test", "test.ts")
    .withApiKeyGroup("test-group")
    .withApiKey("test-group", "test-key")
    .build();

  try {
    const service = createSecretsService(ctx);
    const routes = await ctx.functionsService.getAll();
    const functionId = recordIdToString(routes[0].id);
    const group = await ctx.apiKeyService.getGroupByName("test-group");
    const keys = await ctx.apiKeyService.getKeys("test-group");
    const groupIdStr = recordIdToString(group!.id);
    const keyIdStr = recordIdToString(keys![0].id);

    // Create secrets in different scopes with same name
    await service.createGlobalSecret("API_KEY", "global-value");
    await service.createFunctionSecret(functionId, "API_KEY", "function-value");
    await service.createGroupSecret(groupIdStr, "API_KEY", "group-value");
    await service.createKeySecret(keyIdStr, "API_KEY", "key-value");

    // Query each scope explicitly
    const globalVal = await service.getSecretByScope("API_KEY", "global");
    expect(globalVal).toBe("global-value");

    const funcVal = await service.getSecretByScope("API_KEY", "function", functionId);
    expect(funcVal).toBe("function-value");

    const groupVal = await service.getSecretByScope("API_KEY", "group", undefined, groupIdStr);
    expect(groupVal).toBe("group-value");

    const keyVal = await service.getSecretByScope("API_KEY", "key", undefined, undefined, keyIdStr);
    expect(keyVal).toBe("key-value");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("SecretsService.getSecretHierarchical returns most specific value (key > group > function > global)", async () => {
  const ctx = await TestSetupBuilder.create()
    .withEncryption()
    .withFunction("/test", "test.ts")
    .withApiKeyGroup("test-group")
    .withApiKey("test-group", "test-key")
    .build();

  try {
    const service = createSecretsService(ctx);
    const routes = await ctx.functionsService.getAll();
    const functionId = recordIdToString(routes[0].id);
    const group = await ctx.apiKeyService.getGroupByName("test-group");
    const keys = await ctx.apiKeyService.getKeys("test-group");
    const groupIdStr = recordIdToString(group!.id);
    const keyIdStr = recordIdToString(keys![0].id);

    // Create secret at all levels
    await service.createGlobalSecret("API_KEY", "global");
    await service.createFunctionSecret(functionId, "API_KEY", "function");
    await service.createGroupSecret(groupIdStr, "API_KEY", "group");
    await service.createKeySecret(keyIdStr, "API_KEY", "key");

    // Key is most specific
    const result = await service.getSecretHierarchical(
      "API_KEY",
      functionId,
      groupIdStr,
      keyIdStr
    );
    expect(result).toBe("key");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("SecretsService.getSecretHierarchical falls back through hierarchy", async () => {
  const ctx = await TestSetupBuilder.create()
    .withEncryption()
    .withFunction("/test", "test.ts")
    .withApiKeyGroup("test-group")
    .withApiKey("test-group", "test-key")
    .build();

  try {
    const service = createSecretsService(ctx);
    const routes = await ctx.functionsService.getAll();
    const functionId = recordIdToString(routes[0].id);
    const group = await ctx.apiKeyService.getGroupByName("test-group");
    const keys = await ctx.apiKeyService.getKeys("test-group");
    const groupIdStr = recordIdToString(group!.id);
    const keyIdStr = recordIdToString(keys![0].id);

    // Only global and function exist
    await service.createGlobalSecret("API_KEY", "global");
    await service.createFunctionSecret(functionId, "API_KEY", "function");

    // Should return function (next most specific after missing key/group)
    const result = await service.getSecretHierarchical(
      "API_KEY",
      functionId,
      groupIdStr,
      keyIdStr
    );
    expect(result).toBe("function");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("SecretsService.getSecretHierarchical returns global as fallback", async () => {
  const ctx = await TestSetupBuilder.create()
    .withEncryption()
    .withFunction("/test", "test.ts")
    .build();

  try {
    const service = createSecretsService(ctx);
    const routes = await ctx.functionsService.getAll();
    const functionId = recordIdToString(routes[0].id);

    await service.createGlobalSecret("API_KEY", "global");

    // Only functionId provided, no group/key
    const result = await service.getSecretHierarchical("API_KEY", functionId);
    expect(result).toBe("global");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("SecretsService.getSecretHierarchical returns undefined when not found", async () => {
  const ctx = await TestSetupBuilder.create()
    .withEncryption()
    .withFunction("/test", "test.ts")
    .build();

  try {
    const service = createSecretsService(ctx);
    const routes = await ctx.functionsService.getAll();
    const functionId = recordIdToString(routes[0].id);

    const result = await service.getSecretHierarchical("NONEXISTENT", functionId);
    expect(result).toBeUndefined();
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("SecretsService.getCompleteSecret returns all scopes", async () => {
  const ctx = await TestSetupBuilder.create()
    .withEncryption()
    .withFunction("/test", "test.ts")
    .withApiKeyGroup("test-group")
    .withApiKey("test-group", "test-key")
    .build();

  try {
    const service = createSecretsService(ctx);
    const routes = await ctx.functionsService.getAll();
    const functionId = recordIdToString(routes[0].id);
    const group = await ctx.apiKeyService.getGroupByName("test-group");
    const keys = await ctx.apiKeyService.getKeys("test-group");
    const groupIdStr = recordIdToString(group!.id);
    const keyIdStr = recordIdToString(keys![0].id);

    await service.createGlobalSecret("API_KEY", "global");
    await service.createFunctionSecret(functionId, "API_KEY", "function");
    await service.createGroupSecret(groupIdStr, "API_KEY", "group");
    await service.createKeySecret(keyIdStr, "API_KEY", "key");

    const result = await service.getCompleteSecret(
      "API_KEY",
      functionId,
      groupIdStr,
      keyIdStr
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

integrationTest("SecretsService.getCompleteSecret returns undefined when secret doesn't exist", async () => {
  const ctx = await TestSetupBuilder.create()
    .withEncryption()
    .withFunction("/test", "test.ts")
    .build();

  try {
    const service = createSecretsService(ctx);
    const routes = await ctx.functionsService.getAll();
    const functionId = recordIdToString(routes[0].id);

    const result = await service.getCompleteSecret("NONEXISTENT", functionId);
    expect(result).toBeUndefined();
  } finally {
    await ctx.cleanup();
  }
});

// =====================
// Preview Tests
// =====================

integrationTest("SecretsService.getSecretsPreviewForFunction returns aggregated secrets", async () => {
  const ctx = await TestSetupBuilder.create()
    .withEncryption()
    .withFunction("/test", "test.ts")
    .withApiKeyGroup("allowed-group")
    .withApiKey("allowed-group", "allowed-key")
    .build();

  try {
    const service = createSecretsService(ctx);
    const routes = await ctx.functionsService.getAll();
    const functionId = recordIdToString(routes[0].id);
    const group = await ctx.apiKeyService.getGroupByName("allowed-group");
    const keys = await ctx.apiKeyService.getKeys("allowed-group");
    const groupIdStr = recordIdToString(group!.id);
    const keyIdStr = recordIdToString(keys![0].id);

    // Create secrets at different scopes
    await service.createGlobalSecret("SHARED_SECRET", "global");
    await service.createFunctionSecret(functionId, "SHARED_SECRET", "function");
    await service.createGroupSecret(groupIdStr, "SHARED_SECRET", "group");
    await service.createKeySecret(keyIdStr, "SHARED_SECRET", "key");
    await service.createGlobalSecret("GLOBAL_ONLY", "global-only");

    const preview = await service.getSecretsPreviewForFunction(functionId, [groupIdStr]);

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

integrationTest("SecretsService.getSecretsPreviewForFunction respects accepted groups", async () => {
  const ctx = await TestSetupBuilder.create()
    .withEncryption()
    .withFunction("/test", "test.ts")
    .withApiKeyGroup("allowed-group")
    .withApiKeyGroup("blocked-group")
    .build();

  try {
    const service = createSecretsService(ctx);
    const routes = await ctx.functionsService.getAll();
    const functionId = recordIdToString(routes[0].id);
    const allowed = await ctx.apiKeyService.getGroupByName("allowed-group");
    const blocked = await ctx.apiKeyService.getGroupByName("blocked-group");
    const allowedIdStr = recordIdToString(allowed!.id);
    const blockedIdStr = recordIdToString(blocked!.id);

    await service.createGroupSecret(allowedIdStr, "ALLOWED_SECRET", "allowed");
    await service.createGroupSecret(blockedIdStr, "BLOCKED_SECRET", "blocked");

    // Only allow "allowed-group"
    const preview = await service.getSecretsPreviewForFunction(functionId, [allowedIdStr]);

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

integrationTest("SecretsService stores values encrypted in database", async () => {
  const ctx = await TestSetupBuilder.create().withEncryption().build();

  try {
    const service = createSecretsService(ctx);
    await service.createGlobalSecret("MY_SECRET", "plaintext-value");

    // Query raw database value from SurrealDB
    const row = await ctx.surrealFactory.withSystemConnection({}, async (db) => {
      const [rows] = await db.query<[{ value: string }[]]>(
        `SELECT * FROM secret WHERE name = "MY_SECRET" LIMIT 1`
      );
      return rows?.[0];
    });

    // Should NOT be plaintext
    expect(row!.value).not.toBe("plaintext-value");
    // Should be base64 (encrypted format)
    expect(row!.value).toMatch(/^[A-Za-z0-9+/=]+$/);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("SecretsService decrypts values correctly", async () => {
  const ctx = await TestSetupBuilder.create().withEncryption().build();

  try {
    const service = createSecretsService(ctx);
    await service.createGlobalSecret("MY_SECRET", "plaintext-value");

    const secrets = await service.getGlobalSecrets();
    expect(secrets[0].value).toBe("plaintext-value");
    expect(secrets[0].decryptionError).toBeUndefined();
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("SecretsService handles unicode and emoji correctly", async () => {
  const ctx = await TestSetupBuilder.create().withEncryption().build();

  try {
    const service = createSecretsService(ctx);
    const unicodeValue = "日本語 🎌 émojis 🚀 τέστ";

    await service.createGlobalSecret("UNICODE_SECRET", unicodeValue);

    const secrets = await service.getGlobalSecrets();
    expect(secrets[0].value).toBe(unicodeValue);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("SecretsService handles long values correctly", async () => {
  const ctx = await TestSetupBuilder.create().withEncryption().build();

  try {
    const service = createSecretsService(ctx);
    const longValue = "x".repeat(10000);

    await service.createGlobalSecret("LONG_SECRET", longValue);

    const secrets = await service.getGlobalSecrets();
    expect(secrets[0].value).toBe(longValue);
    expect(secrets[0].value.length).toBe(10000);
  } finally {
    await ctx.cleanup();
  }
});
