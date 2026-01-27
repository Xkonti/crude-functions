/**
 * Test setup builder for creating isolated test environments with real infrastructure.
 *
 * ## Purpose
 *
 * **The primary goal of TestSetupBuilder is to keep tests in sync with the actual
 * application code and minimize regressions.** It achieves this by:
 *
 * - **Using real migrations** instead of hardcoded schemas that can drift
 * - **Production initialization order** matching main.ts startup sequence
 * - **Modular service selection** to include only what tests need
 * - **Auto-dependency resolution** when services depend on others
 *
 * ## Modular Architecture
 *
 * Tests can request only the services they need:
 *
 * ```typescript
 * // Minimal context for metrics tests (no encryption, auth, etc.)
 * const ctx = await TestSetupBuilder.create()
 *   .withMetrics()
 *   .build();
 *
 * // Just settings and encryption
 * const ctx = await TestSetupBuilder.create()
 *   .withSettings()
 *   .build();
 *
 * // Full context (backward compatible - all services)
 * const ctx = await TestSetupBuilder.create().build();
 * ```
 *
 * ## Two Levels of API
 *
 * 1. **Convenience methods** (recommended): `withMetrics()`, `withSettings()`, `withLogs()`
 *    These compose multiple services and handle dependencies automatically.
 *
 * 2. **Individual methods**: `withExecutionMetricsService()`, `withSettingsService()`
 *    For fine-grained control when you need exactly one service.
 *
 * ## Dependency Resolution
 *
 * When you enable a service that requires others, dependencies are auto-enabled:
 * - `withSettings()` → enables encryption services
 * - `withLogs()` → enables settings → enables encryption
 * - `withUserService()` → enables auth → enables encryption
 *
 * ## When to Use TestSetupBuilder
 *
 * Use this builder for tests that need:
 * - **Database and migrations**: Tests validating service behavior with real schema
 * - **Multiple services working together**: Integration-style tests
 * - **Production initialization flow**: Tests that should match main.ts initialization
 *
 * ## When NOT to Use TestSetupBuilder
 *
 * **Use simple helper functions instead** for:
 * - **Low-level utilities**: Pure logic with no infrastructure (e.g., env_isolator_test.ts)
 * - **Single-class unit tests**: Testing a class in isolation
 * - **Encryption-only tests**: Use KeyStorageService directly (encryption_service_test.ts)
 *
 * @example Metrics test (minimal context)
 * ```typescript
 * const ctx = await TestSetupBuilder.create()
 *   .withMetrics()
 *   .build();
 *
 * try {
 *   await ctx.executionMetricsService.store({ ... });
 * } finally {
 *   await ctx.cleanup();
 * }
 * ```
 *
 * @example Full integration test
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
 */

import type { SettingName } from "../settings/types.ts";
import type {
  BaseTestContext,
  FullTestContext,
  MetricsContext,
  EncryptionContext,
  SettingsContext,
  LogsContext,
  RoutesContext,
  FilesContext,
  ApiKeysContext,
  SecretsContext,
  AuthContext,
  UsersContext,
  InstanceIdContext,
  JobQueueContext,
  SchedulingContext,
  CodeSourcesContext,
  RouteOptions,
  DeferredUser,
  DeferredKeyGroup,
  DeferredApiKey,
  DeferredRoute,
  DeferredFile,
  DeferredSetting,
  DeferredConsoleLog,
  DeferredMetric,
  DeferredJob,
} from "./types.ts";
import {
  type ServiceFlags,
  createDefaultFlags,
  enableServiceWithDependencies,
  hasAnyServiceEnabled,
  enableAllServices,
} from "./dependency_graph.ts";
import {
  createCoreInfrastructure,
  createEncryptionKeys,
  createEncryptionService,
  createHashService,
  createSettingsService,
  createExecutionMetricsService,
  createMetricsStateService,
  createConsoleLogService,
  createRoutesService,
  createFileService,
  createApiKeyService,
  createSecretsService,
  createBetterAuth,
  createUserService,
  createUserDirectly,
  createInstanceIdService,
  createJobQueueService,
  createSchedulingService,
  createCodeSourceService,
  createCleanupFunction,
} from "./service_factories.ts";

