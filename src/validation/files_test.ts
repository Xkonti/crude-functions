import { expect } from "@std/expect";
import {
  normalizePath,
  resolveAndValidatePath,
  validateFilePath,
} from "./files.ts";

// =====================
// Test context helper for filesystem tests
// =====================

interface TestContext {
  tempDir: string;
  cleanup: () => Promise<void>;
}

async function createTestContext(): Promise<TestContext> {
  const tempDir = await Deno.makeTempDir();
  return {
    tempDir,
    cleanup: async () => {
      try {
        await Deno.remove(tempDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    },
  };
}

// =====================
// validateFilePath - valid cases
// =====================

Deno.test("validateFilePath accepts simple filename", () => {
  expect(validateFilePath("file.ts")).toBe(true);
});

Deno.test("validateFilePath accepts nested path", () => {
  expect(validateFilePath("path/to/file.ts")).toBe(true);
});

Deno.test("validateFilePath accepts filename with dashes and underscores", () => {
  expect(validateFilePath("file-name_123.ts")).toBe(true);
});

Deno.test("validateFilePath accepts relative path with dot", () => {
  expect(validateFilePath("./file.ts")).toBe(true);
});

Deno.test("validateFilePath accepts filename without extension", () => {
  expect(validateFilePath("readme")).toBe(true);
});

// =====================
// validateFilePath - invalid cases
// =====================

Deno.test("validateFilePath rejects empty string", () => {
  expect(validateFilePath("")).toBe(false);
});

Deno.test("validateFilePath rejects absolute path", () => {
  expect(validateFilePath("/absolute/path")).toBe(false);
});

Deno.test("validateFilePath rejects path with null byte", () => {
  expect(validateFilePath("path\0null")).toBe(false);
});

Deno.test("validateFilePath rejects null byte in middle", () => {
  expect(validateFilePath("before\0after.ts")).toBe(false);
});

// =====================
// normalizePath
// =====================

Deno.test("normalizePath trims leading whitespace", () => {
  expect(normalizePath("  file.ts")).toBe("file.ts");
});

Deno.test("normalizePath trims trailing whitespace", () => {
  expect(normalizePath("file.ts  ")).toBe("file.ts");
});

Deno.test("normalizePath trims both sides", () => {
  expect(normalizePath("  file.ts  ")).toBe("file.ts");
});

Deno.test("normalizePath removes double slashes", () => {
  expect(normalizePath("path//double")).toBe("path/double");
});

Deno.test("normalizePath removes trailing slash", () => {
  expect(normalizePath("path/")).toBe("path");
});

Deno.test("normalizePath handles multiple issues at once", () => {
  expect(normalizePath("  path//to///file/  ")).toBe("path/to/file");
});

Deno.test("normalizePath preserves single slashes", () => {
  expect(normalizePath("path/to/file")).toBe("path/to/file");
});

Deno.test("normalizePath handles empty string", () => {
  expect(normalizePath("")).toBe("");
});

// =====================
// resolveAndValidatePath - valid cases
// =====================

Deno.test("resolveAndValidatePath resolves simple file", async () => {
  const ctx = await createTestContext();
  try {
    const result = await resolveAndValidatePath(ctx.tempDir, "file.ts");
    expect(result).toBe(`${ctx.tempDir}/file.ts`);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("resolveAndValidatePath resolves nested path", async () => {
  const ctx = await createTestContext();
  try {
    const result = await resolveAndValidatePath(ctx.tempDir, "sub/file.ts");
    expect(result).toBe(`${ctx.tempDir}/sub/file.ts`);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("resolveAndValidatePath normalizes path", async () => {
  const ctx = await createTestContext();
  try {
    const result = await resolveAndValidatePath(ctx.tempDir, "  sub//file.ts  ");
    expect(result).toBe(`${ctx.tempDir}/sub/file.ts`);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("resolveAndValidatePath allows dot segments that stay within base", async () => {
  const ctx = await createTestContext();
  try {
    const result = await resolveAndValidatePath(ctx.tempDir, "sub/../file.ts");
    expect(result).toBe(`${ctx.tempDir}/file.ts`);
  } finally {
    await ctx.cleanup();
  }
});

// =====================
// resolveAndValidatePath - directory traversal prevention
// =====================

Deno.test("resolveAndValidatePath rejects simple parent traversal", async () => {
  const ctx = await createTestContext();
  try {
    await expect(
      resolveAndValidatePath(ctx.tempDir, "../escape")
    ).rejects.toThrow("escapes base directory");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("resolveAndValidatePath rejects absolute path", async () => {
  const ctx = await createTestContext();
  try {
    await expect(
      resolveAndValidatePath(ctx.tempDir, "/absolute")
    ).rejects.toThrow("must be relative");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("resolveAndValidatePath rejects nested escape", async () => {
  const ctx = await createTestContext();
  try {
    await expect(
      resolveAndValidatePath(ctx.tempDir, "sub/../../escape")
    ).rejects.toThrow("escapes base directory");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("resolveAndValidatePath rejects deeply nested escape", async () => {
  const ctx = await createTestContext();
  try {
    await expect(
      resolveAndValidatePath(ctx.tempDir, "a/b/c/../../../..")
    ).rejects.toThrow("escapes base directory");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("resolveAndValidatePath rejects multiple parent references", async () => {
  const ctx = await createTestContext();
  try {
    await expect(
      resolveAndValidatePath(ctx.tempDir, "../../etc/passwd")
    ).rejects.toThrow("escapes base directory");
  } finally {
    await ctx.cleanup();
  }
});

// =====================
// resolveAndValidatePath - symlink escape prevention
// =====================

Deno.test("resolveAndValidatePath rejects symlink escaping base directory", async () => {
  const ctx = await createTestContext();
  try {
    // Create a symlink inside tempDir that points outside
    const symlinkPath = `${ctx.tempDir}/escape-link`;
    await Deno.symlink("/tmp", symlinkPath);

    await expect(
      resolveAndValidatePath(ctx.tempDir, "escape-link/somefile")
    ).rejects.toThrow("escapes base directory");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("resolveAndValidatePath allows symlink within base directory", async () => {
  const ctx = await createTestContext();
  try {
    // Create a subdirectory and a symlink to it
    const subDir = `${ctx.tempDir}/subdir`;
    await Deno.mkdir(subDir);
    await Deno.writeTextFile(`${subDir}/file.ts`, "content");

    const symlinkPath = `${ctx.tempDir}/link-to-sub`;
    await Deno.symlink(subDir, symlinkPath);

    // Should succeed because symlink target is within base
    const result = await resolveAndValidatePath(ctx.tempDir, "link-to-sub/file.ts");
    expect(result).toBe(`${ctx.tempDir}/link-to-sub/file.ts`);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("resolveAndValidatePath handles non-existent paths gracefully", async () => {
  const ctx = await createTestContext();
  try {
    // Path doesn't exist but is within base - should resolve without error
    const result = await resolveAndValidatePath(ctx.tempDir, "nonexistent/path/file.ts");
    expect(result).toBe(`${ctx.tempDir}/nonexistent/path/file.ts`);
  } finally {
    await ctx.cleanup();
  }
});

// =====================
// resolveAndValidatePath - basePath with subdirectory
// =====================
// Note: Previously these tests used Deno.chdir() to test relative basePath handling,
// but chdir is process-global and breaks parallel test execution.
// The relative path resolution is handled by @std/path's resolve() which is well-tested.
// These tests now use absolute paths to verify the same validation logic.

Deno.test("resolveAndValidatePath handles basePath with subdirectory", async () => {
  const ctx = await createTestContext();
  try {
    // Create a subdirectory structure similar to production's ./code
    const codeDir = `${ctx.tempDir}/code`;
    await Deno.mkdir(codeDir);

    // Test with absolute path to the code directory
    const result = await resolveAndValidatePath(codeDir, "file.ts");
    expect(result).toBe(`${codeDir}/file.ts`);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("resolveAndValidatePath handles basePath with nested file in subdirectory", async () => {
  const ctx = await createTestContext();
  try {
    const codeDir = `${ctx.tempDir}/code`;
    await Deno.mkdir(codeDir);

    const result = await resolveAndValidatePath(codeDir, "examples/handler.ts");
    expect(result).toBe(`${codeDir}/examples/handler.ts`);
  } finally {
    await ctx.cleanup();
  }
});
