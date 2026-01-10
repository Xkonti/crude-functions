import type { OpenAPIHono } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";
import { createOpenAPIApp } from "../openapi_app.ts";
import type { ConsoleLogService } from "./console_log_service.ts";
import type { RoutesService } from "../routes/routes_service.ts";
import type { ConsoleLogLevel } from "./types.ts";
import {
  LogsQuerySchema,
  GetLogsResponseSchema,
  DeleteLogsParamSchema,
  DeleteLogsResponseSchema,
} from "../routes_schemas/logs.ts";
import { ErrorResponseSchema } from "../schemas/responses.ts";

export interface LogsRoutesOptions {
  consoleLogService: ConsoleLogService;
  routesService: RoutesService;
}

/**
 * GET /api/logs - Query logs with filtering
 */
const getLogsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Logs"],
  summary: "Get logs",
  description:
    "Retrieve function execution logs with optional filtering by function ID and log level. " +
    "Supports pagination using cursor-based approach. Logs include console output, errors, and execution lifecycle events.",
  request: {
    query: LogsQuerySchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: GetLogsResponseSchema,
        },
      },
      description: "Logs retrieved successfully",
    },
    400: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Invalid query parameters or cursor",
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

/**
 * DELETE /api/logs/:functionId - Delete logs for specific function
 */
const deleteLogsRoute = createRoute({
  method: "delete",
  path: "/{functionId}",
  tags: ["Logs"],
  summary: "Delete logs for function",
  description:
    "Delete all log entries for a specific function. This is a permanent operation that cannot be undone.",
  request: {
    params: DeleteLogsParamSchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: DeleteLogsResponseSchema,
        },
      },
      description: "Logs deleted successfully",
    },
    400: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Invalid functionId parameter",
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

export function createLogsRoutes(options: LogsRoutesOptions): OpenAPIHono {
  const { consoleLogService, routesService } = options;
  const routes = createOpenAPIApp();

  // GET /api/logs - Query logs with optional filtering
  routes.openapi(getLogsRoute, async (c) => {
    const { functionId: functionIdParam, level: levelParam, limit, cursor } =
      c.req.valid("query");

    // 1. Parse and validate functionId (optional)
    let routeId: number | undefined;

    if (functionIdParam) {
      // Verify route exists
      const route = await routesService.getById(functionIdParam);
      if (!route) {
        return c.json(
          { error: `Function with id ${functionIdParam} not found` },
          404,
        );
      }

      routeId = functionIdParam;
    }

    // 2. Parse and validate level (optional, comma-separated)
    let levels: ConsoleLogLevel[] | undefined;

    if (levelParam) {
      const validLevels = new Set<ConsoleLogLevel>([
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

      const requestedLevels = levelParam.split(",").map((l) => l.trim());
      const invalidLevels = requestedLevels.filter(
        (l) => !validLevels.has(l as ConsoleLogLevel),
      );

      if (invalidLevels.length > 0) {
        return c.json(
          {
            error:
              `Invalid level values: ${invalidLevels.join(", ")}. Valid levels: ${
                Array.from(validLevels).join(", ")
              }`,
          },
          400,
        );
      }

      levels = requestedLevels as ConsoleLogLevel[];
    }

    // 5. Query logs
    try {
      const result = await consoleLogService.getPaginated({
        routeId,
        levels,
        limit,
        cursor,
      });

      // 6. Build HATEOAS pagination links
      const baseUrl = "/api/logs";
      const queryParams = new URLSearchParams();

      if (routeId !== undefined) {
        queryParams.set("functionId", String(routeId));
      }
      if (levels !== undefined) {
        queryParams.set("level", levels.join(","));
      }
      queryParams.set("limit", String(limit));

      const pagination: {
        limit: number;
        hasMore: boolean;
        next?: string;
        prev?: string;
      } = {
        limit,
        hasMore: result.hasMore,
      };

      if (result.nextCursor) {
        const nextParams = new URLSearchParams(queryParams);
        nextParams.set("cursor", result.nextCursor);
        pagination.next = `${baseUrl}?${nextParams.toString()}`;
      }

      if (result.prevCursor) {
        const prevParams = new URLSearchParams(queryParams);
        prevParams.set("cursor", result.prevCursor);
        pagination.prev = `${baseUrl}?${prevParams.toString()}`;
      }

      return c.json(
        {
          data: {
            logs: result.logs,
            pagination,
          },
        },
        200
      );
    } catch (error) {
      if (
        error instanceof Error && error.message.includes("Invalid cursor")
      ) {
        return c.json({ error: error.message }, 400);
      }
      throw error;
    }
  });

  // DELETE /api/logs/:functionId - Delete logs for specific function
  routes.openapi(deleteLogsRoute, async (c) => {
    const { functionId } = c.req.valid("param");

    // Verify route exists
    const route = await routesService.getById(functionId);
    if (!route) {
      return c.json(
        { error: `Function with id ${functionId} not found` },
        404,
      );
    }

    const deleted = await consoleLogService.deleteByRouteId(functionId);

    return c.json(
      {
        data: {
          deleted,
          functionId,
        },
      },
      200
    );
  });

  return routes;
}
