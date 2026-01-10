import { z } from "zod";
import { IdSchema } from "../schemas/common.ts";

/**
 * Query parameters for metrics endpoint
 */
export const MetricsQuerySchema = z.object({
  resolution: z.enum(["minutes", "hours", "days"]).openapi({
    example: "hours",
    description: "Time resolution for aggregated metrics",
  }),
  functionId: z.coerce.number().int().positive().optional().openapi({
    example: 123,
    description: "Optional function ID to filter metrics for a specific function",
  }),
});

/**
 * Single metric data point
 */
export const MetricDataPointSchema = z.object({
  timestamp: z.string().datetime().openapi({
    example: "2026-01-10T12:00:00.000Z",
    description: "ISO timestamp of this metric period",
  }),
  avgTimeMs: z.number().min(0).openapi({
    example: 42.5,
    description: "Average execution time in milliseconds",
  }),
  maxTimeMs: z.number().min(0).openapi({
    example: 150.2,
    description: "Maximum execution time in milliseconds",
  }),
  executionCount: z.number().int().min(0).openapi({
    example: 25,
    description: "Number of executions in this period",
  }),
}).openapi("MetricDataPoint");

/**
 * Metrics summary statistics
 */
export const MetricsSummarySchema = z.object({
  totalExecutions: z.number().int().min(0).openapi({
    example: 1500,
    description: "Total number of executions across all periods",
  }),
  avgExecutionTime: z.number().min(0).openapi({
    example: 38.7,
    description: "Weighted average execution time in milliseconds",
  }),
  maxExecutionTime: z.number().min(0).openapi({
    example: 250.5,
    description: "Maximum execution time across all periods",
  }),
  periodCount: z.number().int().min(0).openapi({
    example: 60,
    description: "Number of time periods included in this response",
  }),
}).openapi("MetricsSummary");

/**
 * Response schema for GET /api/metrics
 */
export const GetMetricsResponseSchema = z.object({
  data: z.object({
    metrics: z.array(MetricDataPointSchema).openapi({
      description: "Array of metric data points for each time period",
    }),
    functionId: z.number().int().nullable().openapi({
      example: 123,
      description: "Function ID if filtered, null for global metrics",
    }),
    resolution: z.enum(["minutes", "hours", "days"]).openapi({
      example: "hours",
      description: "Time resolution used for this query",
    }),
    summary: MetricsSummarySchema,
  }),
}).openapi("GetMetricsResponse");
