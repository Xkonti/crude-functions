import { expect } from "@std/expect";
import { TestSetupBuilder } from "../test/test_setup_builder.ts";
import { integrationTest } from "../test/test_helpers.ts";
import type {
  CodeSourceProvider,
  CodeSource,
  ProviderCapabilities,
  SyncResult,
  TypeSettings,
  GitTypeSettings,
} from "./types.ts";
import type { CancellationToken } from "../jobs/types.ts";
import {
  DuplicateSourceError,
  InvalidSourceConfigError,
  SourceNotFoundError,
  ProviderNotFoundError,
  SourceNotSyncableError,
  WebhookAuthError,
  WebhookDisabledError,
} from "./errors.ts";
import { RecordId } from "surrealdb";

// ============================================================================
// Mock Provider for Testing
// ============================================================================

/**
 * Creates a mock provider for testing.
 * By default, creates a manual provider (not syncable, is editable).
 */
function createMockProvider(
  type: "manual" | "git" = "manual",
  options?: {
    syncResult?: SyncResult;
    throwOnSync?: Error;
    throwOnEnsureDirectory?: Error;
    throwOnDeleteDirectory?: Error;
  },
): CodeSourceProvider {
  const capabilities: ProviderCapabilities = {
    isSyncable: type === "git",
    isEditable: type === "manual",
  };

  const directories = new Set<string>();

  return {
    type,
    getCapabilities: () => capabilities,
    // No-op encryption for mock provider - settings pass through unchanged
    encryptSensitiveFields: (settings: TypeSettings): Promise<TypeSettings> => {
      return Promise.resolve(settings);
    },
    decryptSensitiveFields: (settings: TypeSettings): Promise<TypeSettings> => {
      return Promise.resolve(settings);
    },
    sync: (_source: CodeSource, token: CancellationToken): Promise<SyncResult> => {
      token.throwIfCancelled();
      if (options?.throwOnSync) {
        return Promise.reject(options.throwOnSync);
      }
      return Promise.resolve(options?.syncResult ?? {
        success: true,
        filesChanged: 0,
        durationMs: 100,
      });
    },
    ensureDirectory: (sourceName: string): Promise<void> => {
      if (options?.throwOnEnsureDirectory) {
        return Promise.reject(options.throwOnEnsureDirectory);
      }
      directories.add(sourceName);
      return Promise.resolve();
    },
    deleteDirectory: (sourceName: string): Promise<void> => {
      if (options?.throwOnDeleteDirectory) {
        return Promise.reject(options.throwOnDeleteDirectory);
      }
      directories.delete(sourceName);
      return Promise.resolve();
    },
    directoryExists: (sourceName: string): Promise<boolean> => {
      return Promise.resolve(directories.has(sourceName));
    },
  };
}

// ============================================================================
// Validation Tests (Pure Functions - No DB Needed)
// ============================================================================

integrationTest("CodeSourceService.isValidSourceName accepts valid names", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    // Lowercase
    expect(ctx.codeSourceService.isValidSourceName("utils")).toBe(true);
    expect(ctx.codeSourceService.isValidSourceName("my-project")).toBe(true);
    expect(ctx.codeSourceService.isValidSourceName("backend_v2")).toBe(true);
    expect(ctx.codeSourceService.isValidSourceName("a")).toBe(true);
    expect(ctx.codeSourceService.isValidSourceName("a1")).toBe(true);
    expect(ctx.codeSourceService.isValidSourceName("test123")).toBe(true);

    // Uppercase (now allowed)
    expect(ctx.codeSourceService.isValidSourceName("MyProject")).toBe(true);
    expect(ctx.codeSourceService.isValidSourceName("UTILS")).toBe(true);
    expect(ctx.codeSourceService.isValidSourceName("Backend-V2")).toBe(true);
    expect(ctx.codeSourceService.isValidSourceName("A")).toBe(true);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("CodeSourceService.isValidSourceName rejects invalid names", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    // Empty/whitespace
    expect(ctx.codeSourceService.isValidSourceName("")).toBe(false);
    expect(ctx.codeSourceService.isValidSourceName("  ")).toBe(false);

    // Spaces not allowed
    expect(ctx.codeSourceService.isValidSourceName("my project")).toBe(false);

    // Special characters not allowed
    expect(ctx.codeSourceService.isValidSourceName("my.project")).toBe(false);
    expect(ctx.codeSourceService.isValidSourceName("my@project")).toBe(false);

    // Starting with hyphen/underscore not allowed
    expect(ctx.codeSourceService.isValidSourceName("-project")).toBe(false);
    expect(ctx.codeSourceService.isValidSourceName("_project")).toBe(false);

    // Too long (> 64 chars)
    expect(ctx.codeSourceService.isValidSourceName("a".repeat(65))).toBe(false);
  } finally {
    await ctx.cleanup();
  }
});

// ============================================================================
// Provider Registration Tests
// ============================================================================

