import { expect } from "@std/expect";
import { Hono } from "@hono/hono";
import { createApiKeyRoutes } from "./api_key_routes.ts";
import { TestSetupBuilder } from "../test/test_setup_builder.ts";
import type { ApiKeysContext, BaseTestContext } from "../test/types.ts";

/**
 * Creates a Hono app with API key routes from a TestSetupBuilder context.
 */
function createTestApp(ctx: BaseTestContext & ApiKeysContext): Hono {
  const app = new Hono();
  app.route("/api/keys", createApiKeyRoutes(ctx.apiKeyService));
  return app;
}

// GET /api/keys tests
Deno.test("GET /api/keys returns empty groups array when no keys", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeys()
    .build();

  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/keys");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.groups).toEqual([]);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("GET /api/keys returns all key groups", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeys()
    .build();

  try {
    await ctx.apiKeyService.addKey("email", "key-1", "key1");
    await ctx.apiKeyService.addKey("service", "key-2", "key2");

    const app = createTestApp(ctx);
    const res = await app.request("/api/keys");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.groups).toContain("email");
    expect(json.groups).toContain("service");
  } finally {
    await ctx.cleanup();
  }
});

// GET /api/keys/:group tests
Deno.test("GET /api/keys/:group returns keys for existing group", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeys()
    .build();

  try {
    await ctx.apiKeyService.addKey("email", "key-1", "key1", "first");
    await ctx.apiKeyService.addKey("email", "key-2", "key2");

    const app = createTestApp(ctx);
    const res = await app.request("/api/keys/email");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.group).toBe("email");
    expect(json.keys.length).toBe(2);
    expect(json.keys.some((k: { value: string; description?: string }) => k.value === "key1" && k.description === "first")).toBe(true);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("GET /api/keys/:group returns 404 for non-existent group", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeys()
    .build();

  try {
    await ctx.apiKeyService.addKey("email", "key-1", "key1");

    const app = createTestApp(ctx);
    const res = await app.request("/api/keys/nonexistent");
    expect(res.status).toBe(404);

    const json = await res.json();
    expect(json.error).toBeDefined();
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("GET /api/keys/:group normalizes group to lowercase", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeys()
    .build();

  try {
    await ctx.apiKeyService.addKey("email", "key-1", "key1");

    const app = createTestApp(ctx);
    const res = await app.request("/api/keys/EMAIL");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.group).toBe("email");
  } finally {
    await ctx.cleanup();
  }
});

// POST /api/keys/:group tests
Deno.test("POST /api/keys/:group adds new key", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeys()
    .build();

  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/keys/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "newkey-name", value: "newkey", description: "test" }),
    });

    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.success).toBe(true);

    // Verify key was added
    expect(await ctx.apiKeyService.hasKey("email", "newkey")).toBe(true);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("POST /api/keys/:group rejects invalid key group", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeys()
    .build();

  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/keys/INVALID.GROUP", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "key1" }),
    });

    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain("group");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("POST /api/keys/:group rejects invalid key value", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeys()
    .build();

  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/keys/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "invalid-key", value: "invalid.value" }),
    });

    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain("value");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("POST /api/keys/:group rejects missing name", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeys()
    .build();

  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/keys/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "some-value" }),
    });

    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain("name");
  } finally {
    await ctx.cleanup();
  }
});

// DELETE /api/keys/by-id/:id tests
Deno.test("DELETE /api/keys/by-id/:id removes key by ID", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeys()
    .build();

  try {
    await ctx.apiKeyService.addKey("email", "key-1", "key1");
    await ctx.apiKeyService.addKey("email", "key-2", "key2");

    const keys = await ctx.apiKeyService.getKeys("email");
    const key1Id = keys!.find((k) => k.value === "key1")!.id;

    const app = createTestApp(ctx);
    const res = await app.request(`/api/keys/by-id/${key1Id}`, {
      method: "DELETE",
    });

    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);

    // Verify only key1 was removed
    expect(await ctx.apiKeyService.hasKey("email", "key1")).toBe(false);
    expect(await ctx.apiKeyService.hasKey("email", "key2")).toBe(true);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("DELETE /api/keys/by-id/:id returns 400 for invalid ID", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeys()
    .build();

  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/keys/by-id/notanumber", {
      method: "DELETE",
    });

    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain("Invalid");
  } finally {
    await ctx.cleanup();
  }
});

