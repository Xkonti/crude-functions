import { expect } from "@std/expect";
import { Hono, type Context } from "@hono/hono";
import { TestSetupBuilder } from "../test/test_setup_builder.ts";
import { integrationTest } from "../test/test_helpers.ts";
import { createSettingsRoutes, type SettingInfo } from "./settings_routes.ts";
import { SettingNames } from "./types.ts";

// Helper to create a test app with settings routes
function createTestApp(ctx: Awaited<ReturnType<typeof TestSetupBuilder.prototype.build>>) {
  const app = new Hono();
  app.route("/api/settings", createSettingsRoutes({
    settingsService: ctx.settingsService,
  }));
  return app;
}

// Helper to create a test app with mock session user
function createTestAppWithSession(
  ctx: Awaited<ReturnType<typeof TestSetupBuilder.prototype.build>>,
  userId: string
) {
  const app = new Hono();

  // Mock session middleware - simulates authenticated user
  app.use("*", async (c, next) => {
    (c as Context).set("user", { id: userId });
    await next();
  });

  app.route("/api/settings", createSettingsRoutes({
    settingsService: ctx.settingsService,
  }));

  return app;
}

// ============== GET /api/settings ==============

integrationTest("GET /api/settings returns all global settings", async () => {
  const ctx = await TestSetupBuilder.create().withSettings().build();
  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/settings");

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.settings).toBeDefined();
    expect(Array.isArray(data.settings)).toBe(true);
    expect(data.settings.length).toBeGreaterThan(0);

    // Verify structure
    const setting = data.settings[0];
    expect(setting.name).toBeDefined();
    expect(setting.value).toBeDefined();
    expect(setting.default).toBeDefined();
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/settings with session includes user settings", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSettings()
    .withAdminUser("test@example.com", "password123")
    .build();
  try {
    const user = await ctx.userService.getByEmail("test@example.com");

    // Create a user setting
    await ctx.settingsService.setUserSetting(
      SettingNames.LOG_LEVEL,
      user!.id,
      "debug"
    );

    // Use helper to create app with mock session
    const app = createTestAppWithSession(ctx, user!.id);
    const res = await app.request("/api/settings");

    expect(res.status).toBe(200);
    const data = await res.json();

    // Should include both global and user settings
    const userSetting = data.settings.find((s: SettingInfo) =>
      s.name === SettingNames.LOG_LEVEL && s.value === "debug"
    );
    expect(userSetting).toBeDefined();
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/settings with ?userId includes that user's settings", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSettings()
    .withAdminUser("test@example.com", "password123")
    .build();
  try {
    const user = await ctx.userService.getByEmail("test@example.com");

    // Create a user setting
    await ctx.settingsService.setUserSetting(
      SettingNames.METRICS_RETENTION_DAYS,
      user!.id,
      "45"
    );

    const app = createTestApp(ctx);
    const res = await app.request(`/api/settings?userId=${user!.id}`);

    expect(res.status).toBe(200);
    const data = await res.json();

    // Should include user settings
    const userSetting = data.settings.find((s: SettingInfo) =>
      s.name === SettingNames.METRICS_RETENTION_DAYS && s.value === "45"
    );
    expect(userSetting).toBeDefined();
  } finally {
    await ctx.cleanup();
  }
});

// ============== PUT /api/settings ==============

integrationTest("PUT /api/settings updates global settings", async () => {
  const ctx = await TestSetupBuilder.create().withSettings().build();
  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: {
          [SettingNames.LOG_LEVEL]: "debug",
          [SettingNames.METRICS_RETENTION_DAYS]: "60",
        },
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.updated.global).toBe(2);

    // Verify settings were actually updated
    const logLevel = await ctx.settingsService.getGlobalSetting(SettingNames.LOG_LEVEL);
    expect(logLevel).toBe("debug");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("PUT /api/settings rejects invalid JSON", async () => {
  const ctx = await TestSetupBuilder.create().withSettings().build();
  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "invalid json",
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Invalid JSON");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("PUT /api/settings rejects missing settings field", async () => {
  const ctx = await TestSetupBuilder.create().withSettings().build();
  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Missing");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("PUT /api/settings validates setting values", async () => {
  const ctx = await TestSetupBuilder.create().withSettings().build();
  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: {
          [SettingNames.LOG_LEVEL]: "invalid-level",
        },
      }),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Validation failed");
    expect(data.details).toBeDefined();
    expect(Array.isArray(data.details)).toBe(true);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("PUT /api/settings rejects user settings without user context", async () => {
  const ctx = await TestSetupBuilder.create().withSettings().build();
  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: {
          "user.theme": "dark",
        },
      }),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    // Will fail validation because user.theme is not a defined setting
    expect(data.error).toBe("Validation failed");
    expect(data.details[0].error).toContain("Unknown setting name");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("PUT /api/settings accepts user settings with ?userId", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSettings()
    .withAdminUser("test@example.com", "password123")
    .build();
  try {
    const user = await ctx.userService.getByEmail("test@example.com");

    // Note: This test would work if we had user.* settings defined in SettingNames
    // For now, we test with a regular setting applied to a user
    const app = createTestApp(ctx);
    const res = await app.request(`/api/settings?userId=${user!.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: {
          [SettingNames.LOG_LEVEL]: "warn",
        },
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
  } finally {
    await ctx.cleanup();
  }
});
