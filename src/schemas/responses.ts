import { z } from "zod";

/**
 * Standard error response schema
 * Used for all error responses (4xx, 5xx)
 */
export const ErrorResponseSchema = z
  .object({
    error: z.string().openapi({
      example: "Resource not found",
      description: "Human-readable error message",
    }),
  })
  .openapi("ErrorResponse");

/**
 * Standard success response schema
 * Used for operations that return success boolean
 */
export const SuccessResponseSchema = z
  .object({
    success: z.boolean().openapi({
      example: true,
      description: "Whether the operation succeeded",
    }),
  })
  .openapi("SuccessResponse");
