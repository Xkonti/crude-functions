/**
 * Test setup builder for creating isolated test environments with real infrastructure.
 *
 * ## Purpose
 *
 * TestSetupBuilder provides production-like test environments to:
 * - **Reduce code duplication** across test files that need similar infrastructure
 * - **Eliminate hardcoded values** (schemas, initialization patterns) that drift from production
 * - **Use real migrations** instead of mocking, ensuring tests validate actual database schema
 * - **Bridge unit/integration gap** by testing services with real dependencies
 * - **Centralize setup** that's shared across multiple test files
 *
 * ## When to Use TestSetupBuilder
 *
 * Use this builder for tests that need:
 * - **Database and migrations**: Tests validating service behavior with real schema
 * - **Multiple services working together**: Integration-style tests (e.g., RoutesService + FileService)
 * - **Production initialization flow**: Tests that should match main.ts initialization
 * - **Cross-cutting infrastructure**: Setup used by 2+ test files
 *
 * Examples: `routes_service_test.ts`, `api_key_service_test.ts`, `routes_toggle_test.ts`
 *
 * ## When NOT to Use TestSetupBuilder
 *
 * **Use simple helper functions instead** for:
 * - **Low-level utilities**: Pure logic with no infrastructure (e.g., `env_isolator_test.ts`)
 * - **File-specific setup**: Needs unique to one test file (e.g., `key_storage_service_test.ts`)
 * - **Simple unit tests**: Testing a single class in isolation
 *
 * **Philosophy**: TestSetupBuilder is for shared infrastructure. Individual test files
 * should be as simple as possible - use lightweight helpers within the test file itself.
 *
 * @example Service test using TestSetupBuilder
 * ```typescript
 * const ctx = await TestSetupBuilder.create()
 *   .withApiKeyGroup("management", "Test keys")
 *   .withApiKey("management", "test-api-key")
 *   .withRoute("/hello", "hello.ts", { methods: ["GET"] })
 *   .build();
 *
 * try {
 *   const routes = await ctx.routesService.getAll();
 *   expect(routes).toHaveLength(1);
 * } finally {
 *   await ctx.cleanup();
 * }
 * ```
 *
 * @example Simple helper (preferred for file-specific needs)
 * ```typescript
 * // In your_service_test.ts
 * async function createTestContext(options?) {
 *   const tempDir = await Deno.makeTempDir();
 *   const service = new YourService({ ... });
 *   const cleanup = async () => await Deno.remove(tempDir, { recursive: true });
 *   return { service, cleanup };
 * }
 * ```
 */

import { DatabaseService } from "../database/database_service.ts";
import { MigrationService } from "../database/migration_service.ts";
import { KeyStorageService } from "../encryption/key_storage_service.ts";
import { VersionedEncryptionService } from "../encryption/versioned_encryption_service.ts";
import { HashService } from "../encryption/hash_service.ts";
import { SettingsService } from "../settings/settings_service.ts";
import { ApiKeyService } from "../keys/api_key_service.ts";
import { RoutesService } from "../routes/routes_service.ts";
import { FileService } from "../files/file_service.ts";
import { ConsoleLogService } from "../logs/console_log_service.ts";
import { ExecutionMetricsService } from "../metrics/execution_metrics_service.ts";
import { UserService } from "../users/user_service.ts";
import { createAuth } from "../auth/auth.ts";
import type { SettingName } from "../settings/types.ts";
import type {
  TestContext,
  RouteOptions,
  DeferredUser,
  DeferredKeyGroup,
  DeferredApiKey,
  DeferredRoute,
  DeferredFile,
  DeferredSetting,
  DeferredConsoleLog,
  DeferredMetric,
} from "./types.ts";

/**
 * Builder for creating isolated test environments with real migrations.
 *
 * Mirrors the production initialization flow from main.ts to ensure tests
 * run against the actual schema and configuration. This creates a complete
 * application stack (database, migrations, all services) in each test's
 * isolated temporary directory.
 *
 * Use this for service tests that need real infrastructure. For lightweight
 * unit tests or file-specific needs, use a simple helper function instead.
 */
export class TestSetupBuilder {
  private migrationsDir = "./migrations";

  // Deferred data to apply during build
  private deferredUsers: DeferredUser[] = [];
  private deferredGroups: DeferredKeyGroup[] = [];
  private deferredKeys: DeferredApiKey[] = [];
  private deferredRoutes: DeferredRoute[] = [];
  private deferredFiles: DeferredFile[] = [];
  private deferredSettings: DeferredSetting[] = [];
  private deferredLogs: DeferredConsoleLog[] = [];
  private deferredMetrics: DeferredMetric[] = [];

  private constructor() {}

  /**
   * Create a new TestSetupBuilder instance.
   */
  static create(): TestSetupBuilder {
    return new TestSetupBuilder();
  }

