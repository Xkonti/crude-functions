import { z } from "zod";

/**
 * Query parameter for user context (optional)
 */
export const SettingsQuerySchema = z.object({
  userId: z.string().optional().openapi({
    example: "user-123",
    description: "Optional user ID to fetch user-specific settings",
  }),
});

/**
 * Single setting info with value and default
 */
export const SettingInfoSchema = z.object({
  name: z.string().openapi({
    example: "log.level",
    description: "Setting name in dot notation",
  }),
  value: z.string().openapi({
    example: "info",
    description: "Current value of the setting",
  }),
  default: z.string().nullable().openapi({
    example: "info",
    description: "Default value for global settings, null for user settings",
  }),
}).openapi("SettingInfo");

/**
 * Response schema for GET /api/settings
 */
export const GetSettingsResponseSchema = z.object({
  settings: z.array(SettingInfoSchema).openapi({
    description: "Array of all settings (global and user if applicable)",
  }),
}).openapi("GetSettingsResponse");

/**
 * Request body for PUT /api/settings
 */
export const UpdateSettingsRequestSchema = z.object({
  settings: z.record(z.string(), z.string()).openapi({
    example: {
      "log.level": "debug",
      "metrics.retention-days": "30",
    },
    description: "Map of setting names to values to update",
  }),
}).openapi("UpdateSettingsRequest");

/**
 * Response schema for PUT /api/settings
 */
export const UpdateSettingsResponseSchema = z.object({
  success: z.boolean().openapi({
    example: true,
  }),
  updated: z.object({
    global: z.number().int().min(0).openapi({
      example: 2,
      description: "Number of global settings updated",
    }),
    user: z.number().int().min(0).openapi({
      example: 0,
      description: "Number of user settings updated",
    }),
  }),
}).openapi("UpdateSettingsResponse");

/**
 * Validation error response for settings
 */
export const SettingsValidationErrorSchema = z.object({
  error: z.string().openapi({
    example: "Validation failed",
  }),
  details: z.record(z.string(), z.string()).optional().openapi({
    example: {
      "log.level": "Must be one of: trace, debug, info, warn, error",
    },
    description: "Map of setting names to error messages",
  }),
}).openapi("SettingsValidationError");
