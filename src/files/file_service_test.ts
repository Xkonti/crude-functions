import { expect } from "@std/expect";
import { FileService } from "./file_service.ts";
import {
  normalizePath,
  validateFilePath,
} from "../validation/files.ts";

// ============================================================================
// Validation Function Tests
// ============================================================================

Deno.test("validateFilePath accepts valid paths", () => {
  expect(validateFilePath("hello.ts")).toBe(true);
  expect(validateFilePath("utils/helper.ts")).toBe(true);
  expect(validateFilePath("deep/nested/path/file.json")).toBe(true);
  expect(validateFilePath("file-with-dashes_and_underscores.ts")).toBe(true);
  expect(validateFilePath("a.ts")).toBe(true);
});

Deno.test("validateFilePath rejects empty paths", () => {
  expect(validateFilePath("")).toBe(false);
});

Deno.test("validateFilePath rejects paths with null bytes", () => {
  expect(validateFilePath("path\0with\0null")).toBe(false);
});

Deno.test("validateFilePath rejects absolute paths", () => {
  expect(validateFilePath("/absolute/path.ts")).toBe(false);
});

Deno.test("normalizePath removes redundant slashes", () => {
  expect(normalizePath("utils//helpers.ts")).toBe("utils/helpers.ts");
  expect(normalizePath("a///b//c.ts")).toBe("a/b/c.ts");
});

Deno.test("normalizePath trims whitespace", () => {
  expect(normalizePath("  hello.ts  ")).toBe("hello.ts");
});

Deno.test("normalizePath removes trailing slash", () => {
  expect(normalizePath("utils/")).toBe("utils");
});

// ============================================================================
// FileService Tests
// ============================================================================

async function createTestService(): Promise<{
  service: FileService;
  tempDir: string;
  basePath: string;
}> {
  const tempDir = await Deno.makeTempDir();
  const basePath = `${tempDir}/code`;
  await Deno.mkdir(basePath, { recursive: true });
  return {
    service: new FileService({ basePath }),
    tempDir,
    basePath,
  };
}

async function cleanup(tempDir: string): Promise<void> {
  await Deno.remove(tempDir, { recursive: true });
}

// listFiles tests

