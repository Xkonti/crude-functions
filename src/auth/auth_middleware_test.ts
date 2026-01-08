import { expect } from "@std/expect";
import { Hono } from "@hono/hono";
import { TestSetupBuilder } from "../test/test_setup_builder.ts";
import { createHybridAuthMiddleware } from "./auth_middleware.ts";
import { SettingNames } from "../settings/types.ts";
import type { ApiKeysContext, BaseTestContext, SettingsContext } from "../test/types.ts";
import type { Auth } from "./auth.ts";

/**
 * Creates a test Hono app with hybrid auth middleware.
 * The app exposes a single protected endpoint at /api/test that returns
 * auth information (method and API key group if applicable).
 */
function createTestApp(ctx: BaseTestContext & SettingsContext & ApiKeysContext, auth: Auth): Hono {
  const hybridAuth = createHybridAuthMiddleware({
    auth,
    apiKeyService: ctx.apiKeyService,
    settingsService: ctx.settingsService,
  });

  const app = new Hono();

  // Protected test endpoint
  app.get("/api/test", hybridAuth, (c) => {
    // deno-lint-ignore no-explicit-any
    const authMethod = (c as any).get("authMethod");
    // deno-lint-ignore no-explicit-any
    const apiKeyGroup = (c as any).get("apiKeyGroup");
    return c.json({
      success: true,
      authMethod,
      apiKeyGroup,
    });
  });

  return app;
}

/**
 * Creates a mock Auth object for testing scenarios without valid sessions.
 * Used for tests that verify API key authentication when no session exists.
 */
function createMockAuth(options: { authenticated: boolean } = { authenticated: true }): Auth {
  return {
    api: {
      getSession: () => {
        if (options.authenticated) {
          return {
            user: {
              id: "test-user",
              email: "test@example.com",
              name: "Test User",
              emailVerified: true,
            },
            session: {
              id: "test-session",
              token: "test-token",
              userId: "test-user",
              expiresAt: new Date(Date.now() + 86400000),
            },
          };
        }
        return null;
      },
    },
  } as unknown as Auth;
}

// HybridAuthMiddleware Tests

