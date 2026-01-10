import { z } from "zod";

/**
 * ID validation schema
 * Validates positive integers up to SQLite's max safe integer
 */
export const IdSchema = z.coerce
  .number()
  .int()
  .positive()
  .max(9007199254740991, "ID exceeds maximum safe integer")
  .openapi({
    example: 123,
    description: "Unique resource ID",
  });

/**
 * Pagination query parameters schema
 * Used for list endpoints that support pagination
 */
export const PaginationQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1, "Limit must be at least 1")
    .max(1000, "Limit cannot exceed 1000")
    .default(100)
    .openapi({
      example: 50,
      description: "Maximum number of items to return",
    }),
  offset: z.coerce
    .number()
    .int()
    .min(0, "Offset must be non-negative")
    .default(0)
    .openapi({
      example: 0,
      description: "Number of items to skip",
    }),
});

/**
 * Pagination response metadata schema
 * Included in paginated list responses
 */
export const PaginationResponseSchema = z.object({
  limit: z.number().int().openapi({
    example: 50,
    description: "Number of items per page",
  }),
  hasMore: z.boolean().openapi({
    example: true,
    description: "Whether more items exist beyond this page",
  }),
  next: z.string().nullable().openapi({
    example: "/api/logs?limit=50&offset=50",
    description: "URL for the next page, or null if no more pages",
  }),
  prev: z.string().nullable().openapi({
    example: null,
    description: "URL for the previous page, or null if on first page",
  }),
});