Deno.test("FileService.listFiles returns empty array for empty directory", async () => {
  const { service, tempDir } = await createTestService();
  try {
    const files = await service.listFiles();
    expect(files).toEqual([]);
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("FileService.listFiles returns files in flat structure", async () => {
  const { service, tempDir, basePath } = await createTestService();
  try {
    await Deno.writeTextFile(`${basePath}/hello.ts`, "content");
    await Deno.mkdir(`${basePath}/utils`, { recursive: true });
    await Deno.writeTextFile(`${basePath}/utils/helper.ts`, "content");

    const files = await service.listFiles();
    expect(files).toContain("hello.ts");
    expect(files).toContain("utils/helper.ts");
    expect(files.length).toBe(2);
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("FileService.listFiles returns deeply nested files", async () => {
  const { service, tempDir, basePath } = await createTestService();
  try {
    await Deno.mkdir(`${basePath}/a/b/c`, { recursive: true });
    await Deno.writeTextFile(`${basePath}/a/b/c/deep.ts`, "content");

    const files = await service.listFiles();
    expect(files).toContain("a/b/c/deep.ts");
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("FileService.listFiles returns sorted files", async () => {
  const { service, tempDir, basePath } = await createTestService();
  try {
    await Deno.writeTextFile(`${basePath}/z.ts`, "content");
    await Deno.writeTextFile(`${basePath}/a.ts`, "content");
    await Deno.writeTextFile(`${basePath}/m.ts`, "content");

    const files = await service.listFiles();
    expect(files).toEqual(["a.ts", "m.ts", "z.ts"]);
  } finally {
    await cleanup(tempDir);
  }
});

// listFilesWithMetadata tests

Deno.test("FileService.listFilesWithMetadata returns empty array for empty directory", async () => {
  const { service, tempDir } = await createTestService();
  try {
    const files = await service.listFilesWithMetadata();
    expect(files).toEqual([]);
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("FileService.listFilesWithMetadata returns correct size for single file", async () => {
  const { service, tempDir, basePath } = await createTestService();
  try {
    const content = "hello world";  // 11 bytes
    await Deno.writeTextFile(`${basePath}/hello.ts`, content);

    const files = await service.listFilesWithMetadata();
    expect(files.length).toBe(1);
    expect(files[0].path).toBe("hello.ts");
    expect(files[0].size).toBe(11);
    expect(files[0].mtime).toBeInstanceOf(Date);
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("FileService.listFilesWithMetadata returns accurate size for binary files", async () => {
  const { service, tempDir, basePath } = await createTestService();
  try {
    const binaryContent = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);  // 6 bytes
    await Deno.writeFile(`${basePath}/data.bin`, binaryContent);

    const files = await service.listFilesWithMetadata();
    expect(files[0].size).toBe(6);
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("FileService.listFilesWithMetadata returns correct size for zero-byte file", async () => {
  const { service, tempDir, basePath } = await createTestService();
  try {
    await Deno.writeTextFile(`${basePath}/empty.ts`, "");

    const files = await service.listFilesWithMetadata();
    expect(files[0].size).toBe(0);
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("FileService.listFilesWithMetadata returns valid mtime", async () => {
  const { service, tempDir, basePath } = await createTestService();
  try {
    await Deno.writeTextFile(`${basePath}/test.ts`, "content");

    const files = await service.listFilesWithMetadata();
    const stat = await Deno.stat(`${basePath}/test.ts`);

    expect(files[0].mtime).toBeInstanceOf(Date);
    // mtime should be within 1 second of filesystem stat
    const timeDiff = Math.abs(files[0].mtime.getTime() - stat.mtime!.getTime());
    expect(timeDiff).toBeLessThan(1000);
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("FileService.listFilesWithMetadata sorts files alphabetically by path", async () => {
  const { service, tempDir, basePath } = await createTestService();
  try {
    await Deno.writeTextFile(`${basePath}/z.ts`, "z");
    await Deno.writeTextFile(`${basePath}/a.ts`, "a");
    await Deno.writeTextFile(`${basePath}/m.ts`, "m");

    const files = await service.listFilesWithMetadata();
    const paths = files.map(f => f.path);
    expect(paths).toEqual(["a.ts", "m.ts", "z.ts"]);
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("FileService.listFilesWithMetadata handles nested directories with correct paths", async () => {
  const { service, tempDir, basePath } = await createTestService();
  try {
    await Deno.mkdir(`${basePath}/utils/helpers`, { recursive: true });
    await Deno.writeTextFile(`${basePath}/root.ts`, "root");
    await Deno.writeTextFile(`${basePath}/utils/mid.ts`, "mid");
    await Deno.writeTextFile(`${basePath}/utils/helpers/deep.ts`, "deep");

    const files = await service.listFilesWithMetadata();
    expect(files.length).toBe(3);

    expect(files.find(f => f.path === "root.ts")).toBeDefined();
    expect(files.find(f => f.path === "utils/mid.ts")).toBeDefined();
    expect(files.find(f => f.path === "utils/helpers/deep.ts")).toBeDefined();

    // All files should have size > 0
    files.forEach(file => {
      expect(file.size).toBeGreaterThan(0);
    });
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("FileService.listFilesWithMetadata returns correct metadata for multiple files", async () => {
  const { service, tempDir, basePath } = await createTestService();
  try {
    await Deno.writeTextFile(`${basePath}/file1.ts`, "12345");  // 5 bytes
    await Deno.mkdir(`${basePath}/subdir`, { recursive: true });
    await Deno.writeTextFile(`${basePath}/subdir/file2.ts`, "123456789");  // 9 bytes

    const files = await service.listFilesWithMetadata();
    expect(files.length).toBe(2);

    const file1 = files.find(f => f.path === "file1.ts");
    expect(file1).toBeDefined();
    expect(file1!.size).toBe(5);
    expect(file1!.mtime).toBeInstanceOf(Date);

    const file2 = files.find(f => f.path === "subdir/file2.ts");
    expect(file2).toBeDefined();
    expect(file2!.size).toBe(9);
    expect(file2!.mtime).toBeInstanceOf(Date);
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("FileService.listFilesWithMetadata handles very large files", async () => {
  const { service, tempDir, basePath } = await createTestService();
  try {
    // Create 1MB file
    const largeContent = new Uint8Array(1024 * 1024).fill(0x41);
    await Deno.writeFile(`${basePath}/large.bin`, largeContent);

    const files = await service.listFilesWithMetadata();
    expect(files[0].size).toBe(1048576);
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("FileService.listFilesWithMetadata sorts correctly with mixed root and nested files", async () => {
  const { service, tempDir, basePath } = await createTestService();
  try {
    await Deno.mkdir(`${basePath}/utils`, { recursive: true });
    await Deno.writeTextFile(`${basePath}/zebra.ts`, "z");
    await Deno.writeTextFile(`${basePath}/apple.ts`, "a");
    await Deno.writeTextFile(`${basePath}/utils/banana.ts`, "b");

    const files = await service.listFilesWithMetadata();
    const paths = files.map(f => f.path);

    // Should be sorted: apple.ts, utils/banana.ts, zebra.ts
    expect(paths).toEqual(["apple.ts", "utils/banana.ts", "zebra.ts"]);
  } finally {
    await cleanup(tempDir);
  }
});

// getFile tests

Deno.test("FileService.getFile returns content for existing file", async () => {
  const { service, tempDir, basePath } = await createTestService();
  try {
    await Deno.writeTextFile(`${basePath}/test.ts`, "test content");

    const content = await service.getFile("test.ts");
    expect(content).toBe("test content");
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("FileService.getFile returns null for non-existent file", async () => {
  const { service, tempDir } = await createTestService();
  try {
    const content = await service.getFile("nonexistent.ts");
    expect(content).toBe(null);
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("FileService.getFile handles nested paths", async () => {
  const { service, tempDir, basePath } = await createTestService();
  try {
    await Deno.mkdir(`${basePath}/utils`, { recursive: true });
    await Deno.writeTextFile(`${basePath}/utils/helper.ts`, "helper content");

    const content = await service.getFile("utils/helper.ts");
    expect(content).toBe("helper content");
  } finally {
    await cleanup(tempDir);
  }
});

// fileExists tests

Deno.test("FileService.fileExists returns true for existing file", async () => {
  const { service, tempDir, basePath } = await createTestService();
  try {
    await Deno.writeTextFile(`${basePath}/exists.ts`, "content");

    expect(await service.fileExists("exists.ts")).toBe(true);
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("FileService.fileExists returns false for non-existent file", async () => {
  const { service, tempDir } = await createTestService();
  try {
    expect(await service.fileExists("nonexistent.ts")).toBe(false);
  } finally {
    await cleanup(tempDir);
  }
});

// writeFile tests

Deno.test("FileService.writeFile creates new file and returns true", async () => {
  const { service, tempDir } = await createTestService();
  try {
    const created = await service.writeFile("new.ts", "new content");
    expect(created).toBe(true);

    const content = await service.getFile("new.ts");
    expect(content).toBe("new content");
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("FileService.writeFile updates existing file and returns false", async () => {
  const { service, tempDir, basePath } = await createTestService();
  try {
    await Deno.writeTextFile(`${basePath}/existing.ts`, "old content");

    const created = await service.writeFile("existing.ts", "new content");
    expect(created).toBe(false);

    const content = await service.getFile("existing.ts");
    expect(content).toBe("new content");
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("FileService.writeFile creates parent directories", async () => {
  const { service, tempDir } = await createTestService();
  try {
    await service.writeFile("deep/nested/file.ts", "content");

    const content = await service.getFile("deep/nested/file.ts");
    expect(content).toBe("content");
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("FileService.writeFile handles empty content", async () => {
  const { service, tempDir } = await createTestService();
  try {
    await service.writeFile("empty.ts", "");

    const content = await service.getFile("empty.ts");
    expect(content).toBe("");
  } finally {
    await cleanup(tempDir);
  }
});

// deleteFile tests

Deno.test("FileService.deleteFile removes file", async () => {
  const { service, tempDir, basePath } = await createTestService();
  try {
    await Deno.writeTextFile(`${basePath}/to-delete.ts`, "content");

    await service.deleteFile("to-delete.ts");

    expect(await service.fileExists("to-delete.ts")).toBe(false);
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("FileService.deleteFile handles nested files", async () => {
  const { service, tempDir, basePath } = await createTestService();
  try {
    await Deno.mkdir(`${basePath}/utils`, { recursive: true });
    await Deno.writeTextFile(`${basePath}/utils/helper.ts`, "content");

    await service.deleteFile("utils/helper.ts");

    expect(await service.fileExists("utils/helper.ts")).toBe(false);
  } finally {
    await cleanup(tempDir);
  }
});

// Edge case tests

Deno.test("FileService handles unicode content", async () => {
  const { service, tempDir } = await createTestService();
  try {
    const unicode = "Unicode: \u4e2d\u6587 \u0430\u0431\u0432 \ud83d\ude00";
    await service.writeFile("unicode.ts", unicode);

    const content = await service.getFile("unicode.ts");
    expect(content).toBe(unicode);
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("FileService handles special characters in content", async () => {
  const { service, tempDir } = await createTestService();
  try {
    const special = "Content with special chars: \n\t\r";
    await service.writeFile("special.ts", special);

    const content = await service.getFile("special.ts");
    expect(content).toBe(special);
  } finally {
    await cleanup(tempDir);
  }
});

// ============================================================================
// Path Traversal Security Tests
// ============================================================================

Deno.test("FileService rejects simple .. traversal", async () => {
  const { service, tempDir } = await createTestService();
  try {
    let errorThrown = false;
    try {
      await service.getFile("../etc/passwd");
    } catch (error) {
      errorThrown = true;
      expect((error as Error).message).toContain("escapes base directory");
    }
    expect(errorThrown).toBe(true);
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("FileService rejects nested .. traversal", async () => {
  const { service, tempDir } = await createTestService();
  try {
    let errorThrown = false;
    try {
      await service.getFile("code/../../../etc/passwd");
    } catch (error) {
      errorThrown = true;
      expect((error as Error).message).toContain("escapes base directory");
    }
    expect(errorThrown).toBe(true);
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("FileService rejects symlink escape attempts", async () => {
  const { service, tempDir, basePath } = await createTestService();
  try {
    // Create a symlink pointing outside base directory
    const symlinkPath = `${basePath}/evil`;
    await Deno.symlink("/etc", symlinkPath);

    // Try to access through symlink - should be rejected
    let errorThrown = false;
    try {
      await service.getFile("evil/passwd");
    } catch (error) {
      errorThrown = true;
      expect((error as Error).message).toContain("escapes base directory");
    }
    expect(errorThrown).toBe(true);
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("FileService allows valid relative paths", async () => {
  const { service, tempDir } = await createTestService();
  try {
    await service.writeFile("valid/path.ts", "content");
    const content = await service.getFile("valid/path.ts");
    expect(content).toBe("content");
  } finally {
    await cleanup(tempDir);
  }
});

// ============================================================================
// Binary File Tests
// ============================================================================

Deno.test("FileService.getFileBytes returns bytes for existing file", async () => {
  const { service, tempDir, basePath } = await createTestService();
  try {
    const content = new Uint8Array([0x00, 0x01, 0xFF, 0xFE]);
    await Deno.writeFile(`${basePath}/binary.bin`, content);

    const bytes = await service.getFileBytes("binary.bin");
    expect(bytes).toEqual(content);
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("FileService.getFileBytes returns null for non-existent file", async () => {
  const { service, tempDir } = await createTestService();
  try {
    const bytes = await service.getFileBytes("nonexistent.bin");
    expect(bytes).toBe(null);
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("FileService.getFileBytes handles nested paths", async () => {
  const { service, tempDir, basePath } = await createTestService();
  try {
    await Deno.mkdir(`${basePath}/assets`, { recursive: true });
    const content = new Uint8Array([0x89, 0x50, 0x4E, 0x47]); // PNG header
    await Deno.writeFile(`${basePath}/assets/image.png`, content);

    const bytes = await service.getFileBytes("assets/image.png");
    expect(bytes).toEqual(content);
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("FileService.writeFileBytes creates binary file and returns true", async () => {
  const { service, tempDir } = await createTestService();
  try {
    const content = new Uint8Array([0x89, 0x50, 0x4E, 0x47]); // PNG header
    const created = await service.writeFileBytes("image.png", content);
    expect(created).toBe(true);

    const bytes = await service.getFileBytes("image.png");
    expect(bytes).toEqual(content);
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("FileService.writeFileBytes updates existing file and returns false", async () => {
  const { service, tempDir, basePath } = await createTestService();
  try {
    const oldContent = new Uint8Array([0x01, 0x02, 0x03]);
    await Deno.writeFile(`${basePath}/existing.bin`, oldContent);

    const newContent = new Uint8Array([0x04, 0x05, 0x06, 0x07]);
    const created = await service.writeFileBytes("existing.bin", newContent);
    expect(created).toBe(false);

    const bytes = await service.getFileBytes("existing.bin");
    expect(bytes).toEqual(newContent);
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("FileService.writeFileBytes creates parent directories", async () => {
  const { service, tempDir } = await createTestService();
  try {
    const content = new Uint8Array([0x00, 0x11, 0x22, 0x33]);
    await service.writeFileBytes("deep/nested/data.bin", content);

    const bytes = await service.getFileBytes("deep/nested/data.bin");
    expect(bytes).toEqual(content);
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("FileService.writeFileBytes handles empty content", async () => {
  const { service, tempDir } = await createTestService();
  try {
    await service.writeFileBytes("empty.bin", new Uint8Array(0));

    const bytes = await service.getFileBytes("empty.bin");
    expect(bytes).toEqual(new Uint8Array(0));
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("FileService.writeFileBytes handles large binary files", async () => {
  const { service, tempDir } = await createTestService();
  try {
    // Create 1MB of random-ish data
    const content = new Uint8Array(1024 * 1024);
    for (let i = 0; i < content.length; i++) {
      content[i] = i % 256;
    }

    await service.writeFileBytes("large.bin", content);

    const bytes = await service.getFileBytes("large.bin");
    expect(bytes?.length).toBe(content.length);
    expect(bytes).toEqual(content);
  } finally {
    await cleanup(tempDir);
  }
});
