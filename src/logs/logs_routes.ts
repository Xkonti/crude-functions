import { Hono } from "@hono/hono";
import type { ConsoleLogService } from "./console_log_service.ts";
import type { RoutesService } from "../routes/routes_service.ts";
import { validateSurrealId } from "../validation/common.ts";
import type { ConsoleLogLevel } from "./types.ts";

export interface LogsRoutesOptions {
  consoleLogService: ConsoleLogService;
  routesService: RoutesService;
}

export function createLogsRoutes(options: LogsRoutesOptions): Hono {
  const { consoleLogService, routesService } = options;
  const routes = new Hono();

  // GET /api/logs - Query logs with optional filtering
  routes.get("/", async (c) => {
    // 1. Parse and validate functionId (optional)
    const functionIdParam = c.req.query("functionId");
    let functionId: string | undefined;

    if (functionIdParam) {
      const parsed = validateSurrealId(functionIdParam);
      if (parsed === null) {
        return c.json({ error: "Invalid functionId parameter" }, 400);
      }

      // Verify function exists
      const route = await routesService.getById(parsed);
      if (!route) {
        return c.json({ error: `Function with id ${parsed} not found` }, 404);
      }

      functionId = parsed;
    }

    // 2. Parse and validate level (optional, comma-separated)
    const levelParam = c.req.query("level");
    let levels: ConsoleLogLevel[] | undefined;

    if (levelParam) {
      const validLevels = new Set<ConsoleLogLevel>([
        "log", "debug", "info", "warn", "error", "trace",
        "stdout", "stderr", "exec_start", "exec_end", "exec_reject",
      ]);

      const requestedLevels = levelParam.split(",").map((l) => l.trim());
      const invalidLevels = requestedLevels.filter((l) =>
        !validLevels.has(l as ConsoleLogLevel)
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

    // 3. Parse and validate limit
    const limitParam = c.req.query("limit");
    const limit = limitParam ? parseInt(limitParam, 10) : 50;

    if (isNaN(limit) || limit < 1 || limit > 1000) {
      return c.json(
        { error: "Invalid limit parameter. Must be between 1 and 1000" },
        400,
      );
    }

    // 4. Get cursor (service validates format)
    const cursor = c.req.query("cursor");

    // 5. Query logs
    try {
      const result = await consoleLogService.getPaginated({
        functionId,
        levels,
        limit,
        cursor,
      });

      // 6. Build HATEOAS pagination links
      const baseUrl = "/api/logs";
      const queryParams = new URLSearchParams();

      if (functionId !== undefined) {
        queryParams.set("functionId", functionId);
      }
      if (levels !== undefined) {
        queryParams.set("level", levels.join(","));
      }
      queryParams.set("limit", String(limit));

      const pagination: Record<string, unknown> = {
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

      return c.json({
        data: {
          logs: result.logs,
          pagination,
        },
      });
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
  routes.delete("/:functionId", async (c) => {
    const functionId = validateSurrealId(c.req.param("functionId"));

    if (functionId === null) {
      return c.json({ error: "Invalid functionId parameter" }, 400);
    }

    // Verify function exists
    const route = await routesService.getById(functionId);
    if (!route) {
      return c.json(
        { error: `Function with id ${functionId} not found` },
        404,
      );
    }

    const deleted = await consoleLogService.deleteByFunctionId(functionId);

    return c.json({
      data: {
        deleted,
        functionId,
      },
    });
  });

  return routes;
}
