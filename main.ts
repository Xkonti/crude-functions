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
import { createApiKeyRoutes, createApiKeyGroupRoutes } from "./src/keys/api_key_routes.ts";
import { RoutesService } from "./src/routes/routes_service.ts";
import { createFunctionsRoutes } from "./src/routes/functions_routes.ts";
import { FunctionRouter } from "./src/functions/function_router.ts";
import { FileService } from "./src/files/file_service.ts";
import { createFileRoutes } from "./src/files/file_routes.ts";
import { createSettingsRoutes } from "./src/settings/settings_routes.ts";
import { createWebRoutes } from "./src/web/web_routes.ts";
import { ConsoleLogService } from "./src/logs/console_log_service.ts";
import { StreamInterceptor } from "./src/logs/stream_interceptor.ts";
import { ExecutionMetricsService } from "./src/metrics/execution_metrics_service.ts";
import { MetricsAggregationService } from "./src/metrics/metrics_aggregation_service.ts";
import { MetricsStateService } from "./src/metrics/metrics_state_service.ts";
import type { MetricsAggregationConfig } from "./src/metrics/types.ts";
import { LogTrimmingService } from "./src/logs/log_trimming_service.ts";
import type { LogTrimmingConfig } from "./src/logs/log_trimming_types.ts";
import { KeyStorageService } from "./src/encryption/key_storage_service.ts";
import { VersionedEncryptionService } from "./src/encryption/versioned_encryption_service.ts";
import { KeyRotationService } from "./src/encryption/key_rotation_service.ts";
import { createRotationRoutes } from "./src/encryption/rotation_routes.ts";
import { HashService } from "./src/encryption/hash_service.ts";
import type { KeyRotationConfig } from "./src/encryption/key_rotation_types.ts";
import { SecretsService } from "./src/secrets/secrets_service.ts";
import { createSecretsRoutes } from "./src/secrets/secrets_routes.ts";
import { createLogsRoutes } from "./src/logs/logs_routes.ts";
import { createMetricsRoutes } from "./src/metrics/metrics_routes.ts";
import { SettingsService } from "./src/settings/settings_service.ts";
import { SettingNames } from "./src/settings/types.ts";
import { UserService } from "./src/users/user_service.ts";
import { createUserRoutes } from "./src/users/user_routes.ts";
import { initializeLogger, stopLoggerRefresh } from "./src/utils/logger.ts";
import { SchedulingService } from "./src/scheduling/mod.ts";
import { InstanceIdService } from "./src/scheduling/instance_id_service.ts";

/**
 * Parse an environment variable as a positive integer.
 * Used only for PORT which remains an env var.
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
// Encryption Key Initialization
// ============================================================================

// Initialize key storage and load/create encryption keys
// Keys are stored in ./data/encryption-keys.json (auto-generated on first run)
const keyStorageService = new KeyStorageService({
  keyFilePath: "./data/encryption-keys.json",
});

const encryptionKeys = await keyStorageService.ensureInitialized();
console.log(`✓ Encryption keys loaded (version ${encryptionKeys.current_version})`);

// Initialize versioned encryption service
const encryptionService = new VersionedEncryptionService({
  currentKey: encryptionKeys.current_key,
  currentVersion: encryptionKeys.current_version,
  phasedOutKey: encryptionKeys.phased_out_key ?? undefined,
  phasedOutVersion: encryptionKeys.phased_out_version ?? undefined,
});

// Initialize hash service for API key lookups (O(1) constant-time)
const hashService = new HashService({
  hashKey: encryptionKeys.hash_key,
});
console.log("✓ Hash service initialized");

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

// ============================================================================
// Settings Service Initialization
// ============================================================================

// Initialize settings service and bootstrap defaults
const settingsService = new SettingsService({ db, encryptionService });
await settingsService.bootstrapGlobalSettings();
console.log("✓ Settings initialized");

// Initialize logger with settings service (enables periodic log level refresh)
initializeLogger(settingsService);

/**
 * Helper to read an integer setting from the database.
 * Returns defaultValue if setting is missing or invalid.
 */
