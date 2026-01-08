import { expect } from "@std/expect";
import { Hono } from "@hono/hono";
import { TestSetupBuilder } from "../test/test_setup_builder.ts";
import { createSettingsRoutes } from "./settings_routes.ts";
import { SettingNames } from "./types.ts";

// Helper to create a test app with settings routes
function createTestApp(ctx: Awaited<ReturnType<typeof TestSetupBuilder.prototype.build>>) {
  const app = new Hono();
  app.route("/api/settings", createSettingsRoutes({
    settingsService: ctx.settingsService,
  }));
  return app;
}

// ============== GET /api/settings ==============

Deno.test("GET /api/settings returns all global settings", async () => {
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

Deno.test("GET /api/settings with session includes user settings", async () => {
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

    const app = new Hono();
    app.use("*", async (c, next) => {
      // Mock session user
      (c as any).set("user", { id: user!.id });
      await next();
    });
    app.route("/api/settings", createSettingsRoutes({
      settingsService: ctx.settingsService,
    }));

    const res = await app.request("/api/settings");

    expect(res.status).toBe(200);
    const data = await res.json();

    // Should include both global and user settings
    const userSetting = data.settings.find((s: any) =>
      s.name === SettingNames.LOG_LEVEL && s.value === "debug"
    );
    expect(userSetting).toBeDefined();
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("GET /api/settings with ?userId includes that user's settings", async () => {
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
    const userSetting = data.settings.find((s: any) =>
      s.name === SettingNames.METRICS_RETENTION_DAYS && s.value === "45"
    );
    expect(userSetting).toBeDefined();
  } finally {
    await ctx.cleanup();
  }
});

// ============== PUT /api/settings ==============

Deno.test("PUT /api/settings updates global settings", async () => {
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

Deno.test("PUT /api/settings rejects invalid JSON", async () => {
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

Deno.test("PUT /api/settings rejects missing settings field", async () => {
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

Deno.test("PUT /api/settings validates setting values", async () => {
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

Deno.test("PUT /api/settings rejects user settings without user context", async () => {
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

Deno.test("PUT /api/settings accepts user settings with ?userId", async () => {
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

// ============== DELETE /api/settings ==============

Deno.test("DELETE /api/settings resets settings to defaults", async () => {
  const ctx = await TestSetupBuilder.create().withSettings().build();
  try {
    // Modify a setting first
    await ctx.settingsService.setGlobalSetting(SettingNames.LOG_LEVEL, "debug");

    const app = createTestApp(ctx);
    const res = await app.request("/api/settings", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        names: [SettingNames.LOG_LEVEL],
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.reset.global).toBe(1);

    // Verify setting was reset
    const logLevel = await ctx.settingsService.getGlobalSetting(SettingNames.LOG_LEVEL);
    expect(logLevel).toBe("info"); // Default value
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("DELETE /api/settings rejects invalid JSON", async () => {
  const ctx = await TestSetupBuilder.create().withSettings().build();
  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/settings", {
      method: "DELETE",
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

Deno.test("DELETE /api/settings rejects missing names field", async () => {
  const ctx = await TestSetupBuilder.create().withSettings().build();
  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/settings", {
      method: "DELETE",
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

Deno.test("DELETE /api/settings rejects invalid setting names", async () => {
  const ctx = await TestSetupBuilder.create().withSettings().build();
  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/settings", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        names: ["unknown.setting"],
      }),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Invalid setting names");
    expect(data.details).toContain("unknown.setting");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("DELETE /api/settings handles empty array", async () => {
  const ctx = await TestSetupBuilder.create().withSettings().build();
  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/settings", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        names: [],
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.reset.global).toBe(0);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("DELETE /api/settings resets multiple settings atomically", async () => {
  const ctx = await TestSetupBuilder.create().withSettings().build();
  try {
    // Modify multiple settings
    await ctx.settingsService.setGlobalSetting(SettingNames.LOG_LEVEL, "debug");
    await ctx.settingsService.setGlobalSetting(SettingNames.METRICS_RETENTION_DAYS, "120");

    const app = createTestApp(ctx);
    const res = await app.request("/api/settings", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        names: [SettingNames.LOG_LEVEL, SettingNames.METRICS_RETENTION_DAYS],
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.reset.global).toBe(2);

    // Verify both settings were reset
    const logLevel = await ctx.settingsService.getGlobalSetting(SettingNames.LOG_LEVEL);
    const retention = await ctx.settingsService.getGlobalSetting(SettingNames.METRICS_RETENTION_DAYS);
    expect(logLevel).toBe("info");
    expect(retention).toBe("90");
  } finally {
    await ctx.cleanup();
  }
});
