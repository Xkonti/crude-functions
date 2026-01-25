/**
 * Service factory functions for TestSetupBuilder.
 *
 * Each factory function creates a specific service with its dependencies.
 * This allows the builder to selectively create only the services needed
 * for a particular test, reducing setup time and complexity.
 */

import type { Surreal } from "surrealdb";
import { DatabaseService } from "../database/database_service.ts";
import { MigrationService } from "../database/migration_service.ts";
import { SurrealConnectionFactory } from "../database/surreal_connection_factory.ts";
import { SurrealMigrationService } from "../database/surreal_migration_service.ts";
import {
  SharedSurrealManager,
  type SharedSurrealTestContext,
} from "./shared_surreal_manager.ts";
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
 * Options for creating core infrastructure.
 */
export interface CoreInfrastructureOptions {
  /** Whether to run SQLite migrations (default: true) */
  runSQLiteMigrations?: boolean;
  /** Whether to run SurrealDB migrations (default: true) */
  runSurrealMigrations?: boolean;
}

/**
 * Creates the base infrastructure: temp directory, code directory, SQLite database,
 * and shared SurrealDB connection with isolated namespace.
 *
 * SurrealDB is shared across all tests - each test gets a unique namespace for isolation.
 * This dramatically improves test performance by avoiding process startup overhead per test.
 *
 * @param migrationsDir - Directory containing migration files
 * @param options - Configuration options
 * @throws Error if SurrealDB binary is not available
 */
export async function createCoreInfrastructure(
  migrationsDir: string,
  options: CoreInfrastructureOptions = {}
): Promise<{
  tempDir: string;
  codeDir: string;
  databasePath: string;
  db: DatabaseService;
  surrealTestContext: SharedSurrealTestContext;
  surrealDb: Surreal;
  surrealFactory: SurrealConnectionFactory;
}> {
  const { runSQLiteMigrations = true, runSurrealMigrations = true } = options;

  // Create temp directory for test isolation
  const tempDir = await Deno.makeTempDir();
  const codeDir = `${tempDir}/code`;
  await Deno.mkdir(codeDir, { recursive: true });

  // Open SQLite database
  const databasePath = `${tempDir}/database.db`;
  const db = new DatabaseService({ databasePath });
  await db.open();

  // Run SQLite migrations if requested
  if (runSQLiteMigrations) {
    const migrationService = new MigrationService({
      db,
      migrationsDir,
    });
    await migrationService.migrate();
  }

  // Get shared SurrealDB context with unique namespace
  const manager = SharedSurrealManager.getInstance();
  const surrealTestContext = await manager.createTestContext();

  // Run SurrealDB migrations in this namespace if requested
  if (runSurrealMigrations) {
    const surrealMigrationService = new SurrealMigrationService({
      connectionFactory: surrealTestContext.factory,
      migrationsDir,
      namespace: surrealTestContext.namespace,
      database: surrealTestContext.database,
    });
    await surrealMigrationService.migrate();
  }

  return {
    tempDir,
    codeDir,
    databasePath,
    db,
    surrealTestContext,
    surrealDb: surrealTestContext.db,
    surrealFactory: surrealTestContext.factory,
  };
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
 * Requires SurrealDB connection factory and encryption service.
 */
export async function createSettingsService(
  encryptionService: VersionedEncryptionService,
  surrealFactory: SurrealConnectionFactory,
  namespace?: string,
  database?: string
): Promise<SettingsService> {
  const settingsService = new SettingsService({
    surrealFactory,
    encryptionService,
    namespace,
    database,
  });
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
// Cleanup Factory
// =============================================================================

/**
 * Creates a cleanup function for the test context.
 * Handles proper teardown order: namespace deletion before SQLite closes,
 * both before temp dir removal.
 *
 * Note: SurrealDB process is shared and managed by SharedSurrealManager.
 * We only clean up the namespace here, not the process.
 */
export function createCleanupFunction(
  db: DatabaseService,
  tempDir: string,
  surrealTestContext: SharedSurrealTestContext,
  consoleLogService?: ConsoleLogService
): () => Promise<void> {
  return async () => {
    // 1. Shutdown console log service if present (flush pending logs)
    if (consoleLogService) {
      await consoleLogService.shutdown();
    }

    // 2. Delete SurrealDB namespace (fast cleanup, shared process stays running)
    const manager = SharedSurrealManager.getInstance();
    await manager.deleteTestContext(
      surrealTestContext.namespace,
      surrealTestContext.db
    );

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