/**
 * Builder for creating isolated test environments with real migrations.
 *
 * Mirrors the production initialization flow from main.ts to ensure tests
 * run against the actual schema and configuration. Uses a flag-based system
 * to selectively include only the services needed for each test.
 *
 * The generic type parameter tracks which services are included, providing
 * compile-time safety when accessing context properties.
 */
export class TestSetupBuilder<TContext extends BaseTestContext = BaseTestContext> {
  private migrationsDir = "./migrations";
  private runSQLiteMigrations = true;
  private runSurrealMigrations = true;
  private baseOnly = false; // When true, skip all services (just base context)

  // Service flags - tracks which services to include
  private flags: ServiceFlags = createDefaultFlags();

  // Deferred data to apply during build
  private deferredUsers: DeferredUser[] = [];
  private deferredGroups: DeferredKeyGroup[] = [];
  private deferredKeys: DeferredApiKey[] = [];
  private deferredRoutes: DeferredRoute[] = [];
  private deferredFiles: DeferredFile[] = [];
  private deferredSettings: DeferredSetting[] = [];
  private deferredLogs: DeferredConsoleLog[] = [];
  private deferredMetrics: DeferredMetric[] = [];
  private deferredJobs: DeferredJob[] = [];

  private constructor() {}

  /**
   * Create a new TestSetupBuilder instance.
   */
  static create(): TestSetupBuilder<BaseTestContext> {
    return new TestSetupBuilder();
  }

  /**
   * Set a custom migrations directory.
   * Defaults to "./migrations" relative to the project root.
   */
  withMigrationsDir(dir: string): this {
    this.migrationsDir = dir;
    return this;
  }

  /**
   * Skip SurrealDB migrations during setup.
   *
   * Use this for tests that need to test migration logic itself,
   * or tests that don't use SurrealDB features at all.
   *
   * @example
   * ```typescript
   * // For migration tests that manage their own migrations
   * const ctx = await TestSetupBuilder.create()
   *   .withMigrationsDir(tempMigrationsDir)
   *   .withoutSurrealMigrations()
   *   .build();
   * ```
   */
  withoutSurrealMigrations(): this {
    this.runSurrealMigrations = false;
    return this;
  }

  /**
   * Skip SQLite migrations during setup.
   *
   * Use this when testing with a custom migrations directory that has files
   * SQLite might try to run (e.g., when testing that SurrealQL ignores .sql files).
   *
   * @example
   * ```typescript
   * const ctx = await TestSetupBuilder.create()
   *   .withMigrationsDir(tempMigrationsDir)
   *   .withoutSQLiteMigrations()
   *   .withoutSurrealMigrations()
   *   .withBaseOnly()
   *   .build();
   * ```
   */
  withoutSQLiteMigrations(): this {
    this.runSQLiteMigrations = false;
    return this;
  }

  /**
   * Request only the base context (no services).
   *
   * This prevents the backward compatibility logic from enabling all services.
   * Use this when testing infrastructure components that don't need any services.
   *
   * @example
   * ```typescript
   * // For migration tests or low-level infrastructure tests
   * const ctx = await TestSetupBuilder.create()
   *   .withMigrationsDir(tempMigrationsDir)
   *   .withoutSurrealMigrations()
   *   .withBaseOnly()
   *   .build();
   * ```
   */
  withBaseOnly(): this {
    this.baseOnly = true;
    return this;
  }

  // =============================================================================
  // Individual Service Methods (Fine-Grained Control)
  // =============================================================================

