import { integrationTest } from "../test/test_helpers.ts";
import { expect } from "@std/expect";
import { TestSetupBuilder } from "../test/test_setup_builder.ts";
import { SourceFileService } from "./source_file_service.ts";
import { ManualCodeSourceProvider } from "../sources/manual_code_source_provider.ts";
import {
  SourceNotFoundError,
  SourceNotEditableError,
} from "../sources/errors.ts";
import type { CodeSourceProvider, ProviderCapabilities, SyncResult, CodeSource, TypeSettings } from "../sources/types.ts";
import type { CancellationToken } from "../jobs/types.ts";

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Mock git provider that is NOT editable.
 */
function createMockGitProvider(): CodeSourceProvider {
  return {
    type: "git" as const,
    getCapabilities(): ProviderCapabilities {
      return { isSyncable: true, isEditable: false };
    },
    // No-op encryption for mock provider
    encryptSensitiveFields(settings: TypeSettings): Promise<TypeSettings> {
      return Promise.resolve(settings);
    },
    decryptSensitiveFields(settings: TypeSettings): Promise<TypeSettings> {
      return Promise.resolve(settings);
    },
    sync(_source: CodeSource, _token: CancellationToken): Promise<SyncResult> {
      return Promise.resolve({ success: true, filesChanged: 0, durationMs: 0 });
    },
    ensureDirectory(_sourceName: string): Promise<void> {
      return Promise.resolve();
    },
    deleteDirectory(_sourceName: string): Promise<void> {
      return Promise.resolve();
    },
    directoryExists(_sourceName: string): Promise<boolean> {
      return Promise.resolve(true);
    },
  };
}

// ============================================================================
// Source Validation Tests - Read Operations
// ============================================================================

integrationTest("SourceFileService.listFiles throws SourceNotFoundError for non-existent source", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    const provider = new ManualCodeSourceProvider({ codeDirectory: ctx.codeDir });
    ctx.codeSourceService.registerProvider(provider);

    const sourceFileService = new SourceFileService({
      codeSourceService: ctx.codeSourceService,
      codeDirectory: ctx.codeDir,
    });

    await expect(
      sourceFileService.listFiles("non-existent")
    ).rejects.toThrow(SourceNotFoundError);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("SourceFileService.getFile throws SourceNotFoundError for non-existent source", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    const provider = new ManualCodeSourceProvider({ codeDirectory: ctx.codeDir });
    ctx.codeSourceService.registerProvider(provider);

    const sourceFileService = new SourceFileService({
      codeSourceService: ctx.codeSourceService,
      codeDirectory: ctx.codeDir,
    });

    await expect(
      sourceFileService.getFile("non-existent", "test.ts")
    ).rejects.toThrow(SourceNotFoundError);
  } finally {
    await ctx.cleanup();
  }
});

// ============================================================================
// Source Validation Tests - Write Operations
// ============================================================================

integrationTest("SourceFileService.writeFile throws SourceNotFoundError for non-existent source", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    const provider = new ManualCodeSourceProvider({ codeDirectory: ctx.codeDir });
    ctx.codeSourceService.registerProvider(provider);

    const sourceFileService = new SourceFileService({
      codeSourceService: ctx.codeSourceService,
      codeDirectory: ctx.codeDir,
    });

    await expect(
      sourceFileService.writeFile("non-existent", "test.ts", "content")
    ).rejects.toThrow(SourceNotFoundError);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("SourceFileService.writeFile throws SourceNotEditableError for git source", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    ctx.codeSourceService.registerProvider(createMockGitProvider());

    // Create a git source
    await ctx.codeSourceService.create({
      name: "git-source",
      type: "git",
      typeSettings: { url: "https://github.com/user/repo.git" },
    });

    const sourceFileService = new SourceFileService({
      codeSourceService: ctx.codeSourceService,
      codeDirectory: ctx.codeDir,
    });

    await expect(
      sourceFileService.writeFile("git-source", "test.ts", "content")
    ).rejects.toThrow(SourceNotEditableError);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("SourceFileService.deleteFile throws SourceNotEditableError for non-editable source", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    ctx.codeSourceService.registerProvider(createMockGitProvider());

    await ctx.codeSourceService.create({
      name: "git-source",
      type: "git",
      typeSettings: { url: "https://github.com/user/repo.git" },
    });

    const sourceFileService = new SourceFileService({
      codeSourceService: ctx.codeSourceService,
      codeDirectory: ctx.codeDir,
    });

    await expect(
      sourceFileService.deleteFile("git-source", "test.ts")
    ).rejects.toThrow(SourceNotEditableError);
  } finally {
    await ctx.cleanup();
  }
});

