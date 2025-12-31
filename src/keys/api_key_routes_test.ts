import { expect } from "@std/expect";
import { Hono } from "@hono/hono";
import { ApiKeyService } from "./api_key_service.ts";
import { createApiKeyRoutes } from "./api_key_routes.ts";

async function createTestApp(initialContent = "") {
  const tempDir = await Deno.makeTempDir();
  const configPath = `${tempDir}/keys.config`;
  await Deno.writeTextFile(configPath, initialContent);

  const service = new ApiKeyService({
    configPath,
    managementKeyFromEnv: "env-mgmt-key",
  });

  const app = new Hono();
  app.route("/api/keys", createApiKeyRoutes(service));

  return { app, tempDir, service };
}

async function cleanup(tempDir: string) {
  await Deno.remove(tempDir, { recursive: true });
}

// GET /api/keys tests
Deno.test("GET /api/keys returns empty names array for empty file", async () => {
  const { app, tempDir } = await createTestApp();

  try {
    const res = await app.request("/api/keys");
    expect(res.status).toBe(200);

    const json = await res.json();
    // Should include management from env
    expect(json.names).toContain("management");
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("GET /api/keys returns all key names", async () => {
  const { app, tempDir } = await createTestApp("email=key1\nservice=key2");

  try {
    const res = await app.request("/api/keys");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.names).toContain("email");
    expect(json.names).toContain("service");
    expect(json.names).toContain("management"); // from env
  } finally {
    await cleanup(tempDir);
  }
});

// GET /api/keys/:name tests
Deno.test("GET /api/keys/:name returns keys for existing name", async () => {
  const { app, tempDir } = await createTestApp("email=key1 # first\nemail=key2");

  try {
    const res = await app.request("/api/keys/email");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.name).toBe("email");
    expect(json.keys.length).toBe(2);
    expect(json.keys[0].value).toBe("key1");
    expect(json.keys[0].description).toBe("first");
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("GET /api/keys/:name returns 404 for non-existent name", async () => {
  const { app, tempDir } = await createTestApp("email=key1");

  try {
    const res = await app.request("/api/keys/nonexistent");
    expect(res.status).toBe(404);

    const json = await res.json();
    expect(json.error).toBeDefined();
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("GET /api/keys/:name normalizes name to lowercase", async () => {
  const { app, tempDir } = await createTestApp("email=key1");

  try {
    const res = await app.request("/api/keys/EMAIL");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.name).toBe("email");
  } finally {
    await cleanup(tempDir);
  }
});

// POST /api/keys/:name tests
Deno.test("POST /api/keys/:name adds new key", async () => {
  const { app, tempDir, service } = await createTestApp();

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
    await cleanup(tempDir);
  }
});

Deno.test("POST /api/keys/:name rejects invalid key name", async () => {
  const { app, tempDir } = await createTestApp();

  try {
    const res = await app.request("/api/keys/INVALID.NAME", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "key1" }),
    });

    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain("name");
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("POST /api/keys/:name rejects invalid key value", async () => {
  const { app, tempDir } = await createTestApp();

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
    await cleanup(tempDir);
  }
});

Deno.test("POST /api/keys/:name rejects missing value", async () => {
  const { app, tempDir } = await createTestApp();

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
    await cleanup(tempDir);
  }
});

// DELETE /api/keys/:name tests
Deno.test("DELETE /api/keys/:name removes all keys for name", async () => {
  const { app, tempDir, service } = await createTestApp("email=key1\nemail=key2\nother=key3");

  try {
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
    await cleanup(tempDir);
  }
});

Deno.test("DELETE /api/keys/:name returns 404 for non-existent name", async () => {
  const { app, tempDir } = await createTestApp("email=key1");

  try {
    const res = await app.request("/api/keys/nonexistent", {
      method: "DELETE",
    });

    expect(res.status).toBe(404);
  } finally {
    await cleanup(tempDir);
  }
});

// DELETE /api/keys/:name/:keyValue tests
Deno.test("DELETE /api/keys/:name/:keyValue removes specific key", async () => {
  const { app, tempDir, service } = await createTestApp("email=key1\nemail=key2");

  try {
    const res = await app.request("/api/keys/email/key1", {
      method: "DELETE",
    });

    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);

    // Verify only key1 was removed
    expect(await service.hasKey("email", "key1")).toBe(false);
    expect(await service.hasKey("email", "key2")).toBe(true);
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("DELETE /api/keys/:name/:keyValue returns 404 for non-existent key", async () => {
  const { app, tempDir } = await createTestApp("email=key1");

  try {
    const res = await app.request("/api/keys/email/nonexistent", {
      method: "DELETE",
    });

    expect(res.status).toBe(404);
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("DELETE /api/keys/:name/:keyValue returns 403 for env management key", async () => {
  const { app, tempDir } = await createTestApp("management=filekey");

  try {
    const res = await app.request("/api/keys/management/env-mgmt-key", {
      method: "DELETE",
    });

    expect(res.status).toBe(403);

    const json = await res.json();
    expect(json.error).toContain("environment");
  } finally {
    await cleanup(tempDir);
  }
});
