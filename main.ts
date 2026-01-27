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
import { ApiKeyService } from "./src/keys/api_key_service.ts";
import { RoutesService } from "./src/routes/routes_service.ts";
import { FunctionRouter } from "./src/functions/function_router.ts";
import { FileService } from "./src/files/file_service.ts";
import { SourceFileService } from "./src/files/source_file_service.ts";
import { CodeSourceService } from "./src/sources/code_source_service.ts";
import { ManualCodeSourceProvider } from "./src/sources/manual_code_source_provider.ts";
import { GitCodeSourceProvider } from "./src/sources/git_code_source_provider.ts";
import type { SyncJobPayload } from "./src/sources/types.ts";
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
import { HashService } from "./src/encryption/hash_service.ts";
import type { KeyRotationConfig } from "./src/encryption/key_rotation_types.ts";
import { SecretsService } from "./src/secrets/secrets_service.ts";
import { SettingsService } from "./src/settings/settings_service.ts";
import { SettingNames } from "./src/settings/types.ts";
import { UserService } from "./src/users/user_service.ts";
import { initializeLogger, stopLoggerRefresh } from "./src/utils/logger.ts";
import { InstanceIdService } from "./src/instance/instance_id_service.ts";
import { JobQueueService } from "./src/jobs/job_queue_service.ts";
import { JobProcessorService } from "./src/jobs/job_processor_service.ts";
import { SchedulingService } from "./src/scheduling/scheduling_service.ts";
import { EventBus } from "./src/events/mod.ts";
import { createFunctionApp, createManagementApp } from "./src/apps/mod.ts";
import { CsrfService } from "./src/csrf/mod.ts";
import { SurrealConnectionFactory } from "./src/database/surreal_connection_factory.ts";
import { SurrealProcessManager } from "./src/database/surreal_process_manager.ts";
import { SurrealHealthMonitor } from "./src/database/surreal_health_monitor.ts";
import { SurrealSupervisor } from "./src/database/surreal_supervisor.ts";
import { SurrealMigrationService } from "./src/database/surreal_migration_service.ts";
import { recordIdToString } from "./src/database/surreal_helpers.ts";

