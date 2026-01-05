import { Hono } from "@hono/hono";
import "@std/dotenv/load";

// Install environment isolation IMMEDIATELY after dotenv loads.
// This must happen before any handlers load to ensure they see the proxy.
// System code (services, startup) runs outside handler context and sees real env.
import { EnvIsolator } from "./src/env/env_isolator.ts";
const envIsolator = new EnvIsolator();
envIsolator.install();

// Install process isolation to prevent handlers from exiting/changing working directory.
// This must happen before any handlers load to ensure they see the intercepted methods.
import { ProcessIsolator } from "./src/process/process_isolator.ts";
const processIsolator = new ProcessIsolator();
processIsolator.install();

import { DatabaseService } from "./src/database/database_service.ts";
import { MigrationService } from "./src/database/migration_service.ts";
import { createAuth } from "./src/auth/auth.ts";
import { createHybridAuthMiddleware } from "./src/auth/auth_middleware.ts";
import { ApiKeyService } from "./src/keys/api_key_service.ts";
import { createApiKeyRoutes } from "./src/keys/api_key_routes.ts";
import { RoutesService } from "./src/routes/routes_service.ts";
import { createRoutesRoutes } from "./src/routes/routes_routes.ts";
import { FunctionRouter } from "./src/functions/function_router.ts";
import { FileService } from "./src/files/file_service.ts";
import { createFileRoutes } from "./src/files/file_routes.ts";
import { createWebRoutes } from "./src/web/web_routes.ts";
import { ConsoleLogService } from "./src/logs/console_log_service.ts";
import { StreamInterceptor } from "./src/logs/stream_interceptor.ts";
import { ExecutionMetricsService } from "./src/metrics/execution_metrics_service.ts";
import { MetricsAggregationService } from "./src/metrics/metrics_aggregation_service.ts";
import type { MetricsAggregationConfig } from "./src/metrics/types.ts";
import { LogTrimmingService } from "./src/logs/log_trimming_service.ts";
import type { LogTrimmingConfig } from "./src/logs/log_trimming_types.ts";
import { base64ToBytes } from "./src/encryption/utils.ts";
import { EncryptionService } from "./src/encryption/encryption_service.ts";
import { SecretsService } from "./src/secrets/secrets_service.ts";

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

// ============================================================================
// Encryption Key Validation
// ============================================================================

// Validate secrets encryption key (REQUIRED)
const secretsEncryptionKey = Deno.env.get("SECRETS_ENCRYPTION_KEY");
if (!secretsEncryptionKey) {
  console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.error("FATAL ERROR: SECRETS_ENCRYPTION_KEY is required");
  console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.error("");
  console.error("This environment variable must be set to encrypt secrets at rest.");
  console.error("Generate a new key with:");
  console.error("");
  console.error("  openssl rand -base64 32");
  console.error("");
  console.error("Then set it in your environment or .env file:");
  console.error("");
  console.error("  SECRETS_ENCRYPTION_KEY=<generated-key>");
  console.error("");
  Deno.exit(1);
}

// Validate key format early (before database operations)
try {
  const keyBytes = base64ToBytes(secretsEncryptionKey);
  if (keyBytes.length !== 32) {
    throw new Error(
      `Key must be 32 bytes (256 bits), got ${keyBytes.length} bytes`
    );
  }
} catch (error) {
  console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.error("FATAL ERROR: Invalid SECRETS_ENCRYPTION_KEY");
  console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.error("");
  console.error(
    `Error: ${error instanceof Error ? error.message : String(error)}`
  );
  console.error("");
  console.error("Generate a valid 32-byte base64-encoded key with:");
  console.error("");
  console.error("  openssl rand -base64 32");
  console.error("");
  Deno.exit(1);
}

console.log("✓ Encryption key validated");

// Initialize encryption service (after validation)
const encryptionService = new EncryptionService({
  encryptionKey: secretsEncryptionKey,
});

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

// Check if any users exist (determines whether sign-up is enabled)
const userExists = await db.queryOne<{ id: string }>("SELECT id FROM user LIMIT 1");
const hasUsers = userExists !== null;

// Initialize Better Auth
// Sign-up is only enabled during first-run setup (when no users exist)
const auth = createAuth({
  databasePath: "./data/database.db",
  baseUrl: Deno.env.get("BETTER_AUTH_BASE_URL") || "http://localhost:8000",
  secret: Deno.env.get("BETTER_AUTH_SECRET") || "dev-secret-change-in-production",
  hasUsers,
});

// Initialize stream/console log capture
// Must be installed after migrations but before handling requests
// Captures both console.* methods AND direct process.stdout/stderr writes
const consoleLogService = new ConsoleLogService({ db });
const streamInterceptor = new StreamInterceptor({ logService: consoleLogService });
streamInterceptor.install();

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
  encryptionService,
});

// Initialize secrets service
const secretsService = new SecretsService({
  db,
  encryptionService,
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
  secretsService,
  codeDirectory: "./code",
});

// Public endpoints
app.get("/ping", (c) => c.json({ pong: true }));

// Better Auth handler - handles /api/auth/* endpoints
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

// Hybrid auth middleware (accepts session OR API key)
const hybridAuth = createHybridAuthMiddleware({ auth, apiKeyService });

// Protected API management routes
app.use("/api/keys/*", hybridAuth);
app.use("/api/keys", hybridAuth);
app.route("/api/keys", createApiKeyRoutes(apiKeyService));

app.use("/api/routes/*", hybridAuth);
app.use("/api/routes", hybridAuth);
app.route("/api/routes", createRoutesRoutes(routesService));

// Initialize file service
const fileService = new FileService({
  basePath: "./code",
});

// Protected file management routes
app.use("/api/files/*", hybridAuth);
app.use("/api/files", hybridAuth);
app.route("/api/files", createFileRoutes(fileService));

// Web UI routes (session auth applied internally)
app.route("/web", createWebRoutes({
  auth,
  db,
  fileService,
  routesService,
  apiKeyService,
  consoleLogService,
  executionMetricsService,
  encryptionService,
}));

// Dynamic function router - catch all /run/* requests
app.all("/run/*", (c) => functionRouter.handle(c));
app.all("/run", (c) => functionRouter.handle(c));

// Export app and services for testing
export { app, apiKeyService, routesService, functionRouter, fileService, consoleLogService, executionMetricsService, logTrimmingService, secretsService, processIsolator };

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
