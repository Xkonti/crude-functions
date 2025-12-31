import { expect } from "@std/expect";
import { Hono } from "@hono/hono";
import { FileService } from "./file_service.ts";
import { createFileRoutes } from "./file_routes.ts";

// ============================================================================
// Test Helpers
// ============================================================================

async function createTestApp(
  initialFiles: Record<string, string> = {}
): Promise<{
  app: Hono;
  tempDir: string;
  service: FileService;
  basePath: string;
}> {
  const tempDir = await Deno.makeTempDir();
  const basePath = `${tempDir}/code`;
  await Deno.mkdir(basePath, { recursive: true });

  // Create initial files
  for (const [path, content] of Object.entries(initialFiles)) {
    const fullPath = `${basePath}/${path}`;
    const lastSlash = fullPath.lastIndexOf("/");
    if (lastSlash > 0) {
      const parentDir = fullPath.substring(0, lastSlash);
      await Deno.mkdir(parentDir, { recursive: true });
    }
    await Deno.writeTextFile(fullPath, content);
  }

  const service = new FileService({ basePath });
  const app = new Hono();
  app.route("/api/files", createFileRoutes(service));

  return { app, tempDir, service, basePath };
}

async function cleanup(tempDir: string): Promise<void> {
  await Deno.remove(tempDir, { recursive: true });
}

// ============================================================================
// GET /api/files - List Files
// ============================================================================

