import { expect } from "@std/expect";
import { Hono } from "@hono/hono";
import { FileService } from "./file_service.ts";
import { createFileRoutes } from "./file_routes.ts";
import { TestSetupBuilder } from "../test/test_setup_builder.ts";
import { bytesToBase64 } from "../encryption/utils.ts";

// ============================================================================
// Test Helpers
// ============================================================================

async function createTestApp(
  initialFiles: Record<string, string | Uint8Array> = {}
): Promise<{
  app: Hono;
  tempDir: string;
  fileService: FileService;
  cleanup: () => Promise<void>;
}> {
  const ctx = await TestSetupBuilder.create()
    .withFiles()
    .withSettings()
    .build();

  // Create initial files
  for (const [path, content] of Object.entries(initialFiles)) {
    if (typeof content === "string") {
      await ctx.fileService.writeFile(path, content);
    } else {
      await ctx.fileService.writeFileBytes(path, content);
    }
  }

  const app = new Hono();
  app.route(
    "/api/files",
    createFileRoutes({
      fileService: ctx.fileService,
      settingsService: ctx.settingsService,
    })
  );

  return {
    app,
    tempDir: "",
    fileService: ctx.fileService,
    cleanup: ctx.cleanup,
  };
}

// ============================================================================
// GET /api/files - List Files
// ============================================================================

Deno.test("GET /api/files returns empty array for empty directory", async () => {
  const { app, cleanup } = await createTestApp();
  try {
    const res = await app.request("/api/files");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.files).toEqual([]);
  } finally {
    await cleanup();
  }
});

Deno.test("GET /api/files returns all files with metadata", async () => {
  const { app, cleanup } = await createTestApp({
    "hello.ts": "content1",
    "utils/helper.ts": "content2",
  });

  try {
    const res = await app.request("/api/files");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.files.length).toBe(2);

    // Check file metadata structure
    const file = json.files.find(
      (f: { path: string }) => f.path === "hello.ts"
    );
    expect(file).toBeDefined();
    expect(file.size).toBe(8); // "content1"
    expect(file.mtime).toBeDefined();
  } finally {
    await cleanup();
  }
});

// ============================================================================
// GET /api/files/:path - Get File Content (Raw)
// ============================================================================

Deno.test("GET /api/files/:path returns raw file content", async () => {
  const { app, cleanup } = await createTestApp({
    "hello.ts": "hello content",
  });

  try {
    const res = await app.request("/api/files/hello.ts");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/typescript");
    expect(res.headers.get("Content-Length")).toBe("13");

    const content = await res.text();
    expect(content).toBe("hello content");
  } finally {
    await cleanup();
  }
});

Deno.test("GET /api/files/:path returns raw binary file", async () => {
  const binaryContent = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG header
  const { app, cleanup } = await createTestApp({
    "image.png": binaryContent,
  });

  try {
    const res = await app.request("/api/files/image.png");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");

    const buffer = await res.arrayBuffer();
    expect(new Uint8Array(buffer)).toEqual(binaryContent);
  } finally {
    await cleanup();
  }
});

Deno.test("GET /api/files/:path returns 404 for non-existent file", async () => {
  const { app, cleanup } = await createTestApp();

  try {
    const res = await app.request("/api/files/nonexistent.ts");
    expect(res.status).toBe(404);

    const json = await res.json();
    expect(json.error).toContain("not found");
  } finally {
    await cleanup();
  }
});

Deno.test("GET /api/files/:path returns 400 for invalid path format", async () => {
  const { app, cleanup } = await createTestApp();

  try {
    // Absolute path should be rejected
    const res = await app.request("/api/files/%2Fabsolute%2Fpath.ts");
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain("Invalid");
  } finally {
    await cleanup();
  }
});

Deno.test("GET /api/files/:path handles nested paths", async () => {
  const { app, cleanup } = await createTestApp({
    "utils/helpers/format.ts": "format content",
  });

  try {
    const res = await app.request("/api/files/utils/helpers/format.ts");
    expect(res.status).toBe(200);

    const content = await res.text();
    expect(content).toBe("format content");
  } finally {
    await cleanup();
  }
});

