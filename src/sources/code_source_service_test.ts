import { expect } from "@std/expect";
import { TestSetupBuilder } from "../test/test_setup_builder.ts";
import type {
  CodeSourceProvider,
  CodeSource,
  ProviderCapabilities,
  SyncResult,
} from "./types.ts";
import type { CancellationToken } from "../jobs/types.ts";
import {
  DuplicateSourceError,
  InvalidSourceConfigError,
  SourceNotFoundError,
  ProviderNotFoundError,
  SourceNotSyncableError,
  WebhookAuthError,
} from "./errors.ts";

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

Deno.test("CodeSourceService.isValidSourceName accepts valid names", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    expect(ctx.codeSourceService.isValidSourceName("utils")).toBe(true);
    expect(ctx.codeSourceService.isValidSourceName("my-project")).toBe(true);
    expect(ctx.codeSourceService.isValidSourceName("backend_v2")).toBe(true);
    expect(ctx.codeSourceService.isValidSourceName("a")).toBe(true);
    expect(ctx.codeSourceService.isValidSourceName("a1")).toBe(true);
    expect(ctx.codeSourceService.isValidSourceName("test123")).toBe(true);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("CodeSourceService.isValidSourceName rejects invalid names", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    // Empty/whitespace
    expect(ctx.codeSourceService.isValidSourceName("")).toBe(false);
    expect(ctx.codeSourceService.isValidSourceName("  ")).toBe(false);

    // Uppercase not allowed
    expect(ctx.codeSourceService.isValidSourceName("MyProject")).toBe(false);
    expect(ctx.codeSourceService.isValidSourceName("UTILS")).toBe(false);

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

Deno.test("CodeSourceService.registerProvider registers provider", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    const provider = createMockProvider("manual");
    ctx.codeSourceService.registerProvider(provider);

    expect(ctx.codeSourceService.hasProvider("manual")).toBe(true);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("CodeSourceService.getProvider returns registered provider", async () => {
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

Deno.test("CodeSourceService.getProvider throws for unregistered type", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    expect(() => ctx.codeSourceService.getProvider("git")).toThrow(
      ProviderNotFoundError,
    );
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("CodeSourceService.hasProvider returns false for unregistered type", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    expect(ctx.codeSourceService.hasProvider("git")).toBe(false);
  } finally {
    await ctx.cleanup();
  }
});

// ============================================================================
// CRUD Tests - Create
// ============================================================================

Deno.test("CodeSourceService.create creates source with minimal config", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    ctx.codeSourceService.registerProvider(createMockProvider("manual"));

    const source = await ctx.codeSourceService.create({
      name: "utils",
      type: "manual",
    });

    expect(source.id).toBeGreaterThan(0);
    expect(source.name).toBe("utils");
    expect(source.type).toBe("manual");
    expect(source.enabled).toBe(true);
    expect(source.typeSettings).toEqual({});
    expect(source.syncSettings).toEqual({});
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("CodeSourceService.create creates source with all fields", async () => {
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

Deno.test("CodeSourceService.create throws on duplicate name", async () => {
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

Deno.test("CodeSourceService.create throws on invalid name", async () => {
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

Deno.test("CodeSourceService.create throws on unregistered provider", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    await expect(
      ctx.codeSourceService.create({ name: "test", type: "manual" }),
    ).rejects.toThrow(ProviderNotFoundError);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("CodeSourceService.create validates git type settings", async () => {
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

Deno.test("CodeSourceService.getAll returns empty array initially", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    const sources = await ctx.codeSourceService.getAll();
    expect(sources).toEqual([]);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("CodeSourceService.getAll returns all sources", async () => {
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

Deno.test("CodeSourceService.getAllEnabled returns only enabled sources", async () => {
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

Deno.test("CodeSourceService.getById returns source or null", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    ctx.codeSourceService.registerProvider(createMockProvider("manual"));

    const created = await ctx.codeSourceService.create({ name: "utils", type: "manual" });

    const found = await ctx.codeSourceService.getById(created.id);
    expect(found?.name).toBe("utils");

    const notFound = await ctx.codeSourceService.getById(99999);
    expect(notFound).toBeNull();
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("CodeSourceService.getByName returns source or null", async () => {
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

Deno.test("CodeSourceService.exists returns true/false correctly", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    ctx.codeSourceService.registerProvider(createMockProvider("manual"));

    const created = await ctx.codeSourceService.create({ name: "utils", type: "manual" });

    expect(await ctx.codeSourceService.exists(created.id)).toBe(true);
    expect(await ctx.codeSourceService.exists(99999)).toBe(false);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("CodeSourceService.nameExists returns true/false correctly", async () => {
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

Deno.test("CodeSourceService.update updates typeSettings", async () => {
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

Deno.test("CodeSourceService.update updates syncSettings", async () => {
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

Deno.test("CodeSourceService.update updates enabled status", async () => {
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

Deno.test("CodeSourceService.update throws for non-existent source", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    await expect(
      ctx.codeSourceService.update(99999, { enabled: false }),
    ).rejects.toThrow(SourceNotFoundError);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("CodeSourceService.setEnabled updates enabled status", async () => {
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

Deno.test("CodeSourceService.delete removes source", async () => {
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

Deno.test("CodeSourceService.delete throws for non-existent source", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    await expect(ctx.codeSourceService.delete(99999)).rejects.toThrow(
      SourceNotFoundError,
    );
  } finally {
    await ctx.cleanup();
  }
});

// ============================================================================
// Encryption Tests
// ============================================================================

Deno.test("CodeSourceService encrypts and decrypts typeSettings correctly", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    ctx.codeSourceService.registerProvider(createMockProvider("git"));

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

    // Verify raw DB value is encrypted (not plaintext)
    const rawRow = await ctx.db.queryOne<{ typeSettings: string }>(
      "SELECT typeSettings FROM codeSources WHERE id = ?",
      [source.id],
    );
    expect(rawRow?.typeSettings).not.toContain("super-secret-token-123");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("CodeSourceService encrypts and decrypts syncSettings correctly", async () => {
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

    // Verify raw DB value is encrypted
    const rawRow = await ctx.db.queryOne<{ syncSettings: string }>(
      "SELECT syncSettings FROM codeSources WHERE id = ?",
      [source.id],
    );
    expect(rawRow?.syncSettings).not.toContain("webhook-secret-456");
  } finally {
    await ctx.cleanup();
  }
});

// ============================================================================
// Capability Tests
// ============================================================================

Deno.test("CodeSourceService.isEditable returns correct value", async () => {
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
    expect(await ctx.codeSourceService.isEditable(99999)).toBe(false);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("CodeSourceService.isSyncable returns correct value", async () => {
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
    expect(await ctx.codeSourceService.isSyncable(99999)).toBe(false);
  } finally {
    await ctx.cleanup();
  }
});

// ============================================================================
// Sync Status Tests
// ============================================================================

Deno.test("CodeSourceService.markSyncStarted sets lastSyncStartedAt", async () => {
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

Deno.test("CodeSourceService.markSyncCompleted sets lastSyncAt and clears error", async () => {
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

Deno.test("CodeSourceService.markSyncFailed sets error and clears startedAt", async () => {
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

Deno.test("CodeSourceService.triggerManualSync throws for non-existent source", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    await expect(
      ctx.codeSourceService.triggerManualSync(99999),
    ).rejects.toThrow(SourceNotFoundError);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("CodeSourceService.triggerManualSync throws for non-syncable source", async () => {
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

Deno.test("CodeSourceService.triggerManualSync enqueues job for syncable source", async () => {
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

Deno.test("CodeSourceService.triggerWebhookSync throws for non-existent source", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    await expect(
      ctx.codeSourceService.triggerWebhookSync(99999, "secret"),
    ).rejects.toThrow(SourceNotFoundError);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("CodeSourceService.triggerWebhookSync throws for invalid secret", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    ctx.codeSourceService.registerProvider(createMockProvider("git"));

    const source = await ctx.codeSourceService.create({
      name: "repo",
      type: "git",
      typeSettings: { url: "https://github.com/user/repo.git" },
      syncSettings: { webhookSecret: "correct-secret" },
    });

    await expect(
      ctx.codeSourceService.triggerWebhookSync(source.id, "wrong-secret"),
    ).rejects.toThrow(WebhookAuthError);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("CodeSourceService.triggerWebhookSync enqueues job with valid secret", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    ctx.codeSourceService.registerProvider(createMockProvider("git"));

    const source = await ctx.codeSourceService.create({
      name: "repo",
      type: "git",
      typeSettings: { url: "https://github.com/user/repo.git" },
      syncSettings: { webhookSecret: "correct-secret" },
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

Deno.test("CodeSourceService.triggerWebhookSync returns null for disabled source", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    ctx.codeSourceService.registerProvider(createMockProvider("git"));

    const source = await ctx.codeSourceService.create({
      name: "repo",
      type: "git",
      typeSettings: { url: "https://github.com/user/repo.git" },
      syncSettings: { webhookSecret: "secret" },
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

Deno.test("CodeSourceService.pauseSchedule throws SourceNotFoundError for non-existent source", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    await expect(
      ctx.codeSourceService.pauseSchedule(99999),
    ).rejects.toThrow(SourceNotFoundError);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("CodeSourceService.resumeSchedule throws SourceNotFoundError for non-existent source", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    await expect(
      ctx.codeSourceService.resumeSchedule(99999),
    ).rejects.toThrow(SourceNotFoundError);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("CodeSourceService.pauseSchedule does not throw for source without schedule", async () => {
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

Deno.test("CodeSourceService.resumeSchedule does not throw for source without schedule", async () => {
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

Deno.test("CodeSourceService.pauseSchedule leaves source enabled", async () => {
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

Deno.test("CodeSourceService.setEnabled with false also pauses schedule (internal call)", async () => {
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

Deno.test("CodeSourceService.getSourceDirectory returns correct path", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    const path = ctx.codeSourceService.getSourceDirectory("my-project");
    expect(path).toContain("my-project");
    expect(path).toContain("code");
  } finally {
    await ctx.cleanup();
  }
});
