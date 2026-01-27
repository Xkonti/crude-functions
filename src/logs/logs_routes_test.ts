import { integrationTest } from "../test/test_helpers.ts";
import { expect } from "@std/expect";
import { Hono } from "@hono/hono";
import { TestSetupBuilder } from "../test/test_setup_builder.ts";
import { createLogsRoutes } from "./logs_routes.ts";
import type { ConsoleLogService } from "./console_log_service.ts";
import type { RoutesService } from "../routes/routes_service.ts";
import type { FunctionRoute } from "../routes/routes_service.ts";
import type { ConsoleLog, ConsoleLogLevel } from "./types.ts";
import { recordIdToString } from "../database/surreal_helpers.ts";

interface LogsTestContext {
  app: Hono;
  consoleLogService: ConsoleLogService;
  routesService: RoutesService;
  routes: { route1: FunctionRoute; route2: FunctionRoute };
  cleanup: () => Promise<void>;
}

async function createTestContext(): Promise<LogsTestContext> {
  const ctx = await TestSetupBuilder.create()
    .withLogs()
    .withRoutes()
    .build();

  // Create test routes
  await ctx.routesService.addRoute({
    name: "test-route-1",
    routePath: "/test1",
    handler: "test1.ts",
    methods: ["GET"],
  });

  await ctx.routesService.addRoute({
    name: "test-route-2",
    routePath: "/test2",
    handler: "test2.ts",
    methods: ["GET"],
  });

  const route1 = await ctx.routesService.getByName("test-route-1");
  const route2 = await ctx.routesService.getByName("test-route-2");

  if (!route1 || !route2) {
    throw new Error("Failed to create test routes");
  }

  const app = new Hono();
  app.route("/api/logs", createLogsRoutes({
    consoleLogService: ctx.consoleLogService,
    routesService: ctx.routesService,
  }));

  return {
    app,
    consoleLogService: ctx.consoleLogService,
    routesService: ctx.routesService,
    routes: { route1, route2 },
    cleanup: ctx.cleanup,
  };
}

// Helper to insert test logs
async function insertLogs(
  service: ConsoleLogService,
  routeId: string,
  count: number,
  level: ConsoleLogLevel = "log",
  baseRequestId = "req",
): Promise<void> {
  for (let i = 0; i < count; i++) {
    service.store({
      requestId: `${baseRequestId}-${i}`,
      routeId,
      level,
      message: `Test message ${i}`,
    });
  }
  await service.flush();
}

// GET /api/logs - Basic Queries