  /**
   * Include ExecutionMetricsService in the test context.
   * No dependencies - works with just the base context.
   */
  withExecutionMetricsService(): TestSetupBuilder<
    TContext & { executionMetricsService: MetricsContext["executionMetricsService"] }
  > {
    enableServiceWithDependencies(this.flags, "executionMetricsService");
    return this as unknown as TestSetupBuilder<
      TContext & { executionMetricsService: MetricsContext["executionMetricsService"] }
    >;
  }

  /**
   * Include MetricsStateService in the test context.
   * No dependencies - works with just the base context.
   */
  withMetricsStateService(): TestSetupBuilder<
    TContext & { metricsStateService: MetricsContext["metricsStateService"] }
  > {
    enableServiceWithDependencies(this.flags, "metricsStateService");
    return this as unknown as TestSetupBuilder<
      TContext & { metricsStateService: MetricsContext["metricsStateService"] }
    >;
  }

  /**
   * Include RoutesService in the test context.
   * No dependencies - works with just the base context.
   */
  withRoutesService(): TestSetupBuilder<TContext & RoutesContext> {
    enableServiceWithDependencies(this.flags, "routesService");
    return this as unknown as TestSetupBuilder<TContext & RoutesContext>;
  }

  /**
   * Include FileService in the test context.
   * No dependencies - works with just the base context.
   */
  withFileService(): TestSetupBuilder<TContext & FilesContext> {
    enableServiceWithDependencies(this.flags, "fileService");
    return this as unknown as TestSetupBuilder<TContext & FilesContext>;
  }

  /**
   * Include encryption services (VersionedEncryptionService + HashService) in the test context.
   * Creates encryption keys and both encryption-related services.
   */
  withEncryptionService(): TestSetupBuilder<TContext & EncryptionContext> {
    enableServiceWithDependencies(this.flags, "encryptionService");
    return this as unknown as TestSetupBuilder<TContext & EncryptionContext>;
  }

  /**
   * Include HashService in the test context.
   * This is typically included via withEncryptionService() which includes both.
   */
  withHashService(): TestSetupBuilder<
    TContext & { hashService: EncryptionContext["hashService"] }
  > {
    enableServiceWithDependencies(this.flags, "hashService");
    return this as unknown as TestSetupBuilder<
      TContext & { hashService: EncryptionContext["hashService"] }
    >;
  }

  /**
   * Include SettingsService in the test context.
   * Auto-enables: encryption services (required dependency).
   */
  withSettingsService(): TestSetupBuilder<TContext & SettingsContext> {
    enableServiceWithDependencies(this.flags, "settingsService");
    return this as unknown as TestSetupBuilder<TContext & SettingsContext>;
  }

  /**
   * Include ConsoleLogService in the test context.
   * Auto-enables: settings service (required dependency).
   */
  withConsoleLogService(): TestSetupBuilder<TContext & LogsContext> {
    enableServiceWithDependencies(this.flags, "consoleLogService");
    return this as unknown as TestSetupBuilder<TContext & LogsContext>;
  }

  /**
   * Include ApiKeyService in the test context.
   * Auto-enables: encryption services (required dependency).
   */
  withApiKeyService(): TestSetupBuilder<TContext & ApiKeysContext> {
    enableServiceWithDependencies(this.flags, "apiKeyService");
    return this as unknown as TestSetupBuilder<TContext & ApiKeysContext>;
  }

  /**
   * Include SecretsService in the test context.
   * Auto-enables: encryption services (required dependency).
   */
  withSecretsService(): TestSetupBuilder<TContext & SecretsContext> {
    enableServiceWithDependencies(this.flags, "secretsService");
    return this as unknown as TestSetupBuilder<TContext & SecretsContext>;
  }

  /**
   * Include Better Auth instance in the test context.
   * Auto-enables: encryption (for better_auth_secret).
   */
  withAuth(): TestSetupBuilder<TContext & AuthContext> {
    enableServiceWithDependencies(this.flags, "auth");
    return this as unknown as TestSetupBuilder<TContext & AuthContext>;
  }

