import { expect } from "@std/expect";
import { TestSetupBuilder } from "../test/test_setup_builder.ts";
import { integrationTest } from "../test/test_helpers.ts";
import { GitCodeSourceProvider } from "./git_code_source_provider.ts";
import type { CodeSource, GitTypeSettings } from "./types.ts";
import type { CancellationToken } from "../jobs/types.ts";

/**
 * Create a mock cancellation token for testing.
 */
function createMockToken(cancelled = false): CancellationToken {
  return {
    isCancelled: cancelled,
    whenCancelled: cancelled ? Promise.resolve() : new Promise(() => {}),
    throwIfCancelled: () => {
      if (cancelled) throw new Error("Cancelled");
    },
  };
}

/**
 * Create a minimal CodeSource for testing.
 */
function createTestSource(
  name: string,
  typeSettings: GitTypeSettings,
): CodeSource {
  return {
    id: 1,
    name,
    type: "git",
    typeSettings,
    syncSettings: {},
    lastSyncStartedAt: null,
    lastSyncAt: null,
    lastSyncError: null,
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// =============================================================================
// Unit Tests
// =============================================================================

integrationTest("GitCodeSourceProvider.getCapabilities returns correct values", () => {
  const provider = new GitCodeSourceProvider({ codeDirectory: "./code" });
  const capabilities = provider.getCapabilities();

  expect(capabilities.isSyncable).toBe(true);
  expect(capabilities.isEditable).toBe(false);
});

integrationTest("GitCodeSourceProvider.type returns 'git'", () => {
  const provider = new GitCodeSourceProvider({ codeDirectory: "./code" });
  expect(provider.type).toBe("git");
});

// =============================================================================
// Directory Operation Tests - Require filesystem access
// =============================================================================

integrationTest("GitCodeSourceProvider.ensureDirectory creates directory", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const provider = new GitCodeSourceProvider({ codeDirectory: tempDir });
    await provider.ensureDirectory("test-source");

    const stat = await Deno.stat(`${tempDir}/test-source`);
    expect(stat.isDirectory).toBe(true);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

integrationTest("GitCodeSourceProvider.deleteDirectory removes directory", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const provider = new GitCodeSourceProvider({ codeDirectory: tempDir });

    // Create directory with contents
    await Deno.mkdir(`${tempDir}/test-source`, { recursive: true });
    await Deno.writeTextFile(`${tempDir}/test-source/file.txt`, "content");

    // Delete it
    await provider.deleteDirectory("test-source");

    // Verify it's gone
    try {
      await Deno.stat(`${tempDir}/test-source`);
      throw new Error("Directory should not exist");
    } catch (error) {
      expect(error instanceof Deno.errors.NotFound).toBe(true);
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

integrationTest("GitCodeSourceProvider.deleteDirectory silently succeeds if directory doesn't exist", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const provider = new GitCodeSourceProvider({ codeDirectory: tempDir });

    // Should not throw
    await provider.deleteDirectory("nonexistent-source");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

integrationTest("GitCodeSourceProvider.directoryExists returns true for existing directory", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const provider = new GitCodeSourceProvider({ codeDirectory: tempDir });
    await Deno.mkdir(`${tempDir}/test-source`, { recursive: true });

    const exists = await provider.directoryExists("test-source");
    expect(exists).toBe(true);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

integrationTest("GitCodeSourceProvider.directoryExists returns false for non-existing directory", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const provider = new GitCodeSourceProvider({ codeDirectory: tempDir });

    const exists = await provider.directoryExists("nonexistent-source");
    expect(exists).toBe(false);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// =============================================================================
// Git Integration Tests - Using isomorphic-git (no external git binary needed)
// =============================================================================

integrationTest({
  name: "GitCodeSourceProvider.sync clones public repository",
  fn: async () => {
    const tempDir = await Deno.makeTempDir();
    try {
      const provider = new GitCodeSourceProvider({ codeDirectory: tempDir });

      const source = createTestSource("test-repo", {
        url: "https://github.com/octocat/Hello-World.git",
        branch: "master",
      });

      const result = await provider.sync(source, createMockToken());

      expect(result.success).toBe(true);
      expect(result.durationMs).toBeGreaterThan(0);

      // Verify clone happened
      const gitDir = await Deno.stat(`${tempDir}/test-repo/.git`);
      expect(gitDir.isDirectory).toBe(true);
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

integrationTest({
  name: "GitCodeSourceProvider.sync handles invalid URL",
  // isomorphic-git's HTTP client may not fully consume error responses
  sanitizeResources: false,
  fn: async () => {
    const tempDir = await Deno.makeTempDir();
    try {
      const provider = new GitCodeSourceProvider({ codeDirectory: tempDir });

      const source = createTestSource("test-repo", {
        url: "https://github.com/nonexistent/nonexistent-repo-12345.git",
        branch: "main",
      });

      const result = await provider.sync(source, createMockToken());

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.durationMs).toBeGreaterThan(0);
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

integrationTest({
  name: "GitCodeSourceProvider.sync respects cancellation token",
  fn: async () => {
    const tempDir = await Deno.makeTempDir();
    try {
      const provider = new GitCodeSourceProvider({ codeDirectory: tempDir });

      const source = createTestSource("test-repo", {
        url: "https://github.com/octocat/Hello-World.git",
        branch: "master",
      });

      // Use a pre-cancelled token
      const cancelledToken = createMockToken(true);

      // Sync should return failure due to cancellation
      const result = await provider.sync(source, cancelledToken);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Cancelled");
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

// =============================================================================
// Integration with TestSetupBuilder
// =============================================================================

integrationTest("GitCodeSourceProvider integrates with CodeSourceService", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();

  try {
    // Verify git provider is registered
    const hasGitProvider = ctx.codeSourceService.hasProvider("git");
    expect(hasGitProvider).toBe(true);

    // Get capabilities through service
    const provider = ctx.codeSourceService.getProvider("git");
    const capabilities = provider.getCapabilities();
    expect(capabilities.isSyncable).toBe(true);
    expect(capabilities.isEditable).toBe(false);
  } finally {
    await ctx.cleanup();
  }
});
