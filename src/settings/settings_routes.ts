import { Hono } from "@hono/hono";
import type { Context } from "@hono/hono";
import type { SettingsService } from "./settings_service.ts";
import type { SchedulingService } from "../scheduling/scheduling_service.ts";
import type { KeyStorageService } from "../encryption/key_storage_service.ts";
import {
  type SettingName,
  GlobalSettingDefaults,
  SettingNames,
} from "./types.ts";
import {
  validateSettings,
  requiresUserContext,
} from "../validation/settings.ts";
import { recalculateKeyRotationSchedule } from "../encryption/key_rotation_schedule_helper.ts";
import { logger } from "../utils/logger.ts";

export interface SettingsRoutesOptions {
  settingsService: SettingsService;
  schedulingService?: SchedulingService;
  keyStorageService?: KeyStorageService;
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

export function createSettingsRoutes(
  options: SettingsRoutesOptions
): Hono {
  const { settingsService, schedulingService, keyStorageService } = options;
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

      // Update related schedules when interval settings change
      if (schedulingService && globalSettings.size > 0) {
        await updateSchedulesForSettings(schedulingService, keyStorageService, globalSettings);
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

  return routes;
}

/**
 * Update schedules when interval-related settings change.
 */
async function updateSchedulesForSettings(
  schedulingService: SchedulingService,
  keyStorageService: KeyStorageService | undefined,
  changedSettings: Map<SettingName, string>
): Promise<void> {
  // Log trimming interval
  if (changedSettings.has(SettingNames.LOG_TRIMMING_INTERVAL_SECONDS)) {
    const newInterval = parseInt(changedSettings.get(SettingNames.LOG_TRIMMING_INTERVAL_SECONDS)!, 10);
    if (!isNaN(newInterval) && newInterval > 0) {
      try {
        await schedulingService.updateSchedule("log-trimming", {
          intervalMs: newInterval * 1000,
        });
        logger.info(`[Settings] Updated log-trimming schedule interval to ${newInterval}s`);
      } catch {
        // Schedule may not exist yet - this is fine
      }
    }
  }

  // Metrics aggregation interval
  if (changedSettings.has(SettingNames.METRICS_AGGREGATION_INTERVAL_SECONDS)) {
    const newInterval = parseInt(changedSettings.get(SettingNames.METRICS_AGGREGATION_INTERVAL_SECONDS)!, 10);
    if (!isNaN(newInterval) && newInterval > 0) {
      try {
        await schedulingService.updateSchedule("metrics-aggregation", {
          intervalMs: newInterval * 1000,
        });
        logger.info(`[Settings] Updated metrics-aggregation schedule interval to ${newInterval}s`);
      } catch {
        // Schedule may not exist yet - this is fine
      }
    }
  }

  // Key rotation interval - recalculate nextRunAt
  if (changedSettings.has(SettingNames.ENCRYPTION_KEY_ROTATION_INTERVAL_DAYS) && keyStorageService) {
    const newIntervalDays = parseInt(changedSettings.get(SettingNames.ENCRYPTION_KEY_ROTATION_INTERVAL_DAYS)!, 10);
    if (!isNaN(newIntervalDays) && newIntervalDays > 0) {
      try {
        await recalculateKeyRotationSchedule(schedulingService, keyStorageService, newIntervalDays);
        logger.info(`[Settings] Recalculated key-rotation schedule for ${newIntervalDays} day interval`);
      } catch {
        // Schedule may not exist yet - this is fine
      }
    }
  }
}
