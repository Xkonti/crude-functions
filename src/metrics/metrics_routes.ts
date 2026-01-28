import { Hono } from "@hono/hono";
import { RecordId } from "surrealdb";
import type { ExecutionMetricsService } from "./execution_metrics_service.ts";
import type { RoutesService } from "../routes/routes_service.ts";
import type { SettingsService } from "../settings/settings_service.ts";
import { validateSurrealId } from "../validation/common.ts";
import type { ExecutionMetric, MetricType } from "./types.ts";
import { SettingNames } from "../settings/types.ts";

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

export function createMetricsRoutes(options: MetricsRoutesOptions): Hono {
  const { executionMetricsService, routesService, settingsService } = options;
  const routes = new Hono();

  // GET /api/metrics - Query metrics with optional functionId and required resolution
  routes.get("/", async (c) => {
    // 1. Parse and validate resolution (required)
    const resolution = c.req.query("resolution");

    if (!resolution) {
      return c.json(
        { error: "Missing required parameter: resolution" },
        400,
      );
    }

    if (!VALID_RESOLUTIONS.includes(resolution)) {
      return c.json(
        {
          error: `Invalid resolution parameter. Must be one of: ${
            VALID_RESOLUTIONS.join(", ")
          }`,
        },
        400,
      );
    }

    const metricType = RESOLUTION_TO_TYPE[resolution];

    // 2. Parse and validate functionId (optional)
    const functionIdParam = c.req.query("functionId");
    let functionId: RecordId | null = null;
    let functionIdStr: string | null = null;

    if (functionIdParam) {
      const parsed = validateSurrealId(functionIdParam);
      if (parsed === null) {
        return c.json({ error: "Invalid functionId parameter" }, 400);
      }

      // Verify route exists
      const route = await routesService.getById(parsed);
      if (!route) {
        return c.json({ error: `Function with id ${parsed} not found` }, 404);
      }

      functionId = route.id;
      functionIdStr = parsed;
    }

    // 3. Calculate time range based on resolution
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
          SettingNames.METRICS_RETENTION_DAYS,
        );
        const retentionDays = retentionDaysStr
          ? parseInt(retentionDaysStr, 10)
          : 90;
        startTime = new Date(
          now.getTime() - retentionDays * 24 * 60 * 60 * 1000,
        );
        break;
      }
      default:
        // Should never reach here due to validation above
        return c.json({ error: "Invalid resolution" }, 400);
    }

    // 4. Query metrics
    const metrics: ExecutionMetric[] = functionId === null
      ? await executionMetricsService.getGlobalMetricsByTypeAndTimeRange(
        metricType,
        startTime,
        now,
      )
      : await executionMetricsService.getByFunctionIdTypeAndTimeRange(
        functionId,
        metricType,
        startTime,
        now,
      );

    // 5. Calculate summary
    const summary: MetricsSummary = {
      totalExecutions: 0,
      avgExecutionTime: 0,
      maxExecutionTime: 0,
      periodCount: metrics.length,
    };

    if (metrics.length > 0) {
      summary.totalExecutions = metrics.reduce(
        (sum, m) => sum + m.executionCount,
        0,
      );
      // maxExecutionTime is in microseconds, convert to milliseconds for API
      summary.maxExecutionTime = Math.max(
        ...metrics.map((m) => m.maxTimeUs / 1000),
      );

      // Weighted average (in microseconds, convert to milliseconds for API)
      if (summary.totalExecutions > 0) {
        const weightedSum = metrics.reduce(
          (sum, m) => sum + m.avgTimeUs * m.executionCount,
          0,
        );
        summary.avgExecutionTime = (weightedSum / summary.totalExecutions) / 1000;
      }
    }

    // 6. Format response (convert microseconds to milliseconds for API backward compatibility)
    const formattedMetrics = metrics.map((m) => ({
      timestamp: m.timestamp.toISOString(),
      avgTimeMs: m.avgTimeUs / 1000,
      maxTimeMs: m.maxTimeUs / 1000,
      executionCount: m.executionCount,
    }));

    return c.json({
      data: {
        metrics: formattedMetrics,
        functionId: functionIdStr,
        resolution,
        summary,
      },
    });
  });

  return routes;
}
