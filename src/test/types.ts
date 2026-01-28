/**
 * Types for the test setup builder.
 *
 * The TestSetupBuilder provides a fluent API for creating isolated test
 * environments with real migrations and production-like initialization.
 *
 * ## Context Hierarchy
 *
 * The type system is designed for modular test contexts:
 *
 * - `BaseTestContext`: Always present (tempDir, codeDir, db, cleanup)
 * - Individual contexts: Add specific services (e.g., MetricsContext)
 * - `FullTestContext`: All services combined
 * - `TestContext`: Alias for FullTestContext (backward compatibility)
 *
 * Tests can request only what they need:
 * ```typescript
 * // Minimal context for metrics tests
 * const ctx = await TestSetupBuilder.create()
 *   .withMetrics()
 *   .build();
 * // ctx has: BaseTestContext & MetricsContext
 *
 * // Full context (backward compatible)
 * const ctx = await TestSetupBuilder.create().build();
 * // ctx has: FullTestContext
 * ```
 */

import type { Surreal, RecordId } from "surrealdb";
import type { SurrealConnectionFactory } from "../database/surreal_connection_factory.ts";
import type { VersionedEncryptionService } from "../encryption/versioned_encryption_service.ts";
import type { HashService } from "../encryption/hash_service.ts";
import type { EncryptionKeyFile } from "../encryption/key_storage_types.ts";
import type { SettingsService } from "../settings/settings_service.ts";
import type { ApiKeyService } from "../keys/api_key_service.ts";
import type { RoutesService } from "../routes/routes_service.ts";
import type { FileService } from "../files/file_service.ts";
import type { ConsoleLogService } from "../logs/console_log_service.ts";
import type { ExecutionMetricsService } from "../metrics/execution_metrics_service.ts";
import type { MetricsStateService } from "../metrics/metrics_state_service.ts";
import type { UserService } from "../users/user_service.ts";
import type { SecretsService } from "../secrets/secrets_service.ts";
import type { InstanceIdService } from "../instance/instance_id_service.ts";
import type { JobQueueService } from "../jobs/job_queue_service.ts";
import type { JobStatus, ExecutionMode } from "../jobs/types.ts";
import type { SchedulingService } from "../scheduling/scheduling_service.ts";
import type { CodeSourceService } from "../sources/code_source_service.ts";
import type { betterAuth } from "better-auth";
import type { SettingName } from "../settings/types.ts";

// =============================================================================
// Base Context (Always Present)
// =============================================================================

/**
 * Base test context that is always present.
 * Contains core infrastructure needed by all tests.
 *
 * SurrealDB is shared across all tests - each test gets a unique namespace
 * for isolation. The process is managed by SharedSurrealManager and stays
 * running for the duration of the test suite.
 */
export interface BaseTestContext {
  /** Temp directory for test isolation (contains keys, code) */
  tempDir: string;
  /** Directory for code files (${tempDir}/code) */
  codeDir: string;
  /** Raw Surreal SDK connection (connected to isolated namespace) */
  surrealDb: Surreal;
  /** SurrealDB connection factory for this test's namespace */
  surrealFactory: SurrealConnectionFactory;
  /** SurrealDB namespace for this test (unique per test for isolation) */
  surrealNamespace: string;
  /** SurrealDB database name (same as namespace) */
  surrealDatabase: string;
  /**
   * Cleanup function to tear down all resources.
   * Call this in a finally block after tests complete.
   * Removes the SurrealDB namespace (shared process stays running).
   */
  cleanup: () => Promise<void>;
}

// =============================================================================
// Individual Service Contexts
// =============================================================================

/**
 * Context with encryption services.
 * Includes encryption keys, versioned encryption, and hash service.
 */
export interface EncryptionContext {
  /** Loaded encryption keys */
  encryptionKeys: EncryptionKeyFile;
  /** Versioned encryption service instance */
  encryptionService: VersionedEncryptionService;
  /** Hash service for API key lookups */
  hashService: HashService;
}

/**
 * Context with settings service.
 * Requires encryption services.
 */
export interface SettingsContext extends EncryptionContext {
  /** Settings service instance */
  settingsService: SettingsService;
}

/**
 * Context with console log service.
 * Requires settings service (which requires encryption).
 */
export interface LogsContext extends SettingsContext {
  /** Console log service instance */
  consoleLogService: ConsoleLogService;
}

/**
 * Context with execution metrics services.
 * No dependencies beyond base context.
 */
export interface MetricsContext {
  /** Execution metrics service instance */
  executionMetricsService: ExecutionMetricsService;
  /** Metrics state service instance */
  metricsStateService: MetricsStateService;
}

/**
 * Context with routes service.
 * No dependencies beyond base context.
 */
export interface RoutesContext {
  /** Routes service instance */
  routesService: RoutesService;
}

/**
 * Context with file service.
 * No dependencies beyond base context.
 */
export interface FilesContext {
  /** File service instance */
  fileService: FileService;
}

/**
 * Context with API key service.
 * Requires encryption services.
 */
export interface ApiKeysContext extends EncryptionContext {
  /** API key service instance */
  apiKeyService: ApiKeyService;
}

/**
 * Context with secrets service.
 * Requires encryption services.
 */
