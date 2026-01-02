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

/**
 * Parse an environment variable as a positive integer.
 * Returns the parsed value or the default if parsing fails or value is invalid.
 */
function parseEnvInt(
  name: string,
  defaultValue: number,
  options?: { min?: number; max?: number }
): number {
  const raw = Deno.env.get(name);
  if (!raw) return defaultValue;

  const parsed = parseInt(raw, 10);
  if (isNaN(parsed)) {
    console.warn(`Invalid ${name}: "${raw}" is not a number. Using default: ${defaultValue}`);
    return defaultValue;
  }

  if (options?.min !== undefined && parsed < options.min) {
    console.warn(`${name} (${parsed}) is below minimum (${options.min}). Using default: ${defaultValue}`);
    return defaultValue;
  }

  if (options?.max !== undefined && parsed > options.max) {
    console.warn(`${name} (${parsed}) is above maximum (${options.max}). Using default: ${defaultValue}`);
    return defaultValue;
  }

  return parsed;
}

// AbortController for graceful shutdown - must be module-scoped
let abortController: AbortController | null = null;

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
  aggregationIntervalSeconds: parseEnvInt("METRICS_AGGREGATION_INTERVAL_SECONDS", 60, { min: 1 }),
  retentionDays: parseEnvInt("METRICS_RETENTION_DAYS", 90, { min: 1 }),
};
const metricsAggregationService = new MetricsAggregationService({
  metricsService: executionMetricsService,
  config: metricsAggregationConfig,
});
metricsAggregationService.start();

// Initialize and start log trimming service
const logTrimmingConfig: LogTrimmingConfig = {
  trimmingIntervalSeconds: parseEnvInt("LOG_TRIMMING_INTERVAL_SECONDS", 300, { min: 1 }),
  maxLogsPerRoute: parseEnvInt("LOG_MAX_PER_ROUTE", 2000, { min: 1 }),
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
    // 1. Stop accepting new requests first
    if (abortController) {
      abortController.abort();
      console.log("Stopped accepting new connections");
    }

    // 2. Wait for in-flight requests to drain (5 seconds)
    const drainTimeoutMs = 5000;
    console.log(`Waiting ${drainTimeoutMs}ms for requests to drain...`);
    await new Promise((resolve) => setTimeout(resolve, drainTimeoutMs));

    // 3. Stop log trimming service (waits for current processing)
    await logTrimmingService.stop();
    console.log("Log trimming service stopped");

    // 4. Stop aggregation service (waits for current processing)
    await metricsAggregationService.stop();
    console.log("Metrics aggregation service stopped");

    // 5. Close database last
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
  const port = parseEnvInt("PORT", 8000, { min: 1, max: 65535 });

  // Setup graceful shutdown - assign to module-scoped variable
  abortController = new AbortController();

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
