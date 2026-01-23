import type { DatabaseService } from "../database/database_service.ts";
import type { IEncryptionService } from "../encryption/types.ts";
import type { JobQueueService } from "../jobs/job_queue_service.ts";
import type { SchedulingService } from "../scheduling/scheduling_service.ts";
import type { CancellationToken } from "../jobs/types.ts";

// ============================================================================
// Source Types
// ============================================================================

/**
 * Supported code source types.
 * Add new types here when implementing new providers.
 */
export type CodeSourceType = "manual" | "git";

export function isCodeSourceType(value: string): value is CodeSourceType {
  return value === "manual" || value === "git";
}

// ============================================================================
// Type Settings (encrypted JSON - varies by source type)
// ============================================================================

/**
 * Base type for type settings. All type settings extend this.
 * Empty object - individual types add their fields.
 */
// deno-lint-ignore no-empty-interface
export interface BaseTypeSettings {}

/**
 * Manual source settings. Currently empty, reserved for future use.
 * Could include: file validation rules, allowed extensions, etc.
 */
export interface ManualTypeSettings extends BaseTypeSettings {
  // Empty - reserved for future expansion
}

/**
 * Git source settings.
 * Exactly one of branch/tag/commit should be set (branch is default).
 */
export interface GitTypeSettings extends BaseTypeSettings {
  /** HTTPS git URL (e.g., https://github.com/user/repo.git) */
  url: string;
  /** Branch name. Default: "main". Mutually exclusive with tag/commit. */
  branch?: string;
  /** Tag name. Mutually exclusive with branch/commit. */
  tag?: string;
  /** Specific commit SHA. Mutually exclusive with branch/tag. */
  commit?: string;
  /** HTTPS auth token for private repos. */
  authToken?: string;
}

/** Union of all type settings */
export type TypeSettings = ManualTypeSettings | GitTypeSettings;

// ============================================================================
// Sync Settings (encrypted JSON - common across syncable types)
// ============================================================================

/**
 * Sync configuration. Applies to all source types that support syncing.
 * For manual sources, intervalSeconds is ignored (nothing to sync from).
 */
export interface SyncSettings {
  /** Interval in seconds for auto-sync. 0 or undefined = disabled. */
  intervalSeconds?: number;
  /** Whether webhook endpoint is enabled. Default: false (disabled). */
  webhookEnabled?: boolean;
  /** Per-source secret for webhook authentication. Optional - if not set, accepts any request when enabled. */
  webhookSecret?: string;
}

// ============================================================================
// Database Row Type
// ============================================================================

/**
 * Raw database row from codeSources table.
 */
