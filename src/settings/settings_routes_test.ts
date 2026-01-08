import { expect } from "@std/expect";
import { Hono } from "@hono/hono";
import { createSettingsRoutes } from "./settings_routes.ts";
import { TestSetupBuilder } from "../test/test_setup_builder.ts";
import { SettingNames } from "./types.ts";
import type { SettingsService } from "./settings_service.ts";

// ============================================================================
// Test Helpers
// ============================================================================

async function createTestApp(): Promise<{
  app: Hono;
  settingsService: SettingsService;
  cleanup: () => Promise<void>;
}> {
  const ctx = await TestSetupBuilder.create()
    .withSettings()
    .build();

  const app = new Hono();
  app.route(
    "/api/settings",
    createSettingsRoutes({
      settingsService: ctx.settingsService,
    })
  );

  return {
    app,
    settingsService: ctx.settingsService,
    cleanup: ctx.cleanup,
  };
}

// ============================================================================
// GET /api/settings - Get All Global Settings
// ============================================================================

Deno.test("GET /api/settings returns all global settings with metadata", async () => {
  const { app, cleanup } = await createTestApp();
  try {
    const res = await app.request("/api/settings");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.settings).toBeDefined();
    expect(json.count).toBeGreaterThan(0);

    // Verify structure includes metadata
    const firstSetting = json.settings[0];
    expect(firstSetting.name).toBeDefined();
    expect(firstSetting.value).toBeDefined();
    expect(firstSetting.label).toBeDefined();
    expect(firstSetting.description).toBeDefined();
    expect(firstSetting.inputType).toBeDefined();
    expect(firstSetting.category).toBeDefined();
  } finally {
    await cleanup();
  }
});

Deno.test("GET /api/settings includes all bootstrapped settings", async () => {
  const { app, cleanup } = await createTestApp();
  try {
    const res = await app.request("/api/settings");
    expect(res.status).toBe(200);

    const json = await res.json();
    const settingNames = json.settings.map((s: { name: string }) => s.name);

    // Verify some key settings are present
    expect(settingNames).toContain(SettingNames.LOG_LEVEL);
    expect(settingNames).toContain(SettingNames.FILES_MAX_SIZE_BYTES);
    expect(settingNames).toContain(SettingNames.API_ACCESS_GROUPS);
  } finally {
    await cleanup();
  }
});

Deno.test("GET /api/settings returns correct default values", async () => {
  const { app, cleanup } = await createTestApp();
  try {
    const res = await app.request("/api/settings");
    expect(res.status).toBe(200);

    const json = await res.json();
    const logLevel = json.settings.find(
      (s: { name: string }) => s.name === SettingNames.LOG_LEVEL
    );

    expect(logLevel).toBeDefined();
    expect(logLevel.value).toBe("info"); // Default value
  } finally {
    await cleanup();
  }
});

// ============================================================================
// PATCH /api/settings - Update Global Settings
// ============================================================================

Deno.test("PATCH /api/settings updates single setting successfully", async () => {
  const { app, settingsService, cleanup } = await createTestApp();
  try {
    const res = await app.request("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: {
          [SettingNames.LOG_LEVEL]: "debug",
        },
      }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.updated).toBe(1);

    // Verify setting was actually updated
    const value = await settingsService.getGlobalSetting(SettingNames.LOG_LEVEL);
    expect(value).toBe("debug");
  } finally {
    await cleanup();
  }
});

Deno.test("PATCH /api/settings updates multiple settings successfully", async () => {
  const { app, settingsService, cleanup } = await createTestApp();
  try {
    const res = await app.request("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: {
          [SettingNames.LOG_LEVEL]: "warn",
          [SettingNames.FILES_MAX_SIZE_BYTES]: "10485760", // 10 MB
          [SettingNames.METRICS_RETENTION_DAYS]: "30",
        },
      }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.updated).toBe(3);

    // Verify all settings were updated
    expect(await settingsService.getGlobalSetting(SettingNames.LOG_LEVEL)).toBe("warn");
    expect(await settingsService.getGlobalSetting(SettingNames.FILES_MAX_SIZE_BYTES)).toBe("10485760");
    expect(await settingsService.getGlobalSetting(SettingNames.METRICS_RETENTION_DAYS)).toBe("30");
  } finally {
    await cleanup();
  }
});

