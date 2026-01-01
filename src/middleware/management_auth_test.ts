import { expect } from "@std/expect";
import { Hono } from "@hono/hono";
import { DatabaseService } from "../database/database_service.ts";
import { ApiKeyService } from "../keys/api_key_service.ts";
import { createManagementAuthMiddleware } from "./management_auth.ts";

const API_KEYS_SCHEMA = `
CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key_group TEXT NOT NULL,
  value TEXT NOT NULL,
  description TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_group_value ON api_keys(key_group, value);
CREATE INDEX IF NOT EXISTS idx_api_keys_group ON api_keys(key_group);
`;

interface TestKey {
  group: string;
  value: string;
}

async function createTestApp(initialKeys: TestKey[] = [], envKey = "env-mgmt-key") {
  const db = new DatabaseService({ databasePath: ":memory:" });
  await db.open();
  await db.exec(API_KEYS_SCHEMA);

  const service = new ApiKeyService({
    db,
    managementKeyFromEnv: envKey,
  });

  // Add initial keys
  for (const key of initialKeys) {
    await service.addKey(key.group, key.value);
  }

  const app = new Hono();
  app.use("/*", createManagementAuthMiddleware(service));
  app.get("/protected", (c) => c.json({ message: "success" }));

  return { app, db, service };
}

async function cleanup(db: DatabaseService) {
  await db.close();
}

Deno.test("returns 401 when no X-API-Key header provided", async () => {
  const { app, db } = await createTestApp();

  try {
    const res = await app.request("/protected");
    expect(res.status).toBe(401);

    const json = await res.json();
    expect(json.error).toBe("Unauthorized");
  } finally {
    await cleanup(db);
  }
});

Deno.test("returns 401 when invalid API key provided", async () => {
  const { app, db } = await createTestApp();

  try {
    const res = await app.request("/protected", {
      headers: { "X-API-Key": "invalid-key" },
    });
    expect(res.status).toBe(401);

    const json = await res.json();
    expect(json.error).toBe("Unauthorized");
  } finally {
    await cleanup(db);
  }
});

Deno.test("allows request with valid env management key", async () => {
  const { app, db } = await createTestApp();

  try {
    const res = await app.request("/protected", {
      headers: { "X-API-Key": "env-mgmt-key" },
    });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.message).toBe("success");
  } finally {
    await cleanup(db);
  }
});

Deno.test("allows request with valid db-based management key", async () => {
  const { app, db } = await createTestApp([{ group: "management", value: "db-key" }]);

  try {
    const res = await app.request("/protected", {
      headers: { "X-API-Key": "db-key" },
    });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.message).toBe("success");
  } finally {
    await cleanup(db);
  }
});

Deno.test("rejects non-management keys", async () => {
  const { app, db } = await createTestApp([{ group: "email", value: "some-key" }]);

  try {
    const res = await app.request("/protected", {
      headers: { "X-API-Key": "some-key" },
    });
    expect(res.status).toBe(401);
  } finally {
    await cleanup(db);
  }
});
