import { Mutex } from "@core/asyncutil/mutex";
import { join } from "@std/path";
import type { DatabaseService } from "../database/database_service.ts";
import type { IEncryptionService } from "../encryption/types.ts";
import type { JobQueueService } from "../jobs/job_queue_service.ts";
import type { SchedulingService } from "../scheduling/scheduling_service.ts";
import type { CancellationToken, Job } from "../jobs/types.ts";
import type {
  CodeSource,
  CodeSourceRow,
  CodeSourceType,
  NewCodeSource,
  UpdateCodeSource,
  TypeSettings,
  SyncSettings,
  SyncResult,
  CodeSourceProvider,
  CodeSourceServiceOptions,
  SyncJobPayload,
} from "./types.ts";
import { isCodeSourceType } from "./types.ts";
import {
  SourceNotFoundError,
  DuplicateSourceError,
  InvalidSourceConfigError,
  ProviderNotFoundError,
  SourceNotSyncableError,
  WebhookAuthError,
} from "./errors.ts";
import { logger } from "../utils/logger.ts";

/** Regex for validating source names: alphanumeric (a-z, A-Z, 0-9), hyphens, underscores, 1-64 chars */
const SOURCE_NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

/**
 * Constant-time string comparison to prevent timing attacks.
 * Returns true if strings are equal, false otherwise.
 */
function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Service for managing code sources.
 *
 * Responsibilities:
 * - CRUD operations for code sources (database)
 * - Encrypted storage of typeSettings and syncSettings
 * - Provider registration and delegation
 * - Schedule management for sync operations
 * - Validation of source configuration
 *
 * This service owns all database access to the codeSources table.
 * File and sync operations are delegated to registered providers.
 */
export class CodeSourceService {
  private readonly db: DatabaseService;
  private readonly encryptionService: IEncryptionService;
  private readonly jobQueueService: JobQueueService;
  private readonly schedulingService: SchedulingService;
  private readonly codeDirectory: string;
  private readonly writeMutex = new Mutex();

  // Provider registry: type -> provider instance
  private readonly providers = new Map<CodeSourceType, CodeSourceProvider>();

  constructor(options: CodeSourceServiceOptions) {
    this.db = options.db;
    this.encryptionService = options.encryptionService;
    this.jobQueueService = options.jobQueueService;
    this.schedulingService = options.schedulingService;
    this.codeDirectory = options.codeDirectory;
  }

  // ============== Provider Registration ==============

  /**
   * Register a provider for a source type.
   * Called during application initialization.
   */
  registerProvider(provider: CodeSourceProvider): void {
    if (this.providers.has(provider.type)) {
      logger.warn(
        `[CodeSource] Overwriting existing provider for type '${provider.type}'`,
      );
    }
    this.providers.set(provider.type, provider);
    logger.info(`[CodeSource] Registered provider for type '${provider.type}'`);
  }

  /**
   * Get provider for a source type.
   * @throws {ProviderNotFoundError} If no provider registered for type
   */
  getProvider(type: CodeSourceType): CodeSourceProvider {
    const provider = this.providers.get(type);
    if (!provider) {
      throw new ProviderNotFoundError(type);
    }
    return provider;
  }

  /**
   * Check if provider is registered for type.
   */
  hasProvider(type: CodeSourceType): boolean {
    return this.providers.has(type);
  }

  // ============== Query Operations ==============

  /**
   * Get all code sources.
   */
  async getAll(): Promise<CodeSource[]> {
    const rows = await this.db.queryAll<CodeSourceRow>(
      `SELECT * FROM codeSources ORDER BY name ASC`,
    );
    return Promise.all(rows.map((row) => this.rowToSource(row)));
  }

  /**
   * Get all enabled code sources.
   */
  async getAllEnabled(): Promise<CodeSource[]> {
    const rows = await this.db.queryAll<CodeSourceRow>(
      `SELECT * FROM codeSources WHERE enabled = 1 ORDER BY name ASC`,
    );
    return Promise.all(rows.map((row) => this.rowToSource(row)));
  }