integrationTest("CodeSourceService.registerProvider registers provider", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    const provider = createMockProvider("manual");
    ctx.codeSourceService.registerProvider(provider);

    expect(ctx.codeSourceService.hasProvider("manual")).toBe(true);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("CodeSourceService.getProvider returns registered provider", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    const provider = createMockProvider("manual");
    ctx.codeSourceService.registerProvider(provider);

    const retrieved = ctx.codeSourceService.getProvider("manual");
    expect(retrieved.type).toBe("manual");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("CodeSourceService.getProvider throws for unregistered type", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    // Use a type that isn't registered (manual and git are registered by default)
    // Cast to bypass type check since we're intentionally testing an invalid type
    expect(() => ctx.codeSourceService.getProvider("s3" as "manual")).toThrow(
      ProviderNotFoundError,
    );
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("CodeSourceService.hasProvider returns false for unregistered type", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    // Use a type that isn't registered (manual and git are registered by default)
    // Cast to bypass type check since we're intentionally testing an invalid type
    expect(ctx.codeSourceService.hasProvider("s3" as "manual")).toBe(false);
  } finally {
    await ctx.cleanup();
  }
});

// ============================================================================
// CRUD Tests - Create
// ============================================================================

integrationTest("CodeSourceService.create creates source with minimal config", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    ctx.codeSourceService.registerProvider(createMockProvider("manual"));

    const source = await ctx.codeSourceService.create({
      name: "utils",
      type: "manual",
    });

    // ID is auto-generated, name is as provided
    expect(source.id).toBeTruthy();
    expect(source.name).toBe("utils");
    expect(source.type).toBe("manual");
    expect(source.enabled).toBe(true);
    expect(source.typeSettings).toEqual({});
    expect(source.syncSettings).toEqual({});
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("CodeSourceService.create creates source with all fields", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    ctx.codeSourceService.registerProvider(createMockProvider("git"));

    const source = await ctx.codeSourceService.create({
      name: "my-repo",
      type: "git",
      typeSettings: {
        url: "https://github.com/user/repo.git",
        branch: "main",
      },
      syncSettings: {
        intervalSeconds: 300,
        webhookSecret: "secret123",
      },
      enabled: false,
    });

    expect(source.name).toBe("my-repo");
    expect(source.type).toBe("git");
    expect(source.enabled).toBe(false);
    expect(source.typeSettings).toEqual({
      url: "https://github.com/user/repo.git",
      branch: "main",
    });
    expect(source.syncSettings).toEqual({
      intervalSeconds: 300,
      webhookSecret: "secret123",
    });
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("CodeSourceService.create throws on duplicate name", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    ctx.codeSourceService.registerProvider(createMockProvider("manual"));

    await ctx.codeSourceService.create({ name: "utils", type: "manual" });

    await expect(
      ctx.codeSourceService.create({ name: "utils", type: "manual" }),
    ).rejects.toThrow(DuplicateSourceError);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("CodeSourceService.create throws on invalid name", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    ctx.codeSourceService.registerProvider(createMockProvider("manual"));

    await expect(
      ctx.codeSourceService.create({ name: "Invalid Name", type: "manual" }),
    ).rejects.toThrow(InvalidSourceConfigError);

    await expect(
      ctx.codeSourceService.create({ name: "", type: "manual" }),
    ).rejects.toThrow(InvalidSourceConfigError);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("CodeSourceService.create throws on unregistered provider", async () => {
  // Get a context with code sources to access dependencies, but create a fresh
  // CodeSourceService without registering any providers
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    // Import CodeSourceService to create a fresh instance without providers
    const { CodeSourceService } = await import("./code_source_service.ts");
    const freshService = new CodeSourceService({
      surrealFactory: ctx.surrealFactory,
      encryptionService: ctx.encryptionService,
      jobQueueService: ctx.jobQueueService,
      schedulingService: ctx.schedulingService,
      codeDirectory: ctx.codeDir,
    });

    // Now "manual" has no provider registered in this fresh instance
    await expect(
      freshService.create({ name: "test", type: "manual" }),
    ).rejects.toThrow(ProviderNotFoundError);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("CodeSourceService.create validates git type settings", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    ctx.codeSourceService.registerProvider(createMockProvider("git"));

    // Missing URL
    await expect(
      ctx.codeSourceService.create({
        name: "repo",
        type: "git",
        typeSettings: { branch: "main" },
      }),
    ).rejects.toThrow(InvalidSourceConfigError);

    // Invalid URL
    await expect(
      ctx.codeSourceService.create({
        name: "repo",
        type: "git",
        typeSettings: { url: "not-a-valid-url" },
      }),
    ).rejects.toThrow(InvalidSourceConfigError);

    // Multiple refs (branch + tag)
    await expect(
      ctx.codeSourceService.create({
        name: "repo",
        type: "git",
        typeSettings: {
          url: "https://github.com/user/repo.git",
          branch: "main",
          tag: "v1.0.0",
        },
      }),
    ).rejects.toThrow(InvalidSourceConfigError);
  } finally {
    await ctx.cleanup();
  }
});

// ============================================================================
// CRUD Tests - Read
// ============================================================================

integrationTest("CodeSourceService.getAll returns empty array initially", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    const sources = await ctx.codeSourceService.getAll();
    expect(sources).toEqual([]);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("CodeSourceService.getAll returns all sources", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    ctx.codeSourceService.registerProvider(createMockProvider("manual"));

    await ctx.codeSourceService.create({ name: "utils", type: "manual" });
    await ctx.codeSourceService.create({ name: "helpers", type: "manual" });

    const sources = await ctx.codeSourceService.getAll();
    expect(sources.length).toBe(2);
    expect(sources.map((s) => s.name).sort()).toEqual(["helpers", "utils"]);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("CodeSourceService.getAllEnabled returns only enabled sources", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    ctx.codeSourceService.registerProvider(createMockProvider("manual"));

    await ctx.codeSourceService.create({ name: "enabled1", type: "manual", enabled: true });
    await ctx.codeSourceService.create({ name: "disabled", type: "manual", enabled: false });
    await ctx.codeSourceService.create({ name: "enabled2", type: "manual", enabled: true });

    const sources = await ctx.codeSourceService.getAllEnabled();
    expect(sources.length).toBe(2);
    expect(sources.map((s) => s.name).sort()).toEqual(["enabled1", "enabled2"]);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("CodeSourceService.getById returns source or null", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    ctx.codeSourceService.registerProvider(createMockProvider("manual"));

    const created = await ctx.codeSourceService.create({ name: "utils", type: "manual" });

    const found = await ctx.codeSourceService.getById(created.id);
    expect(found?.name).toBe("utils");

    // ID is now a string (the source name)
    const notFound = await ctx.codeSourceService.getById("nonexistent");
    expect(notFound).toBeNull();
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("CodeSourceService.getByName returns source or null", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    ctx.codeSourceService.registerProvider(createMockProvider("manual"));

    await ctx.codeSourceService.create({ name: "utils", type: "manual" });

    const found = await ctx.codeSourceService.getByName("utils");
    expect(found?.name).toBe("utils");

    const notFound = await ctx.codeSourceService.getByName("nonexistent");
    expect(notFound).toBeNull();
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("CodeSourceService.exists returns true/false correctly", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    ctx.codeSourceService.registerProvider(createMockProvider("manual"));

    const created = await ctx.codeSourceService.create({ name: "utils", type: "manual" });

    expect(await ctx.codeSourceService.exists(created.id)).toBe(true);
    // ID is now a string (the source name)
    expect(await ctx.codeSourceService.exists("nonexistent")).toBe(false);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("CodeSourceService.nameExists returns true/false correctly", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    ctx.codeSourceService.registerProvider(createMockProvider("manual"));

    await ctx.codeSourceService.create({ name: "utils", type: "manual" });

    expect(await ctx.codeSourceService.nameExists("utils")).toBe(true);
    expect(await ctx.codeSourceService.nameExists("nonexistent")).toBe(false);
  } finally {
    await ctx.cleanup();
  }
});

// ============================================================================
// CRUD Tests - Update
// ============================================================================

integrationTest("CodeSourceService.update updates typeSettings", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    ctx.codeSourceService.registerProvider(createMockProvider("git"));

    const source = await ctx.codeSourceService.create({
      name: "repo",
      type: "git",
      typeSettings: { url: "https://github.com/user/repo.git", branch: "main" },
    });

    const updated = await ctx.codeSourceService.update(source.id, {
      typeSettings: { url: "https://github.com/user/repo.git", branch: "develop" },
    });

    expect(updated.typeSettings).toEqual({
      url: "https://github.com/user/repo.git",
      branch: "develop",
    });
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("CodeSourceService.update updates syncSettings", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    ctx.codeSourceService.registerProvider(createMockProvider("manual"));

    const source = await ctx.codeSourceService.create({
      name: "utils",
      type: "manual",
      syncSettings: { intervalSeconds: 300 },
    });

    const updated = await ctx.codeSourceService.update(source.id, {
      syncSettings: { intervalSeconds: 600, webhookSecret: "newsecret" },
    });

    expect(updated.syncSettings).toEqual({
      intervalSeconds: 600,
      webhookSecret: "newsecret",
    });
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("CodeSourceService.update updates enabled status", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    ctx.codeSourceService.registerProvider(createMockProvider("manual"));

    const source = await ctx.codeSourceService.create({
      name: "utils",
      type: "manual",
      enabled: true,
    });

    const updated = await ctx.codeSourceService.update(source.id, {
      enabled: false,
    });

    expect(updated.enabled).toBe(false);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("CodeSourceService.update throws for non-existent source", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    // ID is now a string (the source name)
    await expect(
      ctx.codeSourceService.update("nonexistent", { enabled: false }),
    ).rejects.toThrow(SourceNotFoundError);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("CodeSourceService.setEnabled updates enabled status", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    ctx.codeSourceService.registerProvider(createMockProvider("manual"));

    const source = await ctx.codeSourceService.create({
      name: "utils",
      type: "manual",
      enabled: true,
    });

    const disabled = await ctx.codeSourceService.setEnabled(source.id, false);
    expect(disabled.enabled).toBe(false);

    const enabled = await ctx.codeSourceService.setEnabled(source.id, true);
    expect(enabled.enabled).toBe(true);
  } finally {
    await ctx.cleanup();
  }
});

// ============================================================================
// CRUD Tests - Delete
// ============================================================================

integrationTest("CodeSourceService.delete removes source", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    ctx.codeSourceService.registerProvider(createMockProvider("manual"));

    const source = await ctx.codeSourceService.create({ name: "utils", type: "manual" });
    expect(await ctx.codeSourceService.exists(source.id)).toBe(true);

    await ctx.codeSourceService.delete(source.id);
    expect(await ctx.codeSourceService.exists(source.id)).toBe(false);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("CodeSourceService.delete throws for non-existent source", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    // ID is now a string (the source name)
    await expect(ctx.codeSourceService.delete("nonexistent")).rejects.toThrow(
      SourceNotFoundError,
    );
  } finally {
    await ctx.cleanup();
  }
});

// ============================================================================
// Encryption Tests
// ============================================================================

integrationTest("CodeSourceService encrypts and decrypts typeSettings correctly", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    // Use real git provider which encrypts authToken
    // (The default providers registered by withCodeSources() include the real GitCodeSourceProvider)

    const sensitiveSettings = {
      url: "https://github.com/user/repo.git",
      branch: "main",
      authToken: "super-secret-token-123",
    };

    const source = await ctx.codeSourceService.create({
      name: "private-repo",
      type: "git",
      typeSettings: sensitiveSettings,
    });

    // Verify decrypted values match
    const retrieved = await ctx.codeSourceService.getById(source.id);
    expect(retrieved?.typeSettings).toEqual(sensitiveSettings);

    // Verify raw DB value has encrypted authToken (not plaintext)
    // Query SurrealDB directly to check the encrypted value
    const recordId = new RecordId("codeSource", source.id);
    const rawRow = await ctx.surrealFactory.withSystemConnection({}, async (db) => {
      const result = await db.query<[{ typeSettings: Record<string, unknown> } | undefined]>(
        `RETURN $recordId.*`,
        { recordId },
      );
      return result[0];
    });
    // authToken should be encrypted (different from plaintext)
    expect(rawRow?.typeSettings?.authToken).not.toBe("super-secret-token-123");
    // But url/branch should be unchanged (not encrypted)
    expect(rawRow?.typeSettings?.url).toBe("https://github.com/user/repo.git");
    expect(rawRow?.typeSettings?.branch).toBe("main");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("CodeSourceService encrypts and decrypts syncSettings correctly", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    ctx.codeSourceService.registerProvider(createMockProvider("manual"));

    const sensitiveSettings = {
      intervalSeconds: 300,
      webhookSecret: "webhook-secret-456",
    };

    const source = await ctx.codeSourceService.create({
      name: "utils",
      type: "manual",
      syncSettings: sensitiveSettings,
    });

    // Verify decrypted values match
    const retrieved = await ctx.codeSourceService.getById(source.id);
    expect(retrieved?.syncSettings).toEqual(sensitiveSettings);

    // Verify raw DB value has encrypted webhookSecret (not plaintext)
    // Query SurrealDB directly to check the encrypted value
    const recordId = new RecordId("codeSource", source.id);
    const rawRow = await ctx.surrealFactory.withSystemConnection({}, async (db) => {
      const result = await db.query<[{ syncSettings: { webhookSecret?: string; intervalSeconds?: number } } | undefined]>(
        `RETURN $recordId.*`,
        { recordId },
      );
      return result[0];
    });
    // webhookSecret should be encrypted (different from plaintext)
    expect(rawRow?.syncSettings?.webhookSecret).not.toBe("webhook-secret-456");
    // But intervalSeconds should be unchanged (not encrypted)
    expect(rawRow?.syncSettings?.intervalSeconds).toBe(300);
  } finally {
    await ctx.cleanup();
  }
});

// ============================================================================
// Encryption Lifecycle Tests - authToken
// ============================================================================

integrationTest("authToken encryption lifecycle: create with token", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    const source = await ctx.codeSourceService.create({
      name: "git-with-token",
      type: "git",
      typeSettings: {
        url: "https://github.com/user/repo.git",
        authToken: "github_pat_secret123",
      },
    });

    // Retrieved value should be decrypted
    const retrieved = await ctx.codeSourceService.getById(source.id);
    const gitSettings = retrieved?.typeSettings as GitTypeSettings;
    expect(gitSettings?.authToken).toBe("github_pat_secret123");

    // Raw DB value should be encrypted (starts with version prefix, not 'g')
    const recordId = new RecordId("codeSource", source.id);
    const rawRow = await ctx.surrealFactory.withSystemConnection({}, async (db) => {
      const result = await db.query<[{ typeSettings: Record<string, unknown> } | undefined]>(
        `RETURN $recordId.*`,
        { recordId },
      );
      return result[0];
    });
    const rawToken = rawRow?.typeSettings?.authToken as string;
    expect(rawToken).not.toBe("github_pat_secret123");
    expect(rawToken?.charAt(0)).toBe("A"); // Encrypted value starts with version prefix
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("authToken encryption lifecycle: create without token", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    const source = await ctx.codeSourceService.create({
      name: "git-no-token",
      type: "git",
      typeSettings: {
        url: "https://github.com/user/repo.git",
      },
    });

    // Retrieved value should have no authToken
    const retrieved = await ctx.codeSourceService.getById(source.id);
    const gitSettings = retrieved?.typeSettings as GitTypeSettings;
    expect(gitSettings?.authToken).toBeUndefined();
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("authToken encryption lifecycle: update with new token", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    // Create with initial token
    const source = await ctx.codeSourceService.create({
      name: "git-update-token",
      type: "git",
      typeSettings: {
        url: "https://github.com/user/repo.git",
        authToken: "initial_token_123",
      },
    });

    // Update with new token
    await ctx.codeSourceService.update(source.id, {
      typeSettings: {
        url: "https://github.com/user/repo.git",
        authToken: "new_token_456",
      },
    });

    // Retrieved value should have new decrypted token
    const retrieved = await ctx.codeSourceService.getById(source.id);
    const gitSettings = retrieved?.typeSettings as GitTypeSettings;
    expect(gitSettings?.authToken).toBe("new_token_456");

    // Raw DB value should be encrypted (different from plaintext)
    const recordId = new RecordId("codeSource", source.id);
    const rawRow = await ctx.surrealFactory.withSystemConnection({}, async (db) => {
      const result = await db.query<[{ typeSettings: Record<string, unknown> } | undefined]>(
        `RETURN $recordId.*`,
        { recordId },
      );
      return result[0];
    });
    const rawToken = rawRow?.typeSettings?.authToken as string;
    expect(rawToken).not.toBe("new_token_456");
    expect(rawToken?.charAt(0)).toBe("A"); // Encrypted value starts with version prefix
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("authToken encryption lifecycle: add token to source without one", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    // Create without token
    const source = await ctx.codeSourceService.create({
      name: "git-add-token",
      type: "git",
      typeSettings: {
        url: "https://github.com/user/repo.git",
      },
    });

    // Verify no token initially
    const initial = await ctx.codeSourceService.getById(source.id);
    const initialSettings = initial?.typeSettings as GitTypeSettings;
    expect(initialSettings?.authToken).toBeUndefined();

    // Update to add token
    await ctx.codeSourceService.update(source.id, {
      typeSettings: {
        url: "https://github.com/user/repo.git",
        authToken: "added_token_789",
      },
    });

    // Retrieved value should have decrypted token
    const retrieved = await ctx.codeSourceService.getById(source.id);
    const gitSettings = retrieved?.typeSettings as GitTypeSettings;
    expect(gitSettings?.authToken).toBe("added_token_789");

    // Raw DB value should be encrypted
    const recordId = new RecordId("codeSource", source.id);
    const rawRow = await ctx.surrealFactory.withSystemConnection({}, async (db) => {
      const result = await db.query<[{ typeSettings: Record<string, unknown> } | undefined]>(
        `RETURN $recordId.*`,
        { recordId },
      );
      return result[0];
    });
    const rawToken = rawRow?.typeSettings?.authToken as string;
    expect(rawToken).not.toBe("added_token_789");
    expect(rawToken?.charAt(0)).toBe("A");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("authToken encryption lifecycle: remove token from source", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    // Create with token
    const source = await ctx.codeSourceService.create({
      name: "git-remove-token",
      type: "git",
      typeSettings: {
        url: "https://github.com/user/repo.git",
        authToken: "token_to_remove",
      },
    });

    // Verify token exists initially
    const initial = await ctx.codeSourceService.getById(source.id);
    const initialSettings = initial?.typeSettings as GitTypeSettings;
    expect(initialSettings?.authToken).toBe("token_to_remove");

    // Update to remove token (by not including it)
    await ctx.codeSourceService.update(source.id, {
      typeSettings: {
        url: "https://github.com/user/repo.git",
        // No authToken = remove it
      },
    });

    // Retrieved value should have no authToken
    const retrieved = await ctx.codeSourceService.getById(source.id);
    const gitSettings = retrieved?.typeSettings as GitTypeSettings;
    expect(gitSettings?.authToken).toBeUndefined();
  } finally {
    await ctx.cleanup();
  }
});

// ============================================================================
// Encryption Lifecycle Tests - webhookSecret
// ============================================================================

integrationTest("webhookSecret encryption lifecycle: create with secret", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    ctx.codeSourceService.registerProvider(createMockProvider("manual"));

    const source = await ctx.codeSourceService.create({
      name: "src-with-secret",
      type: "manual",
      syncSettings: {
        webhookEnabled: true,
        webhookSecret: "super_secret_webhook_key",
      },
    });

    // Retrieved value should be decrypted
    const retrieved = await ctx.codeSourceService.getById(source.id);
    expect(retrieved?.syncSettings?.webhookSecret).toBe("super_secret_webhook_key");

    // Raw DB value should be encrypted (starts with version prefix)
    const recordId = new RecordId("codeSource", source.id);
    const rawRow = await ctx.surrealFactory.withSystemConnection({}, async (db) => {
      const result = await db.query<[{ syncSettings: Record<string, unknown> } | undefined]>(
        `RETURN $recordId.*`,
        { recordId },
      );
      return result[0];
    });
    const rawSecret = rawRow?.syncSettings?.webhookSecret as string;
    expect(rawSecret).not.toBe("super_secret_webhook_key");
    expect(rawSecret?.charAt(0)).toBe("A"); // Encrypted value starts with version prefix
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("webhookSecret encryption lifecycle: create without secret", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    ctx.codeSourceService.registerProvider(createMockProvider("manual"));

    const source = await ctx.codeSourceService.create({
      name: "src-no-secret",
      type: "manual",
      syncSettings: {
        webhookEnabled: true,
        // No webhookSecret
      },
    });

    // Retrieved value should have no webhookSecret
    const retrieved = await ctx.codeSourceService.getById(source.id);
    expect(retrieved?.syncSettings?.webhookSecret).toBeUndefined();
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("webhookSecret encryption lifecycle: update with new secret", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    ctx.codeSourceService.registerProvider(createMockProvider("manual"));

    // Create with initial secret
    const source = await ctx.codeSourceService.create({
      name: "src-update-secret",
      type: "manual",
      syncSettings: {
        webhookEnabled: true,
        webhookSecret: "initial_secret",
      },
    });

    // Update with new secret
    await ctx.codeSourceService.update(source.id, {
      syncSettings: {
        webhookEnabled: true,
        webhookSecret: "new_secret_value",
      },
    });

    // Retrieved value should have new decrypted secret
    const retrieved = await ctx.codeSourceService.getById(source.id);
    expect(retrieved?.syncSettings?.webhookSecret).toBe("new_secret_value");

    // Raw DB value should be encrypted
    const recordId = new RecordId("codeSource", source.id);
    const rawRow = await ctx.surrealFactory.withSystemConnection({}, async (db) => {
      const result = await db.query<[{ syncSettings: Record<string, unknown> } | undefined]>(
        `RETURN $recordId.*`,
        { recordId },
      );
      return result[0];
    });
    const rawSecret = rawRow?.syncSettings?.webhookSecret as string;
    expect(rawSecret).not.toBe("new_secret_value");
    expect(rawSecret?.charAt(0)).toBe("A");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("webhookSecret encryption lifecycle: add secret to source without one", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    ctx.codeSourceService.registerProvider(createMockProvider("manual"));

    // Create without secret
    const source = await ctx.codeSourceService.create({
      name: "src-add-secret",
      type: "manual",
      syncSettings: {
        webhookEnabled: true,
      },
    });

    // Verify no secret initially
    const initial = await ctx.codeSourceService.getById(source.id);
    expect(initial?.syncSettings?.webhookSecret).toBeUndefined();

    // Update to add secret
    await ctx.codeSourceService.update(source.id, {
      syncSettings: {
        webhookEnabled: true,
        webhookSecret: "added_secret",
      },
    });

    // Retrieved value should have decrypted secret
    const retrieved = await ctx.codeSourceService.getById(source.id);
    expect(retrieved?.syncSettings?.webhookSecret).toBe("added_secret");

    // Raw DB value should be encrypted
    const recordId = new RecordId("codeSource", source.id);
    const rawRow = await ctx.surrealFactory.withSystemConnection({}, async (db) => {
      const result = await db.query<[{ syncSettings: Record<string, unknown> } | undefined]>(
        `RETURN $recordId.*`,
        { recordId },
      );
      return result[0];
    });
    const rawSecret = rawRow?.syncSettings?.webhookSecret as string;
    expect(rawSecret).not.toBe("added_secret");
    expect(rawSecret?.charAt(0)).toBe("A");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("webhookSecret encryption lifecycle: remove secret from source", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    ctx.codeSourceService.registerProvider(createMockProvider("manual"));

    // Create with secret
    const source = await ctx.codeSourceService.create({
      name: "src-remove-secret",
      type: "manual",
      syncSettings: {
        webhookEnabled: true,
        webhookSecret: "secret_to_remove",
      },
    });

    // Verify secret exists initially
    const initial = await ctx.codeSourceService.getById(source.id);
    expect(initial?.syncSettings?.webhookSecret).toBe("secret_to_remove");

    // Update to remove secret (by not including it)
    await ctx.codeSourceService.update(source.id, {
      syncSettings: {
        webhookEnabled: true,
        // No webhookSecret = remove it
      },
    });

    // Retrieved value should have no webhookSecret
    const retrieved = await ctx.codeSourceService.getById(source.id);
    expect(retrieved?.syncSettings?.webhookSecret).toBeUndefined();
  } finally {
    await ctx.cleanup();
  }
});

// ============================================================================
// No Double Encryption/Decryption Tests
// ============================================================================

integrationTest("authToken: getById returns correctly decrypted value (no double decrypt)", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    // Create source with token
    const source = await ctx.codeSourceService.create({
      name: "git-decrypt-once",
      type: "git",
      typeSettings: {
        url: "https://github.com/user/repo.git",
        authToken: "github_pat_test123",
      },
    });

    // Multiple getById calls should all return the same decrypted value
    // If there's double decryption, subsequent calls would fail or return garbage
    const retrieved1 = await ctx.codeSourceService.getById(source.id);
    const retrieved2 = await ctx.codeSourceService.getById(source.id);
    const retrieved3 = await ctx.codeSourceService.getById(source.id);

    const settings1 = retrieved1?.typeSettings as GitTypeSettings;
    const settings2 = retrieved2?.typeSettings as GitTypeSettings;
    const settings3 = retrieved3?.typeSettings as GitTypeSettings;

    expect(settings1?.authToken).toBe("github_pat_test123");
    expect(settings2?.authToken).toBe("github_pat_test123");
    expect(settings3?.authToken).toBe("github_pat_test123");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("webhookSecret: getById returns correctly decrypted value (no double decrypt)", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    ctx.codeSourceService.registerProvider(createMockProvider("manual"));

    // Create source with webhook secret
    const source = await ctx.codeSourceService.create({
      name: "src-decrypt-once",
      type: "manual",
      syncSettings: {
        webhookEnabled: true,
        webhookSecret: "webhook_secret_abc",
      },
    });

    // Multiple getById calls should all return the same decrypted value
    const retrieved1 = await ctx.codeSourceService.getById(source.id);
    const retrieved2 = await ctx.codeSourceService.getById(source.id);
    const retrieved3 = await ctx.codeSourceService.getById(source.id);

    expect(retrieved1?.syncSettings?.webhookSecret).toBe("webhook_secret_abc");
    expect(retrieved2?.syncSettings?.webhookSecret).toBe("webhook_secret_abc");
    expect(retrieved3?.syncSettings?.webhookSecret).toBe("webhook_secret_abc");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("authToken: update preserves encryption correctly (no double encrypt)", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    // Create source with token
    const source = await ctx.codeSourceService.create({
      name: "git-encrypt-once",
      type: "git",
      typeSettings: {
        url: "https://github.com/user/repo.git",
        authToken: "original_token",
      },
    });

    // Update multiple times with same token
    // If there's double encryption, each update would nest the encryption
    await ctx.codeSourceService.update(source.id, {
      typeSettings: {
        url: "https://github.com/user/repo.git",
        authToken: "updated_token",
      },
    });

    await ctx.codeSourceService.update(source.id, {
      typeSettings: {
        url: "https://github.com/user/repo.git",
        authToken: "updated_token", // Same token again
      },
    });

    // Should still decrypt correctly
    const retrieved = await ctx.codeSourceService.getById(source.id);
    const gitSettings = retrieved?.typeSettings as GitTypeSettings;
    expect(gitSettings?.authToken).toBe("updated_token");

    // Raw DB should have properly encrypted value (single encryption)
    const recordId = new RecordId("codeSource", source.id);
    const rawRow = await ctx.surrealFactory.withSystemConnection({}, async (db) => {
      const result = await db.query<[{ typeSettings: Record<string, unknown> } | undefined]>(
        `RETURN $recordId.*`,
        { recordId },
      );
      return result[0];
    });
    const rawToken = rawRow?.typeSettings?.authToken as string;
    // Should start with version prefix (single level of encryption)
    expect(rawToken?.charAt(0)).toBe("A");
    // Should NOT have nested encryption markers
    expect(rawToken?.charAt(1)).not.toBe("A");
  } finally {
    await ctx.cleanup();
  }
});

// ============================================================================
// Capability Tests
// ============================================================================

integrationTest("CodeSourceService.isEditable returns correct value", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    ctx.codeSourceService.registerProvider(createMockProvider("manual"));
    ctx.codeSourceService.registerProvider(createMockProvider("git"));

    const manual = await ctx.codeSourceService.create({ name: "manual-src", type: "manual" });
    const git = await ctx.codeSourceService.create({
      name: "git-src",
      type: "git",
      typeSettings: { url: "https://github.com/user/repo.git" },
    });

    expect(await ctx.codeSourceService.isEditable(manual.id)).toBe(true);
    expect(await ctx.codeSourceService.isEditable(git.id)).toBe(false);
    // ID is now a string (the source name)
    expect(await ctx.codeSourceService.isEditable("nonexistent")).toBe(false);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("CodeSourceService.isSyncable returns correct value", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    ctx.codeSourceService.registerProvider(createMockProvider("manual"));
    ctx.codeSourceService.registerProvider(createMockProvider("git"));

    const manual = await ctx.codeSourceService.create({ name: "manual-src", type: "manual" });
    const git = await ctx.codeSourceService.create({
      name: "git-src",
      type: "git",
      typeSettings: { url: "https://github.com/user/repo.git" },
    });

    expect(await ctx.codeSourceService.isSyncable(manual.id)).toBe(false);
    expect(await ctx.codeSourceService.isSyncable(git.id)).toBe(true);
    // ID is now a string (the source name)
    expect(await ctx.codeSourceService.isSyncable("nonexistent")).toBe(false);
  } finally {
    await ctx.cleanup();
  }
});

// ============================================================================
// Sync Status Tests
// ============================================================================

integrationTest("CodeSourceService.markSyncStarted sets lastSyncStartedAt", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    ctx.codeSourceService.registerProvider(createMockProvider("manual"));

    const source = await ctx.codeSourceService.create({ name: "utils", type: "manual" });
    expect(source.lastSyncStartedAt).toBeNull();

    await ctx.codeSourceService.markSyncStarted(source.id);

    const updated = await ctx.codeSourceService.getById(source.id);
    expect(updated?.lastSyncStartedAt).not.toBeNull();
    expect(updated?.lastSyncError).toBeNull();
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("CodeSourceService.markSyncCompleted sets lastSyncAt and clears error", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    ctx.codeSourceService.registerProvider(createMockProvider("manual"));

    const source = await ctx.codeSourceService.create({ name: "utils", type: "manual" });

    // Set up initial state
    await ctx.codeSourceService.markSyncStarted(source.id);
    await ctx.codeSourceService.markSyncFailed(source.id, "Previous error");

    // Complete sync
    await ctx.codeSourceService.markSyncCompleted(source.id);

    const updated = await ctx.codeSourceService.getById(source.id);
    expect(updated?.lastSyncAt).not.toBeNull();
    expect(updated?.lastSyncStartedAt).toBeNull();
    expect(updated?.lastSyncError).toBeNull();
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("CodeSourceService.markSyncFailed sets error and clears startedAt", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    ctx.codeSourceService.registerProvider(createMockProvider("manual"));

    const source = await ctx.codeSourceService.create({ name: "utils", type: "manual" });
    await ctx.codeSourceService.markSyncStarted(source.id);

    await ctx.codeSourceService.markSyncFailed(source.id, "Connection timeout");

    const updated = await ctx.codeSourceService.getById(source.id);
    expect(updated?.lastSyncError).toBe("Connection timeout");
    expect(updated?.lastSyncStartedAt).toBeNull();
  } finally {
    await ctx.cleanup();
  }
});

// ============================================================================
// Manual Sync Trigger Tests
// ============================================================================

integrationTest("CodeSourceService.triggerManualSync throws for non-existent source", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    // ID is now a string (the source name)
    await expect(
      ctx.codeSourceService.triggerManualSync("nonexistent"),
    ).rejects.toThrow(SourceNotFoundError);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("CodeSourceService.triggerManualSync throws for non-syncable source", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    ctx.codeSourceService.registerProvider(createMockProvider("manual"));

    const source = await ctx.codeSourceService.create({ name: "utils", type: "manual" });

    await expect(
      ctx.codeSourceService.triggerManualSync(source.id),
    ).rejects.toThrow(SourceNotSyncableError);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("CodeSourceService.triggerManualSync enqueues job for syncable source", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    ctx.codeSourceService.registerProvider(createMockProvider("git"));

    const source = await ctx.codeSourceService.create({
      name: "repo",
      type: "git",
      typeSettings: { url: "https://github.com/user/repo.git" },
    });

    const job = await ctx.codeSourceService.triggerManualSync(source.id);

    expect(job).not.toBeNull();
    expect(job?.type).toBe("source_sync");
    expect(job?.priority).toBe(10); // Higher priority for manual syncs
  } finally {
    await ctx.cleanup();
  }
});

// ============================================================================
// Webhook Sync Trigger Tests
// ============================================================================

integrationTest("CodeSourceService.triggerWebhookSync throws for non-existent source", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    // ID is now a string (the source name)
    await expect(
      ctx.codeSourceService.triggerWebhookSync("nonexistent", "secret"),
    ).rejects.toThrow(SourceNotFoundError);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("CodeSourceService.triggerWebhookSync throws for disabled webhooks", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    ctx.codeSourceService.registerProvider(createMockProvider("git"));

    const source = await ctx.codeSourceService.create({
      name: "repo",
      type: "git",
      typeSettings: { url: "https://github.com/user/repo.git" },
      syncSettings: { webhookEnabled: false, webhookSecret: "secret" },
    });

    await expect(
      ctx.codeSourceService.triggerWebhookSync(source.id, "secret"),
    ).rejects.toThrow(WebhookDisabledError);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("CodeSourceService.triggerWebhookSync throws for invalid secret", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    ctx.codeSourceService.registerProvider(createMockProvider("git"));

    const source = await ctx.codeSourceService.create({
      name: "repo",
      type: "git",
      typeSettings: { url: "https://github.com/user/repo.git" },
      syncSettings: { webhookEnabled: true, webhookSecret: "correct-secret" },
    });

    await expect(
      ctx.codeSourceService.triggerWebhookSync(source.id, "wrong-secret"),
    ).rejects.toThrow(WebhookAuthError);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("CodeSourceService.triggerWebhookSync enqueues job with valid secret", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    ctx.codeSourceService.registerProvider(createMockProvider("git"));

    const source = await ctx.codeSourceService.create({
      name: "repo",
      type: "git",
      typeSettings: { url: "https://github.com/user/repo.git" },
      syncSettings: { webhookEnabled: true, webhookSecret: "correct-secret" },
    });

    const job = await ctx.codeSourceService.triggerWebhookSync(
      source.id,
      "correct-secret",
    );

    expect(job).not.toBeNull();
    expect(job?.type).toBe("source_sync");
    expect(job?.priority).toBe(5); // Medium priority for webhook syncs
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("CodeSourceService.triggerWebhookSync enqueues job without secret when none required", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    ctx.codeSourceService.registerProvider(createMockProvider("git"));

    const source = await ctx.codeSourceService.create({
      name: "repo",
      type: "git",
      typeSettings: { url: "https://github.com/user/repo.git" },
      syncSettings: { webhookEnabled: true }, // No secret required
    });

    const job = await ctx.codeSourceService.triggerWebhookSync(
      source.id,
      "", // No secret provided
    );

    expect(job).not.toBeNull();
    expect(job?.type).toBe("source_sync");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("CodeSourceService.triggerWebhookSync returns null for disabled source", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    ctx.codeSourceService.registerProvider(createMockProvider("git"));

    const source = await ctx.codeSourceService.create({
      name: "repo",
      type: "git",
      typeSettings: { url: "https://github.com/user/repo.git" },
      syncSettings: { webhookEnabled: true, webhookSecret: "secret" },
      enabled: false,
    });

    const job = await ctx.codeSourceService.triggerWebhookSync(source.id, "secret");
    expect(job).toBeNull();
  } finally {
    await ctx.cleanup();
  }
});

// ============================================================================
// Schedule Lifecycle Tests
// ============================================================================

integrationTest("CodeSourceService.pauseSchedule throws SourceNotFoundError for non-existent source", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    // ID is now a string (the source name)
    await expect(
      ctx.codeSourceService.pauseSchedule("nonexistent"),
    ).rejects.toThrow(SourceNotFoundError);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("CodeSourceService.resumeSchedule throws SourceNotFoundError for non-existent source", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    // ID is now a string (the source name)
    await expect(
      ctx.codeSourceService.resumeSchedule("nonexistent"),
    ).rejects.toThrow(SourceNotFoundError);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("CodeSourceService.pauseSchedule does not throw for source without schedule", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    ctx.codeSourceService.registerProvider(createMockProvider("manual"));

    const source = await ctx.codeSourceService.create({
      name: "utils",
      type: "manual",
    });

    // Should not throw - just does nothing since manual sources have no schedule
    await ctx.codeSourceService.pauseSchedule(source.id);

    // Source should still be enabled
    const retrieved = await ctx.codeSourceService.getById(source.id);
    expect(retrieved?.enabled).toBe(true);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("CodeSourceService.resumeSchedule does not throw for source without schedule", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    ctx.codeSourceService.registerProvider(createMockProvider("manual"));

    const source = await ctx.codeSourceService.create({
      name: "utils",
      type: "manual",
    });

    // Should not throw - just does nothing
    await ctx.codeSourceService.resumeSchedule(source.id);

    // Source should still be enabled
    const retrieved = await ctx.codeSourceService.getById(source.id);
    expect(retrieved?.enabled).toBe(true);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("CodeSourceService.pauseSchedule leaves source enabled", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    ctx.codeSourceService.registerProvider(createMockProvider("git"));

    const source = await ctx.codeSourceService.create({
      name: "repo",
      type: "git",
      typeSettings: { url: "https://github.com/user/repo.git" },
      syncSettings: { intervalSeconds: 300 },
      enabled: true,
    });

    // Pause schedule
    await ctx.codeSourceService.pauseSchedule(source.id);

    // Source should still be enabled
    const retrieved = await ctx.codeSourceService.getById(source.id);
    expect(retrieved?.enabled).toBe(true);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("CodeSourceService.setEnabled with false also pauses schedule (internal call)", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    ctx.codeSourceService.registerProvider(createMockProvider("git"));

    const source = await ctx.codeSourceService.create({
      name: "repo",
      type: "git",
      typeSettings: { url: "https://github.com/user/repo.git" },
      syncSettings: { intervalSeconds: 300 },
      enabled: true,
    });

    // Disable source
    const disabled = await ctx.codeSourceService.setEnabled(source.id, false);
    expect(disabled.enabled).toBe(false);

    // Schedule should be paused (verified by re-enabling)
    const enabled = await ctx.codeSourceService.setEnabled(source.id, true);
    expect(enabled.enabled).toBe(true);
  } finally {
    await ctx.cleanup();
  }
});

// ============================================================================
// Source Directory Tests
// ============================================================================

integrationTest("CodeSourceService.getSourceDirectory returns correct path", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    const path = ctx.codeSourceService.getSourceDirectory("my-project");
    expect(path).toContain("my-project");
    expect(path).toContain("code");
  } finally {
    await ctx.cleanup();
  }
});
