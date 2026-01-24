/**
 * Service factory functions for TestSetupBuilder.
 *
 * Each factory function creates a specific service with its dependencies.
 * This allows the builder to selectively create only the services needed
 * for a particular test, reducing setup time and complexity.
 */

import { DatabaseService } from "../database/database_service.ts";
import { MigrationService } from "../database/migration_service.ts";
import { SurrealProcessManager } from "../database/surreal_process_manager.ts";
import { SurrealDatabaseService } from "../database/surreal_database_service.ts";
import { SurrealHealthMonitor } from "../database/surreal_health_monitor.ts";
import { SurrealSupervisor } from "../database/surreal_supervisor.ts";
import { SurrealMigrationService } from "../database/surreal_migration_service.ts";
import { KeyStorageService } from "../encryption/key_storage_service.ts";
import { VersionedEncryptionService } from "../encryption/versioned_encryption_service.ts";
import { HashService } from "../encryption/hash_service.ts";
import { SettingsService } from "../settings/settings_service.ts";
import { ApiKeyService } from "../keys/api_key_service.ts";
import { RoutesService } from "../routes/routes_service.ts";
import { FileService } from "../files/file_service.ts";
import { ConsoleLogService } from "../logs/console_log_service.ts";
import { ExecutionMetricsService } from "../metrics/execution_metrics_service.ts";
import { MetricsStateService } from "../metrics/metrics_state_service.ts";
import { UserService } from "../users/user_service.ts";
import { SecretsService } from "../secrets/secrets_service.ts";
import { InstanceIdService } from "../instance/instance_id_service.ts";
import { JobQueueService } from "../jobs/job_queue_service.ts";
import { SchedulingService } from "../scheduling/scheduling_service.ts";
import { CodeSourceService } from "../sources/code_source_service.ts";
import { ManualCodeSourceProvider } from "../sources/manual_code_source_provider.ts";
import { GitCodeSourceProvider } from "../sources/git_code_source_provider.ts";
import { createAuth } from "../auth/auth.ts";
import type { EncryptionKeyFile } from "../encryption/key_storage_types.ts";
import type { betterAuth } from "better-auth";

/**
 * Context passed to service factories.
 * Contains the base infrastructure and any previously created services.
 */
export interface FactoryContext {
  tempDir: string;
  codeDir: string;
  databasePath: string;
  db: DatabaseService;
  encryptionKeys?: EncryptionKeyFile;
  encryptionService?: VersionedEncryptionService;
  hashService?: HashService;
  settingsService?: SettingsService;
  auth?: ReturnType<typeof betterAuth>;
}

// =============================================================================
// Core Infrastructure Factories
// =============================================================================

/**
 * Creates the base infrastructure: temp directory, code directory, database, and migrations.
 * This is always called first and is required for all test contexts.
 */
export async function createCoreInfrastructure(migrationsDir: string): Promise<{
  tempDir: string;
  codeDir: string;
  databasePath: string;
  db: DatabaseService;
}> {
  // Create temp directory for test isolation
  const tempDir = await Deno.makeTempDir();
  const codeDir = `${tempDir}/code`;
  await Deno.mkdir(codeDir, { recursive: true });

  // Open database
  const databasePath = `${tempDir}/database.db`;
  const db = new DatabaseService({ databasePath });
  await db.open();

  // Run real migrations
  const migrationService = new MigrationService({
    db,
    migrationsDir,
  });
  await migrationService.migrate();

  return { tempDir, codeDir, databasePath, db };
}

// =============================================================================
// Encryption Factories
// =============================================================================

/**
 * Creates encryption keys using KeyStorageService.
 */
export async function createEncryptionKeys(tempDir: string): Promise<EncryptionKeyFile> {
  const keyStorageService = new KeyStorageService({
    keyFilePath: `${tempDir}/encryption-keys.json`,
  });
  return await keyStorageService.ensureInitialized();
}

/**
 * Creates the VersionedEncryptionService.
 * Requires encryption keys.
 */
export function createEncryptionService(keys: EncryptionKeyFile): VersionedEncryptionService {
  return new VersionedEncryptionService({
    currentKey: keys.current_key,
    currentVersion: keys.current_version,
    phasedOutKey: keys.phased_out_key ?? undefined,
    phasedOutVersion: keys.phased_out_version ?? undefined,
  });
}

/**
 * Creates the HashService.
 * Requires encryption keys.
 */
export function createHashService(keys: EncryptionKeyFile): HashService {
  return new HashService({
    hashKey: keys.hash_key,
  });
}

// =============================================================================
// Settings Factory
// =============================================================================

/**
 * Creates the SettingsService and bootstraps global settings.
 * Requires database and encryption service.
 */
export async function createSettingsService(
  db: DatabaseService,
  encryptionService: VersionedEncryptionService
): Promise<SettingsService> {
  const settingsService = new SettingsService({ db, encryptionService });
  await settingsService.bootstrapGlobalSettings();
  return settingsService;
}