  /**
   * Include UserService in the test context.
   * Auto-enables: auth, encryption services.
   */
  withUserService(): TestSetupBuilder<TContext & UsersContext> {
    enableServiceWithDependencies(this.flags, "userService");
    return this as unknown as TestSetupBuilder<TContext & UsersContext>;
  }

  /**
   * Include InstanceIdService in the test context.
   * No dependencies - works with just the base context.
   */
  withInstanceIdService(): TestSetupBuilder<TContext & InstanceIdContext> {
    enableServiceWithDependencies(this.flags, "instanceIdService");
    return this as unknown as TestSetupBuilder<TContext & InstanceIdContext>;
  }

  /**
   * Include JobQueueService in the test context.
   * Auto-enables: instanceIdService.
   */
  withJobQueueService(): TestSetupBuilder<TContext & JobQueueContext> {
    enableServiceWithDependencies(this.flags, "jobQueueService");
    return this as unknown as TestSetupBuilder<TContext & JobQueueContext>;
  }

  /**
   * Include SchedulingService in the test context.
   * Auto-enables: jobQueueService, instanceIdService.
   */
  withSchedulingService(): TestSetupBuilder<TContext & SchedulingContext> {
    enableServiceWithDependencies(this.flags, "schedulingService");
    return this as unknown as TestSetupBuilder<TContext & SchedulingContext>;
  }

  /**
   * Include CodeSourceService in the test context.
   * Auto-enables: schedulingService, jobQueueService, instanceIdService, encryptionService.
   */
  withCodeSourceService(): TestSetupBuilder<TContext & CodeSourcesContext> {
    enableServiceWithDependencies(this.flags, "codeSourceService");
    return this as unknown as TestSetupBuilder<TContext & CodeSourcesContext>;
  }

  // =============================================================================
  // Convenience Methods (Compose Multiple Services)
  // =============================================================================

  /**
   * Include both metrics services (ExecutionMetricsService + MetricsStateService).
   * Convenience method for tests that need metrics functionality.
   */
  withMetrics(): TestSetupBuilder<TContext & MetricsContext> {
    this.withExecutionMetricsService();
    this.withMetricsStateService();
    return this as unknown as TestSetupBuilder<TContext & MetricsContext>;
  }

  /**
   * Include encryption services (VersionedEncryptionService + HashService).
   * Alias for withEncryptionService() for semantic clarity.
   */
  withEncryption(): TestSetupBuilder<TContext & EncryptionContext> {
    return this.withEncryptionService() as unknown as TestSetupBuilder<TContext & EncryptionContext>;
  }

  /**
   * Include settings and its dependencies (encryption).
   * Alias for withSettingsService() for semantic clarity.
   */
  withSettings(): TestSetupBuilder<TContext & SettingsContext> {
    return this.withSettingsService() as unknown as TestSetupBuilder<TContext & SettingsContext>;
  }

  /**
   * Include console log service and its dependencies (settings, encryption).
   * Alias for withConsoleLogService() for semantic clarity.
   */
  withLogs(): TestSetupBuilder<TContext & LogsContext> {
    return this.withConsoleLogService() as unknown as TestSetupBuilder<TContext & LogsContext>;
  }

  /**
   * Include routes service.
   * Alias for withRoutesService() for semantic clarity.
   */
  withRoutes(): TestSetupBuilder<TContext & RoutesContext> {
    return this.withRoutesService() as unknown as TestSetupBuilder<TContext & RoutesContext>;
  }

  /**
   * Include file service.
   * Alias for withFileService() for semantic clarity.
   */
  withFiles(): TestSetupBuilder<TContext & FilesContext> {
    return this.withFileService() as unknown as TestSetupBuilder<TContext & FilesContext>;
  }

  /**
   * Include API key service and its dependencies (encryption).
   * Alias for withApiKeyService() for semantic clarity.
   */
  withApiKeys(): TestSetupBuilder<TContext & ApiKeysContext> {
    return this.withApiKeyService() as unknown as TestSetupBuilder<TContext & ApiKeysContext>;
  }

