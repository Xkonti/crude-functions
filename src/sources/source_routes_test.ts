import { expect } from "@std/expect";
import { Hono } from "@hono/hono";
import { TestSetupBuilder } from "../test/test_setup_builder.ts";
import { integrationTest } from "../test/test_helpers.ts";
import { createSourceRoutes, createSourceWebhookRoute } from "./source_routes.ts";

/**
 * Create a test app with source routes.
 */
async function createTestApp() {
  const ctx = await TestSetupBuilder.create().withCodeSources().build();

  const app = new Hono();
  // Mount webhook route first (no auth)
  app.route(
    "/api/sources",
    createSourceWebhookRoute({ codeSourceService: ctx.codeSourceService }),
  );
  // Then mount main source routes
  app.route(
    "/api/sources",
    createSourceRoutes({ codeSourceService: ctx.codeSourceService }),
  );

  return { app, ctx };
}

// =============================================================================
// CRUD Operations - List and Get
// =============================================================================

integrationTest("GET /api/sources returns empty array initially", async () => {
  const { app, ctx } = await createTestApp();
  try {
    const res = await app.request("/api/sources");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.sources).toEqual([]);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/sources/:id returns 404 for non-existent source", async () => {
  const { app, ctx } = await createTestApp();
  try {
    const res = await app.request("/api/sources/999");
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toContain("not found");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/sources/:id returns 404 for non-existent ID", async () => {
  const { app, ctx } = await createTestApp();
  try {
    // Any non-existent ID returns 404 (IDs are no longer validated for format)
    const res = await app.request("/api/sources/nonexistent-id");
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toContain("not found");
  } finally {
    await ctx.cleanup();
  }
});

// =============================================================================
// CRUD Operations - Create
// =============================================================================

integrationTest("POST /api/sources creates manual source", async () => {
  const { app, ctx } = await createTestApp();
  try {
    const res = await app.request("/api/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "test-manual",
        type: "manual",
      }),
    });

    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.id).toBeDefined();
    expect(body.name).toBe("test-manual");
    expect(body.type).toBe("manual");
    expect(body.enabled).toBe(true);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("POST /api/sources creates git source", async () => {
  const { app, ctx } = await createTestApp();
  try {
    const res = await app.request("/api/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "test-git",
        type: "git",
        typeSettings: {
          url: "https://github.com/octocat/Hello-World.git",
          branch: "master",
        },
      }),
    });

    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.id).toBeDefined();
    expect(body.name).toBe("test-git");
    expect(body.type).toBe("git");
    expect(body.typeSettings.url).toBe(
      "https://github.com/octocat/Hello-World.git",
    );
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("POST /api/sources redacts authToken in response", async () => {
  const { app, ctx } = await createTestApp();
  try {
    const res = await app.request("/api/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "test-git-auth",
        type: "git",
        typeSettings: {
          url: "https://github.com/octocat/Hello-World.git",
          branch: "master",
          authToken: "secret-token-12345",
        },
      }),
    });

    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.typeSettings.authToken).toBe("***REDACTED***");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("POST /api/sources returns 400 for missing name", async () => {
  const { app, ctx } = await createTestApp();
  try {
    const res = await app.request("/api/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "manual",
      }),
    });

    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toContain("name");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("POST /api/sources returns 400 for missing type", async () => {
  const { app, ctx } = await createTestApp();
  try {
    const res = await app.request("/api/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "test",
      }),
    });

    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toContain("type");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("POST /api/sources returns 400 for invalid type", async () => {
  const { app, ctx } = await createTestApp();
  try {
    const res = await app.request("/api/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "test",
        type: "invalid",
      }),
    });

    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toContain("Invalid source type");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("POST /api/sources returns 409 for duplicate name", async () => {
  const { app, ctx } = await createTestApp();
  try {
    // Create first source
    await app.request("/api/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "duplicate",
        type: "manual",
      }),
    });

    // Try to create second with same name
    const res = await app.request("/api/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "duplicate",
        type: "manual",
      }),
    });

    expect(res.status).toBe(409);

    const body = await res.json();
    expect(body.error).toContain("already exists");
  } finally {
    await ctx.cleanup();
  }
});

