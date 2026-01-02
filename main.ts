import { Hono } from "@hono/hono";
import "@std/dotenv/load";
import { DatabaseService } from "./src/database/database_service.ts";
import { MigrationService } from "./src/database/migration_service.ts";
import { ApiKeyService } from "./src/keys/api_key_service.ts";
import { createApiKeyRoutes } from "./src/keys/api_key_routes.ts";
import { createManagementAuthMiddleware } from "./src/middleware/management_auth.ts";
import { RoutesService } from "./src/routes/routes_service.ts";
import { createRoutesRoutes } from "./src/routes/routes_routes.ts";
import { FunctionRouter } from "./src/functions/function_router.ts";
import { FileService } from "./src/files/file_service.ts";
import { createFileRoutes } from "./src/files/file_routes.ts";
import { createWebRoutes } from "./src/web/web_routes.ts";
import { ConsoleLogService } from "./src/logs/console_log_service.ts";
import { ConsoleInterceptor } from "./src/logs/console_interceptor.ts";
import { ExecutionMetricsService } from "./src/metrics/execution_metrics_service.ts";
import { MetricsAggregationService } from "./src/metrics/metrics_aggregation_service.ts";
import type { MetricsAggregationConfig } from "./src/metrics/types.ts";
import { LogTrimmingService } from "./src/logs/log_trimming_service.ts";
import type { LogTrimmingConfig } from "./src/logs/log_trimming_types.ts";

const app = new Hono();

// Initialize database
// The database connection remains open for the application's lifetime and is
// only closed during graceful shutdown (SIGTERM/SIGINT signals).
// Services assume the database is always open after this initialization.
const db = new DatabaseService({
  databasePath: "./data/database.db",
});
await db.open();

// Run migrations
const migrationService = new MigrationService({
  db,
  migrationsDir: "./migrations",
});
const migrationResult = await migrationService.migrate();
if (migrationResult.appliedCount > 0) {
  console.log(
    `Applied ${migrationResult.appliedCount} migration(s): version ${migrationResult.fromVersion ?? "none"} → ${migrationResult.toVersion}`
  );
}

// Initialize console log capture
// Must be installed after migrations but before handling requests
const consoleLogService = new ConsoleLogService({ db });
const consoleInterceptor = new ConsoleInterceptor({ logService: consoleLogService });
consoleInterceptor.install();

// Initialize execution metrics service
const executionMetricsService = new ExecutionMetricsService({ db });

// Initialize and start metrics aggregation service
const metricsAggregationConfig: MetricsAggregationConfig = {
  aggregationIntervalSeconds: parseInt(
    Deno.env.get("METRICS_AGGREGATION_INTERVAL_SECONDS") || "60"
  ),
  retentionDays: parseInt(
    Deno.env.get("METRICS_RETENTION_DAYS") || "90"
  ),
};
const metricsAggregationService = new MetricsAggregationService({
  metricsService: executionMetricsService,
  config: metricsAggregationConfig,
});
metricsAggregationService.start();

// Initialize and start log trimming service
const logTrimmingConfig: LogTrimmingConfig = {
  trimmingIntervalSeconds: parseInt(
    Deno.env.get("LOG_TRIMMING_INTERVAL_SECONDS") || "300"
  ),
  maxLogsPerRoute: parseInt(
    Deno.env.get("LOG_MAX_PER_ROUTE") || "2000"
  ),
};
const logTrimmingService = new LogTrimmingService({
  logService: consoleLogService,
  config: logTrimmingConfig,
});
logTrimmingService.start();

// Initialize API key service
const apiKeyService = new ApiKeyService({
  db,
  managementKeyFromEnv: Deno.env.get("MANAGEMENT_API_KEY"),
});

// Initialize routes service
const routesService = new RoutesService({
  db,
});

// Initialize function router
const functionRouter = new FunctionRouter({
  routesService,
  apiKeyService,
  consoleLogService,
  executionMetricsService,
  codeDirectory: "./code",
});

// Public endpoints
app.get("/ping", (c) => c.json({ pong: true }));

// Protected API management routes
app.use("/api/keys/*", createManagementAuthMiddleware(apiKeyService));
app.use("/api/keys", createManagementAuthMiddleware(apiKeyService));
app.route("/api/keys", createApiKeyRoutes(apiKeyService));

app.use("/api/routes/*", createManagementAuthMiddleware(apiKeyService));
app.use("/api/routes", createManagementAuthMiddleware(apiKeyService));
app.route("/api/routes", createRoutesRoutes(routesService));

// Initialize file service
const fileService = new FileService({
  basePath: "./code",
});

// Protected file management routes
app.use("/api/files/*", createManagementAuthMiddleware(apiKeyService));
app.use("/api/files", createManagementAuthMiddleware(apiKeyService));
app.route("/api/files", createFileRoutes(fileService));

// Web UI routes (Basic Auth applied internally)
app.route("/web", createWebRoutes({
  fileService,
  routesService,
  apiKeyService,
  consoleLogService,
  executionMetricsService,
}));

// Dynamic function router - catch all /run/* requests
app.all("/run/*", (c) => functionRouter.handle(c));
app.all("/run", (c) => functionRouter.handle(c));

// Export app and services for testing
export { app, apiKeyService, routesService, functionRouter, fileService, consoleLogService, executionMetricsService, logTrimmingService };

// Graceful shutdown handler
async function gracefulShutdown(signal: string) {
  console.log(`\nReceived ${signal}, shutting down gracefully...`);
  try {
    // Stop log trimming service first (waits for current processing)
    await logTrimmingService.stop();
    console.log("Log trimming service stopped");

    // Stop aggregation service (waits for current processing)
    await metricsAggregationService.stop();
    console.log("Metrics aggregation service stopped");

    await db.close();
    console.log("Database connection closed successfully");
  } catch (error) {
    console.error("Error during shutdown:", error);
    Deno.exit(1);
  }
  Deno.exit(0);
}

// Start server only when run directly
if (import.meta.main) {
  const port = parseInt(Deno.env.get("PORT") || "8000");

  // Setup graceful shutdown
  const abortController = new AbortController();

  Deno.addSignalListener("SIGTERM", () => {
    gracefulShutdown("SIGTERM");
  });

  Deno.addSignalListener("SIGINT", () => {
    gracefulShutdown("SIGINT");
  });

  Deno.serve({
    port,
    signal: abortController.signal,
  }, app.fetch);
}