// =============================================================================
// Metrics Factories
// =============================================================================

/**
 * Creates the ExecutionMetricsService.
 * Requires only database.
 */
export function createExecutionMetricsService(db: DatabaseService): ExecutionMetricsService {
  return new ExecutionMetricsService({ db });
}

/**
 * Creates the MetricsStateService.
 * Requires only database.
 */
export function createMetricsStateService(db: DatabaseService): MetricsStateService {
  return new MetricsStateService({ db });
}

// =============================================================================
// Logging Factory
// =============================================================================

/**
 * Creates the ConsoleLogService.
 * Requires database and settings service.
 */
export function createConsoleLogService(
  db: DatabaseService,
  settingsService: SettingsService
): ConsoleLogService {
  return new ConsoleLogService({ db, settingsService });
}

// =============================================================================
// Routes Factory
// =============================================================================

/**
 * Creates the RoutesService.
 * Requires only database.
 */
export function createRoutesService(db: DatabaseService): RoutesService {
  return new RoutesService({ db });
}

// =============================================================================
// Files Factory
// =============================================================================

/**
 * Creates the FileService.
 * Requires only the code directory path.
 */
export function createFileService(codeDir: string): FileService {
  return new FileService({ basePath: codeDir });
}

// =============================================================================
// API Keys Factory
// =============================================================================

/**
 * Creates the ApiKeyService.
 * Requires database, encryption service, and hash service.
 */
export function createApiKeyService(
  db: DatabaseService,
  encryptionService: VersionedEncryptionService,
  hashService: HashService
): ApiKeyService {
  return new ApiKeyService({
    db,
    encryptionService,
    hashService,
  });
}

// =============================================================================
// Secrets Factory
// =============================================================================

/**
 * Creates the SecretsService.
 * Requires database and encryption service.
 */
export function createSecretsService(
  db: DatabaseService,
  encryptionService: VersionedEncryptionService
): SecretsService {
  return new SecretsService({
    db,
    encryptionService,
  });
}

// =============================================================================
// Auth Factories
// =============================================================================

/**
 * Creates the Better Auth instance.
 * Requires database path and encryption keys.
 */
export function createBetterAuth(
  databasePath: string,
  encryptionKeys: EncryptionKeyFile
): ReturnType<typeof betterAuth> {
  return createAuth({
    databasePath,
    secret: encryptionKeys.better_auth_secret,
    hasUsers: false, // Always enable sign-up for tests
  });
}

/**
 * Creates the UserService.
 * Requires database and auth instance.
 */
export function createUserService(
  db: DatabaseService,
  auth: ReturnType<typeof betterAuth>
): UserService {
  return new UserService({ db, auth });
}

// =============================================================================
// User Creation Helper
// =============================================================================

/**
 * Creates a user directly in the database (bypasses Better Auth API).
 * Uses bcrypt for password hashing to match Better Auth's format.
 */
export async function createUserDirectly(
  db: DatabaseService,
  email: string,
  password: string,
  roles: string[] = ["userMgmt"]
): Promise<string> {
  const userId = crypto.randomUUID();
  const roleString = roles.join(",");

  // Insert user record
  await db.execute(
    `INSERT INTO user (id, email, emailVerified, name, role, banned, createdAt, updatedAt)
     VALUES (?, ?, 0, ?, ?, 0, datetime('now'), datetime('now'))`,
    [userId, email, email.split("@")[0], roleString || null]
  );

  // Hash password using bcrypt (Better Auth uses bcrypt internally)
  const { hash } = await import("@da/bcrypt");
  const hashedPassword = await hash(password);

  // Insert account record with credential provider
  const accountId = crypto.randomUUID();
  await db.execute(
    `INSERT INTO account (id, userId, accountId, providerId, password, createdAt, updatedAt)
     VALUES (?, ?, ?, 'credential', ?, datetime('now'), datetime('now'))`,
    [accountId, userId, email, hashedPassword]
  );

  return userId;
}

// =============================================================================
// Instance ID Factory
// =============================================================================

/**
 * Creates the InstanceIdService.
 * No dependencies.
 */
export function createInstanceIdService(): InstanceIdService {
  return new InstanceIdService();
}

// =============================================================================
// Job Queue Factory
// =============================================================================

/**
 * Creates the JobQueueService.
 * Requires database and instance ID service. Encryption is optional.
 */
export function createJobQueueService(
  db: DatabaseService,
  instanceIdService: InstanceIdService,
  encryptionService?: VersionedEncryptionService,
): JobQueueService {
  return new JobQueueService({
    db,
    instanceIdService,
    encryptionService,
  });
}

// =============================================================================
// Scheduling Factory
// =============================================================================

/**
 * Creates the SchedulingService.
 * Requires database and job queue service.
 */
