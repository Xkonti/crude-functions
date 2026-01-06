/**
 * API routes for encryption key rotation.
 */

import { Hono } from "@hono/hono";
import type { Context } from "@hono/hono";
import type { KeyRotationService } from "./key_rotation_service.ts";
import type { KeyStorageService } from "./key_storage_service.ts";
import { logger } from "../utils/logger.ts";

export interface RotationRoutesOptions {
  keyRotationService: KeyRotationService;
  keyStorageService: KeyStorageService;
}

export function createRotationRoutes(options: RotationRoutesOptions): Hono {
  const routes = new Hono();
  const { keyRotationService, keyStorageService } = options;

  // GET /api/rotation/status - Get rotation status
  routes.get("/status", async (c: Context) => {
    try {
      const keys = await keyStorageService.loadKeys();
      if (!keys) {
        return c.json({ error: "No keys file found" }, 500);
      }

      const lastRotation = new Date(keys.last_rotation_finished_at);
      const now = new Date();
      const daysSinceRotation = Math.floor(
        (now.getTime() - lastRotation.getTime()) / (1000 * 60 * 60 * 24)
      );

      const isInProgress = keyStorageService.isRotationInProgress(keys);

      return c.json({
        lastRotationAt: keys.last_rotation_finished_at,
        daysSinceRotation,
        currentVersion: keys.current_version,
        isInProgress,
      });
    } catch (error) {
      logger.error("[RotationAPI] Failed to get rotation status:", error);
      return c.json({ error: "Failed to get rotation status" }, 500);
    }
  });

  // POST /api/rotation/trigger - Manually trigger rotation
  routes.post("/trigger", async (c: Context) => {
    try {
      await keyRotationService.triggerManualRotation();
      return c.json({
        success: true,
        message: "Key rotation completed successfully",
      });
    } catch (error) {
      logger.error("[RotationAPI] Manual rotation failed:", error);

      // Check for specific errors
      if (error instanceof Error) {
        if (error.message === "Key rotation is already in progress") {
          return c.json({ error: error.message }, 409); // Conflict
        }
        if (error.message === "No keys file found") {
          return c.json({ error: error.message }, 500);
        }
      }

      return c.json({
        error: "Key rotation failed",
        details: error instanceof Error ? error.message : "Unknown error",
      }, 500);
    }
  });

  return routes;
}