// =============================================================================
// CRUD Operations - Update
// =============================================================================

integrationTest("PUT /api/sources/:id updates source settings", async () => {
  const { app, ctx } = await createTestApp();
  try {
    // Create source
    const createRes = await app.request("/api/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "test-update",
        type: "manual",
      }),
    });
    const created = await createRes.json();

    // Update it
    const updateRes = await app.request(`/api/sources/${created.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        syncSettings: { intervalSeconds: 300 },
        enabled: false,
      }),
    });

    expect(updateRes.status).toBe(200);

    const body = await updateRes.json();
    expect(body.enabled).toBe(false);
    expect(body.syncSettings.intervalSeconds).toBe(300);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("PUT /api/sources/:id returns 404 for non-existent source", async () => {
  const { app, ctx } = await createTestApp();
  try {
    const res = await app.request("/api/sources/999", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });

    expect(res.status).toBe(404);
  } finally {
    await ctx.cleanup();
  }
});

// =============================================================================
// CRUD Operations - Delete
// =============================================================================

integrationTest("DELETE /api/sources/:id deletes source", async () => {
  const { app, ctx } = await createTestApp();
  try {
    // Create source
    const createRes = await app.request("/api/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "test-delete",
        type: "manual",
      }),
    });
    const created = await createRes.json();

    // Delete it
    const deleteRes = await app.request(`/api/sources/${created.id}`, {
      method: "DELETE",
    });

    expect(deleteRes.status).toBe(200);

    // Verify it's gone
    const getRes = await app.request(`/api/sources/${created.id}`);
    expect(getRes.status).toBe(404);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("DELETE /api/sources/:id returns 404 for non-existent source", async () => {
  const { app, ctx } = await createTestApp();
  try {
    const res = await app.request("/api/sources/999", {
      method: "DELETE",
    });

    expect(res.status).toBe(404);
  } finally {
    await ctx.cleanup();
  }
});

// =============================================================================
// Sync Operations
// =============================================================================

integrationTest("POST /api/sources/:id/sync returns 400 for manual source", async () => {
  const { app, ctx } = await createTestApp();
  try {
    // Create manual source
    const createRes = await app.request("/api/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "test-manual-sync",
        type: "manual",
      }),
    });
    const created = await createRes.json();

    // Try to sync it
    const syncRes = await app.request(`/api/sources/${created.id}/sync`, {
      method: "POST",
    });

    expect(syncRes.status).toBe(400);

    const body = await syncRes.json();
    expect(body.error).toContain("cannot be synced");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("POST /api/sources/:id/sync returns 404 for non-existent source", async () => {
  const { app, ctx } = await createTestApp();
  try {
    const res = await app.request("/api/sources/999/sync", {
      method: "POST",
    });

    expect(res.status).toBe(404);
  } finally {
    await ctx.cleanup();
  }
});

// =============================================================================
// Status Operations
// =============================================================================

integrationTest("GET /api/sources/:id/status returns source status", async () => {
  const { app, ctx } = await createTestApp();
  try {
    // Create source
    const createRes = await app.request("/api/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "test-status",
        type: "manual",
      }),
    });
    const created = await createRes.json();

    // Get status
    const statusRes = await app.request(`/api/sources/${created.id}/status`);

    expect(statusRes.status).toBe(200);

    const body = await statusRes.json();
    expect(body.isSyncable).toBe(false); // Manual sources aren't syncable
    expect(body.isEditable).toBe(true); // Manual sources are editable
    expect(body.isSyncing).toBe(false);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/sources/:id/status returns correct capabilities for git source", async () => {
  const { app, ctx } = await createTestApp();
  try {
    // Create git source
    const createRes = await app.request("/api/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "test-git-status",
        type: "git",
        typeSettings: {
          url: "https://github.com/octocat/Hello-World.git",
          branch: "master",
        },
      }),
    });
    const created = await createRes.json();

    // Get status
    const statusRes = await app.request(`/api/sources/${created.id}/status`);

    expect(statusRes.status).toBe(200);

    const body = await statusRes.json();
    expect(body.isSyncable).toBe(true); // Git sources are syncable
    expect(body.isEditable).toBe(false); // Git sources are not editable
  } finally {
    await ctx.cleanup();
  }
});

// =============================================================================
// Webhook Operations
// =============================================================================

integrationTest("POST /api/sources/:id/webhook returns 403 for disabled webhooks", async () => {
  const { app, ctx } = await createTestApp();
  try {
    // Create git source WITHOUT webhookEnabled
    const createRes = await app.request("/api/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "test-webhook",
        type: "git",
        typeSettings: {
          url: "https://github.com/octocat/Hello-World.git",
          branch: "master",
        },
        syncSettings: {
          webhookSecret: "my-secret",
          // webhookEnabled not set = disabled
        },
      }),
    });
    const created = await createRes.json();

    // Try webhook - should be rejected as disabled
    const webhookRes = await app.request(`/api/sources/${created.id}/webhook`, {
      method: "POST",
      headers: { "X-Webhook-Secret": "my-secret" },
    });

    expect(webhookRes.status).toBe(403);

    const body = await webhookRes.json();
    expect(body.error).toContain("Webhooks disabled");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("POST /api/sources/:id/webhook returns 401 for invalid secret", async () => {
  const { app, ctx } = await createTestApp();
  try {
    // Create git source with webhook enabled and secret required
    const createRes = await app.request("/api/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "test-webhook-invalid",
        type: "git",
        typeSettings: {
          url: "https://github.com/octocat/Hello-World.git",
          branch: "master",
        },
        syncSettings: {
          webhookEnabled: true,
          webhookSecret: "correct-secret",
        },
      }),
    });
    const created = await createRes.json();

    // Try webhook with wrong secret
    const webhookRes = await app.request(`/api/sources/${created.id}/webhook`, {
      method: "POST",
      headers: { "X-Webhook-Secret": "wrong-secret" },
    });

    expect(webhookRes.status).toBe(401);

    const body = await webhookRes.json();
    expect(body.error).toContain("Invalid webhook secret");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("POST /api/sources/:id/webhook returns 404 for non-existent source", async () => {
  const { app, ctx } = await createTestApp();
  try {
    const res = await app.request("/api/sources/999/webhook", {
      method: "POST",
      headers: { "X-Webhook-Secret": "any-secret" },
    });

    expect(res.status).toBe(404);
  } finally {
    await ctx.cleanup();
  }
});

// =============================================================================
// Redaction Tests
// =============================================================================

integrationTest("GET /api/sources/:id redacts sensitive fields", async () => {
  const { app, ctx } = await createTestApp();
  try {
    // Create source with secrets
    const createRes = await app.request("/api/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "test-redact",
        type: "git",
        typeSettings: {
          url: "https://github.com/octocat/Hello-World.git",
          branch: "master",
          authToken: "secret-token",
        },
        syncSettings: {
          webhookSecret: "webhook-secret",
        },
      }),
    });
    const created = await createRes.json();

    // Get source
    const getRes = await app.request(`/api/sources/${created.id}`);
    const body = await getRes.json();

    // Secrets should be redacted
    expect(body.typeSettings.authToken).toBe("***REDACTED***");
    expect(body.syncSettings.webhookSecret).toBe("***REDACTED***");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/sources list redacts sensitive fields", async () => {
  const { app, ctx } = await createTestApp();
  try {
    // Create source with secrets
    await app.request("/api/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "test-list-redact",
        type: "git",
        typeSettings: {
          url: "https://github.com/octocat/Hello-World.git",
          branch: "master",
          authToken: "secret-token",
        },
        syncSettings: {
          webhookSecret: "webhook-secret",
        },
      }),
    });

    // List sources
    const listRes = await app.request("/api/sources");
    const body = await listRes.json();

    const source = body.sources[0];
    expect(source.typeSettings.authToken).toBe("***REDACTED***");
    expect(source.syncSettings.webhookSecret).toBe("***REDACTED***");
  } finally {
    await ctx.cleanup();
  }
});