// ============================================================================
// Successful Operations with Manual Source
// ============================================================================

integrationTest("SourceFileService.writeFile succeeds for manual source", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    const provider = new ManualCodeSourceProvider({ codeDirectory: ctx.codeDir });
    ctx.codeSourceService.registerProvider(provider);

    await ctx.codeSourceService.create({ name: "my-source", type: "manual" });

    const sourceFileService = new SourceFileService({
      codeSourceService: ctx.codeSourceService,
      codeDirectory: ctx.codeDir,
    });

    const created = await sourceFileService.writeFile("my-source", "test.ts", "content");

    expect(created).toBe(true);

    const content = await sourceFileService.getFile("my-source", "test.ts");
    expect(content).toBe("content");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("SourceFileService.writeFile updates existing file", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    const provider = new ManualCodeSourceProvider({ codeDirectory: ctx.codeDir });
    ctx.codeSourceService.registerProvider(provider);

    await ctx.codeSourceService.create({ name: "my-source", type: "manual" });

    const sourceFileService = new SourceFileService({
      codeSourceService: ctx.codeSourceService,
      codeDirectory: ctx.codeDir,
    });

    // Create file
    await sourceFileService.writeFile("my-source", "test.ts", "original");

    // Update file
    const created = await sourceFileService.writeFile("my-source", "test.ts", "updated");

    expect(created).toBe(false); // Not created, just updated

    const content = await sourceFileService.getFile("my-source", "test.ts");
    expect(content).toBe("updated");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("SourceFileService.listFiles returns files for manual source", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    const provider = new ManualCodeSourceProvider({ codeDirectory: ctx.codeDir });
    ctx.codeSourceService.registerProvider(provider);

    await ctx.codeSourceService.create({ name: "my-source", type: "manual" });

    const sourceFileService = new SourceFileService({
      codeSourceService: ctx.codeSourceService,
      codeDirectory: ctx.codeDir,
    });

    // Create some files
    await sourceFileService.writeFile("my-source", "file1.ts", "content1");
    await sourceFileService.writeFile("my-source", "nested/file2.ts", "content2");

    const files = await sourceFileService.listFiles("my-source");

    expect(files.length).toBe(2);
    expect(files).toContain("file1.ts");
    expect(files).toContain("nested/file2.ts");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("SourceFileService.listFilesWithMetadata returns metadata", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    const provider = new ManualCodeSourceProvider({ codeDirectory: ctx.codeDir });
    ctx.codeSourceService.registerProvider(provider);

    await ctx.codeSourceService.create({ name: "my-source", type: "manual" });

    const sourceFileService = new SourceFileService({
      codeSourceService: ctx.codeSourceService,
      codeDirectory: ctx.codeDir,
    });

    await sourceFileService.writeFile("my-source", "test.ts", "hello");

    const files = await sourceFileService.listFilesWithMetadata("my-source");

    expect(files.length).toBe(1);
    expect(files[0].path).toBe("test.ts");
    expect(files[0].size).toBe(5); // "hello"
    expect(files[0].mtime).toBeInstanceOf(Date);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("SourceFileService.getFile returns null for non-existent file", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    const provider = new ManualCodeSourceProvider({ codeDirectory: ctx.codeDir });
    ctx.codeSourceService.registerProvider(provider);

    await ctx.codeSourceService.create({ name: "my-source", type: "manual" });

    const sourceFileService = new SourceFileService({
      codeSourceService: ctx.codeSourceService,
      codeDirectory: ctx.codeDir,
    });

    const content = await sourceFileService.getFile("my-source", "non-existent.ts");

    expect(content).toBeNull();
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("SourceFileService.fileExists returns correct values", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    const provider = new ManualCodeSourceProvider({ codeDirectory: ctx.codeDir });
    ctx.codeSourceService.registerProvider(provider);

    await ctx.codeSourceService.create({ name: "my-source", type: "manual" });

    const sourceFileService = new SourceFileService({
      codeSourceService: ctx.codeSourceService,
      codeDirectory: ctx.codeDir,
    });

    expect(await sourceFileService.fileExists("my-source", "test.ts")).toBe(false);

    await sourceFileService.writeFile("my-source", "test.ts", "content");

    expect(await sourceFileService.fileExists("my-source", "test.ts")).toBe(true);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("SourceFileService.deleteFile removes file", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    const provider = new ManualCodeSourceProvider({ codeDirectory: ctx.codeDir });
    ctx.codeSourceService.registerProvider(provider);

    await ctx.codeSourceService.create({ name: "my-source", type: "manual" });

    const sourceFileService = new SourceFileService({
      codeSourceService: ctx.codeSourceService,
      codeDirectory: ctx.codeDir,
    });

    await sourceFileService.writeFile("my-source", "test.ts", "content");
    expect(await sourceFileService.fileExists("my-source", "test.ts")).toBe(true);

    await sourceFileService.deleteFile("my-source", "test.ts");

    expect(await sourceFileService.fileExists("my-source", "test.ts")).toBe(false);
  } finally {
    await ctx.cleanup();
  }
});

// ============================================================================
// Binary Content Tests
// ============================================================================

integrationTest("SourceFileService.writeFileBytes handles binary content", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    const provider = new ManualCodeSourceProvider({ codeDirectory: ctx.codeDir });
    ctx.codeSourceService.registerProvider(provider);

    await ctx.codeSourceService.create({ name: "my-source", type: "manual" });

    const sourceFileService = new SourceFileService({
      codeSourceService: ctx.codeSourceService,
      codeDirectory: ctx.codeDir,
    });

    const binaryContent = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG header
    await sourceFileService.writeFileBytes("my-source", "image.png", binaryContent);

    const content = await sourceFileService.getFileBytes("my-source", "image.png");

    expect(content).toEqual(binaryContent);
  } finally {
    await ctx.cleanup();
  }
});

// ============================================================================
// Source Isolation Tests
// ============================================================================

integrationTest("SourceFileService isolates files between sources", async () => {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();
  try {
    const provider = new ManualCodeSourceProvider({ codeDirectory: ctx.codeDir });
    ctx.codeSourceService.registerProvider(provider);

    await ctx.codeSourceService.create({ name: "source-a", type: "manual" });
    await ctx.codeSourceService.create({ name: "source-b", type: "manual" });

    const sourceFileService = new SourceFileService({
      codeSourceService: ctx.codeSourceService,
      codeDirectory: ctx.codeDir,
    });

    await sourceFileService.writeFile("source-a", "test.ts", "content-a");
    await sourceFileService.writeFile("source-b", "test.ts", "content-b");

    expect(await sourceFileService.getFile("source-a", "test.ts")).toBe("content-a");
    expect(await sourceFileService.getFile("source-b", "test.ts")).toBe("content-b");

    const filesA = await sourceFileService.listFiles("source-a");
    const filesB = await sourceFileService.listFiles("source-b");

    expect(filesA).toEqual(["test.ts"]);
    expect(filesB).toEqual(["test.ts"]);
  } finally {
    await ctx.cleanup();
  }
});