  /**
   * Get a code source by ID.
   */
  async getById(id: number): Promise<CodeSource | null> {
    const row = await this.db.queryOne<CodeSourceRow>(
      `SELECT * FROM codeSources WHERE id = ?`,
      [id],
    );
    return row ? this.rowToSource(row) : null;
  }

  /**
   * Get a code source by name.
   */
  async getByName(name: string): Promise<CodeSource | null> {
    const row = await this.db.queryOne<CodeSourceRow>(
      `SELECT * FROM codeSources WHERE name = ?`,
      [name],
    );
    return row ? this.rowToSource(row) : null;
  }

  /**
   * Check if a source exists.
   */
  async exists(id: number): Promise<boolean> {
    const row = await this.db.queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM codeSources WHERE id = ?`,
      [id],
    );
    return (row?.count ?? 0) > 0;
  }

  /**
   * Check if a source name is taken.
   */
  async nameExists(name: string): Promise<boolean> {
    const row = await this.db.queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM codeSources WHERE name = ?`,
      [name],
    );
    return (row?.count ?? 0) > 0;
  }

  // ============== Mutation Operations ==============

  /**
   * Create a new code source.
   * Creates the source directory via the provider.
   * For syncable sources with intervalSeconds > 0, creates a schedule.
   *
   * @throws {DuplicateSourceError} If name already exists
   * @throws {InvalidSourceConfigError} If configuration is invalid
   * @throws {ProviderNotFoundError} If no provider for type
   */
  async create(input: NewCodeSource): Promise<CodeSource> {
    using _lock = await this.writeMutex.acquire();

    // Validate input
    this.validateNewSource(input);

    // Check for duplicate name
    if (await this.nameExists(input.name)) {
      throw new DuplicateSourceError(input.name);
    }

    // Get provider (validates type is supported)
    const provider = this.getProvider(input.type);

    // Encrypt settings
    const typeSettingsStr = await this.encryptSettings(input.typeSettings ?? {});
    const syncSettingsStr = await this.encryptSettings(input.syncSettings ?? {});

    // Insert into database
    const result = await this.db.execute(
      `INSERT INTO codeSources (name, type, typeSettings, syncSettings, enabled, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        input.name,
        input.type,
        typeSettingsStr,
        syncSettingsStr,
        (input.enabled ?? true) ? 1 : 0,
      ],
    );

    const sourceId = Number(result.lastInsertRowId);

    // Create directory via provider
    await provider.ensureDirectory(input.name);

    // Get the created source
    const source = await this.getById(sourceId);
    if (!source) {
      throw new Error("Failed to retrieve created source");
    }

    // Create schedule if needed (syncable source with interval)
    await this.ensureSchedule(source);

    logger.info(
      `[CodeSource] Created source '${input.name}' (type: ${input.type}, id: ${sourceId})`,
    );

    return source;
  }

  /**
   * Update a code source.
   * Note: name and type cannot be changed.
   *
   * @throws {SourceNotFoundError} If source doesn't exist
   * @throws {InvalidSourceConfigError} If configuration is invalid
   */
  async update(id: number, updates: UpdateCodeSource): Promise<CodeSource> {
    using _lock = await this.writeMutex.acquire();

    // Get existing source
    const existing = await this.getById(id);
    if (!existing) {
      throw new SourceNotFoundError(id);
    }

    // Validate updates
    if (updates.typeSettings !== undefined) {
      this.validateTypeSettings(existing.type, updates.typeSettings);
    }
    if (updates.syncSettings !== undefined) {
      this.validateSyncSettings(updates.syncSettings);
    }

    // Build update fields
    const fields: string[] = [];
    const values: (string | number)[] = [];

    if (updates.typeSettings !== undefined) {
      const encrypted = await this.encryptSettings(updates.typeSettings);
      fields.push("typeSettings = ?");
      values.push(encrypted);
    }

    if (updates.syncSettings !== undefined) {
      const encrypted = await this.encryptSettings(updates.syncSettings);
      fields.push("syncSettings = ?");
      values.push(encrypted);
    }

    if (updates.enabled !== undefined) {
      fields.push("enabled = ?");
      values.push(updates.enabled ? 1 : 0);
    }

    if (fields.length === 0) {
      return existing; // Nothing to update
    }

    // Add updatedAt
    fields.push("updatedAt = CURRENT_TIMESTAMP");
    values.push(id);

    await this.db.execute(
      `UPDATE codeSources SET ${fields.join(", ")} WHERE id = ?`,
      values,
    );

    // Get updated source
    const updated = await this.getById(id);
    if (!updated) {
      throw new Error("Failed to retrieve updated source");
    }

    // Update schedule based on new settings
    await this.ensureSchedule(updated);

    // Handle enabled/disabled state for schedule
    if (updates.enabled !== undefined) {
      if (updates.enabled && !existing.enabled) {
        // Re-enabled - resume schedule
        await this.resumeSchedule(id);
      } else if (!updates.enabled && existing.enabled) {
        // Disabled - pause schedule
        await this.pauseSchedule(id);
      }
    }

    logger.info(`[CodeSource] Updated source '${existing.name}' (id: ${id})`);
    return updated;
  }

  /**
   * Delete a code source.
   * Deletes the source directory via the provider.
   *
   * @param id - Source ID
   * @param deleteDirectory - Whether to delete directory (default: true)
   * @throws {SourceNotFoundError} If source doesn't exist
   */
  async delete(id: number, deleteDirectory = true): Promise<void> {
    using _lock = await this.writeMutex.acquire();

    const source = await this.getById(id);
    if (!source) {
      throw new SourceNotFoundError(id);
    }

    // Delete schedule first
    await this.deleteSchedule(id);

    // Delete directory if requested and provider exists
    if (deleteDirectory && this.hasProvider(source.type)) {
      const provider = this.getProvider(source.type);
      try {
        await provider.deleteDirectory(source.name);
      } catch (error) {
        logger.warn(
          `[CodeSource] Failed to delete directory for source '${source.name}': ${error}`,
        );
      }
    }

    // Delete from database
    await this.db.execute(`DELETE FROM codeSources WHERE id = ?`, [id]);

    logger.info(`[CodeSource] Deleted source '${source.name}' (id: ${id})`);
  }

  /**
   * Enable or disable a source.
   */
  setEnabled(id: number, enabled: boolean): Promise<CodeSource> {
    return this.update(id, { enabled });
  }

  // ============== Sync Status Operations ==============

  /**
   * Mark sync as started. Sets lastSyncStartedAt, clears lastSyncError.
   */
  async markSyncStarted(id: number): Promise<void> {
    await this.db.execute(
      `UPDATE codeSources
       SET lastSyncStartedAt = CURRENT_TIMESTAMP,
           lastSyncError = NULL,
           updatedAt = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [id],
    );
  }

  /**
   * Mark sync as completed. Sets lastSyncAt, clears error and startedAt.
   */
  async markSyncCompleted(id: number): Promise<void> {
    await this.db.execute(
      `UPDATE codeSources
       SET lastSyncAt = CURRENT_TIMESTAMP,
           lastSyncStartedAt = NULL,
           lastSyncError = NULL,
           updatedAt = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [id],
    );
  }

  /**
   * Mark sync as failed. Sets lastSyncError, clears startedAt.
   */
  async markSyncFailed(id: number, error: string): Promise<void> {
    await this.db.execute(
      `UPDATE codeSources
       SET lastSyncError = ?,
           lastSyncStartedAt = NULL,
           updatedAt = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [error, id],
    );
  }

  // ============== Schedule Management ==============

  /**
   * Get the schedule name for a source.
   */
  private getScheduleName(sourceId: number): string {
    return `source_sync_${sourceId}`;
  }

  /**
   * Ensure sync schedule exists and is configured correctly for a source.
   * Creates, updates, or deletes schedule based on source.syncSettings.intervalSeconds.
   * Called internally after create() and update().
   *
   * @param source - The source to manage schedule for
   */
  private async ensureSchedule(source: CodeSource): Promise<void> {
    // Only syncable sources need schedules
    if (!this.hasProvider(source.type)) {
      return;
    }

    const provider = this.getProvider(source.type);
    const capabilities = provider.getCapabilities();

    if (!capabilities.isSyncable) {
      return; // Manual sources don't need schedules
    }

    const scheduleName = this.getScheduleName(source.id);
    const intervalSeconds = source.syncSettings.intervalSeconds ?? 0;

    // Check if schedule exists
    const existingSchedule = await this.schedulingService.getSchedule(
      scheduleName,
    );

    if (intervalSeconds <= 0) {
      // No interval - delete schedule if exists
      if (existingSchedule) {
        await this.schedulingService.deleteSchedule(scheduleName);
        logger.info(
          `[CodeSource] Deleted schedule for source '${source.name}' (interval disabled)`,
        );
      }
      return;
    }

    const intervalMs = intervalSeconds * 1000;

    if (existingSchedule) {
      // Update existing schedule if interval changed
      if (existingSchedule.intervalMs !== intervalMs) {
        await this.schedulingService.updateSchedule(scheduleName, {
          intervalMs,
        });
        logger.info(
          `[CodeSource] Updated schedule for source '${source.name}' (interval: ${intervalSeconds}s)`,
        );
      }
    } else {
      // Create new schedule
      await this.schedulingService.registerSchedule({
        name: scheduleName,
        description: `Sync schedule for code source '${source.name}'`,
        type: "sequential_interval",
        isPersistent: true,
        intervalMs,
        jobType: "source_sync",
        jobPayload: {
          sourceId: source.id,
          triggeredBy: "interval",
        } as SyncJobPayload,
        jobReferenceType: "code_source",
        jobReferenceId: source.id,
        jobExecutionMode: "sequential",
      });
      logger.info(
        `[CodeSource] Created schedule for source '${source.name}' (interval: ${intervalSeconds}s)`,
      );
    }
  }

  /**
   * Delete the sync schedule for a source.
   * Called internally during delete().
   *
   * @param sourceId - Source ID
   */
  private async deleteSchedule(sourceId: number): Promise<void> {
    const scheduleName = this.getScheduleName(sourceId);
    try {
      const schedule = await this.schedulingService.getSchedule(scheduleName);
      if (schedule) {
        await this.schedulingService.deleteSchedule(scheduleName, {
          cancelRunningJob: true,
          reason: "Source deleted",
        });
      }
    } catch (error) {
      // Log but don't fail - schedule cleanup is best-effort
      logger.debug(
        `[CodeSource] Schedule cleanup for source ${sourceId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Pause the sync schedule for a source.
   * Does nothing if source has no schedule or schedule is already paused.
   *
   * @param sourceId - Source ID
   * @throws {SourceNotFoundError} If source doesn't exist
   */
  async pauseSchedule(sourceId: number): Promise<void> {
    const source = await this.getById(sourceId);
    if (!source) {
      throw new SourceNotFoundError(sourceId);
    }

    const scheduleName = this.getScheduleName(sourceId);
    try {
      const schedule = await this.schedulingService.getSchedule(scheduleName);
      if (schedule && schedule.status === "active") {
        await this.schedulingService.pauseSchedule(scheduleName);
        logger.info(`[CodeSource] Paused schedule for source '${source.name}'`);
      }
    } catch (error) {
      // Log but don't fail - schedule operations are best-effort
      logger.debug(
        `[CodeSource] Schedule pause for source ${sourceId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Resume the sync schedule for a source.
   * Does nothing if source has no schedule or schedule is already active.
   *
   * @param sourceId - Source ID
   * @throws {SourceNotFoundError} If source doesn't exist
   */
  async resumeSchedule(sourceId: number): Promise<void> {
    const source = await this.getById(sourceId);
    if (!source) {
      throw new SourceNotFoundError(sourceId);
    }

    const scheduleName = this.getScheduleName(sourceId);
    try {
      const schedule = await this.schedulingService.getSchedule(scheduleName);
      if (schedule && schedule.status === "paused") {
        await this.schedulingService.resumeSchedule(scheduleName);
        logger.info(`[CodeSource] Resumed schedule for source '${source.name}'`);
      }
    } catch (error) {
      // Log but don't fail - schedule operations are best-effort
      logger.debug(
        `[CodeSource] Schedule resume for source ${sourceId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Trigger a manual sync for a source (bypasses schedule).
   * Enqueues a sync job with higher priority.
   *
   * @param id - Source ID
   * @returns The created job, or null if sync already in progress
   * @throws {SourceNotFoundError} If source doesn't exist
   * @throws {SourceNotSyncableError} If source type doesn't support sync
   */
  async triggerManualSync(id: number): Promise<Job | null> {
    const source = await this.getById(id);
    if (!source) {
      throw new SourceNotFoundError(id);
    }

    // Check if syncable
    if (!this.hasProvider(source.type)) {
      throw new ProviderNotFoundError(source.type);
    }

    const provider = this.getProvider(source.type);
    const capabilities = provider.getCapabilities();

    if (!capabilities.isSyncable) {
      throw new SourceNotSyncableError(source.name);
    }

    // Check if sync already in progress
    if (source.lastSyncStartedAt) {
      logger.info(
        `[CodeSource] Sync already in progress for source '${source.name}'`,
      );
      return null;
    }

    // Enqueue sync job with higher priority
    const job = await this.jobQueueService.enqueue({
      type: "source_sync",
      payload: {
        sourceId: id,
        triggeredBy: "manual",
      } as SyncJobPayload,
      priority: 10, // Higher priority than scheduled syncs
      referenceType: "code_source",
      referenceId: id,
      executionMode: "sequential",
    });

    logger.info(
      `[CodeSource] Triggered manual sync for source '${source.name}' (job: ${job.id})`,
    );

    return job;
  }

  /**
   * Trigger a webhook sync for a source.
   * Validates webhook secret before enqueuing.
   *
   * @param id - Source ID
   * @param providedSecret - Secret from webhook request
   * @returns The created job, or null if sync already in progress
   * @throws {SourceNotFoundError} If source doesn't exist
   * @throws {WebhookAuthError} If secret doesn't match
   * @throws {SourceNotSyncableError} If source type doesn't support sync
   */
  async triggerWebhookSync(
    id: number,
    providedSecret: string,
  ): Promise<Job | null> {
    const source = await this.getById(id);
    if (!source) {
      throw new SourceNotFoundError(id);
    }

    // Validate webhook secret using constant-time comparison to prevent timing attacks
    const expectedSecret = source.syncSettings.webhookSecret;
    if (!expectedSecret || !constantTimeCompare(expectedSecret, providedSecret)) {
      throw new WebhookAuthError(source.name);
    }

    // Check if source is enabled
    if (!source.enabled) {
      logger.info(
        `[CodeSource] Webhook sync skipped for disabled source '${source.name}'`,
      );
      return null;
    }

    // Check if syncable
    if (!this.hasProvider(source.type)) {
      throw new ProviderNotFoundError(source.type);
    }

    const provider = this.getProvider(source.type);
    const capabilities = provider.getCapabilities();

    if (!capabilities.isSyncable) {
      throw new SourceNotSyncableError(source.name);
    }

    // Check if sync already in progress
    if (source.lastSyncStartedAt) {
      logger.info(
        `[CodeSource] Sync already in progress for source '${source.name}'`,
      );
      return null;
    }

    // Enqueue sync job with medium priority (between manual and scheduled)
    const job = await this.jobQueueService.enqueue({
      type: "source_sync",
      payload: {
        sourceId: id,
        triggeredBy: "webhook",
      } as SyncJobPayload,
      priority: 5,
      referenceType: "code_source",
      referenceId: id,
      executionMode: "sequential",
    });

    logger.info(
      `[CodeSource] Triggered webhook sync for source '${source.name}' (job: ${job.id})`,
    );

    return job;
  }

  // ============== Sync Operations (delegates to provider) ==============

  /**
   * Execute sync for a source.
   * Called by job handler - delegates to provider.sync().
   *
   * Flow:
   * 1. Look up source and provider
   * 2. Mark sync started
   * 3. Call provider.sync()
   * 4. Mark sync completed/failed
   *
   * @throws {SourceNotFoundError} If source doesn't exist
   * @throws {SourceNotSyncableError} If source type doesn't support sync
   * @throws {ProviderNotFoundError} If no provider registered for type
   */
  async syncSource(id: number, token: CancellationToken): Promise<SyncResult> {
    const source = await this.getById(id);
    if (!source) {
      throw new SourceNotFoundError(id);
    }

    const provider = this.getProvider(source.type);
    const capabilities = provider.getCapabilities();

    if (!capabilities.isSyncable) {
      throw new SourceNotSyncableError(source.name);
    }

    // Mark sync started
    await this.markSyncStarted(id);

    const startTime = Date.now();
    let result: SyncResult;

    try {
      token.throwIfCancelled();
      result = await provider.sync(source, token);

      if (result.success) {
        await this.markSyncCompleted(id);
        logger.info(
          `[CodeSource] Sync completed for source '${source.name}' (${result.filesChanged ?? 0} files, ${result.durationMs}ms)`,
        );
      } else {
        await this.markSyncFailed(id, result.error ?? "Unknown error");
        logger.warn(
          `[CodeSource] Sync failed for source '${source.name}': ${result.error}`,
        );
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.markSyncFailed(id, errorMessage);

      result = {
        success: false,
        error: errorMessage,
        durationMs: Date.now() - startTime,
      };

      logger.error(
        `[CodeSource] Sync error for source '${source.name}': ${errorMessage}`,
      );
    }

    return result;
  }

  // ============== Capability Queries ==============

  /**
   * Check if a source is editable (supports file writes via API).
   * Uses provider.getCapabilities().isEditable.
   */
  async isEditable(id: number): Promise<boolean> {
    const source = await this.getById(id);
    if (!source) {
      return false;
    }

    if (!this.hasProvider(source.type)) {
      return false;
    }

    const provider = this.getProvider(source.type);
    return provider.getCapabilities().isEditable;
  }

  /**
   * Check if a source is syncable (has remote to sync from).
   * Uses provider.getCapabilities().isSyncable.
   */
  async isSyncable(id: number): Promise<boolean> {
    const source = await this.getById(id);
    if (!source) {
      return false;
    }

    if (!this.hasProvider(source.type)) {
      return false;
    }

    const provider = this.getProvider(source.type);
    return provider.getCapabilities().isSyncable;
  }

  // ============== Validation ==============

  /**
   * Check if a source name is valid.
   * Must be: alphanumeric (a-z, A-Z, 0-9), hyphens, underscores, 1-64 chars.
   * Must start with alphanumeric (not hyphen or underscore).
   */
  isValidSourceName(name: string): boolean {
    return SOURCE_NAME_REGEX.test(name);
  }

  /**
   * Validate new source input.
   */
  private validateNewSource(input: NewCodeSource): void {
    if (!input.name || !this.isValidSourceName(input.name)) {
      throw new InvalidSourceConfigError(
        "Source name must be 1-64 chars, alphanumeric with hyphens/underscores, starting with alphanumeric",
      );
    }

    if (!input.type || !isCodeSourceType(input.type)) {
      throw new InvalidSourceConfigError(
        `Invalid source type: ${input.type}. Must be 'manual' or 'git'`,
      );
    }

    if (input.typeSettings !== undefined) {
      this.validateTypeSettings(input.type, input.typeSettings);
    }

    if (input.syncSettings !== undefined) {
      this.validateSyncSettings(input.syncSettings);
    }
  }

  /**
   * Validate type settings for a source type.
   * @throws {InvalidSourceConfigError} If settings are invalid
   */
  validateTypeSettings(type: CodeSourceType, settings: unknown): void {
    if (settings === null || settings === undefined) {
      return; // Empty settings are valid
    }

    if (typeof settings !== "object") {
      throw new InvalidSourceConfigError("typeSettings must be an object");
    }

    switch (type) {
      case "git":
        this.validateGitSettings(settings);
        break;
      case "manual":
        // Manual settings currently empty - no validation needed
        break;
    }
  }

  /**
   * Validate git-specific type settings.
   * @throws {InvalidSourceConfigError} If settings are invalid
   */
  private validateGitSettings(settings: unknown): void {
    const s = settings as Record<string, unknown>;

    if (!s.url || typeof s.url !== "string") {
      throw new InvalidSourceConfigError(
        "Git source requires a valid URL in typeSettings",
      );
    }

    // Validate URL format (basic check)
    if (
      !s.url.startsWith("https://") &&
      !s.url.startsWith("git@")
    ) {
      throw new InvalidSourceConfigError(
        "Git URL must start with https:// or git@",
      );
    }

    // Check mutually exclusive ref settings
    const refCount = [s.branch, s.tag, s.commit].filter(Boolean).length;
    if (refCount > 1) {
      throw new InvalidSourceConfigError(
        "Git source: only one of branch, tag, or commit can be specified",
      );
    }
  }

  /**
   * Validate sync settings.
   * @throws {InvalidSourceConfigError} If settings are invalid
   */
  validateSyncSettings(settings: unknown): void {
    if (settings === null || settings === undefined) {
      return;
    }

    if (typeof settings !== "object") {
      throw new InvalidSourceConfigError("syncSettings must be an object");
    }

    const syncSettings = settings as SyncSettings;

    if (
      syncSettings.intervalSeconds !== undefined &&
      (typeof syncSettings.intervalSeconds !== "number" ||
        syncSettings.intervalSeconds < 0)
    ) {
      throw new InvalidSourceConfigError(
        "syncSettings.intervalSeconds must be a non-negative number",
      );
    }

    if (
      syncSettings.webhookSecret !== undefined &&
      typeof syncSettings.webhookSecret !== "string"
    ) {
      throw new InvalidSourceConfigError(
        "syncSettings.webhookSecret must be a string",
      );
    }
  }

  // ============== Internal Helpers ==============

  /**
   * Get the directory path for a source.
   */
  getSourceDirectory(sourceName: string): string {
    return join(this.codeDirectory, sourceName);
  }

  /**
   * Encrypt settings object to JSON string.
   */
  private encryptSettings(settings: unknown): Promise<string> {
    const json = JSON.stringify(settings);
    return this.encryptionService.encrypt(json);
  }

  /**
   * Decrypt settings JSON string to object.
   */
  private async decryptSettings<T>(encrypted: string | null): Promise<T> {
    if (!encrypted) {
      return {} as T;
    }
    const json = await this.encryptionService.decrypt(encrypted);
    return JSON.parse(json) as T;
  }

  /**
   * Convert database row to CodeSource entity.
   */
  private async rowToSource(row: CodeSourceRow): Promise<CodeSource> {
    // Validate type
    if (!isCodeSourceType(row.type)) {
      throw new Error(`Invalid source type in database: ${row.type}`);
    }

    // Decrypt settings
    const typeSettings = await this.decryptSettings<TypeSettings>(
      row.typeSettings,
    );
    const syncSettings = await this.decryptSettings<SyncSettings>(
      row.syncSettings,
    );

    return {
      id: row.id,
      name: row.name,
      type: row.type,
      typeSettings,
      syncSettings,
      lastSyncStartedAt: row.lastSyncStartedAt
        ? new Date(row.lastSyncStartedAt)
        : null,
      lastSyncAt: row.lastSyncAt ? new Date(row.lastSyncAt) : null,
      lastSyncError: row.lastSyncError,
      enabled: row.enabled === 1,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
    };
  }
}
