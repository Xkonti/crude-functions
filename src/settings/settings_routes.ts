import { Hono } from "@hono/hono";
import type { Context } from "@hono/hono";
import type { SettingsService } from "./settings_service.ts";
import {
  type SettingName,
  GlobalSettingDefaults,
} from "./types.ts";
import {
  validateSettings,
  requiresUserContext,
  isValidSettingName,
} from "../validation/settings.ts";

export interface SettingsRoutesOptions {
  settingsService: SettingsService;
}

/**
 * Resolved user context from session or query param
 */
interface UserContext {
  userId: string | null;
  source: "session" | "query" | "none";
}

/**
 * Resolve user context from session or query parameter
 */
function resolveUserContext(c: Context): UserContext {
  // Check for ?userId=<id> query parameter (overrides session)
  const userIdParam = c.req.query("userId");
  if (userIdParam) {
    return { userId: userIdParam, source: "query" };
  }

  // Check for authenticated session user
  const sessionUser = c.get("user");
  if (sessionUser?.id) {
    return { userId: sessionUser.id, source: "session" };
  }

  return { userId: null, source: "none" };
}

/**
 * Setting with value and default info
 */
interface SettingInfo {
  name: string;
  value: string;
  default: string | null;
}

export function createSettingsRoutes(
  options: SettingsRoutesOptions
): Hono {
  const { settingsService } = options;
  const routes = new Hono();

  // GET /api/settings - Get all settings
  routes.get("/", async (c) => {
    const userContext = resolveUserContext(c);
    const result: SettingInfo[] = [];

    try {
      // Always include global settings
      const globalSettings = await settingsService.getAllGlobalSettings();

      for (const [name, value] of globalSettings) {
        const defaultValue = GlobalSettingDefaults[name];
        result.push({
          name,
          value,
          default: defaultValue,
        });
      }

      // Include user settings if user context exists
      if (userContext.userId) {
        const userSettings = await settingsService.getAllUserSettings(
          userContext.userId
        );

        for (const [name, value] of userSettings) {
          result.push({
            name,
            value,
            default: null, // User settings don't have defaults
          });
        }
      }

      return c.json({ settings: result });
    } catch (error) {
      console.error("Failed to fetch settings:", error);
      return c.json({ error: "Failed to fetch settings" }, 500);
    }
  });

  // PUT /api/settings - Set multiple settings
  routes.put("/", async (c) => {
    let body: { settings?: Record<string, string> };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    if (!body.settings || typeof body.settings !== "object") {
      return c.json(
        { error: "Missing or invalid 'settings' field (must be object)" },
        400
      );
    }

    // Validate all settings
    const validationResult = validateSettings(body.settings);
    if (!validationResult.valid) {
      return c.json(
        {
          error: "Validation failed",
          details: validationResult.errors,
        },
        400
      );
    }

    // Resolve user context
    const userContext = resolveUserContext(c);

    // Separate settings into user and global
    const globalSettings = new Map<SettingName, string>();
    const userSettings = new Map<SettingName, string>();

    for (const [name, value] of Object.entries(body.settings)) {
      if (requiresUserContext(name)) {
        if (!userContext.userId) {
          return c.json(
            {
              error: `Setting '${name}' requires user context. Authenticate or provide ?userId=<id>`,
            },
            400
          );
        }
        userSettings.set(name as SettingName, value);
      } else {
        globalSettings.set(name as SettingName, value);
      }
    }

    // Apply updates atomically
    try {
      if (globalSettings.size > 0) {
        await settingsService.setGlobalSettingsBatch(globalSettings);
      }
      if (userSettings.size > 0 && userContext.userId) {
        await settingsService.setUserSettingsBatch(
          userContext.userId,
          userSettings
        );
      }

      return c.json({
        success: true,
        updated: {
          global: globalSettings.size,
          user: userSettings.size,
        },
      });
    } catch (error) {
      console.error("Failed to update settings:", error);
      return c.json(
        { error: "Failed to update settings" },
        500
      );
    }
  });

  // DELETE /api/settings - Reset settings to defaults
  routes.delete("/", async (c) => {
    let body: { names?: string[] };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    if (!body.names || !Array.isArray(body.names)) {
      return c.json(
        { error: "Missing or invalid 'names' field (must be array)" },
        400
      );
    }

    // Validate all setting names
    const invalidNames = body.names.filter(
      (name) => !isValidSettingName(name)
    );
    if (invalidNames.length > 0) {
      return c.json(
        {
          error: "Invalid setting names",
          details: invalidNames,
        },
        400
      );
    }

    // Resolve user context
    const userContext = resolveUserContext(c);

    // Separate settings into user and global
    const globalNames: SettingName[] = [];
    const userNames: SettingName[] = [];

    for (const name of body.names) {
      if (requiresUserContext(name)) {
        if (!userContext.userId) {
          return c.json(
            {
              error: `Setting '${name}' requires user context. Authenticate or provide ?userId=<id>`,
            },
            400
          );
        }
        userNames.push(name as SettingName);
      } else {
        globalNames.push(name as SettingName);
      }
    }

    // Reset settings atomically
    try {
      if (globalNames.length > 0) {
        await settingsService.resetGlobalSettings(globalNames);
      }
      if (userNames.length > 0 && userContext.userId) {
        await settingsService.resetUserSettings(
          userContext.userId,
          userNames
        );
      }

      return c.json({
        success: true,
        reset: {
          global: globalNames.length,
          user: userNames.length,
        },
      });
    } catch (error) {
      console.error("Failed to reset settings:", error);
      return c.json(
        { error: "Failed to reset settings" },
        500
      );
    }
  });

  return routes;
}
