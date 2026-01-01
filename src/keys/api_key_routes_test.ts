import { expect } from "@std/expect";
import { Hono } from "@hono/hono";
import { DatabaseService } from "../database/database_service.ts";
import { ApiKeyService } from "./api_key_service.ts";
import { createApiKeyRoutes } from "./api_key_routes.ts";

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

async function createTestApp(managementKeyFromEnv?: string): Promise<{
  app: Hono;
  service: ApiKeyService;
  db: DatabaseService;
  tempDir: string;
}> {
  const tempDir = await Deno.makeTempDir();
  const db = new DatabaseService({ databasePath: `${tempDir}/test.db` });
  await db.open();
  await db.exec(API_KEYS_SCHEMA);

  const service = new ApiKeyService({
    db,
    managementKeyFromEnv: managementKeyFromEnv ?? "env-mgmt-key",
  });

  const app = new Hono();
  app.route("/api/keys", createApiKeyRoutes(service));

  return { app, service, db, tempDir };
}

async function cleanup(db: DatabaseService, tempDir: string): Promise<void> {
  await db.close();
  await Deno.remove(tempDir, { recursive: true });
}

// GET /api/keys tests
Deno.test("GET /api/keys returns groups array with management from env", async () => {
  const { app, db, tempDir } = await createTestApp();

  try {
    const res = await app.request("/api/keys");
    expect(res.status).toBe(200);

    const json = await res.json();
    // Should include management from env
    expect(json.groups).toContain("management");
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("GET /api/keys returns all key groups", async () => {
  const { app, service, db, tempDir } = await createTestApp();

  try {
    await service.addKey("email", "key1");
    await service.addKey("service", "key2");

    const res = await app.request("/api/keys");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.groups).toContain("email");
    expect(json.groups).toContain("service");
    expect(json.groups).toContain("management"); // from env
  } finally {
    await cleanup(db, tempDir);
  }
});

// GET /api/keys/:group tests
Deno.test("GET /api/keys/:group returns keys for existing group", async () => {
  const { app, service, db, tempDir } = await createTestApp();

  try {
    await service.addKey("email", "key1", "first");
    await service.addKey("email", "key2");

    const res = await app.request("/api/keys/email");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.group).toBe("email");
    expect(json.keys.length).toBe(2);
    expect(json.keys.some((k: { value: string; description?: string }) => k.value === "key1" && k.description === "first")).toBe(true);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("GET /api/keys/:group returns 404 for non-existent group", async () => {
  const { app, service, db, tempDir } = await createTestApp();

  try {
    await service.addKey("email", "key1");

    const res = await app.request("/api/keys/nonexistent");
    expect(res.status).toBe(404);

    const json = await res.json();
    expect(json.error).toBeDefined();
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("GET /api/keys/:group normalizes group to lowercase", async () => {
  const { app, service, db, tempDir } = await createTestApp();

  try {
    await service.addKey("email", "key1");

    const res = await app.request("/api/keys/EMAIL");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.group).toBe("email");
  } finally {
    await cleanup(db, tempDir);
  }
});

// POST /api/keys/:group tests
Deno.test("POST /api/keys/:group adds new key", async () => {
  const { app, service, db, tempDir } = await createTestApp();

  try {
    const res = await app.request("/api/keys/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "newkey", description: "test" }),
    });

    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.success).toBe(true);

    // Verify key was added
    expect(await service.hasKey("email", "newkey")).toBe(true);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("POST /api/keys/:group rejects invalid key group", async () => {
  const { app, db, tempDir } = await createTestApp();

  try {
    const res = await app.request("/api/keys/INVALID.GROUP", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "key1" }),
    });

    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain("group");
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("POST /api/keys/:group rejects invalid key value", async () => {
  const { app, db, tempDir } = await createTestApp();

  try {
    const res = await app.request("/api/keys/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "invalid.value" }),
    });

    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain("value");
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("POST /api/keys/:group rejects missing value", async () => {
  const { app, db, tempDir } = await createTestApp();

  try {
    const res = await app.request("/api/keys/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toBeDefined();
  } finally {
    await cleanup(db, tempDir);
  }
});

// DELETE /api/keys/by-id/:id tests
Deno.test("DELETE /api/keys/by-id/:id removes key by ID", async () => {
  const { app, service, db, tempDir } = await createTestApp();

  try {
    await service.addKey("email", "key1");
    await service.addKey("email", "key2");

    const keys = await service.getKeys("email");
    const key1Id = keys!.find((k) => k.value === "key1")!.id;

    const res = await app.request(`/api/keys/by-id/${key1Id}`, {
      method: "DELETE",
    });

    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);

    // Verify only key1 was removed
    expect(await service.hasKey("email", "key1")).toBe(false);
    expect(await service.hasKey("email", "key2")).toBe(true);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("DELETE /api/keys/by-id/:id returns 400 for invalid ID", async () => {
  const { app, db, tempDir } = await createTestApp();

  try {
    const res = await app.request("/api/keys/by-id/notanumber", {
      method: "DELETE",
    });

    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain("Invalid");
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("DELETE /api/keys/by-id/:id returns 403 for env management key", async () => {
  const { app, db, tempDir } = await createTestApp();

  try {
    // ID -1 is the synthetic ID for env-provided management key
    const res = await app.request("/api/keys/by-id/-1", {
      method: "DELETE",
    });

    expect(res.status).toBe(403);

    const json = await res.json();
    expect(json.error).toContain("environment");
  } finally {
    await cleanup(db, tempDir);
  }
});

// DELETE /api/keys/:group tests
Deno.test("DELETE /api/keys/:group removes all keys for group", async () => {
  const { app, service, db, tempDir } = await createTestApp();

  try {
    await service.addKey("email", "key1");
    await service.addKey("email", "key2");
    await service.addKey("other", "key3");

    const res = await app.request("/api/keys/email", {
      method: "DELETE",
    });

    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);

    // Verify keys were removed
    expect(await service.hasKey("email", "key1")).toBe(false);
    expect(await service.hasKey("email", "key2")).toBe(false);
    expect(await service.hasKey("other", "key3")).toBe(true);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("DELETE /api/keys/:group returns 404 for non-existent group", async () => {
  const { app, service, db, tempDir } = await createTestApp();

  try {
    await service.addKey("email", "key1");

    const res = await app.request("/api/keys/nonexistent", {
      method: "DELETE",
    });

    expect(res.status).toBe(404);
  } finally {
    await cleanup(db, tempDir);
  }
});