// ============================================================================
// GET /api/files/:path - Get File Content (JSON)
// ============================================================================

Deno.test("GET /api/files/:path returns JSON for text file with Accept header", async () => {
  const { app, cleanup } = await createTestApp({
    "hello.ts": "hello content",
  });

  try {
    const res = await app.request("/api/files/hello.ts", {
      headers: { Accept: "application/json" },
    });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.path).toBe("hello.ts");
    expect(json.content).toBe("hello content");
    expect(json.contentType).toBe("text/typescript");
    expect(json.encoding).toBe("utf-8");
    expect(json.size).toBe(13);
  } finally {
    await cleanup();
  }
});

Deno.test("GET /api/files/:path returns base64 JSON for binary file with Accept header", async () => {
  const binaryContent = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG header
  const { app, cleanup } = await createTestApp({
    "image.png": binaryContent,
  });

  try {
    const res = await app.request("/api/files/image.png", {
      headers: { Accept: "application/json" },
    });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.path).toBe("image.png");
    expect(json.contentType).toBe("image/png");
    expect(json.encoding).toBe("base64");
    expect(json.content).toBe(bytesToBase64(binaryContent));
  } finally {
    await cleanup();
  }
});

// ============================================================================
// POST /api/files/:path - Create File (JSON)
// ============================================================================

Deno.test("POST /api/files/:path creates new file with 201", async () => {
  const { app, fileService, cleanup } = await createTestApp();

  try {
    const res = await app.request("/api/files/new.ts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "new content" }),
    });

    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.path).toBe("new.ts");
    expect(json.created).toBe(true);

    // Verify file was created
    expect(await fileService.getFile("new.ts")).toBe("new content");
  } finally {
    await cleanup();
  }
});

Deno.test("POST /api/files/:path returns 409 for existing file", async () => {
  const { app, cleanup } = await createTestApp({
    "existing.ts": "old content",
  });

  try {
    const res = await app.request("/api/files/existing.ts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "new content" }),
    });

    expect(res.status).toBe(409);

    const json = await res.json();
    expect(json.error).toContain("already exists");
  } finally {
    await cleanup();
  }
});

Deno.test("POST /api/files/:path creates file with base64 binary content", async () => {
  const { app, fileService, cleanup } = await createTestApp();
  const binaryContent = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG header

  try {
    const res = await app.request("/api/files/image.png", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: bytesToBase64(binaryContent),
        encoding: "base64",
      }),
    });

    expect(res.status).toBe(201);

    const bytes = await fileService.getFileBytes("image.png");
    expect(bytes).toEqual(binaryContent);
  } finally {
    await cleanup();
  }
});

Deno.test("POST /api/files/:path returns 400 for invalid JSON", async () => {
  const { app, cleanup } = await createTestApp();

  try {
    const res = await app.request("/api/files/test.ts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not valid json",
    });

    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain("JSON");
  } finally {
    await cleanup();
  }
});

Deno.test("POST /api/files/:path returns 400 for missing content", async () => {
  const { app, cleanup } = await createTestApp();

  try {
    const res = await app.request("/api/files/test.ts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain("content");
  } finally {
    await cleanup();
  }
});

// ============================================================================
// POST /api/files/:path - Create File (Raw Binary)
// ============================================================================

Deno.test("POST /api/files/:path creates file with raw binary body", async () => {
  const { app, fileService, cleanup } = await createTestApp();
  const binaryContent = new Uint8Array([0x00, 0x11, 0x22, 0x33]);

  try {
    const res = await app.request("/api/files/data.bin", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: binaryContent,
    });

    expect(res.status).toBe(201);

    const bytes = await fileService.getFileBytes("data.bin");
    expect(bytes).toEqual(binaryContent);
  } finally {
    await cleanup();
  }
});