integrationTest("GET /api/logs returns empty array when no logs exist", async () => {
  const ctx = await createTestContext();
  try {
    const res = await ctx.app.request("/api/logs");
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.logs).toEqual([]);
    expect(json.data.pagination.hasMore).toBe(false);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/logs returns all logs across functions when no filters", async () => {
  const ctx = await createTestContext();
  try {
    await insertLogs(ctx.consoleLogService, recordIdToString(ctx.routes.route1.id), 5);
    await insertLogs(ctx.consoleLogService, recordIdToString(ctx.routes.route2.id), 3);

    const res = await ctx.app.request("/api/logs");
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.logs.length).toBe(8);
    expect(json.data.pagination.hasMore).toBe(false);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/logs filters by functionId correctly", async () => {
  const ctx = await createTestContext();
  try {
    await insertLogs(ctx.consoleLogService, recordIdToString(ctx.routes.route1.id), 5);
    await insertLogs(ctx.consoleLogService, recordIdToString(ctx.routes.route2.id), 3);

    const res = await ctx.app.request(
      `/api/logs?functionId=${recordIdToString(ctx.routes.route1.id)}`,
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.logs.length).toBe(5);
    expect(json.data.logs.every((log: ConsoleLog) => log.routeId === recordIdToString(ctx.routes.route1.id))).toBe(true);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/logs filters by single level", async () => {
  const ctx = await createTestContext();
  try {
    await insertLogs(ctx.consoleLogService, recordIdToString(ctx.routes.route1.id), 3, "error");
    await insertLogs(ctx.consoleLogService, recordIdToString(ctx.routes.route1.id), 2, "warn");
    await insertLogs(ctx.consoleLogService, recordIdToString(ctx.routes.route1.id), 1, "info");

    const res = await ctx.app.request("/api/logs?level=error");
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.logs.length).toBe(3);
    expect(json.data.logs.every((log: ConsoleLog) => log.level === "error")).toBe(true);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/logs filters by multiple levels", async () => {
  const ctx = await createTestContext();
  try {
    await insertLogs(ctx.consoleLogService, recordIdToString(ctx.routes.route1.id), 3, "error");
    await insertLogs(ctx.consoleLogService, recordIdToString(ctx.routes.route1.id), 2, "warn");
    await insertLogs(ctx.consoleLogService, recordIdToString(ctx.routes.route1.id), 1, "info");

    const res = await ctx.app.request("/api/logs?level=error,warn");
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.logs.length).toBe(5);
    expect(
      json.data.logs.every((log: ConsoleLog) =>
        log.level === "error" || log.level === "warn"
      ),
    ).toBe(true);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/logs combines functionId and level filters", async () => {
  const ctx = await createTestContext();
  try {
    await insertLogs(ctx.consoleLogService, recordIdToString(ctx.routes.route1.id), 3, "error");
    await insertLogs(ctx.consoleLogService, recordIdToString(ctx.routes.route1.id), 2, "info");
    await insertLogs(ctx.consoleLogService, recordIdToString(ctx.routes.route2.id), 2, "error");

    const res = await ctx.app.request(
      `/api/logs?functionId=${recordIdToString(ctx.routes.route1.id)}&level=error`,
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.logs.length).toBe(3);
    expect(json.data.logs.every((log: ConsoleLog) =>
      log.routeId === recordIdToString(ctx.routes.route1.id) && log.level === "error"
    )).toBe(true);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/logs respects default limit of 50", async () => {
  const ctx = await createTestContext();
  try {
    await insertLogs(ctx.consoleLogService, recordIdToString(ctx.routes.route1.id), 60);

    const res = await ctx.app.request("/api/logs");
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.logs.length).toBe(50);
    expect(json.data.pagination.limit).toBe(50);
    expect(json.data.pagination.hasMore).toBe(true);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/logs respects custom limit", async () => {
  const ctx = await createTestContext();
  try {
    await insertLogs(ctx.consoleLogService, recordIdToString(ctx.routes.route1.id), 20);

    const res = await ctx.app.request("/api/logs?limit=10");
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.logs.length).toBe(10);
    expect(json.data.pagination.limit).toBe(10);
    expect(json.data.pagination.hasMore).toBe(true);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/logs returns logs ordered newest to oldest", async () => {
  const ctx = await createTestContext();
  try {
    await insertLogs(ctx.consoleLogService, recordIdToString(ctx.routes.route1.id), 5);

    const res = await ctx.app.request("/api/logs");
    const json = await res.json();

    expect(res.status).toBe(200);
    const logs = json.data.logs;

    // Verify descending order by timestamp and ID
    for (let i = 0; i < logs.length - 1; i++) {
      const current = new Date(logs[i].timestamp);
      const next = new Date(logs[i + 1].timestamp);
      expect(current >= next).toBe(true);
    }
  } finally {
    await ctx.cleanup();
  }
});

// GET /api/logs - Validation

integrationTest("GET /api/logs returns 400 for invalid functionId format", async () => {
  const ctx = await createTestContext();
  try {
    const res = await ctx.app.request("/api/logs?functionId=invalid");
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("Invalid functionId");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/logs returns 404 for non-existent functionId", async () => {
  const ctx = await createTestContext();
  try {
    const res = await ctx.app.request("/api/logs?functionId=999999");
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain("not found");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/logs returns 400 for invalid level value", async () => {
  const ctx = await createTestContext();
  try {
    const res = await ctx.app.request("/api/logs?level=invalid");
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("Invalid level values");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/logs returns 400 for limit < 1", async () => {
  const ctx = await createTestContext();
  try {
    const res = await ctx.app.request("/api/logs?limit=0");
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("Invalid limit");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/logs returns 400 for limit > 1000", async () => {
  const ctx = await createTestContext();
  try {
    const res = await ctx.app.request("/api/logs?limit=1001");
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("Invalid limit");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/logs returns 400 for malformed cursor", async () => {
  const ctx = await createTestContext();
  try {
    const res = await ctx.app.request("/api/logs?cursor=not-valid-base64!");
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("Invalid cursor");
  } finally {
    await ctx.cleanup();
  }
});

// GET /api/logs - Pagination

integrationTest("GET /api/logs hasMore=true when more logs exist", async () => {
  const ctx = await createTestContext();
  try {
    await insertLogs(ctx.consoleLogService, recordIdToString(ctx.routes.route1.id), 60);

    const res = await ctx.app.request("/api/logs?limit=50");
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.pagination.hasMore).toBe(true);
    expect(json.data.pagination.next).toBeDefined();
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/logs hasMore=false when all logs retrieved", async () => {
  const ctx = await createTestContext();
  try {
    await insertLogs(ctx.consoleLogService, recordIdToString(ctx.routes.route1.id), 10);

    const res = await ctx.app.request("/api/logs?limit=50");
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.pagination.hasMore).toBe(false);
    expect(json.data.pagination.next).toBeUndefined();
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/logs includes next link when hasMore=true", async () => {
  const ctx = await createTestContext();
  try {
    await insertLogs(ctx.consoleLogService, recordIdToString(ctx.routes.route1.id), 60);

    const res = await ctx.app.request("/api/logs?limit=50");
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.pagination.next).toBeDefined();
    expect(json.data.pagination.next).toContain("/api/logs");
    expect(json.data.pagination.next).toContain("cursor=");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/logs does not include next link when hasMore=false", async () => {
  const ctx = await createTestContext();
  try {
    await insertLogs(ctx.consoleLogService, recordIdToString(ctx.routes.route1.id), 10);

    const res = await ctx.app.request("/api/logs");
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.pagination.next).toBeUndefined();
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/logs includes prev link when cursor provided", async () => {
  const ctx = await createTestContext();
  try {
    await insertLogs(ctx.consoleLogService, recordIdToString(ctx.routes.route1.id), 60);

    // Get first page
    const res1 = await ctx.app.request("/api/logs?limit=10");
    const json1 = await res1.json();
    const nextLink = json1.data.pagination.next;

    // Get second page
    const res2 = await ctx.app.request(nextLink);
    const json2 = await res2.json();

    expect(res2.status).toBe(200);
    expect(json2.data.pagination.prev).toBeDefined();
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/logs does not include prev link on first page", async () => {
  const ctx = await createTestContext();
  try {
    await insertLogs(ctx.consoleLogService, recordIdToString(ctx.routes.route1.id), 60);

    const res = await ctx.app.request("/api/logs?limit=10");
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.pagination.prev).toBeUndefined();
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/logs next cursor retrieves correct second page", async () => {
  const ctx = await createTestContext();
  try {
    await insertLogs(ctx.consoleLogService, recordIdToString(ctx.routes.route1.id), 15);

    // Get first page
    const res1 = await ctx.app.request("/api/logs?limit=10");
    const json1 = await res1.json();
    const firstPageIds = json1.data.logs.map((log: ConsoleLog) => log.id);

    // Get second page
    const nextLink = json1.data.pagination.next;
    const res2 = await ctx.app.request(nextLink);
    const json2 = await res2.json();
    const secondPageIds = json2.data.logs.map((log: ConsoleLog) => log.id);

    expect(res2.status).toBe(200);
    expect(json2.data.logs.length).toBe(5);
    // Ensure no overlap between pages
    expect(firstPageIds.some((id: number) => secondPageIds.includes(id))).toBe(false);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/logs preserves functionId in pagination links", async () => {
  const ctx = await createTestContext();
  try {
    await insertLogs(ctx.consoleLogService, recordIdToString(ctx.routes.route1.id), 60);

    const res = await ctx.app.request(
      `/api/logs?functionId=${recordIdToString(ctx.routes.route1.id)}&limit=10`,
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.pagination.next).toContain(`functionId=${recordIdToString(ctx.routes.route1.id)}`);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/logs preserves level filter in pagination links", async () => {
  const ctx = await createTestContext();
  try {
    await insertLogs(ctx.consoleLogService, recordIdToString(ctx.routes.route1.id), 60, "error");

    const res = await ctx.app.request("/api/logs?level=error&limit=10");
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.pagination.next).toContain("level=error");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/logs preserves custom limit in pagination links", async () => {
  const ctx = await createTestContext();
  try {
    await insertLogs(ctx.consoleLogService, recordIdToString(ctx.routes.route1.id), 60);

    const res = await ctx.app.request("/api/logs?limit=25");
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.pagination.next).toContain("limit=25");
  } finally {
    await ctx.cleanup();
  }
});

// GET /api/logs - Edge Cases

integrationTest("GET /api/logs handles logs with identical timestamps", async () => {
  const ctx = await createTestContext();
  try {
    // Insert logs at the same time - they'll have identical timestamps
    for (let i = 0; i < 5; i++) {
      ctx.consoleLogService.store({
        requestId: `req-${i}`,
        routeId: recordIdToString(ctx.routes.route1.id),
        level: "log",
        message: `Message ${i}`,
      });
    }
    await ctx.consoleLogService.flush();

    const res = await ctx.app.request("/api/logs?limit=3");
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.logs.length).toBe(3);
    expect(json.data.pagination.hasMore).toBe(true);

    // Pagination should work correctly even with same timestamps
    const res2 = await ctx.app.request(json.data.pagination.next);
    const json2 = await res2.json();

    expect(res2.status).toBe(200);
    expect(json2.data.logs.length).toBe(2);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/logs works with empty result after cursor", async () => {
  const ctx = await createTestContext();
  try {
    await insertLogs(ctx.consoleLogService, recordIdToString(ctx.routes.route1.id), 10);

    // Get all logs
    const res1 = await ctx.app.request("/api/logs?limit=10");
    const json1 = await res1.json();

    // If there was a next cursor, following it should return empty
    if (json1.data.pagination.next) {
      const res2 = await ctx.app.request(json1.data.pagination.next);
      const json2 = await res2.json();

      expect(res2.status).toBe(200);
      expect(json2.data.logs.length).toBe(0);
      expect(json2.data.pagination.hasMore).toBe(false);
    }
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/logs pagination with level filtering works correctly", async () => {
  const ctx = await createTestContext();
  try {
    await insertLogs(ctx.consoleLogService, recordIdToString(ctx.routes.route1.id), 30, "error");
    await insertLogs(ctx.consoleLogService, recordIdToString(ctx.routes.route1.id), 30, "info");

    const res1 = await ctx.app.request("/api/logs?level=error&limit=20");
    const json1 = await res1.json();

    expect(res1.status).toBe(200);
    expect(json1.data.logs.length).toBe(20);
    expect(json1.data.logs.every((log: ConsoleLog) => log.level === "error")).toBe(true);
    expect(json1.data.pagination.hasMore).toBe(true);

    // Get next page
    const res2 = await ctx.app.request(json1.data.pagination.next);
    const json2 = await res2.json();

    expect(res2.status).toBe(200);
    expect(json2.data.logs.length).toBe(10);
    expect(json2.data.logs.every((log: ConsoleLog) => log.level === "error")).toBe(true);
  } finally {
    await ctx.cleanup();
  }
});

// DELETE /api/logs/:functionId

integrationTest("DELETE /api/logs/:functionId deletes logs and returns count", async () => {
  const ctx = await createTestContext();
  try {
    await insertLogs(ctx.consoleLogService, recordIdToString(ctx.routes.route1.id), 10);

    const res = await ctx.app.request(
      `/api/logs/${recordIdToString(ctx.routes.route1.id)}`,
      { method: "DELETE" },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.deleted).toBe(10);
    expect(json.data.functionId).toBe(recordIdToString(ctx.routes.route1.id));

    // Verify logs are actually deleted
    const logsRes = await ctx.app.request(
      `/api/logs?functionId=${recordIdToString(ctx.routes.route1.id)}`,
    );
    const logsJson = await logsRes.json();
    expect(logsJson.data.logs.length).toBe(0);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("DELETE /api/logs/:functionId returns count=0 when no logs exist", async () => {
  const ctx = await createTestContext();
  try {
    const res = await ctx.app.request(
      `/api/logs/${recordIdToString(ctx.routes.route1.id)}`,
      { method: "DELETE" },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.deleted).toBe(0);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("DELETE /api/logs/:functionId returns 400 for invalid functionId format", async () => {
  const ctx = await createTestContext();
  try {
    const res = await ctx.app.request("/api/logs/invalid", { method: "DELETE" });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("Invalid functionId");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("DELETE /api/logs/:functionId returns 404 for non-existent functionId", async () => {
  const ctx = await createTestContext();
  try {
    const res = await ctx.app.request("/api/logs/999999", { method: "DELETE" });
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain("not found");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("DELETE /api/logs/:functionId only deletes specified function's logs", async () => {
  const ctx = await createTestContext();
  try {
    await insertLogs(ctx.consoleLogService, recordIdToString(ctx.routes.route1.id), 10);
    await insertLogs(ctx.consoleLogService, recordIdToString(ctx.routes.route2.id), 5);

    const res = await ctx.app.request(
      `/api/logs/${recordIdToString(ctx.routes.route1.id)}`,
      { method: "DELETE" },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.deleted).toBe(10);

    // Verify route2 logs are still there
    const logsRes = await ctx.app.request(
      `/api/logs?functionId=${recordIdToString(ctx.routes.route2.id)}`,
    );
    const logsJson = await logsRes.json();
    expect(logsJson.data.logs.length).toBe(5);
  } finally {
    await ctx.cleanup();
  }
});

// Response Format

integrationTest("GET /api/logs has correct data wrapper structure", async () => {
  const ctx = await createTestContext();
  try {
    await insertLogs(ctx.consoleLogService, recordIdToString(ctx.routes.route1.id), 1);

    const res = await ctx.app.request("/api/logs");
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toHaveProperty("data");
    expect(json.data).toHaveProperty("logs");
    expect(json.data).toHaveProperty("pagination");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/logs pagination object has correct structure", async () => {
  const ctx = await createTestContext();
  try {
    await insertLogs(ctx.consoleLogService, recordIdToString(ctx.routes.route1.id), 10);

    const res = await ctx.app.request("/api/logs");
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.pagination).toHaveProperty("limit");
    expect(json.data.pagination).toHaveProperty("hasMore");
    expect(typeof json.data.pagination.limit).toBe("number");
    expect(typeof json.data.pagination.hasMore).toBe("boolean");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/logs log objects have all required fields", async () => {
  const ctx = await createTestContext();
  try {
    await insertLogs(ctx.consoleLogService, recordIdToString(ctx.routes.route1.id), 1);

    const res = await ctx.app.request("/api/logs");
    const json = await res.json();

    expect(res.status).toBe(200);
    const log = json.data.logs[0];
    expect(log).toHaveProperty("id");
    expect(log).toHaveProperty("requestId");
    expect(log).toHaveProperty("routeId");
    expect(log).toHaveProperty("level");
    expect(log).toHaveProperty("message");
    expect(log).toHaveProperty("timestamp");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/logs timestamps are in ISO format", async () => {
  const ctx = await createTestContext();
  try {
    await insertLogs(ctx.consoleLogService, recordIdToString(ctx.routes.route1.id), 1);

    const res = await ctx.app.request("/api/logs");
    const json = await res.json();

    expect(res.status).toBe(200);
    const log = json.data.logs[0];
    const timestamp = new Date(log.timestamp);
    expect(timestamp.toString()).not.toBe("Invalid Date");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("GET /api/logs HATEOAS links are relative paths", async () => {
  const ctx = await createTestContext();
  try {
    await insertLogs(ctx.consoleLogService, recordIdToString(ctx.routes.route1.id), 60);

    const res = await ctx.app.request("/api/logs?limit=10");
    const json = await res.json();

    expect(res.status).toBe(200);
    if (json.data.pagination.next) {
      expect(json.data.pagination.next).toMatch(/^\/api\/logs/);
      expect(json.data.pagination.next).not.toMatch(/^http/);
    }
  } finally {
    await ctx.cleanup();
  }
});
