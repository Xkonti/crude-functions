import { integrationTest } from "../test/test_helpers.ts";
import { expect } from "@std/expect";
import { Hono } from "@hono/hono";
import { createApiKeyGroupRoutes, createApiKeyRoutes } from "./api_key_routes.ts";
import { TestSetupBuilder } from "../test/test_setup_builder.ts";
import type { ApiKeysContext, BaseTestContext } from "../test/types.ts";

/**
 * Creates a Hono app with both API key routes from a TestSetupBuilder context.
 */
function createTestApp(ctx: BaseTestContext & ApiKeysContext): Hono {
  const app = new Hono();
  app.route("/api/key-groups", createApiKeyGroupRoutes(ctx.apiKeyService));
  app.route("/api/keys", createApiKeyRoutes(ctx.apiKeyService));
  return app;
}

// =====================
// Key Groups API Tests
// =====================

// GET /api/key-groups tests
integrationTest("GET /api/key-groups returns management group by default", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeys()
    .build();

  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/key-groups");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.groups.length).toBe(1);
    expect(json.groups[0].name).toBe("management");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/key-groups returns all groups", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeyGroup("email", "Email keys")
    .withApiKeyGroup("webhook", "Webhook keys")
    .build();

  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/key-groups");
    expect(res.status).toBe(200);

    const json = await res.json();
    // Default "management" group + 2 created groups
    expect(json.groups.length).toBe(3);
    const names = json.groups.map((g: { name: string }) => g.name);
    expect(names).toContain("management");
    expect(names).toContain("email");
    expect(names).toContain("webhook");
  } finally {
    await ctx.cleanup();
  }
});