async function getIntSetting(name: typeof SettingNames[keyof typeof SettingNames], defaultValue: number): Promise<number> {
  const value = await settingsService.getGlobalSetting(name);
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

// Check if any users exist (determines whether sign-up is enabled)
const userExists = await db.queryOne<{ id: string }>("SELECT id FROM user LIMIT 1");
const hasUsers = userExists !== null;

// Initialize Better Auth
// baseUrl is optional - when not set, Better Auth auto-detects from request headers
// trustedOrigins dynamically resolves from baseUrl or request origin
// Sign-up is only enabled during first-run setup (when no users exist)
// Auth secret is stored in the encryption keys file (auto-generated on first run)
const auth = createAuth({
  databasePath: "./data/database.db",
  baseUrl: Deno.env.get("AUTH_BASE_URL") || undefined,
  secret: encryptionKeys.better_auth_secret,
  hasUsers,
});

// Initialize user service
const userService = new UserService({
  db,
  auth,
});

// Initialize stream/console log capture
// Must be installed after migrations but before handling requests
// Captures both console.* methods AND direct process.stdout/stderr writes
const consoleLogService = new ConsoleLogService({ db, settingsService });
const streamInterceptor = new StreamInterceptor({ logService: consoleLogService });
streamInterceptor.install();

// Initialize execution metrics service
const executionMetricsService = new ExecutionMetricsService({ db });

// Initialize metrics state service (for aggregation watermarks)
const metricsStateService = new MetricsStateService({ db });

// Initialize metrics aggregation service (runs via scheduler)
const metricsAggregationConfig: MetricsAggregationConfig = {
  aggregationIntervalSeconds: await getIntSetting(SettingNames.METRICS_AGGREGATION_INTERVAL_SECONDS, 60),
  retentionDays: await getIntSetting(SettingNames.METRICS_RETENTION_DAYS, 90),
};
const metricsAggregationService = new MetricsAggregationService({
  metricsService: executionMetricsService,
  stateService: metricsStateService,
  config: metricsAggregationConfig,
});

// Initialize log trimming service (runs via scheduler)
const logTrimmingConfig: LogTrimmingConfig = {
  trimmingIntervalSeconds: await getIntSetting(SettingNames.LOG_TRIMMING_INTERVAL_SECONDS, 300),
  maxLogsPerRoute: await getIntSetting(SettingNames.LOG_TRIMMING_MAX_PER_FUNCTION, 2000),
  retentionSeconds: await getIntSetting(SettingNames.LOG_TRIMMING_RETENTION_SECONDS, 7776000),
};
const logTrimmingService = new LogTrimmingService({
  logService: consoleLogService,
  config: logTrimmingConfig,
});

// Initialize key rotation service (runs via scheduler)
const keyRotationConfig: KeyRotationConfig = {
  checkIntervalSeconds: await getIntSetting(SettingNames.ENCRYPTION_KEY_ROTATION_CHECK_INTERVAL_SECONDS, 10800),
  rotationIntervalDays: await getIntSetting(SettingNames.ENCRYPTION_KEY_ROTATION_INTERVAL_DAYS, 90),
  batchSize: await getIntSetting(SettingNames.ENCRYPTION_KEY_ROTATION_BATCH_SIZE, 100),
  batchSleepMs: await getIntSetting(SettingNames.ENCRYPTION_KEY_ROTATION_BATCH_SLEEP_MS, 100),
};
const keyRotationService = new KeyRotationService({
  db,
  encryptionService,
  keyStorage: keyStorageService,
  config: keyRotationConfig,
});

// ============================================================================
// Scheduling Service Initialization
// ============================================================================

// Initialize instance ID service (for orphan detection in multi-instance scenarios)
const instanceIdService = new InstanceIdService();

// Initialize scheduling service
const schedulingPollingIntervalSeconds = await getIntSetting(SettingNames.SCHEDULING_POLLING_INTERVAL_SECONDS, 1);
const schedulingDefaultTimeoutMs = await getIntSetting(SettingNames.SCHEDULING_DEFAULT_TIMEOUT_MS, 300000);
const schedulingStuckTaskTimeoutMs = await getIntSetting(SettingNames.SCHEDULING_STUCK_TASK_TIMEOUT_MS, 3600000);

const schedulingService = new SchedulingService({
  db,
  instanceIdService,
  pollingIntervalSeconds: schedulingPollingIntervalSeconds,
  defaultTimeoutMs: schedulingDefaultTimeoutMs,
  stuckTaskTimeoutMs: schedulingStuckTaskTimeoutMs,
});

// Register task handlers
schedulingService.registerHandler("log-trimming", {
  handler: async (_task, signal) => {
    await logTrimmingService.runOnce(signal);
    return { success: true };
  },
});

schedulingService.registerHandler("metrics-aggregation", {
  handler: async (_task, signal) => {
    await metricsAggregationService.runOnce(signal);
    return { success: true };
  },
});

schedulingService.registerHandler("key-rotation", {
  handler: async (_task, signal) => {
    await keyRotationService.runOnce(signal);
    // Return next rotation time for rescheduling
    const nextRunAt = await keyRotationService.getNextRotationTime();
    return { success: true, nextRunAt };
  },
});

// Register in-memory scheduled tasks
schedulingService.registerInMemoryTask({
  name: "log-trimming",
  type: "log-trimming",
  scheduleType: "interval",
  intervalSeconds: logTrimmingConfig.trimmingIntervalSeconds,
  runImmediately: true,
});

schedulingService.registerInMemoryTask({
  name: "metrics-aggregation",
  type: "metrics-aggregation",
  scheduleType: "interval",
  intervalSeconds: metricsAggregationConfig.aggregationIntervalSeconds,
  runImmediately: true,
});

// Key rotation uses dynamic scheduling - runs once, then reschedules based on next rotation time
const nextKeyRotationTime = await keyRotationService.getNextRotationTime();
schedulingService.registerInMemoryTask({
  name: "key-rotation",
  type: "key-rotation",
  scheduleType: "dynamic",
  scheduledAt: nextKeyRotationTime,
  runImmediately: false, // Will run at scheduled time
});

// Start the scheduler
await schedulingService.start();
console.log("✓ Scheduling service started");

// Initialize API key service
const apiKeyService = new ApiKeyService({
  db,
  encryptionService,
  hashService,
});

// Ensure management group exists and set default access groups
const mgmtGroupId = await apiKeyService.getOrCreateGroup("management", "Management API keys");
const currentAccessGroups = await settingsService.getGlobalSetting(SettingNames.API_ACCESS_GROUPS);
if (!currentAccessGroups) {
  await settingsService.setGlobalSetting(SettingNames.API_ACCESS_GROUPS, String(mgmtGroupId));
  console.log("✓ Default API access group set to management");
}

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

// Better Auth handler - handles /api/auth/* endpoints
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

// Hybrid auth middleware (accepts session OR API key)
const hybridAuth = createHybridAuthMiddleware({ auth, apiKeyService, settingsService });

// Protected API key group management routes
app.use("/api/key-groups/*", hybridAuth);
app.use("/api/key-groups", hybridAuth);
app.route("/api/key-groups", createApiKeyGroupRoutes(apiKeyService));

// Protected API key management routes
app.use("/api/keys/*", hybridAuth);
app.use("/api/keys", hybridAuth);
app.route("/api/keys", createApiKeyRoutes(apiKeyService));

app.use("/api/functions/*", hybridAuth);
app.use("/api/functions", hybridAuth);
app.route("/api/functions", createFunctionsRoutes(routesService));

// Initialize file service
const fileService = new FileService({
  basePath: "./code",
});

// Protected file management routes
app.use("/api/files/*", hybridAuth);
app.use("/api/files", hybridAuth);
app.route("/api/files", createFileRoutes({
  fileService,
  settingsService,
}));

// Encryption key rotation API
app.use("/api/encryption-keys/*", hybridAuth);
app.use("/api/encryption-keys", hybridAuth);
app.route("/api/encryption-keys", createRotationRoutes({
  keyRotationService,
  keyStorageService,
  settingsService,
}));

// Settings API (hybrid auth)
app.use("/api/settings/*", hybridAuth);
app.use("/api/settings", hybridAuth);
app.route("/api/settings", createSettingsRoutes({
  settingsService,
}));

// Secrets API (hybrid auth)
app.use("/api/secrets/*", hybridAuth);
app.use("/api/secrets", hybridAuth);
app.route("/api/secrets", createSecretsRoutes(secretsService));

// Logs API (hybrid auth)
app.use("/api/logs/*", hybridAuth);
app.use("/api/logs", hybridAuth);
app.route("/api/logs", createLogsRoutes({
  consoleLogService,
  routesService,
}));

// Metrics API (hybrid auth)
app.use("/api/metrics/*", hybridAuth);
app.use("/api/metrics", hybridAuth);
app.route("/api/metrics", createMetricsRoutes({
  executionMetricsService,
  routesService,
  settingsService,
}));

// User management API (hybrid auth)
app.use("/api/users/*", hybridAuth);
app.use("/api/users", hybridAuth);
app.route("/api/users", createUserRoutes(userService));

// Serve favicon at root level (browsers request /favicon.ico automatically)
app.get("/favicon.ico", async (c) => {
  try {
    const faviconPath = new URL("./docs/public/favicon.svg", import.meta.url);
    const content = await Deno.readFile(faviconPath);

    return new Response(content, {
      status: 200,
      headers: {
        "Content-Type": "image/svg+xml",
        "Content-Length": String(content.length),
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (error) {
    console.error("Failed to serve favicon:", error);
    return c.text("Favicon not found", 404);
  }
});

// Web UI routes (session auth applied internally)
app.route("/web", createWebRoutes({
  auth,
  db,
  userService,
  fileService,
  routesService,
  apiKeyService,
  consoleLogService,
  executionMetricsService,
  encryptionService,
  settingsService,
}));

// Dynamic function router - catch all /run/* requests
app.all("/run/*", (c) => functionRouter.handle(c));
app.all("/run", (c) => functionRouter.handle(c));

// Export app and services for testing
export { app, apiKeyService, routesService, functionRouter, fileService, consoleLogService, executionMetricsService, logTrimmingService, keyRotationService, secretsService, settingsService, userService, processIsolator };

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

    // 3. Stop logger refresh interval
    stopLoggerRefresh();
    console.log("Logger refresh stopped");

    // 4. Flush buffered console logs
    await consoleLogService.shutdown();
    console.log("Console log service flushed");

    // 5. Stop scheduling service (waits for any running tasks)
    await schedulingService.stop();
    console.log("Scheduling service stopped");

    // 6. Close database last
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