export interface CodeSourceRow {
  [key: string]: unknown; // Index signature for Row compatibility
  id: number;
  name: string;
  type: string;
  typeSettings: string | null; // Encrypted JSON
  syncSettings: string | null; // Encrypted JSON
  lastSyncStartedAt: string | null;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  enabled: number; // SQLite integer: 1 = enabled, 0 = disabled
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Domain Entity
// ============================================================================

/**
 * Code source entity with decoded/decrypted fields.
 */
export interface CodeSource {
  id: number;
  name: string;
  type: CodeSourceType;
  typeSettings: TypeSettings;
  syncSettings: SyncSettings;
  lastSyncStartedAt: Date | null;
  lastSyncAt: Date | null;
  lastSyncError: string | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// Input Types
// ============================================================================

/**
 * Input for creating a new code source.
 */
export interface NewCodeSource {
  /** Directory name (alphanumeric, hyphens, underscores, 1-64 chars, starts with alphanumeric) */
  name: string;
  /** Source type */
  type: CodeSourceType;
  /** Type-specific settings */
  typeSettings?: TypeSettings;
  /** Sync configuration */
  syncSettings?: SyncSettings;
  /** Whether source is enabled (default: true) */
  enabled?: boolean;
}

/**
 * Input for updating a code source.
 * All fields optional - only provided fields are updated.
 * Note: name and type cannot be changed after creation.
 */
export interface UpdateCodeSource {
  /** Type-specific settings (replaces entire object) */
  typeSettings?: TypeSettings;
  /** Sync configuration (replaces entire object) */
  syncSettings?: SyncSettings;
  /** Enable/disable the source */
  enabled?: boolean;
}

// ============================================================================
// Sync Types
// ============================================================================

/**
 * Result from a sync operation.
 */
export interface SyncResult {
  /** Whether sync completed successfully */
  success: boolean;
  /** Number of files added/updated/deleted */
  filesChanged?: number;
  /** Error message if success=false */
  error?: string;
  /** Duration in milliseconds */
  durationMs: number;
}

/**
 * Payload for source_sync jobs.
 */
export interface SyncJobPayload {
  /** Source ID to sync */
  sourceId: number;
  /** What triggered this sync */
  triggeredBy?: "manual" | "interval" | "webhook";
}

// ============================================================================
// File Types (for provider operations)
// ============================================================================

/**
 * File metadata returned by list operations.
 */
export interface SourceFileMetadata {
  /** Relative path within source (e.g., "utils/helper.ts") */
  path: string;
  /** File size in bytes */
  size: number;
  /** Last modification time */
  mtime: Date;
}

// ============================================================================
// Provider Interface
// ============================================================================

/**
 * Capabilities that a provider may support.
 */
export interface ProviderCapabilities {
  /**
   * Whether this source type supports syncing from a remote.
   * - true for git, s3, ftp (can sync from external source)
   * - false for manual (local filesystem is the source of truth)
   */
  isSyncable: boolean;

  /**
   * Whether files in this source type can be edited via API.
   * - true for manual (user can upload/modify files)
   * - false for git, s3 (files come from external source)
   *
   * Note: This is informational - actual file operations are handled
   * by a separate file management API, not the provider.
   */
  isEditable: boolean;
}

/**
 * Minimal interface that all code source providers must implement.
 *
 * Providers are responsible for:
 * - Syncing data from external sources (git clone/pull, s3 download, etc.)
 * - Managing source directories on the filesystem
 * - Reporting their capabilities
 *
 * Providers do NOT handle:
 * - File read/write operations (handled by separate file management API)
 * - Schedule management (handled by CodeSourceService)
 * - Job orchestration (handled by CodeSourceService)
 */
export interface CodeSourceProvider {
  /**
   * The source type this provider handles (e.g., "git", "manual", "s3").
   */
  readonly type: CodeSourceType;

  /**
   * Get provider capabilities.
   */
  getCapabilities(): ProviderCapabilities;

  // ==================== Sync Operations ====================

  /**
   * Sync files from the remote source to the local directory.
   *
   * Behavior depends on source type:
   * - git: Clone (if new) or fetch+checkout (if exists)
   * - s3: Download changed files
   * - manual: No-op (returns success immediately - nothing to sync from)
   *
   * On failure: Should leave existing files intact (graceful degradation).
   *
   * @param source - The source to sync (includes typeSettings with credentials)
   * @param token - Cancellation token for long-running operations
   * @returns Sync result with success/failure status and file count
   */
  sync(source: CodeSource, token: CancellationToken): Promise<SyncResult>;

  // ==================== Directory Operations ====================

  /**
   * Ensure the source directory exists on the filesystem.
   * Called by CodeSourceService when creating a new source.
   *
   * @param sourceName - Directory name under code/
   */
  ensureDirectory(sourceName: string): Promise<void>;

  /**
   * Delete the source directory and all its contents.
   * Called by CodeSourceService when deleting a source.
   *
   * @param sourceName - Directory name under code/
   */
  deleteDirectory(sourceName: string): Promise<void>;

  /**
   * Check if the source directory exists.
   *
   * @param sourceName - Directory name under code/
   * @returns true if directory exists
   */
  directoryExists(sourceName: string): Promise<boolean>;
}

// ============================================================================
// Service Options
// ============================================================================

export interface CodeSourceServiceOptions {
  db: DatabaseService;
  encryptionService: IEncryptionService;
  jobQueueService: JobQueueService;
  schedulingService: SchedulingService;
  codeDirectory: string;
}