// POST /api/key-groups tests
integrationTest("POST /api/key-groups creates new group", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeys()
    .build();

  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/key-groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "email", description: "Email keys" }),
    });

    expect(res.status).toBe(201);

    const json = await res.json();
    expect(typeof json.id).toBe("string");
    expect(json.id.length).toBeGreaterThan(0);
    expect(json.name).toBe("email");

    const group = await ctx.apiKeyService.getGroupByName("email");
    expect(group).not.toBeNull();
    expect(group!.description).toBe("Email keys");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("POST /api/key-groups rejects duplicate group", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeyGroup("email", "First")
    .build();

  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/key-groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "email", description: "Second" }),
    });

    expect(res.status).toBe(409);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("POST /api/key-groups rejects invalid group name", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeys()
    .build();

  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/key-groups", {
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

integrationTest("POST /api/key-groups rejects missing name", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeys()
    .build();

  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/key-groups", {
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

// GET /api/key-groups/:groupId tests
integrationTest("GET /api/key-groups/:groupId returns group by ID", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeyGroup("email", "Email keys")
    .build();

  try {
    const group = await ctx.apiKeyService.getGroupByName("email");

    const app = createTestApp(ctx);
    const res = await app.request(`/api/key-groups/${group!.id}`);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.id).toBe(group!.id);
    expect(json.name).toBe("email");
    expect(json.description).toBe("Email keys");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/key-groups/:groupId returns 404 for nonexistent", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeys()
    .build();

  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/key-groups/999");
    expect(res.status).toBe(404);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/key-groups/:groupId returns 400 for invalid ID characters", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeys()
    .build();

  try {
    const app = createTestApp(ctx);
    // SurrealDB IDs must be alphanumeric with dashes/underscores only
    const res = await app.request("/api/key-groups/invalid.id");
    expect(res.status).toBe(400);
  } finally {
    await ctx.cleanup();
  }
});

// PUT /api/key-groups/:groupId tests
integrationTest("PUT /api/key-groups/:groupId updates group description", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeyGroup("email", "Old desc")
    .build();

  try {
    const group = await ctx.apiKeyService.getGroupByName("email");

    const app = createTestApp(ctx);
    const res = await app.request(`/api/key-groups/${group!.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "New desc" }),
    });

    expect(res.status).toBe(200);

    const updated = await ctx.apiKeyService.getGroupById(group!.id);
    expect(updated!.description).toBe("New desc");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("PUT /api/key-groups/:groupId returns 404 for nonexistent", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeys()
    .build();

  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/key-groups/999", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "New desc" }),
    });

    expect(res.status).toBe(404);
  } finally {
    await ctx.cleanup();
  }
});

// DELETE /api/key-groups/:groupId tests
integrationTest("DELETE /api/key-groups/:groupId deletes empty group", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeyGroup("email", "Email keys")
    .build();

  try {
    const group = await ctx.apiKeyService.getGroupByName("email");

    const app = createTestApp(ctx);
    const res = await app.request(`/api/key-groups/${group!.id}`, {
      method: "DELETE",
    });

    expect(res.status).toBe(200);

    // Group should be gone
    expect(await ctx.apiKeyService.getGroupById(group!.id)).toBeNull();
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("DELETE /api/key-groups/:groupId blocks deleting management group", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeys()
    .build();

  try {
    const group = await ctx.apiKeyService.getGroupByName("management");

    const app = createTestApp(ctx);
    const res = await app.request(`/api/key-groups/${group!.id}`, {
      method: "DELETE",
    });

    expect(res.status).toBe(403);

    const json = await res.json();
    expect(json.error).toContain("management");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("DELETE /api/key-groups/:groupId returns 409 when keys exist", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeyGroup("test-group")
    .withApiKey("test-group", "value1", "test-key")
    .build();

  try {
    const group = await ctx.apiKeyService.getGroupByName("test-group");

    const app = createTestApp(ctx);
    const res = await app.request(`/api/key-groups/${group!.id}`, {
      method: "DELETE",
    });

    expect(res.status).toBe(409);

    const json = await res.json();
    expect(json.error).toContain("Delete keys first");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("DELETE /api/key-groups/:groupId error includes key count", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeyGroup("test-group")
    .withApiKey("test-group", "value1", "key-1")
    .withApiKey("test-group", "value2", "key-2")
    .withApiKey("test-group", "value3", "key-3")
    .build();

  try {
    const group = await ctx.apiKeyService.getGroupByName("test-group");

    const app = createTestApp(ctx);
    const res = await app.request(`/api/key-groups/${group!.id}`, {
      method: "DELETE",
    });

    expect(res.status).toBe(409);

    const json = await res.json();
    expect(json.error).toContain("3 existing key(s)");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("DELETE /api/key-groups/:groupId works after keys deleted", async () => {
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
    const res = await app.request(`/api/key-groups/${group!.id}`, {
      method: "DELETE",
    });

    expect(res.status).toBe(200);

    // Group should be gone
    expect(await ctx.apiKeyService.getGroupById(group!.id)).toBeNull();
  } finally {
    await ctx.cleanup();
  }
});

// =====================
// Keys API Tests
// =====================

// GET /api/keys tests
integrationTest("GET /api/keys returns empty array when no keys", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeys()
    .build();

  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/keys");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.keys).toEqual([]);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/keys returns all keys", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeyGroup("email")
    .withApiKeyGroup("service")
    .withApiKey("email", "key1-value", "key-1")
    .withApiKey("service", "key2-value", "key-2")
    .build();

  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/keys");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.keys.length).toBe(2);
    const names = json.keys.map((k: { name: string }) => k.name);
    expect(names).toContain("key-1");
    expect(names).toContain("key-2");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/keys filters by groupId", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeyGroup("email")
    .withApiKeyGroup("service")
    .withApiKey("email", "key1-value", "key-1")
    .withApiKey("email", "key2-value", "key-2")
    .withApiKey("service", "key3-value", "key-3")
    .build();

  try {
    const emailGroup = await ctx.apiKeyService.getGroupByName("email");

    const app = createTestApp(ctx);
    const res = await app.request(`/api/keys?groupId=${emailGroup!.id}`);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.keys.length).toBe(2);
    const names = json.keys.map((k: { name: string }) => k.name);
    expect(names).toContain("key-1");
    expect(names).toContain("key-2");
    expect(names).not.toContain("key-3");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/keys returns 400 for invalid groupId", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeys()
    .build();

  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/keys?groupId=notanumber");
    expect(res.status).toBe(400);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/keys returns 404 for nonexistent groupId", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeys()
    .build();

  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/keys?groupId=nonexistent-999");
    expect(res.status).toBe(404);
  } finally {
    await ctx.cleanup();
  }
});

// POST /api/keys tests
integrationTest("POST /api/keys creates key with groupId in body", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeyGroup("email")
    .build();

  try {
    const group = await ctx.apiKeyService.getGroupByName("email");

    const app = createTestApp(ctx);
    const res = await app.request("/api/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupId: group!.id, name: "new-key", value: "new-value" }),
    });

    expect(res.status).toBe(201);

    const json = await res.json();
    expect(typeof json.id).toBe("string");
    expect(json.id.length).toBeGreaterThan(0);
    expect(json.name).toBe("new-key");
    expect(json.value).toBe("new-value");

    // Verify key was added
    expect(await ctx.apiKeyService.hasKey("email", "new-value")).toBe(true);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("POST /api/keys generates value when not provided", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeyGroup("email")
    .build();

  try {
    const group = await ctx.apiKeyService.getGroupByName("email");

    const app = createTestApp(ctx);
    const res = await app.request("/api/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupId: group!.id, name: "auto-key" }),
    });

    expect(res.status).toBe(201);

    const json = await res.json();
    expect(typeof json.id).toBe("string");
    expect(json.id.length).toBeGreaterThan(0);
    expect(json.name).toBe("auto-key");
    expect(json.value).toBeDefined();
    expect(json.value.length).toBeGreaterThan(10);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("POST /api/keys rejects missing groupId", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeys()
    .build();

  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "new-key", value: "new-value" }),
    });

    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain("groupId");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("POST /api/keys rejects invalid groupId characters", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeys()
    .build();

  try {
    const app = createTestApp(ctx);
    // SurrealDB IDs must be alphanumeric with dashes/underscores only
    const res = await app.request("/api/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupId: "invalid.id", name: "new-key" }),
    });

    expect(res.status).toBe(400);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("POST /api/keys rejects nonexistent groupId", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeys()
    .build();

  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupId: "nonexistent-999", name: "new-key" }),
    });

    expect(res.status).toBe(404);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("POST /api/keys rejects missing name", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeyGroup("email")
    .build();

  try {
    const group = await ctx.apiKeyService.getGroupByName("email");

    const app = createTestApp(ctx);
    const res = await app.request("/api/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupId: group!.id, value: "some-value" }),
    });

    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain("name");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("POST /api/keys rejects invalid key name", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeyGroup("email")
    .build();

  try {
    const group = await ctx.apiKeyService.getGroupByName("email");

    const app = createTestApp(ctx);
    const res = await app.request("/api/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupId: group!.id, name: "Invalid Name!" }),
    });

    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain("name");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("POST /api/keys rejects invalid key value", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeyGroup("email")
    .build();

  try {
    const group = await ctx.apiKeyService.getGroupByName("email");

    const app = createTestApp(ctx);
    const res = await app.request("/api/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupId: group!.id, name: "test-key", value: "invalid.value!" }),
    });

    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain("value");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("POST /api/keys returns 409 for duplicate key name", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeyGroup("email")
    .withApiKey("email", "existing-value", "existing-key")
    .build();

  try {
    const group = await ctx.apiKeyService.getGroupByName("email");

    const app = createTestApp(ctx);
    const res = await app.request("/api/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupId: group!.id, name: "existing-key", value: "new-value" }),
    });

    expect(res.status).toBe(409);

    const json = await res.json();
    expect(json.error).toContain("already exists");
  } finally {
    await ctx.cleanup();
  }
});

// GET /api/keys/:keyId tests
integrationTest("GET /api/keys/:keyId returns key by ID", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeyGroup("email")
    .withApiKey("email", "test-value", "test-key", "Test description")
    .build();

  try {
    const keys = await ctx.apiKeyService.getKeys("email");
    const keyId = keys![0].id;

    const app = createTestApp(ctx);
    const res = await app.request(`/api/keys/${keyId}`);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.key.id).toBe(keyId);
    expect(json.key.name).toBe("test-key");
    expect(json.key.description).toBe("Test description");
    expect(json.group.id).toBeDefined();
    expect(json.group.name).toBe("email");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/keys/:keyId returns 404 for nonexistent", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeys()
    .build();

  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/keys/999");
    expect(res.status).toBe(404);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/keys/:keyId returns 400 for invalid ID", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeys()
    .build();

  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/keys/notanumber");
    expect(res.status).toBe(400);
  } finally {
    await ctx.cleanup();
  }
});

// PUT /api/keys/:keyId tests
integrationTest("PUT /api/keys/:keyId updates name", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeyGroup("test-group")
    .withApiKey("test-group", "original-value", "original-name")
    .build();

  try {
    const keys = await ctx.apiKeyService.getKeys("test-group");
    const keyId = keys![0].id;

    const app = createTestApp(ctx);
    const res = await app.request(`/api/keys/${keyId}`, {
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

integrationTest("PUT /api/keys/:keyId updates value", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeyGroup("test-group")
    .withApiKey("test-group", "original-value", "test-key")
    .build();

  try {
    const keys = await ctx.apiKeyService.getKeys("test-group");
    const keyId = keys![0].id;

    const app = createTestApp(ctx);
    const res = await app.request(`/api/keys/${keyId}`, {
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

integrationTest("PUT /api/keys/:keyId updates description", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeyGroup("test-group")
    .withApiKey("test-group", "value1", "test-key", "Old description")
    .build();

  try {
    const keys = await ctx.apiKeyService.getKeys("test-group");
    const keyId = keys![0].id;

    const app = createTestApp(ctx);
    const res = await app.request(`/api/keys/${keyId}`, {
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

integrationTest("PUT /api/keys/:keyId returns 400 for invalid name", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeyGroup("test-group")
    .withApiKey("test-group", "value1", "test-key")
    .build();

  try {
    const keys = await ctx.apiKeyService.getKeys("test-group");
    const keyId = keys![0].id;

    const app = createTestApp(ctx);
    const res = await app.request(`/api/keys/${keyId}`, {
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

integrationTest("PUT /api/keys/:keyId returns 400 for invalid value", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeyGroup("test-group")
    .withApiKey("test-group", "value1", "test-key")
    .build();

  try {
    const keys = await ctx.apiKeyService.getKeys("test-group");
    const keyId = keys![0].id;

    const app = createTestApp(ctx);
    const res = await app.request(`/api/keys/${keyId}`, {
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

integrationTest("PUT /api/keys/:keyId returns 404 for non-existent key", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeys()
    .build();

  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/keys/99999", {
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

integrationTest("PUT /api/keys/:keyId returns 409 for duplicate name", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeyGroup("test-group")
    .withApiKey("test-group", "value1", "key-one")
    .withApiKey("test-group", "value2", "key-two")
    .build();

  try {
    const keys = await ctx.apiKeyService.getKeys("test-group");
    const key2Id = keys!.find((k) => k.name === "key-two")!.id;

    const app = createTestApp(ctx);
    const res = await app.request(`/api/keys/${key2Id}`, {
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

integrationTest("PUT /api/keys/:keyId returns 400 for invalid ID", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeys()
    .build();

  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/keys/notanumber", {
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

// DELETE /api/keys/:keyId tests
integrationTest("DELETE /api/keys/:keyId removes key by ID", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeyGroup("email")
    .withApiKey("email", "key1-value", "key-1")
    .withApiKey("email", "key2-value", "key-2")
    .build();

  try {
    const keys = await ctx.apiKeyService.getKeys("email");
    const key1Id = keys!.find((k) => k.value === "key1-value")!.id;

    const app = createTestApp(ctx);
    const res = await app.request(`/api/keys/${key1Id}`, {
      method: "DELETE",
    });

    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);

    // Verify only key1 was removed
    expect(await ctx.apiKeyService.hasKey("email", "key1-value")).toBe(false);
    expect(await ctx.apiKeyService.hasKey("email", "key2-value")).toBe(true);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("DELETE /api/keys/:keyId returns 404 for non-existent key", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeys()
    .build();

  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/keys/99999", {
      method: "DELETE",
    });

    expect(res.status).toBe(404);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("DELETE /api/keys/:keyId returns 400 for invalid ID", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeys()
    .build();

  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/keys/notanumber", {
      method: "DELETE",
    });

    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain("Invalid");
  } finally {
    await ctx.cleanup();
  }
});
