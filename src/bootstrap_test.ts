import { integrationTest } from "./test/test_helpers.ts";
import { expect } from "@std/expect";
import { TestSetupBuilder } from "./test/test_setup_builder.ts";
import type { ApiKeyService } from "./keys/api_key_service.ts";
import type { SettingsService } from "./settings/settings_service.ts";
import { SettingNames } from "./settings/types.ts";

/**
 * Simulates the bootstrap logic from main.ts lines 216-221
 */
async function bootstrapApiAccess(
  apiKeyService: ApiKeyService,
  settingsService: SettingsService
): Promise<void> {
  // Ensure management group exists and set default access groups
  const mgmtGroupId = await apiKeyService.getOrCreateGroup("management", "Management API keys");
  const currentAccessGroups = await settingsService.getGlobalSetting(SettingNames.API_ACCESS_GROUPS);
  if (!currentAccessGroups) {
    await settingsService.setGlobalSetting(SettingNames.API_ACCESS_GROUPS, String(mgmtGroupId));
  }
}

// Bootstrap Tests

integrationTest("Bootstrap: management group exists from migrations and bootstrap is idempotent", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeys()
    .withSettings()
    .build();

  try {
    // Management group is created by migrations (000-init.sql)
    const groupsBefore = await ctx.apiKeyService.getGroups();
    expect(groupsBefore).toHaveLength(1);
    expect(groupsBefore[0].name).toBe("management");

    // Run bootstrap - should be idempotent (no error, no duplicate)
    await bootstrapApiAccess(ctx.apiKeyService, ctx.settingsService);

    // Verify still only one management group exists
    const groupsAfter = await ctx.apiKeyService.getGroups();
    expect(groupsAfter).toHaveLength(1);
    expect(groupsAfter[0].name).toBe("management");
    expect(groupsAfter[0].description).toBe("Management API keys");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("Bootstrap: management group has no keys by default", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeys()
    .withSettings()
    .build();

  try {
    // Run bootstrap
    await bootstrapApiAccess(ctx.apiKeyService, ctx.settingsService);

    // Verify management group has no keys
    const keys = await ctx.apiKeyService.getKeys("management");
    expect(keys).toEqual([]);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("Bootstrap: sets api.access-groups to management group ID", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeys()
    .withSettings()
    .build();

  try {
    // Run bootstrap
    await bootstrapApiAccess(ctx.apiKeyService, ctx.settingsService);

    // Get the management group ID
    const mgmtGroup = await ctx.apiKeyService.getGroupByName("management");
    expect(mgmtGroup).toBeDefined();

    // Verify setting was configured correctly
    const accessGroups = await ctx.settingsService.getGlobalSetting(SettingNames.API_ACCESS_GROUPS);
    expect(accessGroups).toBe(String(mgmtGroup!.id));
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("Bootstrap: does not override existing api.access-groups setting", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeys()
    .withSettings()
    .build();

  try {
    // Create a custom group and set it as the access group
    const customGroupId = await ctx.apiKeyService.createGroup("custom", "Custom access");
    await ctx.settingsService.setGlobalSetting(SettingNames.API_ACCESS_GROUPS, String(customGroupId));

    // Run bootstrap
    await bootstrapApiAccess(ctx.apiKeyService, ctx.settingsService);

    // Verify setting was NOT overridden
    const accessGroups = await ctx.settingsService.getGlobalSetting(SettingNames.API_ACCESS_GROUPS);
    expect(accessGroups).toBe(String(customGroupId));

    // Verify it's not the management group ID
    const mgmtGroup = await ctx.apiKeyService.getGroupByName("management");
    expect(accessGroups).not.toBe(String(mgmtGroup!.id));
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("Bootstrap: is idempotent (can run multiple times safely)", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeys()
    .withSettings()
    .build();

  try {
    // Run bootstrap multiple times
    await bootstrapApiAccess(ctx.apiKeyService, ctx.settingsService);
    await bootstrapApiAccess(ctx.apiKeyService, ctx.settingsService);
    await bootstrapApiAccess(ctx.apiKeyService, ctx.settingsService);

    // Verify only one management group exists
    const groups = await ctx.apiKeyService.getGroups();
    const managementGroups = groups.filter((g) => g.name === "management");
    expect(managementGroups).toHaveLength(1);

    // Verify setting is still correct
    const mgmtGroup = await ctx.apiKeyService.getGroupByName("management");
    const accessGroups = await ctx.settingsService.getGlobalSetting(SettingNames.API_ACCESS_GROUPS);
    expect(accessGroups).toBe(String(mgmtGroup!.id));
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("Bootstrap: management group can receive keys after creation", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeys()
    .withSettings()
    .build();

  try {
    // Run bootstrap
    await bootstrapApiAccess(ctx.apiKeyService, ctx.settingsService);

    // Add a key to management group
    await ctx.apiKeyService.addKey("management", "test-key", "test-key-123", "Test key");

    // Verify key was added successfully
    const keys = await ctx.apiKeyService.getKeys("management");
    expect(keys).not.toBeNull();
    expect(keys).toHaveLength(1);
    expect(keys![0].value).toBe("test-key-123");
    expect(keys![0].description).toBe("Test key");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("Bootstrap: management group in access-groups setting enables API access", async () => {
  const ctx = await TestSetupBuilder.create()
    .withApiKeys()
    .withSettings()
    .build();

  try {
    // Run bootstrap
    await bootstrapApiAccess(ctx.apiKeyService, ctx.settingsService);

    // Add a key to management group
    await ctx.apiKeyService.addKey("management", "test-key-456", "test-key-value-456", "Test key description");

    // Verify the key can be used for authentication
    const mgmtGroup = await ctx.apiKeyService.getGroupByName("management");
    expect(mgmtGroup).toBeDefined();

    // Check that the key exists in the management group
    const hasKey = await ctx.apiKeyService.hasKey("management", "test-key-value-456");
    expect(hasKey).toBe(true);

    // Verify the management group ID is in the access groups setting
    const accessGroups = await ctx.settingsService.getGlobalSetting(SettingNames.API_ACCESS_GROUPS);
    expect(accessGroups).toContain(String(mgmtGroup!.id));
  } finally {
    await ctx.cleanup();
  }
});