  /**
   * Include secrets service and its dependencies (encryption).
   * Alias for withSecretsService() for semantic clarity.
   */
  withSecrets(): TestSetupBuilder<TContext & SecretsContext> {
    return this.withSecretsService() as unknown as TestSetupBuilder<TContext & SecretsContext>;
  }

  /**
   * Include user service and auth.
   * Convenience method that enables both auth and user service.
   */
  withUsers(): TestSetupBuilder<TContext & UsersContext> {
    return this.withUserService() as unknown as TestSetupBuilder<TContext & UsersContext>;
  }

  /**
   * Include instance ID service.
   * Alias for withInstanceIdService() for semantic clarity.
   */
  withInstanceId(): TestSetupBuilder<TContext & InstanceIdContext> {
    return this.withInstanceIdService() as unknown as TestSetupBuilder<
      TContext & InstanceIdContext
    >;
  }

  /**
   * Include job queue service and its dependencies (instanceIdService).
   * Alias for withJobQueueService() for semantic clarity.
   */
  withJobQueue(): TestSetupBuilder<TContext & JobQueueContext> {
    return this.withJobQueueService() as unknown as TestSetupBuilder<
      TContext & JobQueueContext
    >;
  }

  /**
   * Include scheduling service and its dependencies (jobQueueService, instanceIdService).
   * Alias for withSchedulingService() for semantic clarity.
   */
  withScheduling(): TestSetupBuilder<TContext & SchedulingContext> {
    return this.withSchedulingService() as unknown as TestSetupBuilder<
      TContext & SchedulingContext
    >;
  }

  /**
   * Include code source service and its dependencies.
   * Alias for withCodeSourceService() for semantic clarity.
   */
  withCodeSources(): TestSetupBuilder<TContext & CodeSourcesContext> {
    return this.withCodeSourceService() as unknown as TestSetupBuilder<
      TContext & CodeSourcesContext
    >;
  }

  /**
   * Include all services.
   * This is the default behavior for backward compatibility.
   * SurrealDB is always included as part of the base infrastructure.
   */
  withAll(): TestSetupBuilder<FullTestContext> {
    enableAllServices(this.flags);
    return this as unknown as TestSetupBuilder<FullTestContext>;
  }

  // =============================================================================
  // Deferred Data Methods
  // =============================================================================

  /**
   * Add an admin user to be created during build.
   * Uses direct DB insert for speed (bypasses Better Auth HTTP requirement).
   * Auto-enables: userService, auth, encryption.
   *
   * @param email - User email address
   * @param password - User password (will be hashed with bcrypt)
   * @param roles - User roles (defaults to ["userMgmt"])
   */
  withAdminUser(
    email: string,
    password: string,
    roles?: string[]
  ): TestSetupBuilder<TContext & UsersContext> {
    this.deferredUsers.push({ email, password, roles });
    this.withUserService();
    return this as unknown as TestSetupBuilder<TContext & UsersContext>;
  }

  /**
   * Add an API key group to be created during build.
   * Auto-enables: apiKeyService, encryption.
   *
   * @param name - Group name (lowercase, hyphens allowed)
   * @param description - Optional description
   */
  withApiKeyGroup(
    name: string,
    description?: string
  ): TestSetupBuilder<TContext & ApiKeysContext> {
    this.deferredGroups.push({ name, description });
    this.withApiKeyService();
    return this as unknown as TestSetupBuilder<TContext & ApiKeysContext>;
  }

