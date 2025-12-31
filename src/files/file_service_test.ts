import { expect } from "@std/expect";
import {
  FileService,
  isPathSafe,
  normalizePath,
  validateFilePath,
} from "./file_service.ts";

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

Deno.test("isPathSafe accepts safe paths", () => {
  expect(isPathSafe("hello.ts")).toBe(true);
  expect(isPathSafe("utils/helpers.ts")).toBe(true);
  expect(isPathSafe("a/b/c/d.ts")).toBe(true);
});

Deno.test("isPathSafe rejects directory traversal with ..", () => {
  expect(isPathSafe("../etc/passwd")).toBe(false);
  expect(isPathSafe("utils/../../../etc/passwd")).toBe(false);
  expect(isPathSafe("..")).toBe(false);
  expect(isPathSafe("utils/..")).toBe(false);
});

Deno.test("isPathSafe rejects paths starting with ./", () => {
  expect(isPathSafe("./hello.ts")).toBe(false);
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
