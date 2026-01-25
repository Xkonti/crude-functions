import { expect } from "@std/expect";
import { Hono } from "@hono/hono";
import { TestSetupBuilder } from "../test/test_setup_builder.ts";
import { integrationTest } from "../test/test_helpers.ts";
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
    expect(data.updated).toBe(2);

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

integrationTest("PUT /api/settings rejects unknown setting names", async () => {
  const ctx = await TestSetupBuilder.create().withSettings().build();
  try {
    const app = createTestApp(ctx);
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: {
          "unknown.setting": "value",
        },
      }),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Validation failed");
    expect(data.details[0].error).toContain("Unknown setting name");
  } finally {
    await ctx.cleanup();
  }
});