  /**
   * Add an API key to be created during build.
   * The group must be added first via withApiKeyGroup().
   * Auto-enables: apiKeyService, encryption.
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
  ): TestSetupBuilder<TContext & ApiKeysContext> {
    this.deferredKeys.push({ groupName, keyValue, keyName, description });
    this.withApiKeyService();
    return this as unknown as TestSetupBuilder<TContext & ApiKeysContext>;
  }

  /**
   * Add a route to be created during build.
   * Auto-enables: routesService.
   *
   * @param path - Route path (e.g., "/hello")
   * @param fileName - Handler filename (e.g., "hello.ts")
   * @param options - Optional route configuration
   */
  withRoute(
    path: string,
    fileName: string,
    options?: RouteOptions
  ): TestSetupBuilder<TContext & RoutesContext> {
    this.deferredRoutes.push({ path, fileName, options });
    this.withRoutesService();
    return this as unknown as TestSetupBuilder<TContext & RoutesContext>;
  }

  /**
   * Add a code file to be created during build.
   * Auto-enables: fileService.
   *
   * @param name - Filename (e.g., "hello.ts")
   * @param content - File content (TypeScript handler code)
   */
  withFile(name: string, content: string): TestSetupBuilder<TContext & FilesContext> {
    this.deferredFiles.push({ name, content });
    this.withFileService();
    return this as unknown as TestSetupBuilder<TContext & FilesContext>;
  }

  /**
   * Set a global setting during build.
   * Auto-enables: settingsService, encryption.
   *
   * @param name - Setting name
   * @param value - Setting value (string)
   */
  withSetting(
    name: SettingName,
    value: string
  ): TestSetupBuilder<TContext & SettingsContext> {
    this.deferredSettings.push({ name, value });
    this.withSettingsService();
    return this as unknown as TestSetupBuilder<TContext & SettingsContext>;
  }

  /**
   * Seed a console log entry during build.
   * Auto-enables: consoleLogService, settingsService, encryption.
   *
   * @param log - Log data
   */
  withConsoleLog(log: DeferredConsoleLog): TestSetupBuilder<TContext & LogsContext> {
    this.deferredLogs.push(log);
    this.withConsoleLogService();
    return this as unknown as TestSetupBuilder<TContext & LogsContext>;
  }

  /**
   * Seed an execution metric during build.
   * Auto-enables: executionMetricsService.
   *
   * @param metric - Metric data
   */
  withMetric(
    metric: DeferredMetric
  ): TestSetupBuilder<TContext & { executionMetricsService: MetricsContext["executionMetricsService"] }> {
    this.deferredMetrics.push(metric);
    this.withExecutionMetricsService();
    return this as unknown as TestSetupBuilder<
      TContext & { executionMetricsService: MetricsContext["executionMetricsService"] }
    >;
  }

  /**
   * Seed a job in the job queue during build.
   * Auto-enables: jobQueueService, instanceIdService.
   *
   * @param job - Job data
   */
  withJob(job: DeferredJob): TestSetupBuilder<TContext & JobQueueContext> {
    this.deferredJobs.push(job);
    this.withJobQueueService();
    return this as unknown as TestSetupBuilder<TContext & JobQueueContext>;
  }

  // =============================================================================
  // Build Method
  // =============================================================================