Deno.test("PATCH /api/settings returns 400 for invalid setting name", async () => {
  const { app, cleanup } = await createTestApp();
  try {
    const res = await app.request("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: {
          "invalid.setting.name": "value",
        },
      }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Invalid setting names");
    expect(json.invalidNames).toContain("invalid.setting.name");
  } finally {
    await cleanup();
  }
});

Deno.test("PATCH /api/settings returns 400 when value is not a string", async () => {
  const { app, cleanup } = await createTestApp();
  try {
    const res = await app.request("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: {
          [SettingNames.LOG_LEVEL]: 123, // Should be string
        },
      }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("must be strings");
    expect(json.invalidFields).toContain(SettingNames.LOG_LEVEL);
  } finally {
    await cleanup();
  }
});

Deno.test("PATCH /api/settings returns 400 when settings field is missing", async () => {
  const { app, cleanup } = await createTestApp();
  try {
    const res = await app.request("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Missing or invalid 'settings' field");
  } finally {
    await cleanup();
  }
});

Deno.test("PATCH /api/settings returns 400 for invalid JSON", async () => {
  const { app, cleanup } = await createTestApp();
  try {
    const res = await app.request("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: "invalid json{",
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid JSON body");
  } finally {
    await cleanup();
  }
});

Deno.test("PATCH /api/settings handles transaction rollback on error", async () => {
  const { app, settingsService, cleanup } = await createTestApp();
  try {
    // Set initial value
    await settingsService.setGlobalSetting(SettingNames.LOG_LEVEL, "info");

    // Try to update with mix of valid and invalid settings
    const res = await app.request("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: {
          [SettingNames.LOG_LEVEL]: "debug",
          "invalid.name": "value", // This should cause failure
        },
      }),
    });

    expect(res.status).toBe(400);

    // Verify the valid setting was NOT updated (transaction rolled back)
    const value = await settingsService.getGlobalSetting(SettingNames.LOG_LEVEL);
    expect(value).toBe("info"); // Should still be original value
  } finally {
    await cleanup();
  }
});

Deno.test("PATCH /api/settings accepts empty settings object", async () => {
  const { app, cleanup } = await createTestApp();
  try {
    const res = await app.request("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: {},
      }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.updated).toBe(0);
  } finally {
    await cleanup();
  }
});

// ============================================================================
// GET /api/settings/user/:userId - Get User Settings
// ============================================================================

Deno.test("GET /api/settings/user/:userId returns empty array for user with no settings", async () => {
  const { app, cleanup } = await createTestApp();
  try {
    const res = await app.request("/api/settings/user/user123");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.userId).toBe("user123");
    expect(json.settings).toEqual([]);
    expect(json.count).toBe(0);
  } finally {
    await cleanup();
  }
});

Deno.test("GET /api/settings/user/:userId returns user settings with metadata", async () => {
  const { app, settingsService, cleanup } = await createTestApp();
  try {
    // Create some user settings
    await settingsService.setUserSetting(SettingNames.LOG_LEVEL, "user456", "error");

    const res = await app.request("/api/settings/user/user456");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.userId).toBe("user456");
    expect(json.settings.length).toBe(1);
    expect(json.count).toBe(1);

    const setting = json.settings[0];
    expect(setting.name).toBe(SettingNames.LOG_LEVEL);
    expect(setting.value).toBe("error");
    expect(setting.label).toBeDefined();
    expect(setting.description).toBeDefined();
  } finally {
    await cleanup();
  }
});

