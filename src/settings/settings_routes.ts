import { Hono, type Context } from "@hono/hono";
import { SettingsService } from "./settings_service.ts";
import { SettingNames, SettingsMetadata, type SettingName } from "./types.ts";

export interface SettingsRoutesOptions {
  settingsService: SettingsService;
}

/**
 * Setting with value and metadata for API responses.
 */
interface SettingWithMetadata {
  name: string;
  value: string;
  label: string;
  description: string;
  inputType: string;
  options?: readonly string[];
  min?: number;
  max?: number;
  category: string;
}

/**
 * Create settings management API routes.
 *
 * Endpoints:
 * - GET /api/settings - Get all global settings with metadata
 * - PATCH /api/settings - Update multiple global settings (transactional)
 * - GET /api/settings/user/:userId - Get all user settings with metadata
 * - PATCH /api/settings/user/:userId - Update multiple user settings (transactional)
 */
export function createSettingsRoutes(options: SettingsRoutesOptions): Hono {
  const { settingsService } = options;
  const routes = new Hono();

  // Helper: Validate setting names
  function validateSettingNames(settings: Record<string, unknown>): {
    valid: boolean;
    invalidNames?: string[];
  } {
    const validNames = new Set(Object.values(SettingNames));
    const invalidNames = Object.keys(settings).filter((name) => !validNames.has(name as SettingName));

    if (invalidNames.length > 0) {
      return { valid: false, invalidNames };
    }

    return { valid: true };
  }

  // Helper: Validate setting values are strings
  function validateSettingValues(settings: Record<string, unknown>): {
    valid: boolean;
    invalidFields?: string[];
  } {
    const invalidFields = Object.entries(settings)
      .filter(([_, value]) => typeof value !== "string")
      .map(([name]) => name);

    if (invalidFields.length > 0) {
      return { valid: false, invalidFields };
    }

    return { valid: true };
  }

  // Helper: Combine settings with metadata
  function combineWithMetadata(
    settings: Record<string, string>
  ): SettingWithMetadata[] {
    return Object.entries(settings).map(([name, value]) => {
      const metadata = SettingsMetadata[name as SettingName];
      return {
        name,
        value,
        label: metadata?.label || name,
        description: metadata?.description || "",
        inputType: metadata?.inputType || "text",
        options: metadata?.options,
        min: metadata?.min,
        max: metadata?.max,
        category: metadata?.category || "Security",
      };
    });
  }

  // GET /api/settings - Get all global settings with metadata
  routes.get("/", async (c) => {
    const settings = await settingsService.getAllGlobalSettings();
    const settingsWithMetadata = combineWithMetadata(settings);

    return c.json({
      settings: settingsWithMetadata,
      count: settingsWithMetadata.length,
    });
  });

  // PATCH /api/settings - Update multiple global settings (transactional)
  routes.patch("/", async (c) => {
    let body: { settings?: Record<string, unknown> };

    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    if (!body.settings || typeof body.settings !== "object") {
      return c.json({
        error: "Missing or invalid 'settings' field. Expected: { settings: { name: value, ... } }",
      }, 400);
    }

    // Validate setting names
    const nameValidation = validateSettingNames(body.settings);
    if (!nameValidation.valid) {
      return c.json({
        error: "Invalid setting names",
        invalidNames: nameValidation.invalidNames,
      }, 400);
    }

    // Validate setting values are strings
    const valueValidation = validateSettingValues(body.settings);
    if (!valueValidation.valid) {
      return c.json({
        error: "All setting values must be strings",
        invalidFields: valueValidation.invalidFields,
      }, 400);
    }

    // Update settings in a transaction (all or nothing)
    try {
      await settingsService.setGlobalSettings(body.settings as Record<string, string>);
      return c.json({
        success: true,
        updated: Object.keys(body.settings).length,
      });
    } catch (err) {
      // Transaction failed - return error
      return c.json({
        error: "Failed to update settings",
        message: err instanceof Error ? err.message : "Unknown error",
      }, 500);
    }
  });

  // GET /api/settings/user/:userId - Get all user settings with metadata
  routes.get("/user/:userId", async (c) => {
    const userId = c.req.param("userId");

    if (!userId) {
      return c.json({ error: "Missing userId parameter" }, 400);
    }

    const settings = await settingsService.getAllUserSettings(userId);
    const settingsWithMetadata = combineWithMetadata(settings);

    return c.json({
      userId,
      settings: settingsWithMetadata,
      count: settingsWithMetadata.length,
    });
  });

  // PATCH /api/settings/user/:userId - Update multiple user settings (transactional)
  routes.patch("/user/:userId", async (c) => {
    const userId = c.req.param("userId");

    if (!userId) {
      return c.json({ error: "Missing userId parameter" }, 400);
    }

    let body: { settings?: Record<string, unknown> };

    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    if (!body.settings || typeof body.settings !== "object") {
      return c.json({
        error: "Missing or invalid 'settings' field. Expected: { settings: { name: value, ... } }",
      }, 400);
    }

    // Validate setting names
    const nameValidation = validateSettingNames(body.settings);
    if (!nameValidation.valid) {
      return c.json({
        error: "Invalid setting names",
        invalidNames: nameValidation.invalidNames,
      }, 400);
    }

    // Validate setting values are strings
    const valueValidation = validateSettingValues(body.settings);
    if (!valueValidation.valid) {
      return c.json({
        error: "All setting values must be strings",
        invalidFields: valueValidation.invalidFields,
      }, 400);
    }

    // Update settings in a transaction (all or nothing)
    try {
      await settingsService.setUserSettings(userId, body.settings as Record<string, string>);
      return c.json({
        success: true,
        userId,
        updated: Object.keys(body.settings).length,
      });
    } catch (err) {
      // Transaction failed - return error
      return c.json({
        error: "Failed to update user settings",
        message: err instanceof Error ? err.message : "Unknown error",
      }, 500);
    }
  });

  return routes;
}