  /**
   * Set a custom migrations directory.
   * Defaults to "./migrations" relative to the project root.
   */
  withMigrationsDir(dir: string): TestSetupBuilder {
    this.migrationsDir = dir;
    return this;
  }

  /**
   * Add an admin user to be created during build.
   * Uses direct DB insert for speed (bypasses Better Auth HTTP requirement).
   *
   * @param email - User email address
   * @param password - User password (will be hashed with bcrypt)
   * @param roles - User roles (defaults to ["userMgmt"])
   */
  withAdminUser(email: string, password: string, roles?: string[]): TestSetupBuilder {
    this.deferredUsers.push({ email, password, roles });
    return this;
  }

  /**
   * Add an API key group to be created during build.
   *
   * @param name - Group name (lowercase, hyphens allowed)
   * @param description - Optional description
   */
  withApiKeyGroup(name: string, description?: string): TestSetupBuilder {
    this.deferredGroups.push({ name, description });
    return this;
  }

  /**
   * Add an API key to be created during build.
   * The group must be added first via withApiKeyGroup().
   *
   * @param groupName - Name of the group (must exist)
   * @param keyValue - The key value
   * @param keyName - Optional display name (defaults to timestamp-based)
   * @param description - Optional description
   */
  withApiKey(
    groupName: string,
    keyValue: string,
    keyName?: string,
    description?: string
  ): TestSetupBuilder {
    this.deferredKeys.push({ groupName, keyValue, keyName, description });
    return this;
  }

  /**
   * Add a route to be created during build.
   *
   * @param path - Route path (e.g., "/hello")
   * @param fileName - Handler filename (e.g., "hello.ts")
   * @param options - Optional route configuration
   */
  withRoute(path: string, fileName: string, options?: RouteOptions): TestSetupBuilder {
    this.deferredRoutes.push({ path, fileName, options });
    return this;
  }

  /**
   * Add a code file to be created during build.
   *
   * @param name - Filename (e.g., "hello.ts")
   * @param content - File content (TypeScript handler code)
   */
  withFile(name: string, content: string): TestSetupBuilder {
    this.deferredFiles.push({ name, content });
    return this;
  }

  /**
   * Set a global setting during build.
   *
   * @param name - Setting name
   * @param value - Setting value (string)
   */
  withSetting(name: SettingName, value: string): TestSetupBuilder {
    this.deferredSettings.push({ name, value });
    return this;
  }

  /**
   * Seed a console log entry during build.
   *
   * @param log - Log data
   */
  withConsoleLog(log: DeferredConsoleLog): TestSetupBuilder {
    this.deferredLogs.push(log);
    return this;
  }

  /**
   * Seed an execution metric during build.
   *
   * @param metric - Metric data
   */
  withMetric(metric: DeferredMetric): TestSetupBuilder {
    this.deferredMetrics.push(metric);
    return this;
  }

