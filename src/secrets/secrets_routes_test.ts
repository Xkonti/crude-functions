import { expect } from "@std/expect";
import { Hono } from "@hono/hono";
import { createSecretsRoutes } from "./secrets_routes.ts";
import { TestSetupBuilder } from "../test/test_setup_builder.ts";
import { integrationTest } from "../test/test_helpers.ts";
import type { BaseTestContext, SecretsContext } from "../test/types.ts";

/**
 * Creates a Hono app with secrets routes from a TestSetupBuilder context.
 */
function createTestApp(ctx: BaseTestContext & SecretsContext): Hono {
  const app = new Hono();
  app.route("/api/secrets", createSecretsRoutes(ctx.secretsService));
  return app;
}

// ============== GET /api/secrets tests ==============

integrationTest("GET /api/secrets returns empty array when no secrets", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSecrets()
    .build();

  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/secrets");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.secrets).toEqual([]);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/secrets returns all secrets without values by default", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSecrets()
    .build();

  try {
    await ctx.secretsService.createGlobalSecret("GLOBAL_SECRET", "value1");
    await ctx.secretsService.createGlobalSecret("ANOTHER_SECRET", "value2");

    const app = createTestApp(ctx);
    const res = await app.request("/api/secrets");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.secrets.length).toBe(2);

    // Should not include values by default
    expect(json.secrets[0].value).toBeUndefined();
    expect(json.secrets[0].scope).toBe("global");
    expect(json.secrets[0].scopeId).toBeNull();
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/secrets?includeValues=true returns secrets with values", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSecrets()
    .build();

  try {
    await ctx.secretsService.createGlobalSecret("MY_SECRET", "secret_value");

    const app = createTestApp(ctx);
    const res = await app.request("/api/secrets?includeValues=true");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.secrets.length).toBe(1);
    expect(json.secrets[0].value).toBe("secret_value");
    expect(json.secrets[0].name).toBe("MY_SECRET");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/secrets?scope=global filters by scope", async () => {
  const ctx = await TestSetupBuilder.create()
    .withRoutes()
    .withSecrets()
    .build();

  try {
    await ctx.secretsService.createGlobalSecret("GLOBAL", "value1");

    // Create a route and function-scoped secret
    await ctx.routesService.addRoute({
      name: "test",
      handler: "test.ts",
      route: "/test",
      methods: ["GET"],
    });
    const route = await ctx.routesService.getByName("test");
    await ctx.secretsService.createFunctionSecret(route!.id, "FUNCTION", "value2");

    const app = createTestApp(ctx);
    const res = await app.request("/api/secrets?scope=global");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.secrets.length).toBe(1);
    expect(json.secrets[0].name).toBe("GLOBAL");
    expect(json.secrets[0].scope).toBe("global");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/secrets?scope=function&functionId=1 filters by function", async () => {
  const ctx = await TestSetupBuilder.create()
    .withRoutes()
    .withSecrets()
    .build();

  try {
    // Create routes
    await ctx.routesService.addRoute({
      name: "test1",
      handler: "test1.ts",
      route: "/test1",
      methods: ["GET"],
    });
    await ctx.routesService.addRoute({
      name: "test2",
      handler: "test2.ts",
      route: "/test2",
      methods: ["GET"],
    });

    const route1 = await ctx.routesService.getByName("test1");
    const route2 = await ctx.routesService.getByName("test2");

    await ctx.secretsService.createFunctionSecret(route1!.id, "SECRET1", "value1");
    await ctx.secretsService.createFunctionSecret(route2!.id, "SECRET2", "value2");

    const app = createTestApp(ctx);
    const res = await app.request(`/api/secrets?scope=function&functionId=${route1!.id}`);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.secrets.length).toBe(1);
    expect(json.secrets[0].name).toBe("SECRET1");
    expect(json.secrets[0].scopeId).toBe(route1!.id);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/secrets rejects invalid scope", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSecrets()
    .build();

  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/secrets?scope=invalid");
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain("Invalid scope");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/secrets rejects invalid functionId", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSecrets()
    .build();

  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/secrets?functionId=abc");
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain("Invalid functionId");
  } finally {
    await ctx.cleanup();
  }
});

// ============== GET /api/secrets/:id tests ==============

