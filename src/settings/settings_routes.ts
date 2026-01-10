import type { OpenAPIHono } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";
import { createOpenAPIApp } from "../openapi_app.ts";
import type { Context } from "@hono/hono";
import type { SettingsService } from "./settings_service.ts";
import {
  type SettingName,
  GlobalSettingDefaults,
} from "./types.ts";
import {
  validateSettings,
  requiresUserContext,
} from "../validation/settings.ts";
import {
  SettingsQuerySchema,
  GetSettingsResponseSchema,
  UpdateSettingsRequestSchema,
  UpdateSettingsResponseSchema,
  SettingsValidationErrorSchema,
} from "../routes_schemas/settings.ts";
import { ErrorResponseSchema } from "../schemas/responses.ts";

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
export interface SettingInfo {
  name: string;
  value: string;
  default: string | null;
}

/**
 * GET /api/settings - Get all settings
 */
const getSettingsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Settings"],
  summary: "Get settings",
  description:
    "Retrieve all application settings including log levels, retention policies, and API access groups. " +
    "Optionally include user-specific settings by providing userId query parameter or authenticating as a user.",
  request: {
    query: SettingsQuerySchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: GetSettingsResponseSchema,
        },
      },
      description: "Settings retrieved successfully",
    },
    500: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Failed to fetch settings",
    },
  },
});

/**
 * PUT /api/settings - Update multiple settings
 */
const updateSettingsRoute = createRoute({
  method: "put",
  path: "/",
  tags: ["Settings"],
  summary: "Update settings",
  description:
    "Update application settings such as log levels, metrics retention, and encryption rotation intervals. " +
    "Settings are validated before being applied. User-specific settings require user context (session or userId query param). " +
    "All updates are applied atomically.",
  request: {
    query: SettingsQuerySchema,
    body: {
      content: {
        "application/json": {
          schema: UpdateSettingsRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: UpdateSettingsResponseSchema,
        },
      },
      description: "Settings updated successfully",
    },
    400: {
      content: {
        "application/json": {
          schema: SettingsValidationErrorSchema,
        },
      },
      description: "Validation failed or user context required",
    },
    500: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Failed to update settings",
    },
  },
});

export function createSettingsRoutes(
  options: SettingsRoutesOptions
): OpenAPIHono {
  const { settingsService } = options;
  const routes = createOpenAPIApp();

  // GET /api/settings - Get all settings
  routes.openapi(getSettingsRoute, async (c) => {
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

      return c.json({ settings: result }, 200);
    } catch (error) {
      console.error("Failed to fetch settings:", error);
      return c.json({ error: "Failed to fetch settings" }, 500);
    }
  });

  // PUT /api/settings - Set multiple settings
  routes.openapi(updateSettingsRoute, async (c) => {
    const body = c.req.valid("json");

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

      return c.json(
        {
          success: true,
          updated: {
            global: globalSettings.size,
            user: userSettings.size,
          },
        },
        200
      );
    } catch (error) {
      console.error("Failed to update settings:", error);
      return c.json(
        { error: "Failed to update settings" },
        500
      );
    }
  });

  return routes;
}
