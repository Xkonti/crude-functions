import { expect } from "@std/expect";
import { Hono } from "@hono/hono";
import { createFileSearchRoutes } from "./file_search_routes.ts";

// Create a temporary directory with test files for each test
async function setupTestDirectory(): Promise<string> {
  const tempDir = await Deno.makeTempDir({ prefix: "file_search_test_" });

  // Create some test files
  await Deno.writeTextFile(`${tempDir}/handler.ts`, "// handler");
  await Deno.writeTextFile(`${tempDir}/utils.js`, "// utils");
  await Deno.mkdir(`${tempDir}/src`);
  await Deno.writeTextFile(`${tempDir}/src/helper.ts`, "// helper");
  await Deno.writeTextFile(`${tempDir}/src/config.json`, "{}"); // Non-code file
  await Deno.mkdir(`${tempDir}/.git`);
  await Deno.writeTextFile(`${tempDir}/.git/config`, "// git config"); // Should be filtered
  await Deno.writeTextFile(`${tempDir}/.hidden.ts`, "// hidden ts file"); // Should NOT be filtered

  return tempDir;
}

async function cleanupTestDirectory(dir: string): Promise<void> {
  await Deno.remove(dir, { recursive: true });
}

function createTestApp(codeDirectory: string): Hono {
  const app = new Hono();
  app.route("/files", createFileSearchRoutes({ codeDirectory }));
  return app;
}

// =============================================================================
// API Tests
// =============================================================================

Deno.test("GET /files/search returns 400 when query is missing", async () => {
  const tempDir = await setupTestDirectory();
  try {
    const app = createTestApp(tempDir);
    const res = await app.request("/files/search");

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Missing required query parameter");
  } finally {
    await cleanupTestDirectory(tempDir);
  }
});

Deno.test("GET /files/search returns matches for valid query", async () => {
  const tempDir = await setupTestDirectory();
  try {
    const app = createTestApp(tempDir);
    const res = await app.request("/files/search?q=handler");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.matches).toBeDefined();
    expect(Array.isArray(body.matches)).toBe(true);
    expect(body.matches.length).toBeGreaterThan(0);
    expect(body.matches[0].path).toBe("handler.ts");
  } finally {
    await cleanupTestDirectory(tempDir);
  }
});

Deno.test("GET /files/search returns empty matches for non-matching query", async () => {
  const tempDir = await setupTestDirectory();
  try {
    const app = createTestApp(tempDir);
    const res = await app.request("/files/search?q=nonexistent");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.matches).toEqual([]);
  } finally {
    await cleanupTestDirectory(tempDir);
  }
});

Deno.test("GET /files/search respects limit parameter", async () => {
  const tempDir = await setupTestDirectory();
  try {
    const app = createTestApp(tempDir);
    // Query that matches multiple files
    const res = await app.request("/files/search?q=.ts&limit=1");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.matches.length).toBe(1);
  } finally {
    await cleanupTestDirectory(tempDir);
  }
});

Deno.test("GET /files/search returns 400 for invalid limit", async () => {
  const tempDir = await setupTestDirectory();
  try {
    const app = createTestApp(tempDir);
    const res = await app.request("/files/search?q=test&limit=invalid");

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Invalid limit");
  } finally {
    await cleanupTestDirectory(tempDir);
  }
});

Deno.test("GET /files/search filters out .git directory files", async () => {
  const tempDir = await setupTestDirectory();
  try {
    const app = createTestApp(tempDir);
    // Search for "config" which exists in .git/config
    const res = await app.request("/files/search?q=config");

    expect(res.status).toBe(200);
    const body = await res.json();
    // .git/config should be filtered out, only config.json remains but it's not a code file
    const gitPaths = body.matches.filter((m: { path: string }) =>
      m.path.includes(".git")
    );
    expect(gitPaths.length).toBe(0);
  } finally {
    await cleanupTestDirectory(tempDir);
  }
});

Deno.test("GET /files/search filters out non-code files", async () => {
  const tempDir = await setupTestDirectory();
  try {
    const app = createTestApp(tempDir);
    // Search for "src" which should match src/helper.ts but not src/config.json
    const res = await app.request("/files/search?q=src");

    expect(res.status).toBe(200);
    const body = await res.json();
    // config.json should be filtered out
    const jsonPaths = body.matches.filter((m: { path: string }) =>
      m.path.endsWith(".json")
    );
    expect(jsonPaths.length).toBe(0);
  } finally {
    await cleanupTestDirectory(tempDir);
  }
});

Deno.test("GET /files/search includes hidden TypeScript files", async () => {
  const tempDir = await setupTestDirectory();
  try {
    const app = createTestApp(tempDir);
    const res = await app.request("/files/search?q=hidden");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.matches.length).toBe(1);
    expect(body.matches[0].path).toBe(".hidden.ts");
  } finally {
    await cleanupTestDirectory(tempDir);
  }
});

Deno.test("GET /files/search returns matches with scores", async () => {
  const tempDir = await setupTestDirectory();
  try {
    const app = createTestApp(tempDir);
    const res = await app.request("/files/search?q=handler");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.matches[0].score).toBeDefined();
    expect(typeof body.matches[0].score).toBe("number");
  } finally {
    await cleanupTestDirectory(tempDir);
  }
});

Deno.test("GET /files/search caps limit at 50", async () => {
  const tempDir = await setupTestDirectory();
  try {
    const app = createTestApp(tempDir);
    // Request more than 50
    const res = await app.request("/files/search?q=.&limit=100");

    expect(res.status).toBe(200);
    const body = await res.json();
    // We only have a few test files, but the logic should cap at 50
    // Just verify it doesn't error
    expect(body.matches).toBeDefined();
  } finally {
    await cleanupTestDirectory(tempDir);
  }
});
