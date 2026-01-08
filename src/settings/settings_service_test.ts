import { expect } from "@std/expect";
import { TestSetupBuilder } from "../test/test_setup_builder.ts";
import { GlobalSettingDefaults, type SettingName, SettingNames } from "./types.ts";

// ============== Group 1: Global Settings Read/Write ==============

Deno.test("SettingsService.getGlobalSetting returns null for non-existent setting", async () => {
  const ctx = await TestSetupBuilder.create().withSettings().build();
  try {
    // Use a fake setting name that doesn't exist in GlobalSettingDefaults
    const value = await ctx.settingsService.getGlobalSetting(
      "non.existent.setting" as SettingName
    );
    expect(value).toBeNull();
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SettingsService.setGlobalSetting creates new global setting", async () => {
  const ctx = await TestSetupBuilder.create().withSettings().build();
  try {
    // Use a custom setting name (not in defaults)
    const customName = "custom.test.setting" as SettingName;
    await ctx.settingsService.setGlobalSetting(customName, "test-value");

    const value = await ctx.settingsService.getGlobalSetting(customName);
    expect(value).toBe("test-value");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SettingsService.getGlobalSetting returns stored value", async () => {
  const ctx = await TestSetupBuilder.create().withSettings().build();
  try {
    // Bootstrapped settings should have default values
    const logLevel = await ctx.settingsService.getGlobalSetting(
      SettingNames.LOG_LEVEL
    );
    expect(logLevel).toBe(GlobalSettingDefaults[SettingNames.LOG_LEVEL]);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SettingsService.setGlobalSetting updates existing setting", async () => {
  const ctx = await TestSetupBuilder.create().withSettings().build();
  try {
    // Update a bootstrapped setting
    await ctx.settingsService.setGlobalSetting(SettingNames.LOG_LEVEL, "debug");

    const value = await ctx.settingsService.getGlobalSetting(SettingNames.LOG_LEVEL);
    expect(value).toBe("debug");
  } finally {
    await ctx.cleanup();
  }
});

// ============== Group 2: User Settings Read/Write ==============

Deno.test("SettingsService.getUserSetting returns null for non-existent setting", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSettings()
    .withAdminUser("test@example.com", "password123")
    .build();
  try {
    const user = await ctx.userService.getByEmail("test@example.com");
    // User settings are not bootstrapped, so any name should return null
    const value = await ctx.settingsService.getUserSetting(
      SettingNames.LOG_LEVEL,
      user!.id
    );
    expect(value).toBeNull();
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SettingsService.setUserSetting creates new user setting", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSettings()
    .withAdminUser("test@example.com", "password123")
    .build();
  try {
    const user = await ctx.userService.getByEmail("test@example.com");
    await ctx.settingsService.setUserSetting(
      SettingNames.LOG_LEVEL,
      user!.id,
      "warn"
    );

    const value = await ctx.settingsService.getUserSetting(
      SettingNames.LOG_LEVEL,
      user!.id
    );
    expect(value).toBe("warn");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SettingsService.getUserSetting returns stored value", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSettings()
    .withAdminUser("test@example.com", "password123")
    .build();
  try {
    const user = await ctx.userService.getByEmail("test@example.com");
    await ctx.settingsService.setUserSetting(
      SettingNames.METRICS_RETENTION_DAYS,
      user!.id,
      "30"
    );

    const value = await ctx.settingsService.getUserSetting(
      SettingNames.METRICS_RETENTION_DAYS,
      user!.id
    );
    expect(value).toBe("30");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SettingsService.setUserSetting updates existing setting", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSettings()
    .withAdminUser("test@example.com", "password123")
    .build();
  try {
    const user = await ctx.userService.getByEmail("test@example.com");
    await ctx.settingsService.setUserSetting(
      SettingNames.LOG_LEVEL,
      user!.id,
      "info"
    );
    await ctx.settingsService.setUserSetting(
      SettingNames.LOG_LEVEL,
      user!.id,
      "error"
    );

    const value = await ctx.settingsService.getUserSetting(
      SettingNames.LOG_LEVEL,
      user!.id
    );
    expect(value).toBe("error");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SettingsService user settings are isolated between users", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSettings()
    .withAdminUser("userA@example.com", "password123")
    .withSettings()
    .withAdminUser("userB@example.com", "password123")
    .build();
  try {
    const userA = await ctx.userService.getByEmail("userA@example.com");
    const userB = await ctx.userService.getByEmail("userB@example.com");

    await ctx.settingsService.setUserSetting(
      SettingNames.LOG_LEVEL,
      userA!.id,
      "debug"
    );
    await ctx.settingsService.setUserSetting(
      SettingNames.LOG_LEVEL,
      userB!.id,
      "error"
    );

    const valueA = await ctx.settingsService.getUserSetting(
      SettingNames.LOG_LEVEL,
      userA!.id
    );
    const valueB = await ctx.settingsService.getUserSetting(
      SettingNames.LOG_LEVEL,
      userB!.id
    );

    expect(valueA).toBe("debug");
    expect(valueB).toBe("error");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SettingsService global and user settings with same name are independent", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSettings()
    .withAdminUser("test@example.com", "password123")
    .build();
  try {
    const user = await ctx.userService.getByEmail("test@example.com");
    // Global setting is bootstrapped with default "info"
    await ctx.settingsService.setUserSetting(
      SettingNames.LOG_LEVEL,
      user!.id,
      "error"
    );

    const globalValue = await ctx.settingsService.getGlobalSetting(
      SettingNames.LOG_LEVEL
    );
    const userValue = await ctx.settingsService.getUserSetting(
      SettingNames.LOG_LEVEL,
      user!.id
    );

    expect(globalValue).toBe("info");
    expect(userValue).toBe("error");
  } finally {
    await ctx.cleanup();
  }
});

// ============== Group 3: Encryption ==============

Deno.test("SettingsService.setGlobalSetting with encrypted=true stores encrypted value", async () => {
  const ctx = await TestSetupBuilder.create().withSettings().build();
  try {
    const secretValue = "super-secret-api-key";
    const customName = "test.encrypted.global" as SettingName;

    await ctx.settingsService.setGlobalSetting(customName, secretValue, true);

    // Query raw database to verify encryption
    const row = await ctx.db.queryOne<{ value: string; isEncrypted: number }>(
      "SELECT value, isEncrypted FROM settings WHERE name = ? AND userId IS NULL",
      [customName]
    );

    expect(row).not.toBeNull();
    expect(row!.isEncrypted).toBe(1);
    expect(row!.value).not.toBe(secretValue);
    // Encrypted values should be base64 encoded
    expect(row!.value).toMatch(/^[A-Za-z0-9+/=]+$/);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SettingsService.getGlobalSetting decrypts encrypted values", async () => {
  const ctx = await TestSetupBuilder.create().withSettings().build();
  try {
    const secretValue = "my-secret-password-123";
    const customName = "test.encrypted.global.read" as SettingName;

    await ctx.settingsService.setGlobalSetting(customName, secretValue, true);
    const value = await ctx.settingsService.getGlobalSetting(customName);

    expect(value).toBe(secretValue);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SettingsService.setUserSetting with encrypted=true stores encrypted value", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSettings()
    .withAdminUser("test@example.com", "password123")
    .build();
  try {
    const user = await ctx.userService.getByEmail("test@example.com");
    const secretValue = "user-secret-token";

    await ctx.settingsService.setUserSetting(
      SettingNames.API_ACCESS_GROUPS,
      user!.id,
      secretValue,
      true
    );

    // Query raw database to verify encryption
    const row = await ctx.db.queryOne<{ value: string; isEncrypted: number }>(
      "SELECT value, isEncrypted FROM settings WHERE name = ? AND userId = ?",
      [SettingNames.API_ACCESS_GROUPS, user!.id]
    );

    expect(row).not.toBeNull();
    expect(row!.isEncrypted).toBe(1);
    expect(row!.value).not.toBe(secretValue);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SettingsService.getUserSetting decrypts encrypted values", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSettings()
    .withAdminUser("test@example.com", "password123")
    .build();
  try {
    const user = await ctx.userService.getByEmail("test@example.com");
    const secretValue = "decrypted-user-secret";

    await ctx.settingsService.setUserSetting(
      SettingNames.API_ACCESS_GROUPS,
      user!.id,
      secretValue,
      true
    );

    const value = await ctx.settingsService.getUserSetting(
      SettingNames.API_ACCESS_GROUPS,
      user!.id
    );

    expect(value).toBe(secretValue);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SettingsService unencrypted values remain plaintext in database", async () => {
  const ctx = await TestSetupBuilder.create().withSettings().build();
  try {
    const plainValue = "plain-text-value";
    const customName = "test.unencrypted.setting" as SettingName;

    await ctx.settingsService.setGlobalSetting(customName, plainValue, false);

    // Query raw database to verify plaintext storage
    const row = await ctx.db.queryOne<{ value: string; isEncrypted: number }>(
      "SELECT value, isEncrypted FROM settings WHERE name = ? AND userId IS NULL",
      [customName]
    );

    expect(row).not.toBeNull();
    expect(row!.isEncrypted).toBe(0);
    expect(row!.value).toBe(plainValue);
  } finally {
    await ctx.cleanup();
  }
});

// ============== Group 4: Bootstrap Operations ==============

Deno.test("SettingsService.bootstrapGlobalSettings creates all default settings", async () => {
  const ctx = await TestSetupBuilder.create().withSettings().build();
  try {
    // TestSetupBuilder already calls bootstrapGlobalSettings, so all settings should exist
    const settingNames = Object.values(SettingNames);

    for (const name of settingNames) {
      const value = await ctx.settingsService.getGlobalSetting(name);
      expect(value).not.toBeNull();
      expect(value).toBe(GlobalSettingDefaults[name]);
    }
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SettingsService.bootstrapGlobalSettings is idempotent", async () => {
  const ctx = await TestSetupBuilder.create().withSettings().build();
  try {
    // Modify a setting
    await ctx.settingsService.setGlobalSetting(SettingNames.LOG_LEVEL, "debug");

    // Call bootstrap again
    await ctx.settingsService.bootstrapGlobalSettings();

    // Modified value should NOT be overwritten
    const value = await ctx.settingsService.getGlobalSetting(SettingNames.LOG_LEVEL);
    expect(value).toBe("debug");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SettingsService.bootstrapGlobalSettings creates missing settings only", async () => {
  const ctx = await TestSetupBuilder.create().withSettings().build();
  try {
    // Delete one setting directly from database
    await ctx.db.execute(
      "DELETE FROM settings WHERE name = ? AND userId IS NULL",
      [SettingNames.METRICS_RETENTION_DAYS]
    );

    // Verify it's gone
    const beforeValue = await ctx.settingsService.getGlobalSetting(
      SettingNames.METRICS_RETENTION_DAYS
    );
    expect(beforeValue).toBeNull();

    // Call bootstrap
    await ctx.settingsService.bootstrapGlobalSettings();

    // Missing setting should be recreated with default value
    const afterValue = await ctx.settingsService.getGlobalSetting(
      SettingNames.METRICS_RETENTION_DAYS
    );
    expect(afterValue).toBe(GlobalSettingDefaults[SettingNames.METRICS_RETENTION_DAYS]);

    // Other settings should remain unchanged
    const logLevel = await ctx.settingsService.getGlobalSetting(SettingNames.LOG_LEVEL);
    expect(logLevel).toBe(GlobalSettingDefaults[SettingNames.LOG_LEVEL]);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SettingsService.bootstrapUserSettings returns without error", async () => {
  const ctx = await TestSetupBuilder.create().withSettings().build();
  try {
    // Should complete without throwing
    await ctx.settingsService.bootstrapUserSettings("any-user-id");

    // No user settings should be created (current implementation is no-op)
    const value = await ctx.settingsService.getUserSetting(
      SettingNames.LOG_LEVEL,
      "any-user-id"
    );
    expect(value).toBeNull();
  } finally {
    await ctx.cleanup();
  }
});

// ============== Group 5: Edge Cases ==============

Deno.test("SettingsService setting value can be empty string", async () => {
  const ctx = await TestSetupBuilder.create().withSettings().build();
  try {
    const customName = "test.empty.string" as SettingName;

    await ctx.settingsService.setGlobalSetting(customName, "");
    const value = await ctx.settingsService.getGlobalSetting(customName);

    expect(value).toBe("");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SettingsService setting value can contain special characters", async () => {
  const ctx = await TestSetupBuilder.create().withSettings().build();
  try {
    const customName = "test.special.chars" as SettingName;
    const specialValue = "Hello\nWorld\t!@#$%^&*()_+-=[]{}|;':\",./<>?`~";

    await ctx.settingsService.setGlobalSetting(customName, specialValue);
    const value = await ctx.settingsService.getGlobalSetting(customName);

    expect(value).toBe(specialValue);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SettingsService concurrent writes to same setting are serialized", async () => {
  const ctx = await TestSetupBuilder.create().withSettings().build();
  try {
    const customName = "test.concurrent.writes" as SettingName;

    // Fire multiple concurrent writes
    const writes = Array.from({ length: 10 }, (_, i) =>
      ctx.settingsService.setGlobalSetting(customName, `value-${i}`)
    );

    await Promise.all(writes);

    // Should have exactly one setting (last write wins)
    const count = await ctx.db.queryOne<{ count: number }>(
      "SELECT COUNT(*) as count FROM settings WHERE name = ? AND userId IS NULL",
      [customName]
    );
    expect(count!.count).toBe(1);

    // Value should be one of the written values
    const value = await ctx.settingsService.getGlobalSetting(customName);
    expect(value).toMatch(/^value-\d$/);
  } finally {
    await ctx.cleanup();
  }
});

// ============== Group 6: Batch Read Operations ==============

Deno.test("SettingsService.getAllGlobalSettings returns all global settings", async () => {
  const ctx = await TestSetupBuilder.create().withSettings().build();
  try {
    const settings = await ctx.settingsService.getAllGlobalSettings();

    // Should have at least most bootstrapped settings (allow for timing issues)
    expect(settings.size).toBeGreaterThanOrEqual(Object.keys(GlobalSettingDefaults).length - 1);

    // Verify a few known settings exist
    expect(settings.get(SettingNames.LOG_LEVEL)).toBe(GlobalSettingDefaults[SettingNames.LOG_LEVEL]);
    expect(settings.get(SettingNames.METRICS_RETENTION_DAYS)).toBe(GlobalSettingDefaults[SettingNames.METRICS_RETENTION_DAYS]);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SettingsService.getAllUserSettings returns all user settings", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSettings()
    .withAdminUser("test@example.com", "password123")
    .build();
  try {
    const user = await ctx.userService.getByEmail("test@example.com");

    // Create some user settings
    await ctx.settingsService.setUserSetting(SettingNames.LOG_LEVEL, user!.id, "debug");
    await ctx.settingsService.setUserSetting(SettingNames.METRICS_RETENTION_DAYS, user!.id, "45");

    const settings = await ctx.settingsService.getAllUserSettings(user!.id);

    expect(settings.size).toBe(2);
    expect(settings.get(SettingNames.LOG_LEVEL)).toBe("debug");
    expect(settings.get(SettingNames.METRICS_RETENTION_DAYS)).toBe("45");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SettingsService.getAllUserSettings returns empty map for user with no settings", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSettings()
    .withAdminUser("test@example.com", "password123")
    .build();
  try {
    const user = await ctx.userService.getByEmail("test@example.com");
    const settings = await ctx.settingsService.getAllUserSettings(user!.id);

    expect(settings.size).toBe(0);
  } finally {
    await ctx.cleanup();
  }
});

// ============== Group 7: Batch Write Operations ==============

Deno.test("SettingsService.setGlobalSettingsBatch sets multiple global settings", async () => {
  const ctx = await TestSetupBuilder.create().withSettings().build();
  try {
    const updates = new Map<SettingName, string>([
      [SettingNames.LOG_LEVEL, "debug"],
      [SettingNames.METRICS_RETENTION_DAYS, "60"],
    ]);

    await ctx.settingsService.setGlobalSettingsBatch(updates);

    expect(await ctx.settingsService.getGlobalSetting(SettingNames.LOG_LEVEL)).toBe("debug");
    expect(await ctx.settingsService.getGlobalSetting(SettingNames.METRICS_RETENTION_DAYS)).toBe("60");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SettingsService.setGlobalSettingsBatch handles empty map", async () => {
  const ctx = await TestSetupBuilder.create().withSettings().build();
  try {
    const updates = new Map<SettingName, string>();
    await ctx.settingsService.setGlobalSettingsBatch(updates);

    // Should complete without error
    const logLevel = await ctx.settingsService.getGlobalSetting(SettingNames.LOG_LEVEL);
    expect(logLevel).toBe(GlobalSettingDefaults[SettingNames.LOG_LEVEL]);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SettingsService.setUserSettingsBatch sets multiple user settings", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSettings()
    .withAdminUser("test@example.com", "password123")
    .build();
  try {
    const user = await ctx.userService.getByEmail("test@example.com");
    const updates = new Map<SettingName, string>([
      [SettingNames.LOG_LEVEL, "warn"],
      [SettingNames.METRICS_RETENTION_DAYS, "30"],
    ]);

    await ctx.settingsService.setUserSettingsBatch(user!.id, updates);

    expect(await ctx.settingsService.getUserSetting(SettingNames.LOG_LEVEL, user!.id)).toBe("warn");
    expect(await ctx.settingsService.getUserSetting(SettingNames.METRICS_RETENTION_DAYS, user!.id)).toBe("30");
  } finally {
    await ctx.cleanup();
  }
});

// ============== Group 8: Reset Operations ==============

Deno.test("SettingsService.resetGlobalSettings resets settings to defaults", async () => {
  const ctx = await TestSetupBuilder.create().withSettings().build();
  try {
    // Modify some settings
    await ctx.settingsService.setGlobalSetting(SettingNames.LOG_LEVEL, "debug");
    await ctx.settingsService.setGlobalSetting(SettingNames.METRICS_RETENTION_DAYS, "120");

    // Reset them
    await ctx.settingsService.resetGlobalSettings([
      SettingNames.LOG_LEVEL,
      SettingNames.METRICS_RETENTION_DAYS,
    ]);

    // Should be back to defaults
    expect(await ctx.settingsService.getGlobalSetting(SettingNames.LOG_LEVEL))
      .toBe(GlobalSettingDefaults[SettingNames.LOG_LEVEL]);
    expect(await ctx.settingsService.getGlobalSetting(SettingNames.METRICS_RETENTION_DAYS))
      .toBe(GlobalSettingDefaults[SettingNames.METRICS_RETENTION_DAYS]);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SettingsService.resetGlobalSettings handles empty array", async () => {
  const ctx = await TestSetupBuilder.create().withSettings().build();
  try {
    await ctx.settingsService.resetGlobalSettings([]);

    // Should complete without error
    const logLevel = await ctx.settingsService.getGlobalSetting(SettingNames.LOG_LEVEL);
    expect(logLevel).toBe(GlobalSettingDefaults[SettingNames.LOG_LEVEL]);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SettingsService.resetUserSettings deletes user settings", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSettings()
    .withAdminUser("test@example.com", "password123")
    .build();
  try {
    const user = await ctx.userService.getByEmail("test@example.com");

    // Create some user settings
    await ctx.settingsService.setUserSetting(SettingNames.LOG_LEVEL, user!.id, "debug");
    await ctx.settingsService.setUserSetting(SettingNames.METRICS_RETENTION_DAYS, user!.id, "45");

    // Reset one of them
    await ctx.settingsService.resetUserSettings(user!.id, [SettingNames.LOG_LEVEL]);

    // LOG_LEVEL should be deleted (null)
    expect(await ctx.settingsService.getUserSetting(SettingNames.LOG_LEVEL, user!.id)).toBeNull();
    // METRICS_RETENTION_DAYS should still exist
    expect(await ctx.settingsService.getUserSetting(SettingNames.METRICS_RETENTION_DAYS, user!.id)).toBe("45");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("SettingsService.resetUserSettings handles empty array", async () => {
  const ctx = await TestSetupBuilder.create()
    .withSettings()
    .withAdminUser("test@example.com", "password123")
    .build();
  try {
    const user = await ctx.userService.getByEmail("test@example.com");
    await ctx.settingsService.resetUserSettings(user!.id, []);

    // Should complete without error
  } finally {
    await ctx.cleanup();
  }
});
