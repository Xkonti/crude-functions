import type { OpenAPIHono } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";
import { createOpenAPIApp } from "../openapi_app.ts";
import type { ExecutionMetricsService } from "./execution_metrics_service.ts";
import type { RoutesService } from "../routes/routes_service.ts";
import type { SettingsService } from "../settings/settings_service.ts";
import { validateId } from "../validation/common.ts";
import type { MetricType } from "./types.ts";
import { SettingNames } from "../settings/types.ts";
import {
  MetricsQuerySchema,
  GetMetricsResponseSchema,
} from "../routes_schemas/metrics.ts";
import { ErrorResponseSchema } from "../schemas/responses.ts";

export interface MetricsRoutesOptions {
  executionMetricsService: ExecutionMetricsService;
  routesService: RoutesService;
  settingsService: SettingsService;
}

interface MetricsSummary {
  totalExecutions: number;
  avgExecutionTime: number;
  maxExecutionTime: number;
  periodCount: number;
}

const RESOLUTION_TO_TYPE: Record<string, MetricType> = {
  "minutes": "minute",
  "hours": "hour",
  "days": "day",
};

const VALID_RESOLUTIONS = Object.keys(RESOLUTION_TO_TYPE);

/**
 * GET /api/metrics - Query execution metrics
 */
const getMetricsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Metrics"],
  summary: "Get execution metrics",
  description:
    "Retrieve aggregated execution metrics including request counts, durations, and error rates. " +
    "Metrics can be filtered by function ID and are aggregated by time resolution (minutes, hours, or days). " +
    "Time ranges are automatically determined based on resolution: 60 minutes for 'minutes', 24 hours for 'hours', " +
    "and configurable retention period for 'days'.",
  request: {
    query: MetricsQuerySchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: GetMetricsResponseSchema,
        },
      },
      description: "Metrics retrieved successfully",
    },
    400: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Invalid resolution or functionId parameter",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Function not found",
    },
  },
});

export function createMetricsRoutes(
  options: MetricsRoutesOptions
): OpenAPIHono {
  const { executionMetricsService, routesService, settingsService } = options;
  const routes = createOpenAPIApp();

  // GET /api/metrics - Query metrics with optional functionId and required resolution
  routes.openapi(getMetricsRoute, async (c) => {
    const { resolution, functionId: functionIdParam } = c.req.valid("query");

    // Validate resolution
    if (!resolution) {
      return c.json(
        { error: "Missing required parameter: resolution" },
        400
      );
    }

    if (!VALID_RESOLUTIONS.includes(resolution)) {
      return c.json(
        {
          error: `Invalid resolution parameter. Must be one of: ${
            VALID_RESOLUTIONS.join(", ")
          }`,
        },
        400
      );
    }

    const metricType = RESOLUTION_TO_TYPE[resolution];

    // Parse and validate functionId (optional)
    let routeId: number | null = null;

    if (functionIdParam) {
      const parsed = validateId(String(functionIdParam));
      if (parsed === null) {
        return c.json({ error: "Invalid functionId parameter" }, 400);
      }

      // Verify route exists
      const route = await routesService.getById(parsed);
      if (!route) {
        return c.json({ error: `Function with id ${parsed} not found` }, 404);
      }

      routeId = parsed;
    }

    // Calculate time range based on resolution
    const now = new Date();
    let startTime: Date;

    switch (resolution) {
      case "minutes":
        // Last 60 minutes of minute-aggregated data
        startTime = new Date(now.getTime() - 60 * 60 * 1000);
        break;
      case "hours":
        // Last 24 hours of hour-aggregated data
        startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case "days": {
        // Last X days of day-aggregated data (get from settings)
        const retentionDaysStr = await settingsService.getGlobalSetting(
          SettingNames.METRICS_RETENTION_DAYS
        );
        const retentionDays = retentionDaysStr
          ? parseInt(retentionDaysStr, 10)
          : 90;
        startTime = new Date(
          now.getTime() - retentionDays * 24 * 60 * 60 * 1000
        );
        break;
      }
      default:
        // Should never reach here due to validation above
        return c.json({ error: "Invalid resolution" }, 400);
    }

    // Query metrics
    const metrics = routeId === null
      ? await executionMetricsService.getGlobalMetricsByTypeAndTimeRange(
        metricType,
        startTime,
        now
      )
      : await executionMetricsService.getByRouteIdTypeAndTimeRange(
        routeId,
        metricType,
        startTime,
        now
      );

    // Calculate summary
    const summary: MetricsSummary = {
      totalExecutions: 0,
      avgExecutionTime: 0,
      maxExecutionTime: 0,
      periodCount: metrics.length,
    };

    if (metrics.length > 0) {
      summary.totalExecutions = metrics.reduce(
        (sum, m) => sum + m.executionCount,
        0
      );
      summary.maxExecutionTime = Math.max(
        ...metrics.map((m) => m.maxTimeMs)
      );

      // Weighted average
      if (summary.totalExecutions > 0) {
        const weightedSum = metrics.reduce(
          (sum, m) => sum + m.avgTimeMs * m.executionCount,
          0
        );
        summary.avgExecutionTime = weightedSum / summary.totalExecutions;
      }
    }

    // Format response
    const formattedMetrics = metrics.map((m) => ({
      timestamp: m.timestamp.toISOString(),
      avgTimeMs: m.avgTimeMs,
      maxTimeMs: m.maxTimeMs,
      executionCount: m.executionCount,
    }));

    return c.json(
      {
        data: {
          metrics: formattedMetrics,
          functionId: routeId,
          resolution,
          summary,
        },
      },
      200
    );
  });

  return routes;
}