integrationTest("GET /api/secrets/:id returns secret by ID", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSecrets()
    .build();

  try {
    await ctx.secretsService.createGlobalSecret("MY_SECRET", "secret_value", "test comment");
    const secrets = await ctx.secretsService.getGlobalSecretsWithValues();
    const secretId = secrets[0].id;

    const app = createTestApp(ctx);
    const res = await app.request(`/api/secrets/${secretId}`);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.id).toBe(secretId);
    expect(json.name).toBe("MY_SECRET");
    expect(json.value).toBe("secret_value");
    expect(json.comment).toBe("test comment");
    expect(json.scope).toBe("global");
    expect(json.scopeId).toBeNull();
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/secrets/:id returns 404 for non-existent ID", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSecrets()
    .build();

  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/secrets/999999");
    expect(res.status).toBe(404);

    const json = await res.json();
    expect(json.error).toContain("not found");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/secrets/:id returns 400 for invalid ID", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSecrets()
    .build();

  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/secrets/invalid");
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain("Invalid secret ID");
  } finally {
    await ctx.cleanup();
  }
});

// ============== GET /api/secrets/by-name/:name tests ==============

integrationTest("GET /api/secrets/by-name/:name returns matching secrets", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSecrets()
    .build();

  try {
    await ctx.secretsService.createGlobalSecret("MY_SECRET", "global_value");

    const app = createTestApp(ctx);
    const res = await app.request("/api/secrets/by-name/MY_SECRET");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.name).toBe("MY_SECRET");
    expect(json.secrets.length).toBe(1);
    expect(json.secrets[0].value).toBe("global_value");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/secrets/by-name/:name returns 404 when not found", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSecrets()
    .build();

  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/secrets/by-name/NONEXISTENT");
    expect(res.status).toBe(404);

    const json = await res.json();
    expect(json.error).toContain("No secrets found");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/secrets/by-name/:name?scope=global filters by scope", async () => {
  const ctx = await TestSetupBuilder.create()
    .withRoutes()
    .withSecrets()
    .build();

  try {
    await ctx.secretsService.createGlobalSecret("MY_SECRET", "global_value");

    // Create function-scoped secret with same name
    await ctx.routesService.addRoute({
      name: "test",
      handler: "test.ts",
      route: "/test",
      methods: ["GET"],
    });
    const route = await ctx.routesService.getByName("test");
    await ctx.secretsService.createFunctionSecret(route!.id, "MY_SECRET", "function_value");

    const app = createTestApp(ctx);
    const res = await app.request("/api/secrets/by-name/MY_SECRET?scope=global");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.secrets.length).toBe(1);
    expect(json.secrets[0].value).toBe("global_value");
    expect(json.secrets[0].scope).toBe("global");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/secrets/by-name/:name rejects invalid scope", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSecrets()
    .build();

  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/secrets/by-name/TEST?scope=invalid");
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain("Invalid scope");
  } finally {
    await ctx.cleanup();
  }
});

// ============== POST /api/secrets tests ==============