export interface SecretsContext extends EncryptionContext {
  /** Secrets service instance */
  secretsService: SecretsService;
}

/**
 * Context with Better Auth instance.
 * Requires encryption (for better_auth_secret).
 */
export interface AuthContext extends EncryptionContext {
  /** Better Auth instance */
  auth: ReturnType<typeof betterAuth>;
}

/**
 * Context with user service.
 * Requires auth context.
 */
export interface UsersContext extends AuthContext {
  /** User service instance */
  userService: UserService;
}

/**
 * Context with instance ID service.
 * No dependencies beyond base context.
 */
export interface InstanceIdContext {
  /** Instance ID service instance */
  instanceIdService: InstanceIdService;
}

/**
 * Context with job queue service.
 * Requires instance ID service.
 */
export interface JobQueueContext extends InstanceIdContext {
  /** Job queue service instance */
  jobQueueService: JobQueueService;
}

/**
 * Context with scheduling service.
 * Requires job queue service (which requires instance ID service).
 */
export interface SchedulingContext extends JobQueueContext {
  /** Scheduling service instance */
  schedulingService: SchedulingService;
}

/**
 * Context with code source service.
 * Requires scheduling service (which requires job queue and instance ID).
 */
export interface CodeSourcesContext extends SchedulingContext, EncryptionContext {
  /** Code source service instance */
  codeSourceService: CodeSourceService;
}


// =============================================================================
// Full Context (All Services)
// =============================================================================

/**
 * Complete test context with all services.
 * This is the intersection of all individual contexts.
 * SurrealDB is included in BaseTestContext and always available.
 */
export type FullTestContext = BaseTestContext &
  EncryptionContext &
  SettingsContext &
  LogsContext &
  MetricsContext &
  RoutesContext &
  FilesContext &
  ApiKeysContext &
  SecretsContext &
  UsersContext &
  JobQueueContext &
  SchedulingContext &
  CodeSourcesContext;

/**
 * Alias for FullTestContext (backward compatibility).
 * Use FullTestContext for new code.
 *
 * @deprecated Use FullTestContext instead for clarity
 */
export type TestContext = FullTestContext;

/**
 * Options for route configuration in withRoute().
 */
export interface RouteOptions {
  /** Route display name (defaults to filename without extension) */
  name?: string;
  /** Route description */
  description?: string;
  /** Allowed HTTP methods (defaults to ["GET"]) */
  methods?: string[];
  /**
   * API key groups required to access this route.
   * Specified as group names (strings) - resolved to IDs at build time.
   * Group must be created with withApiKeyGroup before the route.
   */
  keys?: string[];
}

/**
 * Data for creating a user via withAdminUser().
 */
export interface DeferredUser {
  email: string;
  password: string;
  roles?: string[];
}

/**
 * Data for creating an API key group via withApiKeyGroup().
 */
export interface DeferredKeyGroup {
  name: string;
  description?: string;
}

/**
 * Data for creating an API key via withApiKey().
 */
export interface DeferredApiKey {
  groupName: string;
  keyValue: string;
  keyName?: string;
  description?: string;
}

/**
 * Data for creating a route via withRoute().
 */
export interface DeferredRoute {
  path: string;
  fileName: string;
  options?: RouteOptions;
}

/**
 * Data for creating a code file via withFile().
 */
export interface DeferredFile {
  name: string;
  content: string;
}

/**
 * Data for setting a global setting via withSetting().
 */
export interface DeferredSetting {
  name: SettingName;
  value: string;
}

/**
 * Data for seeding a console log via withConsoleLog().
 * Matches NewConsoleLog type (timestamp is auto-generated).
 */
export interface DeferredConsoleLog {
  requestId: string;
  functionId: string;  // SurrealDB RecordId string of functionDef
  level: "log" | "debug" | "info" | "warn" | "error" | "trace" | "stdout" | "stderr" | "exec_start" | "exec_end" | "exec_reject";
  message: string;
  args?: string; // JSON-serialized additional arguments
}

/**
 * Data for seeding an execution metric via withMetric().
 * Matches NewExecutionMetric type (aggregated metrics, not per-request).
 */
export interface DeferredMetric {
  /** Function ID (RecordId), or null for global metrics */
  functionId: RecordId | null;
  /** Metric type: execution, minute, hour, or day */
  type: "execution" | "minute" | "hour" | "day";
  /** Average execution time in milliseconds */
  avgTimeMs: number;
  /** Maximum execution time in milliseconds */
  maxTimeMs: number;
  /** Number of executions */
  executionCount: number;
  /** Optional timestamp (auto-generated if not provided) */
  timestamp?: Date;
}

/**
 * Data for seeding a job via withJob().
 */
export interface DeferredJob {
  /** Job type identifier */
  type: string;
  /** Job payload data */
  payload?: unknown;
  /** Job status (defaults to 'pending') */
  status?: JobStatus;
  /** Processing priority (defaults to 0) */
  priority?: number;
  /** Reference type for entity association */
  referenceType?: string;
  /** Reference ID for entity association */
  referenceId?: number;
  /** Execution mode (defaults to 'sequential') */
  executionMode?: ExecutionMode;
}