Deno.test("POST /api/files/:path creates file with raw text body", async () => {
  const { app, fileService, cleanup } = await createTestApp();

  try {
    const res = await app.request("/api/files/script.ts", {
      method: "POST",
      headers: { "Content-Type": "text/typescript" },
      body: "export const x = 1;",
    });

    expect(res.status).toBe(201);

    const content = await fileService.getFile("script.ts");
    expect(content).toBe("export const x = 1;");
  } finally {
    await cleanup();
  }
});

// ============================================================================
// PUT /api/files/:path - Create or Update File
// ============================================================================

Deno.test("PUT /api/files/:path creates new file with 201", async () => {
  const { app, fileService, cleanup } = await createTestApp();

  try {
    const res = await app.request("/api/files/new.ts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "new content" }),
    });

    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.created).toBe(true);

    expect(await fileService.getFile("new.ts")).toBe("new content");
  } finally {
    await cleanup();
  }
});

Deno.test("PUT /api/files/:path updates existing file with 200", async () => {
  const { app, fileService, cleanup } = await createTestApp({
    "existing.ts": "old content",
  });

  try {
    const res = await app.request("/api/files/existing.ts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "updated content" }),
    });

    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.created).toBe(false);

    expect(await fileService.getFile("existing.ts")).toBe("updated content");
  } finally {
    await cleanup();
  }
});

Deno.test("PUT /api/files/:path creates nested directories", async () => {
  const { app, fileService, cleanup } = await createTestApp();

  try {
    const res = await app.request("/api/files/deep/nested/file.ts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "deep content" }),
    });

    expect(res.status).toBe(201);
    expect(await fileService.getFile("deep/nested/file.ts")).toBe(
      "deep content"
    );
  } finally {
    await cleanup();
  }
});

Deno.test("PUT /api/files/:path handles raw binary upload", async () => {
  const { app, fileService, cleanup } = await createTestApp();
  const binaryContent = new Uint8Array([0xff, 0xfe, 0xfd]);

  try {
    const res = await app.request("/api/files/binary.bin", {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: binaryContent,
    });

    expect(res.status).toBe(201);

    const bytes = await fileService.getFileBytes("binary.bin");
    expect(bytes).toEqual(binaryContent);
  } finally {
    await cleanup();
  }
});

// ============================================================================
// DELETE /api/files/:path - Delete File
// ============================================================================

Deno.test("DELETE /api/files/:path deletes existing file", async () => {
  const { app, fileService, cleanup } = await createTestApp({
    "to-delete.ts": "content",
  });

  try {
    const res = await app.request("/api/files/to-delete.ts", {
      method: "DELETE",
    });

    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.path).toBe("to-delete.ts");
    expect(json.deleted).toBe(true);

    expect(await fileService.fileExists("to-delete.ts")).toBe(false);
  } finally {
    await cleanup();
  }
});

Deno.test("DELETE /api/files/:path returns 404 for non-existent file", async () => {
  const { app, cleanup } = await createTestApp();

  try {
    const res = await app.request("/api/files/nonexistent.ts", {
      method: "DELETE",
    });

    expect(res.status).toBe(404);

    const json = await res.json();
    expect(json.error).toContain("not found");
  } finally {
    await cleanup();
  }
});

Deno.test("DELETE /api/files/:path handles nested files", async () => {
  const { app, fileService, cleanup } = await createTestApp({
    "utils/helper.ts": "content",
  });

  try {
    const res = await app.request("/api/files/utils/helper.ts", {
      method: "DELETE",
    });

    expect(res.status).toBe(200);
    expect(await fileService.fileExists("utils/helper.ts")).toBe(false);
  } finally {
    await cleanup();
  }
});

// ============================================================================
// File Size Limit Tests
// ============================================================================