integrationTest("POST /api/secrets creates global secret", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSecrets()
    .build();

  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/secrets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "NEW_SECRET",
        value: "secret_value",
        comment: "test comment",
        scope: "global",
      }),
    });

    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.id).toBeDefined();
    expect(json.name).toBe("NEW_SECRET");
    expect(json.scope).toBe("global");

    // Verify secret was created
    const secret = await ctx.secretsService.getSecretById(json.id);
    expect(secret).not.toBeNull();
    expect(secret!.value).toBe("secret_value");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("POST /api/secrets creates function-scoped secret", async () => {
  const ctx = await TestSetupBuilder.create()
    .withRoutes()
    .withSecrets()
    .build();

  try {
    await ctx.routesService.addRoute({
      name: "test",
      handler: "test.ts",
      route: "/test",
      methods: ["GET"],
    });
    const route = await ctx.routesService.getByName("test");

    const app = createTestApp(ctx);
    const res = await app.request("/api/secrets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "FUNCTION_SECRET",
        value: "func_value",
        scope: "function",
        functionId: route!.id,
      }),
    });

    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.scope).toBe("function");

    // Verify secret was created
    const secrets = await ctx.secretsService.getFunctionSecrets(route!.id);
    expect(secrets.length).toBe(1);
    expect(secrets[0].name).toBe("FUNCTION_SECRET");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("POST /api/secrets creates group-scoped secret", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeys()
    .withSecrets()
    .build();

  try {
    const groupId = await ctx.apiKeyService.createGroup("test-group");

    const app = createTestApp(ctx);
    const res = await app.request("/api/secrets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "GROUP_SECRET",
        value: "group_value",
        scope: "group",
        groupId,
      }),
    });

    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.scope).toBe("group");

    // Verify secret was created
    const secrets = await ctx.secretsService.getGroupSecrets(groupId);
    expect(secrets.length).toBe(1);
    expect(secrets[0].name).toBe("GROUP_SECRET");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("POST /api/secrets creates key-scoped secret", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeys()
    .withSecrets()
    .build();

  try {
    const _groupId = await ctx.apiKeyService.createGroup("test-group");
    await ctx.apiKeyService.addKey("test-group", "test-key", "key-value");
    const keys = await ctx.apiKeyService.getKeys("test-group");
    const keyId = keys![0].id;

    const app = createTestApp(ctx);
    const res = await app.request("/api/secrets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "KEY_SECRET",
        value: "key_value",
        scope: "key",
        keyId,
      }),
    });

    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.scope).toBe("key");

    // Verify secret was created
    const secrets = await ctx.secretsService.getKeySecrets(keyId);
    expect(secrets.length).toBe(1);
    expect(secrets[0].name).toBe("KEY_SECRET");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("POST /api/secrets rejects missing name", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSecrets()
    .build();

  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/secrets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        value: "test",
        scope: "global",
      }),
    });

    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain("name");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("POST /api/secrets rejects invalid name", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSecrets()
    .build();

  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/secrets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "invalid name!",
        value: "test",
        scope: "global",
      }),
    });

    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain("Invalid secret name");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("POST /api/secrets rejects missing value", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSecrets()
    .build();

  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/secrets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "TEST",
        scope: "global",
      }),
    });

    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain("value");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("POST /api/secrets rejects empty value", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSecrets()
    .build();

  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/secrets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "TEST",
        value: "",
        scope: "global",
      }),
    });

    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain("value");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("POST /api/secrets rejects missing scope", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSecrets()
    .build();

  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/secrets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "TEST",
        value: "value",
      }),
    });

    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain("scope");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("POST /api/secrets rejects invalid scope", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSecrets()
    .build();

  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/secrets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "TEST",
        value: "value",
        scope: "invalid",
      }),
    });

    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain("Invalid scope");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("POST /api/secrets rejects function scope without functionId", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSecrets()
    .build();

  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/secrets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "TEST",
        value: "value",
        scope: "function",
      }),
    });

    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain("functionId is required");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("POST /api/secrets rejects group scope without groupId", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSecrets()
    .build();

  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/secrets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "TEST",
        value: "value",
        scope: "group",
      }),
    });

    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain("groupId is required");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("POST /api/secrets rejects key scope without keyId", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSecrets()
    .build();

  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/secrets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "TEST",
        value: "value",
        scope: "key",
      }),
    });

    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain("keyId is required");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("POST /api/secrets returns 409 for duplicate names in same scope", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSecrets()
    .build();

  try {
    await ctx.secretsService.createGlobalSecret("DUPLICATE", "value1");

    const app = createTestApp(ctx);
    const res = await app.request("/api/secrets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "DUPLICATE",
        value: "value2",
        scope: "global",
      }),
    });

    expect(res.status).toBe(409);

    const json = await res.json();
    expect(json.error).toContain("already exists");
  } finally {
    await ctx.cleanup();
  }
});

// ============== PUT /api/secrets/:id tests ==============

