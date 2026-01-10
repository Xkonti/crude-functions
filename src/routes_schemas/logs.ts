import { z } from "zod";
import { IdSchema } from "../schemas/common.ts";

/**
 * Console log levels
 */
export const LogLevelSchema = z.enum([
  "log",
  "debug",
  "info",
  "warn",
  "error",
  "trace",
  "stdout",
  "stderr",
  "exec_start",
  "exec_end",
  "exec_reject",
]);

/**
 * Query parameters for logs endpoint
 */
export const LogsQuerySchema = z.object({
  functionId: z.coerce.number().int().positive().optional().openapi({
    example: 123,
    description: "Optional function ID to filter logs",
  }),
  level: z.string().optional().openapi({
    example: "error,warn",
    description: "Comma-separated list of log levels to filter by",
  }),
  limit: z.coerce.number().int().min(1).max(1000).default(50).openapi({
    example: 50,
    description: "Maximum number of logs to return (1-1000)",
  }),
  cursor: z.string().optional().openapi({
    example: "eyJpZCI6MTIzLCJ0aW1lc3RhbXAiOiIyMDI2LTAxLTEwVDEyOjAwOjAwLjAwMFoifQ==",
    description: "Pagination cursor from previous response",
  }),
});

/**
 * Single log entry
 */
export const LogEntrySchema = z.object({
  id: IdSchema,
  routeId: z.number().int().positive().openapi({
    example: 123,
    description: "Function ID that produced this log",
  }),
  requestId: z.string().openapi({
    example: "req_abc123",
    description: "Request ID for tracing",
  }),
  level: LogLevelSchema.openapi({
    example: "info",
  }),
  message: z.string().openapi({
    example: "Processing request for user 456",
    description: "Log message content",
  }),
  timestamp: z.string().datetime().openapi({
    example: "2026-01-10T12:34:56.789Z",
    description: "When this log was created",
  }),
}).openapi("LogEntry");

/**
 * Pagination metadata for logs
 */
export const LogsPaginationSchema = z.object({
  limit: z.number().int().openapi({
    example: 50,
    description: "Number of items per page",
  }),
  hasMore: z.boolean().openapi({
    example: true,
    description: "Whether more logs exist beyond this page",
  }),
  next: z.string().optional().openapi({
    example: "/api/logs?limit=50&cursor=eyJ...",
    description: "URL for the next page, if available",
  }),
  prev: z.string().optional().openapi({
    example: "/api/logs?limit=50&cursor=eyJ...",
    description: "URL for the previous page, if available",
  }),
}).openapi("LogsPagination");

/**
 * Response schema for GET /api/logs
 */
export const GetLogsResponseSchema = z.object({
  data: z.object({
    logs: z.array(LogEntrySchema).openapi({
      description: "Array of log entries",
    }),
    pagination: LogsPaginationSchema,
  }),
}).openapi("GetLogsResponse");

/**
 * Path parameter for DELETE endpoint
 */
export const DeleteLogsParamSchema = z.object({
  functionId: z.coerce.number().int().positive().openapi({
    param: {
      name: "functionId",
      in: "path",
    },
    example: 123,
    description: "Function ID to delete logs for",
  }),
});

/**
 * Response schema for DELETE /api/logs/:functionId
 */
export const DeleteLogsResponseSchema = z.object({
  data: z.object({
    deleted: z.number().int().min(0).openapi({
      example: 150,
      description: "Number of log entries deleted",
    }),
    functionId: z.number().int().positive().openapi({
      example: 123,
      description: "Function ID that logs were deleted for",
    }),
  }),
}).openapi("DeleteLogsResponse");