Deno.test("POST /api/files/:path returns 413 for oversized file", async () => {
  // Create a context with a small file size limit
  const ctx = await TestSetupBuilder.create()
    .withFiles()
    .withSettings()
    .withSetting("files.max-size-bytes", "100") // 100 bytes limit
    .build();

  try {
    const app = new Hono();
    app.route(
      "/api/files",
      createFileRoutes({
        fileService: ctx.fileService,
        settingsService: ctx.settingsService,
      })
    );

    // Try to upload content larger than 100 bytes
    const largeContent = "x".repeat(200);
    const res = await app.request("/api/files/large.txt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: largeContent }),
    });

    expect(res.status).toBe(413);

    const json = await res.json();
    expect(json.error).toContain("exceeds maximum");
  } finally {
    await ctx.cleanup();
  }
});

// ============================================================================
// Path Handling Tests
// ============================================================================

Deno.test("File routes handle URL-encoded paths", async () => {
  const { app, fileService, cleanup } = await createTestApp();

  try {
    // Create file with space in name
    const res = await app.request("/api/files/my%20file.ts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "content" }),
    });

    expect(res.status).toBe(201);
    expect(await fileService.getFile("my file.ts")).toBe("content");
  } finally {
    await cleanup();
  }
});

Deno.test("File routes allow empty file content", async () => {
  const { app, fileService, cleanup } = await createTestApp();

  try {
    const res = await app.request("/api/files/empty.ts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "" }),
    });

    expect(res.status).toBe(201);
    expect(await fileService.getFile("empty.ts")).toBe("");
  } finally {
    await cleanup();
  }
});

// ============================================================================
// POST/PUT with Multipart Form-Data
// ============================================================================

Deno.test("POST /api/files/:path accepts multipart/form-data with 'file' field", async () => {
  const { app, fileService, cleanup } = await createTestApp();

  try {
    const formData = new FormData();
    const fileContent = "export const x = 1;";
    const file = new File([fileContent], "script.ts", { type: "text/typescript" });
    formData.append("file", file);

    const res = await app.request("/api/files/script.ts", {
      method: "POST",
      body: formData,
    });

    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.path).toBe("script.ts");
    expect(json.created).toBe(true);

    // Verify file was created on filesystem
    expect(await fileService.getFile("script.ts")).toBe("export const x = 1;");
  } finally {
    await cleanup();
  }
});

Deno.test("POST /api/files/:path accepts multipart/form-data with 'content' field", async () => {
  const { app, fileService, cleanup } = await createTestApp();

  try {
    const formData = new FormData();
    const binaryData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG header
    const file = new File([binaryData], "image.png", { type: "image/png" });
    formData.append("content", file);  // Use "content" instead of "file"

    const res = await app.request("/api/files/image.png", {
      method: "POST",
      body: formData,
    });

    expect(res.status).toBe(201);

    // Verify binary content matches
    const bytes = await fileService.getFileBytes("image.png");
    expect(bytes).toEqual(binaryData);
  } finally {
    await cleanup();
  }
});

Deno.test("POST /api/files/:path accepts multipart/form-data with string value", async () => {
  const { app, fileService, cleanup } = await createTestApp();

  try {
    const formData = new FormData();
    formData.append("file", "console.log('hello');");  // String, not File

    const res = await app.request("/api/files/hello.ts", {
      method: "POST",
      body: formData,
    });

    expect(res.status).toBe(201);

    const content = await fileService.getFile("hello.ts");
    expect(content).toBe("console.log('hello');");
  } finally {
    await cleanup();
  }
});

Deno.test("PUT /api/files/:path creates new file with multipart/form-data", async () => {
  const { app, fileService, cleanup } = await createTestApp();

  try {
    const formData = new FormData();
    const file = new File(["new content"], "new.ts");
    formData.append("file", file);

    const res = await app.request("/api/files/new.ts", {
      method: "PUT",
      body: formData,
    });

    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.created).toBe(true);

    expect(await fileService.getFile("new.ts")).toBe("new content");
  } finally {
    await cleanup();
  }
});

Deno.test("PUT /api/files/:path updates existing file with multipart/form-data", async () => {
  const { app, fileService, cleanup } = await createTestApp({
    "existing.ts": "old content",
  });

  try {
    const formData = new FormData();
    const file = new File(["new content"], "existing.ts");
    formData.append("file", file);

    const res = await app.request("/api/files/existing.ts", {
      method: "PUT",
      body: formData,
    });

    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.created).toBe(false);

    expect(await fileService.getFile("existing.ts")).toBe("new content");
  } finally {
    await cleanup();
  }
});

