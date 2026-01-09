/**
 * RESTful API routes for encryption key rotation management.
 *
 * These endpoints provide programmatic access to key rotation status and controls,
 * following REST best practices with a resource-oriented design.
 */

import { Hono } from "@hono/hono";
import type { Context } from "@hono/hono";
import type { KeyRotationService } from "./key_rotation_service.ts";
import type { KeyStorageService } from "./key_storage_service.ts";
import type { SettingsService } from "../settings/settings_service.ts";
import { SettingNames } from "../settings/types.ts";
import { logger } from "../utils/logger.ts";

export interface RotationRoutesOptions {
  keyRotationService: KeyRotationService;
  keyStorageService: KeyStorageService;
  settingsService: SettingsService;
}

export function createRotationRoutes(options: RotationRoutesOptions): Hono {
  const routes = new Hono();
  const { keyRotationService, keyStorageService, settingsService } = options;

  /**
   * GET /api/encryption-keys/rotation
   *
   * Get the current encryption key rotation status including:
   * - When the last rotation occurred
   * - How many days since last rotation
   * - When the next rotation is scheduled
   * - The rotation interval configuration
   * - Current key version
   * - Whether a rotation is currently in progress
   *
   * @returns 200 with rotation status
   * @returns 500 on server error
   */
  routes.get("/rotation", async (c: Context) => {
    try {
      // Load encryption keys to get rotation timestamps
      const keys = await keyStorageService.loadKeys();
      if (!keys) {
        return c.json({ error: "No keys file found" }, 500);
      }

      // Get rotation interval from settings
      const intervalSetting = await settingsService.getGlobalSetting(
        SettingNames.ENCRYPTION_KEY_ROTATION_INTERVAL_DAYS
      );
      const rotationIntervalDays = intervalSetting ? parseInt(intervalSetting, 10) : 90;

      // Calculate time-based information
      const lastRotation = new Date(keys.last_rotation_finished_at);
      const now = new Date();
      const daysSinceRotation = Math.floor(
        (now.getTime() - lastRotation.getTime()) / (1000 * 60 * 60 * 24)
      );

      // Calculate next scheduled rotation
      const nextRotation = new Date(
        lastRotation.getTime() + rotationIntervalDays * 24 * 60 * 60 * 1000
      );

      // Check if rotation is currently in progress
      const isInProgress = keyStorageService.isRotationInProgress(keys);

      return c.json({
        lastRotationAt: keys.last_rotation_finished_at,
        daysSinceRotation,
        nextRotationAt: nextRotation.toISOString(),
        rotationIntervalDays,
        currentVersion: keys.current_version,
        isInProgress,
      });
    } catch (error) {
      logger.error("[EncryptionKeyAPI] Failed to get rotation status:", error);
      return c.json(
        {
          error: "Failed to get rotation status",
          details: error instanceof Error ? error.message : "Unknown error"
        },
        500
      );
    }
  });

  /**
   * POST /api/encryption-keys/rotation
   *
   * Manually trigger an encryption key rotation. This will:
   * - Generate new encryption keys
   * - Re-encrypt all sensitive data (secrets, API keys, settings)
   * - Update the Better Auth secret (invalidating all sessions)
   *
   * If a rotation is already in progress, returns 409 Conflict.
   * If an incomplete rotation is detected, it will be resumed.
   *
   * Note: This operation can take time depending on the amount of data.
   * The rotation happens synchronously but uses batching to avoid blocking.
   *
   * @returns 200 with success message
   * @returns 409 if rotation is already in progress
   * @returns 500 on server error
   */
  routes.post("/rotation", async (c: Context) => {
    try {
      await keyRotationService.triggerManualRotation();
      return c.json({
        success: true,
        message: "Key rotation completed successfully",
      });
    } catch (error) {
      logger.error("[EncryptionKeyAPI] Manual rotation failed:", error);

      // Handle specific error cases
      if (error instanceof Error) {
        // Rotation already in progress
        if (error.message === "Key rotation is already in progress") {
          return c.json({ error: error.message }, 409);
        }

        // Keys file not found (critical error)
        if (error.message === "No keys file found") {
          return c.json(
            {
              error: "Encryption keys not found",
              details: "The encryption keys file is missing. This is a critical error."
            },
            500
          );
        }
      }

      // Generic error response
      return c.json({
        error: "Key rotation failed",
        details: error instanceof Error ? error.message : "Unknown error",
      }, 500);
    }
  });

  return routes;
}