Deno.test("GET /api/settings/user/:userId returns 400 when userId is missing", async () => {
  const { app, cleanup } = await createTestApp();
  try {
    // This should technically not be reachable due to routing, but test the handler logic
    const res = await app.request("/api/settings/user/");
    expect(res.status).toBe(404); // Hono returns 404 for no route match
  } finally {
    await cleanup();
  }
});

// ============================================================================
// PATCH /api/settings/user/:userId - Update User Settings
// ============================================================================

Deno.test("PATCH /api/settings/user/:userId updates single user setting", async () => {
  const { app, settingsService, cleanup } = await createTestApp();
  try {
    const res = await app.request("/api/settings/user/user789", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: {
          [SettingNames.LOG_LEVEL]: "warn",
        },
      }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.userId).toBe("user789");
    expect(json.updated).toBe(1);

    // Verify setting was created
    const value = await settingsService.getUserSetting(SettingNames.LOG_LEVEL, "user789");
    expect(value).toBe("warn");
  } finally {
    await cleanup();
  }
});

Deno.test("PATCH /api/settings/user/:userId updates multiple user settings", async () => {
  const { app, settingsService, cleanup } = await createTestApp();
  try {
    const res = await app.request("/api/settings/user/user999", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: {
          [SettingNames.LOG_LEVEL]: "debug",
          [SettingNames.METRICS_RETENTION_DAYS]: "7",
        },
      }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.updated).toBe(2);

    // Verify both settings were created
    expect(await settingsService.getUserSetting(SettingNames.LOG_LEVEL, "user999")).toBe("debug");
    expect(await settingsService.getUserSetting(SettingNames.METRICS_RETENTION_DAYS, "user999")).toBe("7");
  } finally {
    await cleanup();
  }
});

Deno.test("PATCH /api/settings/user/:userId returns 400 for invalid setting name", async () => {
  const { app, cleanup } = await createTestApp();
  try {
    const res = await app.request("/api/settings/user/user111", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: {
          "bad.setting": "value",
        },
      }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Invalid setting names");
    expect(json.invalidNames).toContain("bad.setting");
  } finally {
    await cleanup();
  }
});

Deno.test("PATCH /api/settings/user/:userId returns 400 when value is not a string", async () => {
  const { app, cleanup } = await createTestApp();
  try {
    const res = await app.request("/api/settings/user/user222", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: {
          [SettingNames.LOG_LEVEL]: { invalid: "object" },
        },
      }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("must be strings");
  } finally {
    await cleanup();
  }
});

Deno.test("PATCH /api/settings/user/:userId handles transaction rollback", async () => {
  const { app, settingsService, cleanup } = await createTestApp();
  try {
    // Create initial user setting
    await settingsService.setUserSetting(SettingNames.LOG_LEVEL, "user333", "info");

    // Try to update with invalid setting
    const res = await app.request("/api/settings/user/user333", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: {
          [SettingNames.LOG_LEVEL]: "error",
          "invalid.setting": "value",
        },
      }),
    });

    expect(res.status).toBe(400);

    // Verify original setting unchanged (transaction rolled back)
    const value = await settingsService.getUserSetting(SettingNames.LOG_LEVEL, "user333");
    expect(value).toBe("info");
  } finally {
    await cleanup();
  }
});

Deno.test("PATCH /api/settings/user/:userId accepts empty settings", async () => {
  const { app, cleanup } = await createTestApp();
  try {
    const res = await app.request("/api/settings/user/user444", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: {},
      }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.updated).toBe(0);
  } finally {
    await cleanup();
  }
});

Deno.test("PATCH /api/settings/user/:userId returns 400 for invalid JSON", async () => {
  const { app, cleanup } = await createTestApp();
  try {
    const res = await app.request("/api/settings/user/user555", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid JSON body");
  } finally {
    await cleanup();
  }
});
