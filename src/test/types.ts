/**
 * Types for the test setup builder.
 *
 * The TestSetupBuilder provides a fluent API for creating isolated test
 * environments with real migrations and production-like initialization.
 */

import type { DatabaseService } from "../database/database_service.ts";
import type { VersionedEncryptionService } from "../encryption/versioned_encryption_service.ts";
import type { HashService } from "../encryption/hash_service.ts";
import type { EncryptionKeyFile } from "../encryption/key_storage_types.ts";
import type { SettingsService } from "../settings/settings_service.ts";
import type { ApiKeyService } from "../keys/api_key_service.ts";
import type { RoutesService } from "../routes/routes_service.ts";
import type { FileService } from "../files/file_service.ts";
import type { ConsoleLogService } from "../logs/console_log_service.ts";
import type { ExecutionMetricsService } from "../metrics/execution_metrics_service.ts";
import type { UserService } from "../users/user_service.ts";
import type { betterAuth } from "better-auth";
import type { SettingName } from "../settings/types.ts";

/**
 * Complete test context returned from TestSetupBuilder.build().
 * Contains all initialized services and cleanup function.
 */
export interface TestContext {
  // Directories
  /** Temp directory for test isolation (contains db, keys, code) */
  tempDir: string;
  /** Directory for code files (${tempDir}/code) */
  codeDir: string;

  // Database
  /** Database service instance */
  db: DatabaseService;

  // Encryption
  /** Loaded encryption keys */
  encryptionKeys: EncryptionKeyFile;
  /** Versioned encryption service instance */
  encryptionService: VersionedEncryptionService;
  /** Hash service for API key lookups */
  hashService: HashService;

  // Core services
  /** Settings service instance */
  settingsService: SettingsService;
  /** API key service instance */
  apiKeyService: ApiKeyService;
  /** Routes service instance */
  routesService: RoutesService;
  /** File service instance */
  fileService: FileService;
  /** Console log service instance */
  consoleLogService: ConsoleLogService;
  /** Execution metrics service instance */
  executionMetricsService: ExecutionMetricsService;

  // Auth
  /** Better Auth instance */
  auth: ReturnType<typeof betterAuth>;
  /** User service instance */
  userService: UserService;

  /**
   * Cleanup function to tear down all resources.
   * Call this in a finally block after tests complete.
   */
  cleanup: () => Promise<void>;
}

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
  /** API key group names required to access this route */
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
  routeId: number;
  level: "log" | "debug" | "info" | "warn" | "error" | "trace" | "stdout" | "stderr" | "exec_start" | "exec_end" | "exec_reject";
  message: string;
  args?: string; // JSON-serialized additional arguments
}

/**
 * Data for seeding an execution metric via withMetric().
 * Matches NewExecutionMetric type (aggregated metrics, not per-request).
 */
export interface DeferredMetric {
  /** Route ID, or null for global metrics */
  routeId: number | null;
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