Deno.test("GET /api/files returns empty array for empty directory", async () => {
  const { app, tempDir } = await createTestApp();
  try {
    const res = await app.request("/api/files");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.files).toEqual([]);
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("GET /api/files returns all files", async () => {
  const { app, tempDir } = await createTestApp({
    "hello.ts": "content1",
    "utils/helper.ts": "content2",
  });

  try {
    const res = await app.request("/api/files");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.files).toContain("hello.ts");
    expect(json.files).toContain("utils/helper.ts");
  } finally {
    await cleanup(tempDir);
  }
});

// ============================================================================
// GET /api/files/content - Get File Content
// ============================================================================

Deno.test("GET /api/files/content returns file content", async () => {
  const { app, tempDir } = await createTestApp({
    "hello.ts": "hello content",
  });

  try {
    const res = await app.request("/api/files/content?path=hello.ts");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.path).toBe("hello.ts");
    expect(json.content).toBe("hello content");
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("GET /api/files/content returns 400 for missing path", async () => {
  const { app, tempDir } = await createTestApp();

  try {
    const res = await app.request("/api/files/content");
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain("path");
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("GET /api/files/content returns 404 for non-existent file", async () => {
  const { app, tempDir } = await createTestApp();

  try {
    const res = await app.request("/api/files/content?path=nonexistent.ts");
    expect(res.status).toBe(404);

    const json = await res.json();
    expect(json.error).toContain("not found");
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("GET /api/files/content returns 403 for path traversal", async () => {
  const { app, tempDir } = await createTestApp();

  try {
    const res = await app.request("/api/files/content?path=../etc/passwd");
    expect(res.status).toBe(403);

    const json = await res.json();
    expect(json.error).toContain("traversal");
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("GET /api/files/content returns 400 for invalid path format", async () => {
  const { app, tempDir } = await createTestApp();

  try {
    const res = await app.request("/api/files/content?path=/absolute/path.ts");
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain("Invalid");
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("GET /api/files/content handles nested paths", async () => {
  const { app, tempDir } = await createTestApp({
    "utils/helpers/format.ts": "format content",
  });

  try {
    const res = await app.request(
      "/api/files/content?path=utils/helpers/format.ts"
    );
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.content).toBe("format content");
  } finally {
    await cleanup(tempDir);
  }
});

// ============================================================================
// POST /api/files - Create/Update File
// ============================================================================

Deno.test("POST /api/files creates new file with 201", async () => {
  const { app, tempDir, service } = await createTestApp();

  try {
    const res = await app.request("/api/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "new.ts", content: "new content" }),
    });

    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.success).toBe(true);

    // Verify file was created
    expect(await service.getFile("new.ts")).toBe("new content");
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("POST /api/files updates existing file with 200", async () => {
  const { app, tempDir, service } = await createTestApp({
    "existing.ts": "old content",
  });

  try {
    const res = await app.request("/api/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "existing.ts", content: "updated content" }),
    });

    expect(res.status).toBe(200);
    expect(await service.getFile("existing.ts")).toBe("updated content");
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("POST /api/files creates nested directories", async () => {
  const { app, tempDir, service } = await createTestApp();

  try {
    const res = await app.request("/api/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: "deep/nested/file.ts",
        content: "deep content",
      }),
    });

    expect(res.status).toBe(201);
    expect(await service.getFile("deep/nested/file.ts")).toBe("deep content");
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("POST /api/files returns 400 for missing path", async () => {
  const { app, tempDir } = await createTestApp();

  try {
    const res = await app.request("/api/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "content" }),
    });

    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain("path");
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("POST /api/files returns 400 for missing content", async () => {
  const { app, tempDir } = await createTestApp();

  try {
    const res = await app.request("/api/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "test.ts" }),
    });

    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain("content");
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("POST /api/files returns 403 for path traversal", async () => {
  const { app, tempDir } = await createTestApp();

  try {
    const res = await app.request("/api/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: "../../../etc/cron.d/evil",
        content: "malicious",
      }),
    });

    expect(res.status).toBe(403);
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("POST /api/files returns 400 for invalid JSON", async () => {
  const { app, tempDir } = await createTestApp();

  try {
    const res = await app.request("/api/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not valid json",
    });

    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain("JSON");
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("POST /api/files allows empty content", async () => {
  const { app, tempDir, service } = await createTestApp();

  try {
    const res = await app.request("/api/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "empty.ts", content: "" }),
    });

    expect(res.status).toBe(201);
    expect(await service.getFile("empty.ts")).toBe("");
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("POST /api/files returns 400 for invalid path format", async () => {
  const { app, tempDir } = await createTestApp();

  try {
    const res = await app.request("/api/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "/absolute/path.ts", content: "content" }),
    });

    expect(res.status).toBe(400);
  } finally {
    await cleanup(tempDir);
  }
});

// ============================================================================
// DELETE /api/files - Delete File
// ============================================================================

Deno.test("DELETE /api/files deletes existing file", async () => {
  const { app, tempDir, service } = await createTestApp({
    "to-delete.ts": "content",
  });

  try {
    const res = await app.request("/api/files", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "to-delete.ts" }),
    });

    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);

    expect(await service.fileExists("to-delete.ts")).toBe(false);
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("DELETE /api/files returns 404 for non-existent file", async () => {
  const { app, tempDir } = await createTestApp();

  try {
    const res = await app.request("/api/files", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "nonexistent.ts" }),
    });

    expect(res.status).toBe(404);
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("DELETE /api/files returns 400 for missing path", async () => {
  const { app, tempDir } = await createTestApp();

  try {
    const res = await app.request("/api/files", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("DELETE /api/files returns 403 for path traversal", async () => {
  const { app, tempDir } = await createTestApp();

  try {
    const res = await app.request("/api/files", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "../important.ts" }),
    });

    expect(res.status).toBe(403);
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("DELETE /api/files returns 400 for invalid JSON", async () => {
  const { app, tempDir } = await createTestApp();

  try {
    const res = await app.request("/api/files", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: "not valid json",
    });

    expect(res.status).toBe(400);
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("DELETE /api/files handles nested files", async () => {
  const { app, tempDir, service } = await createTestApp({
    "utils/helper.ts": "content",
  });

  try {
    const res = await app.request("/api/files", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "utils/helper.ts" }),
    });

    expect(res.status).toBe(200);
    expect(await service.fileExists("utils/helper.ts")).toBe(false);
  } finally {
    await cleanup(tempDir);
  }
});
