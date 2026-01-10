import { z } from "zod";

/**
 * Response schema for GET /api/encryption-keys/rotation
 * Returns current encryption key rotation status
 */
export const RotationStatusSchema = z
  .object({
    lastRotationAt: z.string().datetime().openapi({
      example: "2025-12-01T10:30:00.000Z",
      description: "ISO timestamp of when the last rotation finished",
    }),
    daysSinceRotation: z.number().int().min(0).openapi({
      example: 15,
      description: "Number of days since the last rotation",
    }),
    nextRotationAt: z.string().datetime().openapi({
      example: "2026-03-01T10:30:00.000Z",
      description: "ISO timestamp of when the next rotation is scheduled",
    }),
    rotationIntervalDays: z.number().int().positive().openapi({
      example: 90,
      description: "Configured rotation interval in days",
    }),
    currentVersion: z.string().openapi({
      example: "B",
      description: "Current encryption key version identifier",
    }),
    isInProgress: z.boolean().openapi({
      example: false,
      description: "Whether a rotation is currently in progress",
    }),
  })
  .openapi("RotationStatus");

/**
 * Response schema for POST /api/encryption-keys/rotation
 * Confirms successful rotation with details
 */
export const TriggerRotationResponseSchema = z
  .object({
    success: z.boolean().openapi({
      example: true,
      description: "Whether the rotation completed successfully",
    }),
    message: z.string().openapi({
      example: "Key rotation completed successfully",
      description: "Human-readable success message",
    }),
  })
  .openapi("TriggerRotationResponse");

/**
 * Error response schema for rotation-specific errors
 */
export const RotationErrorSchema = z
  .object({
    error: z.string().openapi({
      example: "Key rotation is already in progress",
      description: "Error message",
    }),
    details: z.string().optional().openapi({
      example: "The encryption keys file is missing. This is a critical error.",
      description: "Additional error details if available",
    }),
  })
  .openapi("RotationError");