Deno.test("HybridAuth: rejects request without API key or session", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSettings()  // Need settings service for hybrid auth
    .withApiKeyService()  // Need API key service for hybrid auth middleware
    .build();

  try {
    const auth = createMockAuth({ authenticated: false });
    const app = createTestApp(ctx, auth);

    const res = await app.request("/api/test");
    expect(res.status).toBe(401);

    const json = await res.json();
    expect(json.error).toBe("Unauthorized");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("HybridAuth: accepts valid session without API key", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSettings()  // Need settings service for hybrid auth
    .withApiKeyService()  // Need API key service for hybrid auth middleware
    .build();

  try {
    const auth = createMockAuth({ authenticated: true });
    const app = createTestApp(ctx, auth);

    const res = await app.request("/api/test");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.authMethod).toBe("session");
    expect(json.apiKeyGroup).toBeUndefined();
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("HybridAuth: rejects API key when no access groups configured", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSettings()  // Required for auth middleware and API access groups
    .withApiKeyGroup("test-group", "Test Group")
    .withApiKey("test-group", "test-key-123", "test-key")
    .build();

  try {
    const auth = createMockAuth({ authenticated: false });
    const app = createTestApp(ctx, auth);

    const res = await app.request("/api/test", {
      headers: {
        "X-API-Key": "test-key-123",
      },
    });

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Unauthorized");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("HybridAuth: rejects API key from non-allowed group", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSettings()  // Required for auth middleware and API access groups
    .withApiKeyGroup("allowed-group", "Allowed")
    .withApiKeyGroup("forbidden-group", "Forbidden")
    .withApiKey("allowed-group", "allowed-key-value", "allowed-key")
    .withApiKey("forbidden-group", "forbidden-key-value", "forbidden-key")
    .build();

  try {
    // Get the allowed group ID and configure it as the only allowed group
    const allowedGroup = await ctx.apiKeyService.getGroupByName("allowed-group");
    if (!allowedGroup) throw new Error("allowed-group not found");

    await ctx.settingsService.setGlobalSetting(
      SettingNames.API_ACCESS_GROUPS,
      String(allowedGroup.id)
    );

    const auth = createMockAuth({ authenticated: false });
    const app = createTestApp(ctx, auth);

    // Try to use key from forbidden group
    const res = await app.request("/api/test", {
      headers: {
        "X-API-Key": "forbidden-key-value",
      },
    });

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Unauthorized");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("HybridAuth: accepts API key from single allowed group", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSettings()  // Required for auth middleware and API access groups
    .withApiKeyGroup("management", "Management keys")
    .withApiKey("management", "mgmt-key-123", "mgmt-key")
    .build();

  try {
    // Configure the management group as allowed
    const mgmtGroup = await ctx.apiKeyService.getGroupByName("management");
    if (!mgmtGroup) throw new Error("management group not found");

    await ctx.settingsService.setGlobalSetting(
      SettingNames.API_ACCESS_GROUPS,
      String(mgmtGroup.id)
    );

    const auth = createMockAuth({ authenticated: false });
    const app = createTestApp(ctx, auth);

    const res = await app.request("/api/test", {
      headers: {
        "X-API-Key": "mgmt-key-123",
      },
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.authMethod).toBe("api-key");
    expect(json.apiKeyGroup).toBe("management");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("HybridAuth: accepts API key from multiple allowed groups (first group)", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSettings()  // Required for auth middleware and API access groups
    .withApiKeyGroup("admin", "Admin keys")
    .withApiKeyGroup("service", "Service keys")
    .withApiKey("admin", "admin-key-value", "admin-key")
    .withApiKey("service", "service-key-value", "service-key")
    .build();

  try {
    // Get both group IDs
    const adminGroup = await ctx.apiKeyService.getGroupByName("admin");
    const serviceGroup = await ctx.apiKeyService.getGroupByName("service");
    if (!adminGroup || !serviceGroup) throw new Error("Groups not found");

    // Configure both groups (comma-separated IDs)
    await ctx.settingsService.setGlobalSetting(
      SettingNames.API_ACCESS_GROUPS,
      `${adminGroup.id},${serviceGroup.id}`
    );

    const auth = createMockAuth({ authenticated: false });
    const app = createTestApp(ctx, auth);

    // Test key from first group
    const res = await app.request("/api/test", {
      headers: {
        "X-API-Key": "admin-key-value",
      },
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.authMethod).toBe("api-key");
    expect(json.apiKeyGroup).toBe("admin");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("HybridAuth: accepts API key from multiple allowed groups (second group)", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSettings()  // Required for auth middleware and API access groups
    .withApiKeyGroup("admin", "Admin keys")
    .withApiKeyGroup("service", "Service keys")
    .withApiKey("admin", "admin-key-value", "admin-key")
    .withApiKey("service", "service-key-value", "service-key")
    .build();

  try {
    // Get both group IDs
    const adminGroup = await ctx.apiKeyService.getGroupByName("admin");
    const serviceGroup = await ctx.apiKeyService.getGroupByName("service");
    if (!adminGroup || !serviceGroup) throw new Error("Groups not found");

    // Configure both groups (comma-separated IDs)
    await ctx.settingsService.setGlobalSetting(
      SettingNames.API_ACCESS_GROUPS,
      `${adminGroup.id},${serviceGroup.id}`
    );

    const auth = createMockAuth({ authenticated: false });
    const app = createTestApp(ctx, auth);

    // Test key from second group
    const res = await app.request("/api/test", {
      headers: {
        "X-API-Key": "service-key-value",
      },
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.authMethod).toBe("api-key");
    expect(json.apiKeyGroup).toBe("service");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("HybridAuth: rejects invalid API key even when access groups configured", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSettings()  // Required for auth middleware and API access groups
    .withApiKeyGroup("management", "Management")
    .withApiKey("management", "valid-key-value", "valid-key")
    .build();

  try {
    const mgmtGroup = await ctx.apiKeyService.getGroupByName("management");
    if (!mgmtGroup) throw new Error("management group not found");

    await ctx.settingsService.setGlobalSetting(
      SettingNames.API_ACCESS_GROUPS,
      String(mgmtGroup.id)
    );

    const auth = createMockAuth({ authenticated: false });
    const app = createTestApp(ctx, auth);

    const res = await app.request("/api/test", {
      headers: {
        "X-API-Key": "invalid-key-xyz",
      },
    });

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Unauthorized");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("HybridAuth: handles malformed access groups setting gracefully", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSettings()  // Required for auth middleware and API access groups
    .withApiKeyGroup("test", "Test Group")
    .withApiKey("test", "test-key-value", "test-key")
    .build();

  try {
    // Set malformed setting (non-numeric values)
    await ctx.settingsService.setGlobalSetting(
      SettingNames.API_ACCESS_GROUPS,
      "abc,xyz,123invalid"
    );

    const auth = createMockAuth({ authenticated: false });
    const app = createTestApp(ctx, auth);

    const res = await app.request("/api/test", {
      headers: {
        "X-API-Key": "test-key-value",
      },
    });

    // Should reject because no valid group IDs could be parsed
    expect(res.status).toBe(401);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("HybridAuth: handles empty access groups setting", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSettings()  // Required for auth middleware and API access groups
    .withApiKeyGroup("test", "Test Group")
    .withApiKey("test", "test-key-value", "test-key")
    .build();

  try {
    await ctx.settingsService.setGlobalSetting(SettingNames.API_ACCESS_GROUPS, "");

    const auth = createMockAuth({ authenticated: false });
    const app = createTestApp(ctx, auth);

    const res = await app.request("/api/test", {
      headers: {
        "X-API-Key": "test-key-value",
      },
    });

    // Should reject because no groups are allowed
    expect(res.status).toBe(401);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("HybridAuth: prioritizes session over API key when both present", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSettings()  // Required for auth middleware and API access groups
    .withApiKeyGroup("management", "Management")
    .withApiKey("management", "test-key-value", "test-key")
    .build();

  try {
    const mgmtGroup = await ctx.apiKeyService.getGroupByName("management");
    if (!mgmtGroup) throw new Error("management group not found");

    await ctx.settingsService.setGlobalSetting(
      SettingNames.API_ACCESS_GROUPS,
      String(mgmtGroup.id)
    );

    const auth = createMockAuth({ authenticated: true });
    const app = createTestApp(ctx, auth);

    const res = await app.request("/api/test", {
      headers: {
        "X-API-Key": "test-key-value",
      },
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.authMethod).toBe("session"); // Session should be preferred
    expect(json.apiKeyGroup).toBeUndefined();
  } finally {
    await ctx.cleanup();
  }
});
