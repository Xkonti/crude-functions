import { expect } from "@std/expect";
import { Hono } from "@hono/hono";
import { createWebRoutes } from "./web_routes.ts";
import { DatabaseService } from "../database/database_service.ts";
import { ApiKeyService } from "../keys/api_key_service.ts";
import { RoutesService } from "../routes/routes_service.ts";
import { FileService } from "../files/file_service.ts";

const API_KEYS_SCHEMA = `
  CREATE TABLE api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key_group TEXT NOT NULL,
    value TEXT NOT NULL,
    description TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE UNIQUE INDEX idx_api_keys_group_value ON api_keys(key_group, value);
  CREATE INDEX idx_api_keys_group ON api_keys(key_group);
`;

interface TestContext {
  app: Hono;
  tempDir: string;
  db: DatabaseService;
  apiKeyService: ApiKeyService;
  routesService: RoutesService;
  fileService: FileService;
}

async function createTestApp(
  initialRoutes = "[]"
): Promise<TestContext> {
  const tempDir = await Deno.makeTempDir();
  const routesPath = `${tempDir}/routes.json`;
  const codePath = `${tempDir}/code`;

  // Set up database
  const db = new DatabaseService({ databasePath: `${tempDir}/test.db` });
  await db.open();
  await db.exec(API_KEYS_SCHEMA);

  // Add default management key
  await db.execute(
    "INSERT INTO api_keys (key_group, value, description) VALUES (?, ?, ?)",
    ["management", "testkey123", "admin"]
  );

  await Deno.writeTextFile(routesPath, initialRoutes);
  await Deno.mkdir(codePath);

  const apiKeyService = new ApiKeyService({ db });
  const routesService = new RoutesService({ configPath: routesPath });
  const fileService = new FileService({ basePath: codePath });

  const app = new Hono();
  app.route(
    "/web",
    createWebRoutes({ fileService, routesService, apiKeyService })
  );

  return { app, tempDir, db, apiKeyService, routesService, fileService };
}

async function cleanup(db: DatabaseService, tempDir: string) {
  await db.close();
  await Deno.remove(tempDir, { recursive: true });
}

function authHeader(password = "testkey123") {
  const encoded = btoa(`admin:${password}`);
  return { Authorization: `Basic ${encoded}` };
}

