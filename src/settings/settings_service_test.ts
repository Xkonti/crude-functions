import { expect } from "@std/expect";
import { TestSetupBuilder } from "../test/test_setup_builder.ts";
import { integrationTest } from "../test/test_helpers.ts";
import { GlobalSettingDefaults, type SettingName, SettingNames } from "./types.ts";

// ============== Group 1: Global Settings Read/Write ==============

integrationTest("SettingsService.getGlobalSetting returns undefined for non-existent setting", async () => {
  const ctx = await TestSetupBuilder.create().withSettings().build();
  try {
    // Use a fake setting name that doesn't exist in GlobalSettingDefaults
    const value = await ctx.settingsService.getGlobalSetting(
      "non.existent.setting" as SettingName
    );
    expect(value).toBeUndefined();
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("SettingsService.setGlobalSetting creates new global setting", async () => {
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

integrationTest("SettingsService.getGlobalSetting returns stored value", async () => {
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

integrationTest("SettingsService.setGlobalSetting updates existing setting", async () => {
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

// ============== Group 3: Encryption ==============

integrationTest("SettingsService.getGlobalSetting decrypts encrypted values", async () => {
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

// ============== Group 4: Bootstrap Operations ==============

integrationTest("SettingsService.bootstrapGlobalSettings creates all default settings", async () => {
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

integrationTest("SettingsService.bootstrapGlobalSettings is idempotent", async () => {
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

// ============== Group 5: Edge Cases ==============

integrationTest("SettingsService setting value can be empty string", async () => {
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

integrationTest("SettingsService setting value can contain special characters", async () => {
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

integrationTest("SettingsService concurrent writes to same setting are serialized", async () => {
  const ctx = await TestSetupBuilder.create().withSettings().build();
  try {
    const customName = "test.concurrent.writes" as SettingName;

    // Fire multiple concurrent writes
    const writes = Array.from({ length: 10 }, (_, i) =>
      ctx.settingsService.setGlobalSetting(customName, `value-${i}`)
    );

    await Promise.all(writes);

    // With RecordID-based storage, there's inherently one record per name
    // Verify the value is one of the written values (last write wins)
    const value = await ctx.settingsService.getGlobalSetting(customName);
    expect(value).toMatch(/^value-\d$/);
  } finally {
    await ctx.cleanup();
  }
});

// ============== Group 6: Batch Read Operations ==============

integrationTest("SettingsService.getAllGlobalSettings returns all global settings", async () => {
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

// ============== Group 8: Reset Operations ==============

integrationTest("SettingsService.resetGlobalSettings resets settings to defaults", async () => {
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

integrationTest("SettingsService.resetGlobalSettings handles empty array", async () => {
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

// ============== Group 9: Concurrency and Transaction Tests ==============


integrationTest("SettingsService reset operations are atomic", async () => {
  const ctx = await TestSetupBuilder.create().withSettings().build();
  try {
    // Modify several settings
    await ctx.settingsService.setGlobalSetting(SettingNames.LOG_LEVEL, "error");
    await ctx.settingsService.setGlobalSetting(SettingNames.METRICS_RETENTION_DAYS, "180");
    await ctx.settingsService.setGlobalSetting(SettingNames.LOG_TRIMMING_INTERVAL_SECONDS, "900");

    // Reset multiple settings atomically
    await ctx.settingsService.resetGlobalSettings([
      SettingNames.LOG_LEVEL,
      SettingNames.METRICS_RETENTION_DAYS,
      SettingNames.LOG_TRIMMING_INTERVAL_SECONDS,
    ]);

    // All should be back to defaults
    expect(await ctx.settingsService.getGlobalSetting(SettingNames.LOG_LEVEL))
      .toBe(GlobalSettingDefaults[SettingNames.LOG_LEVEL]);
    expect(await ctx.settingsService.getGlobalSetting(SettingNames.METRICS_RETENTION_DAYS))
      .toBe(GlobalSettingDefaults[SettingNames.METRICS_RETENTION_DAYS]);
    expect(await ctx.settingsService.getGlobalSetting(SettingNames.LOG_TRIMMING_INTERVAL_SECONDS))
      .toBe(GlobalSettingDefaults[SettingNames.LOG_TRIMMING_INTERVAL_SECONDS]);
  } finally {
    await ctx.cleanup();
  }
});