integrationTest("PUT /api/secrets/:id updates name", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSecrets()
    .build();

  try {
    await ctx.secretsService.createGlobalSecret("OLD_NAME", "value");
    const secrets = await ctx.secretsService.getGlobalSecrets();
    const secretId = secrets[0].id;

    const app = createTestApp(ctx);
    const res = await app.request(`/api/secrets/${secretId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "NEW_NAME" }),
    });

    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);

    // Verify name was updated
    const updated = await ctx.secretsService.getSecretById(secretId);
    expect(updated!.name).toBe("NEW_NAME");
    expect(updated!.value).toBe("value"); // value unchanged
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("PUT /api/secrets/:id updates value", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSecrets()
    .build();

  try {
    await ctx.secretsService.createGlobalSecret("MY_SECRET", "old_value");
    const secrets = await ctx.secretsService.getGlobalSecrets();
    const secretId = secrets[0].id;

    const app = createTestApp(ctx);
    const res = await app.request(`/api/secrets/${secretId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "new_value" }),
    });

    expect(res.status).toBe(200);

    // Verify value was updated
    const updated = await ctx.secretsService.getSecretById(secretId);
    expect(updated!.value).toBe("new_value");
    expect(updated!.name).toBe("MY_SECRET"); // name unchanged
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("PUT /api/secrets/:id updates comment", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSecrets()
    .build();

  try {
    await ctx.secretsService.createGlobalSecret("MY_SECRET", "value", "old comment");
    const secrets = await ctx.secretsService.getGlobalSecrets();
    const secretId = secrets[0].id;

    const app = createTestApp(ctx);
    const res = await app.request(`/api/secrets/${secretId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment: "new comment" }),
    });

    expect(res.status).toBe(200);

    // Verify comment was updated
    const updated = await ctx.secretsService.getSecretById(secretId);
    expect(updated!.comment).toBe("new comment");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("PUT /api/secrets/:id updates multiple fields", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSecrets()
    .build();

  try {
    await ctx.secretsService.createGlobalSecret("OLD", "old_value", "old comment");
    const secrets = await ctx.secretsService.getGlobalSecrets();
    const secretId = secrets[0].id;

    const app = createTestApp(ctx);
    const res = await app.request(`/api/secrets/${secretId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "NEW",
        value: "new_value",
        comment: "new comment",
      }),
    });

    expect(res.status).toBe(200);

    // Verify all fields were updated
    const updated = await ctx.secretsService.getSecretById(secretId);
    expect(updated!.name).toBe("NEW");
    expect(updated!.value).toBe("new_value");
    expect(updated!.comment).toBe("new comment");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("PUT /api/secrets/:id rejects when no fields provided", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSecrets()
    .build();

  try {
    await ctx.secretsService.createGlobalSecret("TEST", "value");
    const secrets = await ctx.secretsService.getGlobalSecrets();
    const secretId = secrets[0].id;

    const app = createTestApp(ctx);
    const res = await app.request(`/api/secrets/${secretId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain("At least one field");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("PUT /api/secrets/:id rejects invalid name", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSecrets()
    .build();

  try {
    await ctx.secretsService.createGlobalSecret("TEST", "value");
    const secrets = await ctx.secretsService.getGlobalSecrets();
    const secretId = secrets[0].id;

    const app = createTestApp(ctx);
    const res = await app.request(`/api/secrets/${secretId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "invalid name!" }),
    });

    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain("Invalid secret name");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("PUT /api/secrets/:id rejects empty value", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSecrets()
    .build();

  try {
    await ctx.secretsService.createGlobalSecret("TEST", "value");
    const secrets = await ctx.secretsService.getGlobalSecrets();
    const secretId = secrets[0].id;

    const app = createTestApp(ctx);
    const res = await app.request(`/api/secrets/${secretId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "" }),
    });

    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain("value cannot be empty");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("PUT /api/secrets/:id returns 404 for non-existent ID", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSecrets()
    .build();

  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/secrets/999999", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "new_value" }),
    });

    expect(res.status).toBe(404);

    const json = await res.json();
    expect(json.error).toContain("not found");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("PUT /api/secrets/:id returns 400 for invalid ID", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSecrets()
    .build();

  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/secrets/invalid", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "new_value" }),
    });

    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain("Invalid secret ID");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("PUT /api/secrets/:id returns 409 for duplicate name in same scope", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSecrets()
    .build();

  try {
    await ctx.secretsService.createGlobalSecret("EXISTING", "value1");
    await ctx.secretsService.createGlobalSecret("TO_RENAME", "value2");

    const secrets = await ctx.secretsService.getGlobalSecrets();
    const toRename = secrets.find(s => s.name === "TO_RENAME");

    const app = createTestApp(ctx);
    const res = await app.request(`/api/secrets/${toRename!.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "EXISTING" }),
    });

    expect(res.status).toBe(409);

    const json = await res.json();
    expect(json.error).toContain("already exists");
  } finally {
    await ctx.cleanup();
  }
});

// ============== DELETE /api/secrets/:id tests ==============

integrationTest("DELETE /api/secrets/:id deletes secret", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSecrets()
    .build();

  try {
    await ctx.secretsService.createGlobalSecret("TO_DELETE", "value");
    const secrets = await ctx.secretsService.getGlobalSecrets();
    const secretId = secrets[0].id;

    const app = createTestApp(ctx);
    const res = await app.request(`/api/secrets/${secretId}`, {
      method: "DELETE",
    });

    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);

    // Verify secret was deleted
    const deleted = await ctx.secretsService.getSecretById(secretId);
    expect(deleted).toBeNull();
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("DELETE /api/secrets/:id returns 404 for non-existent ID", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSecrets()
    .build();

  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/secrets/999999", {
      method: "DELETE",
    });

    expect(res.status).toBe(404);

    const json = await res.json();
    expect(json.error).toContain("not found");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("DELETE /api/secrets/:id returns 400 for invalid ID", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSecrets()
    .build();

  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/secrets/invalid", {
      method: "DELETE",
    });

    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain("Invalid secret ID");
  } finally {
    await ctx.cleanup();
  }
});