// DELETE /api/keys/:group tests
Deno.test("DELETE /api/keys/:group removes all keys for group", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeys()
    .build();

  try {
    await ctx.apiKeyService.addKey("email", "key-1", "key1");
    await ctx.apiKeyService.addKey("email", "key-2", "key2");
    await ctx.apiKeyService.addKey("other", "key-3", "key3");

    const app = createTestApp(ctx);
    const res = await app.request("/api/keys/email", {
      method: "DELETE",
    });

    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);

    // Verify keys were removed
    expect(await ctx.apiKeyService.hasKey("email", "key1")).toBe(false);
    expect(await ctx.apiKeyService.hasKey("email", "key2")).toBe(false);
    expect(await ctx.apiKeyService.hasKey("other", "key3")).toBe(true);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("DELETE /api/keys/:group returns 404 for non-existent group", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeys()
    .build();

  try {
    await ctx.apiKeyService.addKey("email", "key-1", "key1");

    const app = createTestApp(ctx);
    const res = await app.request("/api/keys/nonexistent", {
      method: "DELETE",
    });

    expect(res.status).toBe(404);
  } finally {
    await ctx.cleanup();
  }
});

// =====================
// Group endpoint tests
// =====================

Deno.test("GET /api/keys/groups returns all groups", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeys()
    .build();

  try {
    await ctx.apiKeyService.createGroup("email", "Email keys");
    await ctx.apiKeyService.createGroup("webhook", "Webhook keys");

    const app = createTestApp(ctx);
    const res = await app.request("/api/keys/groups");
    expect(res.status).toBe(200);

    const json = await res.json();
    // Note: migrations create a default "management" group, so we have 3 groups
    expect(json.groups.length).toBe(3);
    expect(json.groups.some((g: { name: string }) => g.name === "email")).toBe(true);
    expect(json.groups.some((g: { name: string }) => g.name === "webhook")).toBe(true);
    expect(json.groups.some((g: { name: string }) => g.name === "management")).toBe(true);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("POST /api/keys/groups creates new group", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeys()
    .build();

  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/keys/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "email", description: "Email keys" }),
    });

    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.id).toBeGreaterThan(0);
    expect(json.name).toBe("email");

    const group = await ctx.apiKeyService.getGroupByName("email");
    expect(group).not.toBeNull();
    expect(group!.description).toBe("Email keys");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("POST /api/keys/groups rejects duplicate group", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeys()
    .build();

  try {
    await ctx.apiKeyService.createGroup("email", "First");

    const app = createTestApp(ctx);
    const res = await app.request("/api/keys/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "email", description: "Second" }),
    });

    expect(res.status).toBe(409);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("POST /api/keys/groups rejects invalid group name", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeys()
    .build();

  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/keys/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "INVALID.NAME" }),
    });

    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain("group name");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("POST /api/keys/groups rejects missing name", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeys()
    .build();

  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/keys/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "No name" }),
    });

    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain("name");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("GET /api/keys/groups/:id returns group by ID", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeys()
    .build();

  try {
    const id = await ctx.apiKeyService.createGroup("email", "Email keys");

    const app = createTestApp(ctx);
    const res = await app.request(`/api/keys/groups/${id}`);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.id).toBe(id);
    expect(json.name).toBe("email");
    expect(json.description).toBe("Email keys");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("GET /api/keys/groups/:id returns 404 for nonexistent", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeys()
    .build();

  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/keys/groups/999");
    expect(res.status).toBe(404);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("PUT /api/keys/groups/:id updates group", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeys()
    .build();

  try {
    const id = await ctx.apiKeyService.createGroup("email", "Old desc");

    const app = createTestApp(ctx);
    const res = await app.request(`/api/keys/groups/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "New desc" }),
    });

    expect(res.status).toBe(200);

    const group = await ctx.apiKeyService.getGroupById(id);
    expect(group!.description).toBe("New desc");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("DELETE /api/keys/groups/:id deletes empty group", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeys()
    .build();

  try {
    const id = await ctx.apiKeyService.createGroup("email", "Email keys");
    // No keys added - group is empty

    const app = createTestApp(ctx);
    const res = await app.request(`/api/keys/groups/${id}`, {
      method: "DELETE",
    });

    expect(res.status).toBe(200);

    // Group should be gone
    expect(await ctx.apiKeyService.getGroupById(id)).toBeNull();
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("DELETE /api/keys/groups/:id blocks deleting management group", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeys()
    .build();

  try {
    // Management group is created by migrations, so we just get it
    const group = await ctx.apiKeyService.getGroupByName("management");
    expect(group).not.toBeNull();

    const app = createTestApp(ctx);
    const res = await app.request(`/api/keys/groups/${group!.id}`, {
      method: "DELETE",
    });

    expect(res.status).toBe(403);

    const json = await res.json();
    expect(json.error).toContain("management");
  } finally {
    await ctx.cleanup();
  }
});

// =====================
// Auto-generation tests
// =====================

Deno.test("POST /api/keys/:group generates key when value not provided", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeys()
    .build();

  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/keys/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "auto-key" }),
    });

    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.name).toBe("auto-key");
    expect(json.value).toBeDefined();
    expect(json.value.length).toBeGreaterThan(10); // Generated UUID is long
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("POST /api/keys/:group returns generated key that is stored correctly", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeys()
    .build();

  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/keys/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "auto-key" }),
    });

    expect(res.status).toBe(201);

    const json = await res.json();
    const generatedValue = json.value;

    // Verify the key was stored and can be retrieved
    expect(await ctx.apiKeyService.hasKey("email", generatedValue)).toBe(true);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("POST /api/keys/:group with explicit value uses that value", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeys()
    .build();

  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/keys/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "manual-key", value: "my-explicit-value" }),
    });

    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.name).toBe("manual-key");
    expect(json.value).toBe("my-explicit-value");

    // Verify the explicit value was stored
    expect(await ctx.apiKeyService.hasKey("email", "my-explicit-value")).toBe(true);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("POST /api/keys/:group returns 409 for duplicate key name", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeys()
    .build();

  try {
    await ctx.apiKeyService.addKey("email", "existing-key", "value1");

    const app = createTestApp(ctx);
    const res = await app.request("/api/keys/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "existing-key", value: "different-value" }),
    });

    expect(res.status).toBe(409);

    const json = await res.json();
    expect(json.error).toContain("already exists");
  } finally {
    await ctx.cleanup();
  }
});

// =====================
// PUT /api/keys/by-id/:id tests
// =====================

Deno.test("PUT /api/keys/by-id/:id updates name", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeyGroup("test-group")
    .withApiKey("test-group", "original-value", "original-name")
    .build();

  try {
    const keys = await ctx.apiKeyService.getKeys("test-group");
    const keyId = keys![0].id;

    const app = createTestApp(ctx);
    const res = await app.request(`/api/keys/by-id/${keyId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "new-name" }),
    });

    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);

    const updated = await ctx.apiKeyService.getById(keyId);
    expect(updated!.key.name).toBe("new-name");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("PUT /api/keys/by-id/:id updates value", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeyGroup("test-group")
    .withApiKey("test-group", "original-value", "test-key")
    .build();

  try {
    const keys = await ctx.apiKeyService.getKeys("test-group");
    const keyId = keys![0].id;

    const app = createTestApp(ctx);
    const res = await app.request(`/api/keys/by-id/${keyId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "new-value" }),
    });

    expect(res.status).toBe(200);

    // Verify value was updated
    expect(await ctx.apiKeyService.hasKey("test-group", "new-value")).toBe(true);
    expect(await ctx.apiKeyService.hasKey("test-group", "original-value")).toBe(false);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("PUT /api/keys/by-id/:id updates description", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeyGroup("test-group")
    .withApiKey("test-group", "value1", "test-key", "Old description")
    .build();

  try {
    const keys = await ctx.apiKeyService.getKeys("test-group");
    const keyId = keys![0].id;

    const app = createTestApp(ctx);
    const res = await app.request(`/api/keys/by-id/${keyId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "New description" }),
    });

    expect(res.status).toBe(200);

    const updated = await ctx.apiKeyService.getById(keyId);
    expect(updated!.key.description).toBe("New description");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("PUT /api/keys/by-id/:id returns 400 for invalid name", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeyGroup("test-group")
    .withApiKey("test-group", "value1", "test-key")
    .build();

  try {
    const keys = await ctx.apiKeyService.getKeys("test-group");
    const keyId = keys![0].id;

    const app = createTestApp(ctx);
    const res = await app.request(`/api/keys/by-id/${keyId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Invalid Name!" }),
    });

    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain("name");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("PUT /api/keys/by-id/:id returns 400 for invalid value", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeyGroup("test-group")
    .withApiKey("test-group", "value1", "test-key")
    .build();

  try {
    const keys = await ctx.apiKeyService.getKeys("test-group");
    const keyId = keys![0].id;

    const app = createTestApp(ctx);
    const res = await app.request(`/api/keys/by-id/${keyId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "invalid.value!" }),
    });

    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain("value");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("PUT /api/keys/by-id/:id returns 404 for non-existent key", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeys()
    .build();

  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/keys/by-id/99999", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "new-name" }),
    });

    expect(res.status).toBe(404);

    const json = await res.json();
    expect(json.error).toContain("not found");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("PUT /api/keys/by-id/:id returns 409 for duplicate name", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeyGroup("test-group")
    .withApiKey("test-group", "value1", "key-one")
    .withApiKey("test-group", "value2", "key-two")
    .build();

  try {
    const keys = await ctx.apiKeyService.getKeys("test-group");
    const key2Id = keys!.find(k => k.name === "key-two")!.id;

    const app = createTestApp(ctx);
    const res = await app.request(`/api/keys/by-id/${key2Id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "key-one" }),
    });

    expect(res.status).toBe(409);

    const json = await res.json();
    expect(json.error).toContain("already exists");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("PUT /api/keys/by-id/:id returns 400 for invalid ID", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeys()
    .build();

  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/keys/by-id/notanumber", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "new-name" }),
    });

    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain("Invalid");
  } finally {
    await ctx.cleanup();
  }
});

// =====================
// Group deletion protection tests
// =====================

Deno.test("DELETE /api/keys/groups/:id returns 409 when keys exist", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeyGroup("test-group")
    .withApiKey("test-group", "value1", "test-key")
    .build();

  try {
    const group = await ctx.apiKeyService.getGroupByName("test-group");

    const app = createTestApp(ctx);
    const res = await app.request(`/api/keys/groups/${group!.id}`, {
      method: "DELETE",
    });

    expect(res.status).toBe(409);

    const json = await res.json();
    expect(json.error).toContain("Delete keys first");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("DELETE /api/keys/groups/:id works after keys deleted", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeyGroup("test-group")
    .withApiKey("test-group", "value1", "test-key")
    .build();

  try {
    const group = await ctx.apiKeyService.getGroupByName("test-group");
    const keys = await ctx.apiKeyService.getKeys("test-group");
    const keyId = keys![0].id;

    // Delete the key first
    await ctx.apiKeyService.removeKeyById(keyId);

    const app = createTestApp(ctx);
    const res = await app.request(`/api/keys/groups/${group!.id}`, {
      method: "DELETE",
    });

    expect(res.status).toBe(200);

    // Group should be gone
    expect(await ctx.apiKeyService.getGroupById(group!.id)).toBeNull();
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("DELETE /api/keys/groups/:id error includes key count", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeyGroup("test-group")
    .withApiKey("test-group", "value1", "key-1")
    .withApiKey("test-group", "value2", "key-2")
    .withApiKey("test-group", "value3", "key-3")
    .build();

  try {
    const group = await ctx.apiKeyService.getGroupByName("test-group");

    const app = createTestApp(ctx);
    const res = await app.request(`/api/keys/groups/${group!.id}`, {
      method: "DELETE",
    });

    expect(res.status).toBe(409);

    const json = await res.json();
    expect(json.error).toContain("3 existing key(s)");
  } finally {
    await ctx.cleanup();
  }
});