Deno.test("Multipart upload returns 400 for missing file field", async () => {
  const { app, cleanup } = await createTestApp();

  try {
    const formData = new FormData();
    formData.append("wrong_field", "content");  // Neither "file" nor "content"

    const res = await app.request("/api/files/test.ts", {
      method: "POST",
      body: formData,
    });

    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain("Missing file field");
  } finally {
    await cleanup();
  }
});

Deno.test("Multipart upload returns 413 for oversized File object", async () => {
  const ctx = await TestSetupBuilder.create()
    .withFiles()
    .withSettings()
    .withSetting("files.max-size-bytes", "100")  // 100 bytes limit
    .build();

  try {
    const app = new Hono();
    app.route(
      "/api/files",
      createFileRoutes({
        fileService: ctx.fileService,
        settingsService: ctx.settingsService,
      })
    );

    const formData = new FormData();
    const largeContent = "x".repeat(200);  // 200 bytes
    const file = new File([largeContent], "large.txt");
    formData.append("file", file);

    const res = await app.request("/api/files/large.txt", {
      method: "POST",
      body: formData,
    });

    expect(res.status).toBe(413);

    const json = await res.json();
    expect(json.error).toContain("exceeds maximum");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("Multipart upload returns 413 for oversized string value", async () => {
  const ctx = await TestSetupBuilder.create()
    .withFiles()
    .withSettings()
    .withSetting("files.max-size-bytes", "100")  // 100 bytes limit
    .build();

  try {
    const app = new Hono();
    app.route(
      "/api/files",
      createFileRoutes({
        fileService: ctx.fileService,
        settingsService: ctx.settingsService,
      })
    );

    const formData = new FormData();
    formData.append("file", "x".repeat(200));  // String, not File

    const res = await app.request("/api/files/large.txt", {
      method: "POST",
      body: formData,
    });

    expect(res.status).toBe(413);

    const json = await res.json();
    expect(json.error).toContain("exceeds maximum");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("Multipart upload returns 400 for invalid form-data", async () => {
  const { app, cleanup } = await createTestApp();

  try {
    const res = await app.request("/api/files/test.ts", {
      method: "POST",
      headers: { "Content-Type": "multipart/form-data; boundary=---broken" },
      body: "not valid multipart data",
    });

    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain("Invalid multipart form-data");
  } finally {
    await cleanup();
  }
});

Deno.test("Multipart upload works with nested directory paths", async () => {
  const { app, fileService, cleanup } = await createTestApp();

  try {
    const formData = new FormData();
    const file = new File(["nested content"], "file.ts");
    formData.append("file", file);

    const res = await app.request("/api/files/utils/nested/file.ts", {
      method: "PUT",
      body: formData,
    });

    expect(res.status).toBe(201);

    expect(await fileService.getFile("utils/nested/file.ts")).toBe("nested content");
  } finally {
    await cleanup();
  }
});

Deno.test("Multipart upload handles empty File object", async () => {
  const { app, fileService, cleanup } = await createTestApp();

  try {
    const formData = new FormData();
    const file = new File([], "empty.ts");
    formData.append("file", file);

    const res = await app.request("/api/files/empty.ts", {
      method: "POST",
      body: formData,
    });

    expect(res.status).toBe(201);

    expect(await fileService.getFile("empty.ts")).toBe("");
  } finally {
    await cleanup();
  }
});

Deno.test("Multipart upload rejects empty string value", async () => {
  const { app, cleanup } = await createTestApp();

  try {
    const formData = new FormData();
    formData.append("file", "");  // Empty string is treated as missing field

    const res = await app.request("/api/files/empty.ts", {
      method: "POST",
      body: formData,
    });

    // Empty string in FormData is falsy and treated as missing field
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain("Missing file field");
  } finally {
    await cleanup();
  }
});
