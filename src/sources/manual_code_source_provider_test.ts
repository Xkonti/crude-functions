import { expect } from "@std/expect";
import { ManualCodeSourceProvider } from "./manual_code_source_provider.ts";
import type { CodeSource } from "./types.ts";

// ============================================================================
// Capability Tests
// ============================================================================

Deno.test("ManualCodeSourceProvider.type is 'manual'", () => {
  const provider = new ManualCodeSourceProvider({ codeDirectory: "/tmp" });
  expect(provider.type).toBe("manual");
});

Deno.test("ManualCodeSourceProvider.getCapabilities returns correct values", () => {
  const provider = new ManualCodeSourceProvider({ codeDirectory: "/tmp" });
  const capabilities = provider.getCapabilities();

  expect(capabilities.isSyncable).toBe(false);
  expect(capabilities.isEditable).toBe(true);
});

// ============================================================================
// Sync Tests
// ============================================================================

Deno.test("ManualCodeSourceProvider.sync returns immediate success", async () => {
  const provider = new ManualCodeSourceProvider({ codeDirectory: "/tmp" });

  const mockSource: CodeSource = {
    id: "test-source", // ID is now the source name (string)
    name: "test-source",
    type: "manual",
    typeSettings: {},
    syncSettings: {},
    lastSyncStartedAt: null,
    lastSyncAt: null,
    lastSyncError: null,
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockToken = {
    isCancelled: false,
    whenCancelled: new Promise<void>(() => {}), // Never resolves
    throwIfCancelled: () => {},
  };

  const result = await provider.sync(mockSource, mockToken);

  expect(result.success).toBe(true);
  expect(result.filesChanged).toBe(0);
  expect(result.durationMs).toBe(0);
});

// ============================================================================
// Directory Operation Tests
// ============================================================================

Deno.test("ManualCodeSourceProvider.directoryExists returns false for non-existent directory", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const provider = new ManualCodeSourceProvider({ codeDirectory: tempDir });

    const exists = await provider.directoryExists("non-existent-source");

    expect(exists).toBe(false);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("ManualCodeSourceProvider.ensureDirectory creates directory", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const provider = new ManualCodeSourceProvider({ codeDirectory: tempDir });

    // Initially doesn't exist
    expect(await provider.directoryExists("test-source")).toBe(false);

    // Create directory
    await provider.ensureDirectory("test-source");

    // Now exists
    expect(await provider.directoryExists("test-source")).toBe(true);

    // Verify it's a directory
    const stat = await Deno.stat(`${tempDir}/test-source`);
    expect(stat.isDirectory).toBe(true);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("ManualCodeSourceProvider.ensureDirectory is idempotent", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const provider = new ManualCodeSourceProvider({ codeDirectory: tempDir });

    // Create directory twice - should not throw
    await provider.ensureDirectory("test-source");
    await provider.ensureDirectory("test-source");

    expect(await provider.directoryExists("test-source")).toBe(true);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("ManualCodeSourceProvider.deleteDirectory removes directory", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const provider = new ManualCodeSourceProvider({ codeDirectory: tempDir });

    // Create directory with contents
    await provider.ensureDirectory("test-source");
    await Deno.writeTextFile(`${tempDir}/test-source/file.txt`, "content");

    expect(await provider.directoryExists("test-source")).toBe(true);

    // Delete directory
    await provider.deleteDirectory("test-source");

    expect(await provider.directoryExists("test-source")).toBe(false);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("ManualCodeSourceProvider.deleteDirectory silently succeeds for non-existent directory", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const provider = new ManualCodeSourceProvider({ codeDirectory: tempDir });

    // Should not throw for non-existent directory
    await provider.deleteDirectory("non-existent");

    // Verify it still doesn't exist
    expect(await provider.directoryExists("non-existent")).toBe(false);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("ManualCodeSourceProvider.directoryExists returns false for file with same name", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const provider = new ManualCodeSourceProvider({ codeDirectory: tempDir });

    // Create a file instead of directory
    await Deno.writeTextFile(`${tempDir}/not-a-dir`, "file content");

    // Should return false because it's not a directory
    expect(await provider.directoryExists("not-a-dir")).toBe(false);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