  /**
   * Build the test context with all services initialized.
   * Follows the same initialization order as main.ts.
   *
   * @returns Complete TestContext with all services and cleanup function
   */
  async build(): Promise<TestContext> {
    // STEP 1: Create temp directory for test isolation
    const tempDir = await Deno.makeTempDir();
    const codeDir = `${tempDir}/code`;
    await Deno.mkdir(codeDir, { recursive: true });

    // STEP 2: Generate encryption keys using real KeyStorageService
    const keyStorageService = new KeyStorageService({
      keyFilePath: `${tempDir}/encryption-keys.json`,
    });
    const encryptionKeys = await keyStorageService.ensureInitialized();

    // STEP 3: Initialize encryption services
    const encryptionService = new VersionedEncryptionService({
      currentKey: encryptionKeys.current_key,
      currentVersion: encryptionKeys.current_version,
      phasedOutKey: encryptionKeys.phased_out_key ?? undefined,
      phasedOutVersion: encryptionKeys.phased_out_version ?? undefined,
    });

    const hashService = new HashService({
      hashKey: encryptionKeys.hash_key,
    });

    // STEP 4: Open database
    const databasePath = `${tempDir}/database.db`;
    const db = new DatabaseService({ databasePath });
    await db.open();

    // STEP 5: Run real migrations
    const migrationService = new MigrationService({
      db,
      migrationsDir: this.migrationsDir,
    });
    await migrationService.migrate();

    // STEP 6: Initialize settings service and bootstrap defaults
    const settingsService = new SettingsService({ db, encryptionService });
    await settingsService.bootstrapGlobalSettings();

    // STEP 7: Apply deferred settings
    for (const { name, value } of this.deferredSettings) {
      await settingsService.setGlobalSetting(name, value);
    }

    // STEP 8: Initialize Better Auth
    const auth = createAuth({
      databasePath,
      secret: encryptionKeys.better_auth_secret,
      hasUsers: false, // Always enable sign-up for tests
    });

    // STEP 9: Initialize UserService
    const userService = new UserService({ db, auth });

    // STEP 10: Create deferred users via direct DB insert
    for (const user of this.deferredUsers) {
      await this.createUserDirectly(db, user);
    }

    // STEP 11: Initialize console log and metrics services
    const consoleLogService = new ConsoleLogService({ db, settingsService });
    const executionMetricsService = new ExecutionMetricsService({ db });

    // STEP 12: Initialize API key service
    const apiKeyService = new ApiKeyService({
      db,
      encryptionService,
      hashService,
    });

    // STEP 13: Create deferred API key groups and keys
    for (const { name, description } of this.deferredGroups) {
      await apiKeyService.getOrCreateGroup(name, description);
    }
    for (const { groupName, keyValue, keyName, description } of this.deferredKeys) {
      const name = keyName ?? `test-key-${Date.now()}`;
      await apiKeyService.addKey(groupName, name, keyValue, description);
    }

    // STEP 14: Initialize routes service
    const routesService = new RoutesService({ db });

    // STEP 15: Create deferred routes
    for (const { path, fileName, options } of this.deferredRoutes) {
      await routesService.addRoute({
        name: options?.name ?? fileName.replace(/\.ts$/, ""),
        description: options?.description,
        handler: fileName,
        route: path,
        methods: options?.methods ?? ["GET"],
        keys: options?.keys,
      });
    }

    // STEP 16: Initialize file service
    const fileService = new FileService({ basePath: codeDir });

    // STEP 17: Create deferred files
    for (const { name, content } of this.deferredFiles) {
      await fileService.writeFile(name, content);
    }

    // STEP 18: Seed deferred console logs
    for (const log of this.deferredLogs) {
      consoleLogService.store({
        requestId: log.requestId,
        routeId: log.routeId,
        level: log.level,
        message: log.message,
        args: log.args,
      });
    }
    await consoleLogService.flush();

    // STEP 19: Seed deferred execution metrics
    for (const metric of this.deferredMetrics) {
      await executionMetricsService.store({
        routeId: metric.routeId,
        type: metric.type,
        avgTimeMs: metric.avgTimeMs,
        maxTimeMs: metric.maxTimeMs,
        executionCount: metric.executionCount,
        timestamp: metric.timestamp,
      });
    }

    // STEP 20: Create cleanup function
    const cleanup = this.createCleanupFunction(db, consoleLogService, tempDir);

    // Return complete context
    return {
      tempDir,
      codeDir,
      db,
      encryptionKeys,
      encryptionService,
      hashService,
      settingsService,
      apiKeyService,
      routesService,
      fileService,
      consoleLogService,
      executionMetricsService,
      auth,
      userService,
      cleanup,
    };
  }

  /**
   * Create a user directly in the database (bypasses Better Auth API).
   * Uses bcrypt for password hashing to match Better Auth's format.
   */
  private async createUserDirectly(db: DatabaseService, user: DeferredUser): Promise<string> {
    const userId = crypto.randomUUID();
    const roles = user.roles ?? ["userMgmt"];
    const roleString = roles.join(",");

    // Insert user record
    await db.execute(
      `INSERT INTO user (id, email, emailVerified, name, role, banned, createdAt, updatedAt)
       VALUES (?, ?, 0, ?, ?, 0, datetime('now'), datetime('now'))`,
      [userId, user.email, user.email.split("@")[0], roleString || null]
    );

    // Hash password using bcrypt (Better Auth uses bcrypt internally)
    const hashedPassword = await this.hashPasswordBcrypt(user.password);

    // Insert account record with credential provider
    const accountId = crypto.randomUUID();
    await db.execute(
      `INSERT INTO account (id, userId, accountId, providerId, password, createdAt, updatedAt)
       VALUES (?, ?, ?, 'credential', ?, datetime('now'), datetime('now'))`,
      [accountId, userId, user.email, hashedPassword]
    );

    return userId;
  }

  /**
   * Hash password using bcrypt to match Better Auth's format.
   * Uses Deno's bcrypt library for compatibility.
   */
  private async hashPasswordBcrypt(password: string): Promise<string> {
    // Import bcrypt dynamically to avoid bundling issues
    const { hash } = await import("@da/bcrypt");
    return await hash(password);
  }

  /**
   * Create cleanup function with proper teardown order.
   */
  private createCleanupFunction(
    db: DatabaseService,
    consoleLogService: ConsoleLogService,
    tempDir: string
  ): () => Promise<void> {
    return async () => {
      // 1. Shutdown console log service (flush pending logs)
      await consoleLogService.shutdown();

      // 2. Close database
      await db.close();

      // 3. Remove temp directory
      try {
        await Deno.remove(tempDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    };
  }
}