export function createSchedulingService(
  db: DatabaseService,
  jobQueueService: JobQueueService,
): SchedulingService {
  return new SchedulingService({
    db,
    jobQueueService,
  });
}

// =============================================================================
// Code Source Factory
// =============================================================================

/**
 * Creates the CodeSourceService with providers registered.
 * Requires database, encryption service, job queue service, scheduling service, and code directory.
 */
export function createCodeSourceService(
  db: DatabaseService,
  encryptionService: VersionedEncryptionService,
  jobQueueService: JobQueueService,
  schedulingService: SchedulingService,
  codeDir: string,
): CodeSourceService {
  const service = new CodeSourceService({
    db,
    encryptionService,
    jobQueueService,
    schedulingService,
    codeDirectory: codeDir,
  });

  // Register providers (manual and git)
  service.registerProvider(
    new ManualCodeSourceProvider({ codeDirectory: codeDir }),
  );
  service.registerProvider(
    new GitCodeSourceProvider({ codeDirectory: codeDir }),
  );

  return service;
}

// =============================================================================
// SurrealDB Factories
// =============================================================================

/**
 * Checks if the SurrealDB binary is available in PATH.
 * Caches the result after first check.
 */
let _surrealAvailable: boolean | null = null;

export async function isSurrealAvailable(): Promise<boolean> {
  if (_surrealAvailable !== null) {
    return _surrealAvailable;
  }

  try {
    const command = new Deno.Command("which", { args: ["surreal"] });
    const { success } = await command.output();
    _surrealAvailable = success;
    return success;
  } catch {
    _surrealAvailable = false;
    return false;
  }
}

/**
 * Creates the SurrealDB infrastructure: process manager, database service, and supervisor.
 * Starts the process, opens the connection, and runs migrations.
 *
 * @param tempDir - Temp directory for SurrealDB storage
 * @param migrationsDir - Path to migrations directory
 * @returns Object with surrealProcessManager, surrealDb, and surrealSupervisor
 * @throws Error if SurrealDB binary is not available
 */
export async function createSurrealInfrastructure(
  tempDir: string,
  migrationsDir: string
): Promise<{
  surrealProcessManager: SurrealProcessManager;
  surrealDb: SurrealDatabaseService;
  surrealSupervisor: SurrealSupervisor;
}> {
  // Check if surreal binary is available
  if (!(await isSurrealAvailable())) {
    throw new Error(
      "SurrealDB binary not found in PATH. Install SurrealDB to run these tests."
    );
  }

  const storageDir = `${tempDir}/surreal`;
  await Deno.mkdir(storageDir, { recursive: true });

  // Use a random port in the ephemeral range to avoid conflicts
  const port = 49152 + Math.floor(Math.random() * 16383);

  // Create process manager
  const surrealProcessManager = new SurrealProcessManager({
    binaryPath: "surreal",
    port,
    storagePath: storageDir,
    username: "root",
    password: "root",
    readinessTimeoutMs: 30000,
  });

  // Create database service
  const surrealDb = new SurrealDatabaseService({
    connectionUrl: surrealProcessManager.connectionUrl,
    username: "root",
    password: "root",
    namespace: "test",
    database: "test",
  });

  // Create health monitor
  const surrealHealthMonitor = new SurrealHealthMonitor({
    processManager: surrealProcessManager,
    checkIntervalMs: 5000,
    failureThreshold: 3,
  });

  // Create supervisor
  const surrealSupervisor = new SurrealSupervisor({
    processManager: surrealProcessManager,
    databaseService: surrealDb,
    healthMonitor: surrealHealthMonitor,
    maxRestartAttempts: 3,
    restartCooldownMs: 5000,
  });

  // Start supervisor (starts process, connects DB, starts monitoring)
  await surrealSupervisor.start();

  // Run SurrealDB migrations
  const surrealMigrationService = new SurrealMigrationService({
    db: surrealDb,
    migrationsDir,
  });
  await surrealMigrationService.migrate();

  return { surrealProcessManager, surrealDb, surrealSupervisor };
}

// =============================================================================
// Cleanup Factory
// =============================================================================

/**
 * Creates a cleanup function for the test context.
 * Handles proper teardown order.
 */
export function createCleanupFunction(
  db: DatabaseService,
  tempDir: string,
  consoleLogService?: ConsoleLogService,
  surrealSupervisor?: SurrealSupervisor
): () => Promise<void> {
  return async () => {
    // 1. Shutdown console log service if present (flush pending logs)
    if (consoleLogService) {
      await consoleLogService.shutdown();
    }

    // 2. Stop SurrealDB supervisor if present
    if (surrealSupervisor) {
      await surrealSupervisor.stop();
    }

    // 3. Close SQLite database
    await db.close();

    // 4. Remove temp directory
    try {
      await Deno.remove(tempDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  };
}