// Authentication tests
Deno.test("GET /web returns 401 without credentials", async () => {
  const { app, db, tempDir } = await createTestApp();
  try {
    const res = await app.request("/web");
    expect(res.status).toBe(401);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("GET /web returns 401 with wrong password", async () => {
  const { app, db, tempDir } = await createTestApp();
  try {
    const res = await app.request("/web", {
      headers: authHeader("wrongpassword"),
    });
    expect(res.status).toBe(401);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("GET /web returns 200 with valid credentials", async () => {
  const { app, db, tempDir } = await createTestApp();
  try {
    const res = await app.request("/web", {
      headers: authHeader(),
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Dashboard");
  } finally {
    await cleanup(db, tempDir);
  }
});

// Dashboard tests
Deno.test("Dashboard contains links to all sections", async () => {
  const { app, db, tempDir } = await createTestApp();
  try {
    const res = await app.request("/web", {
      headers: authHeader(),
    });
    const html = await res.text();
    expect(html).toContain('href="/web/code"');
    expect(html).toContain('href="/web/functions"');
    expect(html).toContain('href="/web/keys"');
  } finally {
    await cleanup(db, tempDir);
  }
});

// Code pages tests
Deno.test("GET /web/code lists files", async () => {
  const { app, db, tempDir, fileService } = await createTestApp();
  try {
    await fileService.writeFile("test.ts", "console.log('test');");

    const res = await app.request("/web/code", {
      headers: authHeader(),
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("test.ts");
    expect(html).toContain("Upload New File");
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("GET /web/code/edit shows file content", async () => {
  const { app, db, tempDir, fileService } = await createTestApp();
  try {
    await fileService.writeFile("hello.ts", "export default () => 'hello';");

    const res = await app.request("/web/code/edit?path=hello.ts", {
      headers: authHeader(),
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("export default () =&gt; &#039;hello&#039;;");
    expect(html).toContain("hello.ts");
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("POST /web/code/edit saves file and redirects", async () => {
  const { app, db, tempDir, fileService } = await createTestApp();
  try {
    await fileService.writeFile("test.ts", "old content");

    const formData = new FormData();
    formData.append("content", "new content");

    const res = await app.request("/web/code/edit?path=test.ts", {
      method: "POST",
      headers: authHeader(),
      body: formData,
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/web/code?success=");

    const content = await fileService.getFile("test.ts");
    expect(content).toBe("new content");
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("GET /web/code/upload shows form", async () => {
  const { app, db, tempDir } = await createTestApp();
  try {
    const res = await app.request("/web/code/upload", {
      headers: authHeader(),
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Upload New File");
    expect(html).toContain('name="path"');
    expect(html).toContain('name="content"');
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("POST /web/code/upload creates file", async () => {
  const { app, db, tempDir, fileService } = await createTestApp();
  try {
    const formData = new FormData();
    formData.append("path", "new-file.ts");
    formData.append("content", "export default 'new';");

    const res = await app.request("/web/code/upload", {
      method: "POST",
      headers: authHeader(),
      body: formData,
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/web/code?success=");

    const content = await fileService.getFile("new-file.ts");
    expect(content).toBe("export default 'new';");
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("POST /web/code/delete removes file", async () => {
  const { app, db, tempDir, fileService } = await createTestApp();
  try {
    await fileService.writeFile("delete-me.ts", "content");

    const res = await app.request("/web/code/delete?path=delete-me.ts", {
      method: "POST",
      headers: authHeader(),
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/web/code?success=");

    const exists = await fileService.fileExists("delete-me.ts");
    expect(exists).toBe(false);
  } finally {
    await cleanup(db, tempDir);
  }
});

// Functions pages tests
Deno.test("GET /web/functions lists functions", async () => {
  const initialRoutes = JSON.stringify([
    {
      name: "test-fn",
      handler: "test.ts",
      route: "/test",
      methods: ["GET"],
      description: "Test function",
    },
  ]);
  const { app, db, tempDir } = await createTestApp(initialRoutes);
  try {
    const res = await app.request("/web/functions", {
      headers: authHeader(),
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("test-fn");
    expect(html).toContain("/test");
    expect(html).toContain("GET");
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("GET /web/functions/create shows form", async () => {
  const { app, db, tempDir } = await createTestApp();
  try {
    const res = await app.request("/web/functions/create", {
      headers: authHeader(),
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Create Function");
    expect(html).toContain('name="name"');
    expect(html).toContain('name="handler"');
    expect(html).toContain('name="route"');
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("POST /web/functions/create creates function", async () => {
  const { app, db, tempDir, routesService } = await createTestApp();
  try {
    const formData = new FormData();
    formData.append("name", "new-fn");
    formData.append("handler", "handler.ts");
    formData.append("route", "/api/new");
    formData.append("methods", "GET");
    formData.append("methods", "POST");

    const res = await app.request("/web/functions/create", {
      method: "POST",
      headers: authHeader(),
      body: formData,
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/web/functions?success=");

    const fn = await routesService.getByName("new-fn");
    expect(fn).not.toBeNull();
    expect(fn!.route).toBe("/api/new");
    expect(fn!.methods).toContain("GET");
    expect(fn!.methods).toContain("POST");
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("POST /web/functions/delete removes function", async () => {
  const initialRoutes = JSON.stringify([
    { name: "to-delete", handler: "t.ts", route: "/del", methods: ["GET"] },
  ]);
  const { app, db, tempDir, routesService } = await createTestApp(initialRoutes);
  try {
    const res = await app.request("/web/functions/delete?name=to-delete", {
      method: "POST",
      headers: authHeader(),
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/web/functions?success=");

    const fn = await routesService.getByName("to-delete");
    expect(fn).toBeNull();
  } finally {
    await cleanup(db, tempDir);
  }
});

// Keys pages tests
Deno.test("GET /web/keys lists keys grouped by group", async () => {
  const { app, db, tempDir, apiKeyService } = await createTestApp();
  try {
    // Add additional key
    await apiKeyService.addKey("api", "key1", "user");

    const res = await app.request("/web/keys", {
      headers: authHeader(),
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("management");
    expect(html).toContain("testkey123");
    expect(html).toContain("api");
    expect(html).toContain("key1");
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("GET /web/keys/create shows form", async () => {
  const { app, db, tempDir } = await createTestApp();
  try {
    const res = await app.request("/web/keys/create", {
      headers: authHeader(),
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Create API Key");
    expect(html).toContain('name="group"');
    expect(html).toContain('name="value"');
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("GET /web/keys/create with group param prefills form", async () => {
  const { app, db, tempDir } = await createTestApp();
  try {
    const res = await app.request("/web/keys/create?group=mykey", {
      headers: authHeader(),
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('value="mykey"');
    expect(html).toContain("readonly");
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("POST /web/keys/create creates key", async () => {
  const { app, db, tempDir, apiKeyService } = await createTestApp();
  try {
    const formData = new FormData();
    formData.append("group", "newkey");
    formData.append("value", "newvalue123");
    formData.append("description", "test description");

    const res = await app.request("/web/keys/create", {
      method: "POST",
      headers: authHeader(),
      body: formData,
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/web/keys?success=");

    const keys = await apiKeyService.getKeys("newkey");
    expect(keys).not.toBeNull();
    expect(keys!.some((k) => k.value === "newvalue123")).toBe(true);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("POST /web/keys/delete removes key by ID", async () => {
  const { app, db, tempDir, apiKeyService } = await createTestApp();
  try {
    await apiKeyService.addKey("mykey", "val1");
    await apiKeyService.addKey("mykey", "val2");

    const keys = await apiKeyService.getKeys("mykey");
    const val1Key = keys!.find((k) => k.value === "val1")!;

    const res = await app.request(`/web/keys/delete?id=${val1Key.id}`, {
      method: "POST",
      headers: authHeader(),
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/web/keys?success=");

    const updatedKeys = await apiKeyService.getKeys("mykey");
    expect(updatedKeys).not.toBeNull();
    expect(updatedKeys!.some((k) => k.value === "val1")).toBe(false);
    expect(updatedKeys!.some((k) => k.value === "val2")).toBe(true);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("POST /web/keys/delete-group removes all keys for group", async () => {
  const { app, db, tempDir, apiKeyService } = await createTestApp();
  try {
    await apiKeyService.addKey("toremove", "val1");
    await apiKeyService.addKey("toremove", "val2");

    const res = await app.request("/web/keys/delete-group?group=toremove", {
      method: "POST",
      headers: authHeader(),
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/web/keys?success=");

    const keys = await apiKeyService.getKeys("toremove");
    expect(keys).toBeNull();
  } finally {
    await cleanup(db, tempDir);
  }
});

// Error handling tests
Deno.test("GET /web/code/edit without path redirects with error", async () => {
  const { app, db, tempDir } = await createTestApp();
  try {
    const res = await app.request("/web/code/edit", {
      headers: authHeader(),
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("error=");
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("POST /web/code/upload rejects path traversal", async () => {
  const { app, db, tempDir } = await createTestApp();
  try {
    const formData = new FormData();
    formData.append("path", "../escape.ts");
    formData.append("content", "evil code");

    const res = await app.request("/web/code/upload", {
      method: "POST",
      headers: authHeader(),
      body: formData,
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("error=");
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("POST /web/keys/create rejects invalid key group", async () => {
  const { app, db, tempDir } = await createTestApp();
  try {
    const formData = new FormData();
    formData.append("group", "Invalid Group!");
    formData.append("value", "validvalue");

    const res = await app.request("/web/keys/create", {
      method: "POST",
      headers: authHeader(),
      body: formData,
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("error=");
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("GET /web/keys/delete-group blocks deleting all management keys", async () => {
  const { app, db, tempDir } = await createTestApp();
  try {
    const res = await app.request("/web/keys/delete-group?group=management", {
      headers: authHeader(),
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("error=");
  } finally {
    await cleanup(db, tempDir);
  }
});