/**
 * Parse an environment variable as a positive integer.
 * Used for FUNCTION_PORT and MANAGEMENT_PORT.
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

// Initialize CSRF service for web form protection
const csrfService = new CsrfService({
  secret: encryptionKeys.hash_key,
});
console.log("✓ CSRF service initialized");

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
// SurrealDB Initialization (Experimental)
// ============================================================================

// Initialize SurrealDB with supervisor for process lifecycle management
// Runs alongside SQLite - does not replace it

const surrealPort = parseEnvInt("SURREAL_PORT", 5173, { min: 1, max: 65535 });
const surrealUser = Deno.env.get("SURREAL_USER") || "root";
const surrealPass = Deno.env.get("SURREAL_PASS") || "root";

// Create process manager
const surrealProcessManager = new SurrealProcessManager({
  binaryPath: Deno.env.get("SURREAL_BINARY") || "/surreal",
  port: surrealPort,
  storagePath: Deno.env.get("SURREAL_STORAGE") || "./data/surreal",
  username: surrealUser,
  password: surrealPass,
});

// Create connection factory (thin wrapper returning raw Surreal connections)
const surrealFactory = new SurrealConnectionFactory({
  connectionUrl: surrealProcessManager.connectionUrl,
  username: surrealUser,
  password: surrealPass,
});

// Create health monitor
const surrealHealthMonitor = new SurrealHealthMonitor({
  processManager: surrealProcessManager,
  checkIntervalMs: 5000,
  failureThreshold: 3,
});

// Create supervisor to coordinate process lifecycle and monitoring
const surrealSupervisor = new SurrealSupervisor({
  processManager: surrealProcessManager,
  connectionFactory: surrealFactory,
  healthMonitor: surrealHealthMonitor,
  maxRestartAttempts: 3,
  restartCooldownMs: 5000,
});

try {
  // Start supervisor (starts process, connects DB, starts monitoring)
  await surrealSupervisor.start();
  console.log("✓ SurrealDB supervisor started");

  // Register status change listener for logging
  surrealSupervisor.onStatusChange((event) => {
    if (event.status !== event.previousStatus) {
      console.log(`[SurrealDB] Health: ${event.previousStatus} -> ${event.status}`);
      if (event.lastError) {
        console.error(`[SurrealDB] Error: ${event.lastError.message}`);
      }
    }
  });

  // Run SurrealDB migrations
  const surrealMigrationService = new SurrealMigrationService({
    connectionFactory: surrealFactory,
    migrationsDir: "./migrations",
  });
  const surrealMigrationResult = await surrealMigrationService.migrate();
  if (surrealMigrationResult.appliedCount > 0) {
    console.log(
      `Applied ${surrealMigrationResult.appliedCount} SurrealDB migration(s): ` +
      `version ${surrealMigrationResult.fromVersion ?? "none"} → ${surrealMigrationResult.toVersion}`
    );
  }
} catch (error) {
  console.warn("⚠ SurrealDB initialization failed (non-fatal):", error);
  // Supervisor handles its own cleanup
  // Don't throw - SurrealDB is experimental and optional
}

// ============================================================================
// Settings Service Initialization
// ============================================================================

// Initialize settings service and bootstrap defaults
// Uses factory's default namespace/database (system/system)
const settingsService = new SettingsService({
  surrealFactory,
  encryptionService,
});
await settingsService.bootstrapGlobalSettings();
console.log("✓ Settings initialized");

// Initialize logger with settings service (enables periodic log level refresh)
initializeLogger(settingsService);

// Initialize instance ID service (for job ownership tracking)
const instanceIdService = new InstanceIdService();

// Initialize event bus for decoupled service communication
const eventBus = new EventBus();

// Initialize job queue service
const jobQueueService = new JobQueueService({
  db,
  instanceIdService,
  eventBus,
});

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

// Check if any users exist in SurrealDB (determines whether sign-up is enabled)
const hasUsers = await surrealFactory.withSystemConnection({}, async (db) => {
  const [result] = await db.query<[{ id: unknown }[]]>(
    `SELECT id FROM user LIMIT 1`
  );
  return (result?.length ?? 0) > 0;
});

// Initialize Better Auth
// baseUrl is optional - when not set, Better Auth auto-detects from request headers
// trustedOrigins dynamically resolves from baseUrl or request origin
// Sign-up is only enabled during first-run setup (when no users exist)
// Auth secret is stored in the encryption keys file (auto-generated on first run)
// Uses SurrealDB adapter for all auth data storage
const auth = createAuth({
  surrealFactory,
  baseUrl: Deno.env.get("AUTH_BASE_URL") || undefined,
  secret: encryptionKeys.better_auth_secret,
  hasUsers,
});

// Initialize user service
const userService = new UserService({
  surrealFactory,
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

// Initialize and start metrics aggregation service
const metricsAggregationConfig: MetricsAggregationConfig = {
  aggregationIntervalSeconds: await getIntSetting(SettingNames.METRICS_AGGREGATION_INTERVAL_SECONDS, 60),
  retentionDays: await getIntSetting(SettingNames.METRICS_RETENTION_DAYS, 90),
};
const metricsAggregationService = new MetricsAggregationService({
  metricsService: executionMetricsService,
  stateService: metricsStateService,
  config: metricsAggregationConfig,
});

// Initialize and start log trimming service
const logTrimmingConfig: LogTrimmingConfig = {
  trimmingIntervalSeconds: await getIntSetting(SettingNames.LOG_TRIMMING_INTERVAL_SECONDS, 300),
  maxLogsPerRoute: await getIntSetting(SettingNames.LOG_TRIMMING_MAX_PER_FUNCTION, 2000),
  retentionSeconds: await getIntSetting(SettingNames.LOG_TRIMMING_RETENTION_SECONDS, 7776000),
};
const logTrimmingService = new LogTrimmingService({
  logService: consoleLogService,
  config: logTrimmingConfig,
});

// Initialize and start key rotation service
const keyRotationConfig: KeyRotationConfig = {
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

// Initialize job processor service
const jobProcessorService = new JobProcessorService({
  jobQueueService,
  instanceIdService,
  eventBus,
  config: {
    pollingIntervalSeconds: await getIntSetting(SettingNames.JOB_PROCESSOR_POLLING_INTERVAL_SECONDS, 5),
    shutdownTimeoutMs: 60000,
  },
});

// Initialize scheduling service
const schedulingService = new SchedulingService({
  db,
  jobQueueService,
});

// Initialize code source service
const codeSourceService = new CodeSourceService({
  surrealFactory,
  encryptionService,
  jobQueueService,
  schedulingService,
  codeDirectory: "./code",
});

// Register code source providers
// Manual provider has no sensitive fields
const manualCodeSourceProvider = new ManualCodeSourceProvider({
  codeDirectory: "./code",
});
codeSourceService.registerProvider(manualCodeSourceProvider);

// Git provider needs encryption service for authToken encryption
const gitCodeSourceProvider = new GitCodeSourceProvider({
  codeDirectory: "./code",
  encryptionService,
});
codeSourceService.registerProvider(gitCodeSourceProvider);
console.log("✓ Code source service initialized (manual, git)");

// Initialize API key service
const apiKeyService = new ApiKeyService({
  surrealFactory,
  encryptionService,
  hashService,
});

// Bootstrap management group (creates if not exists)
await apiKeyService.bootstrapManagementGroup();

// Ensure default access groups setting is set
const mgmtGroup = await apiKeyService.getGroupByName("management");
const currentAccessGroups = await settingsService.getGlobalSetting(SettingNames.API_ACCESS_GROUPS);
if (!currentAccessGroups && mgmtGroup) {
  await settingsService.setGlobalSetting(SettingNames.API_ACCESS_GROUPS, recordIdToString(mgmtGroup.id));
  console.log("✓ Default API access group set to management");
}

// Initialize secrets service
const secretsService = new SecretsService({
  surrealFactory,
  encryptionService,
});

// Initialize routes service
const routesService = new RoutesService({
  surrealFactory,
  secretsService, // For cascade delete of function-scoped secrets
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

// ============================================================================
// Job Processing and Scheduling Setup
// ============================================================================

// Start job processor
jobProcessorService.start();

// Register job handlers
jobProcessorService.registerHandler("log-trimming", async (_job, token) => {
  token.throwIfCancelled();
  return await logTrimmingService.performTrimming();
});

jobProcessorService.registerHandler("metrics-aggregation", async (_job, token) => {
  await metricsAggregationService.performAggregation(token);
  return { success: true };
});

jobProcessorService.registerHandler("key-rotation", async (_job, token) => {
  return await keyRotationService.performRotationCheck(token);
});

jobProcessorService.registerHandler("source_sync", async (job, token) => {
  const payload = job.payload as SyncJobPayload;
  return await codeSourceService.syncSource(payload.sourceId, token);
});

// Start scheduling service (clears transient schedules, loads persistent)
await schedulingService.start();

// Register transient schedules (re-registered on each restart)
await schedulingService.registerSchedule({
  name: "log-trimming",
  description: "Trims console logs based on retention and count limits",
  type: "sequential_interval",
  isPersistent: false,
  intervalMs: logTrimmingConfig.trimmingIntervalSeconds * 1000,
  jobType: "log-trimming",
});

await schedulingService.registerSchedule({
  name: "metrics-aggregation",
  description: "Aggregates execution metrics into time-based summaries",
  type: "sequential_interval",
  isPersistent: false,
  intervalMs: metricsAggregationConfig.aggregationIntervalSeconds * 1000,
  jobType: "metrics-aggregation",
});

// Register persistent key rotation schedule (only if not exists)
const existingKeyRotationSchedule = await schedulingService.getSchedule("key-rotation");
if (!existingKeyRotationSchedule) {
  const keys = await keyStorageService.loadKeys();
  let nextRunAt: Date;

  if (keys && keyStorageService.isRotationInProgress(keys)) {
    // Incomplete rotation - resume soon
    nextRunAt = new Date(Date.now() + 60000);
  } else if (keys) {
    // Calculate when rotation is due
    const lastRotation = new Date(keys.last_rotation_finished_at);
    const rotationIntervalMs = keyRotationConfig.rotationIntervalDays * 24 * 60 * 60 * 1000;
    nextRunAt = new Date(lastRotation.getTime() + rotationIntervalMs);
    if (nextRunAt < new Date()) {
      nextRunAt = new Date(); // Past due, run now
    }
  } else {
    nextRunAt = new Date(); // No keys yet, run immediately
  }

  await schedulingService.registerSchedule({
    name: "key-rotation",
    description: "Automatic encryption key rotation",
    type: "dynamic",
    isPersistent: true,
    nextRunAt,
    jobType: "key-rotation",
  });
}

console.log("✓ Job processor and scheduling services started");

// ============================================================================
// File Services (used by management app)
// ============================================================================

// Initialize file service (used by web UI)
const fileService = new FileService({
  basePath: "./code",
});

// Initialize source file service (source-aware file operations)
const sourceFileService = new SourceFileService({
  codeSourceService,
  codeDirectory: "./code",
});

// ============================================================================
// Create Hono Apps
// ============================================================================

// Function execution app (runs on FUNCTION_PORT)
const functionApp = createFunctionApp(functionRouter);

// Management app (runs on MANAGEMENT_PORT)
const managementApp = createManagementApp({
  auth,
  db,
  surrealFactory,
  apiKeyService,
  routesService,
  consoleLogService,
  executionMetricsService,
  encryptionService,
  keyStorageService,
  keyRotationService,
  secretsService,
  settingsService,
  userService,
  codeSourceService,
  sourceFileService,
  schedulingService,
  csrfService,
});

console.log("✓ Hono apps created");

// Export apps and services for testing
export { functionApp, managementApp, apiKeyService, routesService, functionRouter, fileService, sourceFileService, codeSourceService, consoleLogService, executionMetricsService, logTrimmingService, keyRotationService, secretsService, settingsService, userService, processIsolator, jobQueueService, jobProcessorService, schedulingService, surrealFactory, surrealProcessManager, surrealSupervisor };

// Graceful shutdown handler
async function gracefulShutdown(signal: string) {
  console.log(`\nReceived ${signal}, shutting down gracefully...`);
  try {
    // 1. Stop accepting new requests
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

    // 5. Stop scheduling service (stops triggering new jobs)
    await schedulingService.stop();
    console.log("Scheduling service stopped");

    // 6. Stop job processor (waits for current job)
    await jobProcessorService.stop();
    console.log("Job processor stopped");

    // 7. Stop SurrealDB supervisor (handles monitor, DB connection, and process)
    if (surrealSupervisor.isHealthy() || surrealProcessManager.isRunning) {
      await surrealSupervisor.stop();
      console.log("SurrealDB supervisor stopped");
    }

    // 8. Close SQLite database last
    await db.close();
    console.log("Database connection closed successfully");
  } catch (error) {
    console.error("Error during shutdown:", error);
    Deno.exit(1);
  }
  Deno.exit(0);
}

// Start servers only when run directly
if (import.meta.main) {
  const functionPort = parseEnvInt("FUNCTION_PORT", 8000, { min: 1, max: 65535 });
  const managementPort = parseEnvInt("MANAGEMENT_PORT", 9000, { min: 1, max: 65535 });

  // Setup graceful shutdown
  abortController = new AbortController();

  Deno.addSignalListener("SIGTERM", () => {
    gracefulShutdown("SIGTERM");
  });

  Deno.addSignalListener("SIGINT", () => {
    gracefulShutdown("SIGINT");
  });

  // Start server(s) based on port configuration
  if (functionPort === managementPort) {
    // Single port mode: mount function routes on management app
    managementApp.all("/run/*", (c) => functionRouter.handle(c));
    managementApp.all("/run", (c) => functionRouter.handle(c));

    Deno.serve({
      port: functionPort,
      signal: abortController.signal,
      onListen: () => {
        console.log(`Server (combined): http://localhost:${functionPort}`);
        console.log("  /run/* → Function execution");
        console.log("  /api/* → Management API");
        console.log("  /web/* → Web UI");
      },
    }, managementApp.fetch);
  } else {
    // Dual port mode: separate servers
    Deno.serve({
      port: functionPort,
      signal: abortController.signal,
      onListen: () => {
        console.log(`Function server: http://localhost:${functionPort}/run/*`);
      },
    }, functionApp.fetch);

    Deno.serve({
      port: managementPort,
      signal: abortController.signal,
      onListen: () => {
        console.log(`Management server: http://localhost:${managementPort}`);
      },
    }, managementApp.fetch);
  }
}