  /**
   * Build the test context with selected services initialized.
   *
   * If no services were explicitly selected (no with* methods called),
   * all services are included for backward compatibility.
   *
   * @returns Context with selected services and cleanup function
   */
  async build(): Promise<TContext> {
    // Backward compatibility: if no flags are set, enable all services
    // (unless baseOnly is set, which means user explicitly wants no services)
    if (!this.baseOnly && !hasAnyServiceEnabled(this.flags)) {
      enableAllServices(this.flags);
    }

    // STEP 1: Create core infrastructure (always needed)
    // This includes SQLite database, shared SurrealDB connection, and migrations
    const {
      tempDir,
      codeDir,
      databasePath,
      db,
      surrealTestContext,
      surrealDb,
      surrealFactory,
    } = await createCoreInfrastructure(this.migrationsDir, {
      runSQLiteMigrations: this.runSQLiteMigrations,
      runSurrealMigrations: this.runSurrealMigrations,
    });

    // Build context incrementally
    // deno-lint-ignore no-explicit-any
    const context: any = {
      tempDir,
      codeDir,
      databasePath,
      db,
      surrealDb,
      surrealFactory,
      surrealNamespace: surrealTestContext.namespace,
      surrealDatabase: surrealTestContext.database,
      cleanup: async () => {}, // Placeholder, will be replaced
    };

    // STEP 2: Create encryption keys and services if needed
    // Note: encryptionService flag implies hashService is also enabled
    const needsEncryption =
      this.flags.encryptionService ||
      this.flags.hashService ||
      this.flags.settingsService ||
      this.flags.consoleLogService ||
      this.flags.apiKeyService ||
      this.flags.secretsService ||
      this.flags.auth ||
      this.flags.userService;

    if (needsEncryption) {
      const encryptionKeys = await createEncryptionKeys(tempDir);
      context.encryptionKeys = encryptionKeys;

      if (this.flags.encryptionService || this.flags.settingsService ||
          this.flags.consoleLogService || this.flags.apiKeyService ||
          this.flags.secretsService || this.flags.auth || this.flags.userService) {
        context.encryptionService = createEncryptionService(encryptionKeys);
      }

      if (this.flags.hashService || this.flags.encryptionService ||
          this.flags.settingsService || this.flags.consoleLogService ||
          this.flags.apiKeyService) {
        context.hashService = createHashService(encryptionKeys);
      }
    }

    // STEP 3: Create settings service if needed
    // Uses factory's default namespace/database (set by SharedSurrealManager)
    if (this.flags.settingsService || this.flags.consoleLogService) {
      context.settingsService = await createSettingsService(
        context.encryptionService,
        surrealFactory,
      );

      // Apply deferred settings
      for (const { name, value } of this.deferredSettings) {
        await context.settingsService.setGlobalSetting(name, value);
      }
    }

    // STEP 4: Create auth if needed
    // Uses SurrealDB adapter for all auth data storage
    if (this.flags.auth || this.flags.userService) {
      context.auth = createBetterAuth(surrealFactory, context.encryptionKeys);
    }

    // STEP 5: Create user service if needed
    if (this.flags.userService) {
      context.userService = createUserService(surrealFactory, context.auth);

      // Create deferred users directly in SurrealDB
      for (const user of this.deferredUsers) {
        await createUserDirectly(surrealFactory, user.email, user.password, user.roles);
      }
    }

    // STEP 6: Create API key service if needed (BEFORE routes for key resolution)
    // Map to track group name -> ID for resolving route keys
    const groupNameToId = new Map<string, string>();

    if (this.flags.apiKeyService) {
      context.apiKeyService = createApiKeyService(
        surrealFactory,
        context.encryptionService,
        context.hashService
      );

      // Bootstrap management group for API key service
      await context.apiKeyService.bootstrapManagementGroup();

      // Create deferred groups and keys
      for (const { name, description } of this.deferredGroups) {
        const groupId = await context.apiKeyService.getOrCreateGroup(name, description);
        groupNameToId.set(name, groupId);
      }
      for (const { groupName, keyValue, keyName, description } of this.deferredKeys) {
        const name = keyName ?? `test-key-${Date.now()}`;
        await context.apiKeyService.addKey(groupName, name, keyValue, description);
      }
    }

    // STEP 6.5: Create secrets service if needed (before routes for cascade delete)
    if (this.flags.secretsService) {
      context.secretsService = createSecretsService(surrealFactory, context.encryptionService);
    }

    // STEP 7: Create routes service if needed (after API keys for key resolution, after secrets for cascade delete)
    if (this.flags.routesService) {
      // Pass secretsService for cascade delete of function-scoped secrets
      context.routesService = createRoutesService(surrealFactory, context.secretsService);

      // Create deferred routes
      for (const { path, fileName, options } of this.deferredRoutes) {
        // Resolve any string keys to their IDs (now string IDs)
        let resolvedKeys: string[] | undefined;
        if (options?.keys && options.keys.length > 0) {
          resolvedKeys = options.keys.map((key) => {
            // Key is already a string (group name that we need to resolve to string ID)
            const id = groupNameToId.get(key);
            if (id === undefined) {
              throw new Error(
                `Test setup error: Route "${path}" references API key group "${key}" ` +
                `which was not created. Add .withApiKeyGroup("${key}") before the route.`
              );
            }
            return id;
          });
        }

        await context.routesService.addRoute({
          name: options?.name ?? fileName.replace(/\.ts$/, ""),
          description: options?.description,
          handler: fileName,
          routePath: path,
          methods: options?.methods ?? ["GET"],
          keys: resolvedKeys,
        });
      }
    }

    // STEP 8: Create file service if needed
    if (this.flags.fileService) {
      context.fileService = createFileService(codeDir);

      // Create deferred files
      for (const { name, content } of this.deferredFiles) {
        await context.fileService.writeFile(name, content);
      }
    }

    // STEP 9: Create console log service if needed (after routes exist for FK constraint)
    if (this.flags.consoleLogService) {
      context.consoleLogService = createConsoleLogService(db, context.settingsService);

      // Seed deferred logs
      for (const log of this.deferredLogs) {
        context.consoleLogService.store({
          requestId: log.requestId,
          routeId: log.routeId,
          level: log.level,
          message: log.message,
          args: log.args,
        });
      }
      await context.consoleLogService.flush();
    }

    // STEP 10: Create metrics services if needed (after routes exist for FK constraint)
    if (this.flags.executionMetricsService) {
      context.executionMetricsService = createExecutionMetricsService(db);

      // Seed deferred metrics
      for (const metric of this.deferredMetrics) {
        await context.executionMetricsService.store({
          routeId: metric.routeId,
          type: metric.type,
          avgTimeMs: metric.avgTimeMs,
          maxTimeMs: metric.maxTimeMs,
          executionCount: metric.executionCount,
          timestamp: metric.timestamp,
        });
      }
    }

    if (this.flags.metricsStateService) {
      context.metricsStateService = createMetricsStateService(db);
    }

    // STEP 11: Create instance ID service if needed
    if (this.flags.instanceIdService || this.flags.jobQueueService || this.flags.schedulingService) {
      context.instanceIdService = createInstanceIdService();
    }

    // STEP 12: Create job queue service if needed
    if (this.flags.jobQueueService || this.flags.schedulingService) {
      context.jobQueueService = createJobQueueService(
        db,
        context.instanceIdService,
        context.encryptionService,
      );

      // Seed deferred jobs
      for (const job of this.deferredJobs) {
        // Insert job directly into database for seeding
        // (bypasses enqueue to allow setting status)
        const payloadStr = job.payload !== undefined
          ? JSON.stringify(job.payload)
          : null;
        await db.execute(
          `INSERT INTO jobQueue (type, status, executionMode, payload, priority, referenceType, referenceId, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
          [
            job.type,
            job.status ?? "pending",
            job.executionMode ?? "sequential",
            payloadStr,
            job.priority ?? 0,
            job.referenceType ?? null,
            job.referenceId ?? null,
          ],
        );
      }
    }

    // STEP 13: Create scheduling service if needed
    if (this.flags.schedulingService || this.flags.codeSourceService) {
      context.schedulingService = createSchedulingService(
        db,
        context.jobQueueService,
      );
    }

    // STEP 14: Create code source service if needed
    if (this.flags.codeSourceService) {
      context.codeSourceService = createCodeSourceService(
        surrealFactory,
        context.encryptionService,
        context.jobQueueService,
        context.schedulingService,
        codeDir,
      );
    }

    // STEP 15: Create cleanup function
    context.cleanup = createCleanupFunction(
      db,
      tempDir,
      surrealTestContext,
      this.flags.consoleLogService ? context.consoleLogService : undefined
    );

    return context as TContext;
  }
}
