import { Mutex } from "@core/asyncutil/mutex";
import { join } from "@std/path";
import { RecordId } from "surrealdb";
import type { SurrealConnectionFactory } from "../database/surreal_connection_factory.ts";
import { toDate } from "../database/surreal_helpers.ts";
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
  WebhookDisabledError,
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
 * - Field-level encryption of sensitive settings (webhookSecret)
 * - Provider registration and delegation
 * - Schedule management for sync operations
 * - Validation of source configuration
 *
 * This service owns all database access to the codeSource table.
 * File and sync operations are delegated to registered providers.
 *
 * Note: typeSettings encryption is delegated to providers (e.g., GitCodeSourceProvider
 * encrypts authToken). This service only handles syncSettings.webhookSecret encryption.
 */
export class CodeSourceService {
  private readonly surrealFactory: SurrealConnectionFactory;
  private readonly encryptionService: IEncryptionService;
  private readonly jobQueueService: JobQueueService;
  private readonly schedulingService: SchedulingService;
  private readonly codeDirectory: string;
  private readonly writeMutex = new Mutex();

  // Provider registry: type -> provider instance
  private readonly providers = new Map<CodeSourceType, CodeSourceProvider>();

  constructor(options: CodeSourceServiceOptions) {
    this.surrealFactory = options.surrealFactory;
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
    const rows = await this.surrealFactory.withSystemConnection({}, async (db) => {
      const [result] = await db.query<[CodeSourceRow[]]>(
        `SELECT * FROM codeSource ORDER BY name ASC`,
      );
      return result ?? [];
    });
    return Promise.all(rows.map((row) => this.rowToSource(row)));
  }

  /**
   * Get all enabled code sources.
   */
  async getAllEnabled(): Promise<CodeSource[]> {
    const rows = await this.surrealFactory.withSystemConnection({}, async (db) => {
      const [result] = await db.query<[CodeSourceRow[]]>(
        `SELECT * FROM codeSource WHERE enabled = true ORDER BY name ASC`,
      );
      return result ?? [];
    });
    return Promise.all(rows.map((row) => this.rowToSource(row)));
  }

  /**
   * Get a code source by ID.
   */
  async getById(id: string): Promise<CodeSource | null> {
    const recordId = new RecordId("codeSource", id);
    const row = await this.surrealFactory.withSystemConnection({}, async (db) => {
      const [result] = await db.query<[CodeSourceRow | undefined]>(
        `RETURN $recordId.*`,
        { recordId },
      );
      return result ?? null;
    });
    return row ? this.rowToSource(row) : null;
  }

  /**
   * Get a code source by name.
   */
  async getByName(name: string): Promise<CodeSource | null> {
    const row = await this.surrealFactory.withSystemConnection({}, async (db) => {
      const [result] = await db.query<[CodeSourceRow[]]>(
        `SELECT * FROM codeSource WHERE name = $name LIMIT 1`,
        { name },
      );
      return result?.[0] ?? null;
    });
    return row ? this.rowToSource(row) : null;
  }

  /**
   * Check if a source exists by ID.
   */
  async exists(id: string): Promise<boolean> {
    const recordId = new RecordId("codeSource", id);
    const row = await this.surrealFactory.withSystemConnection({}, async (db) => {
      const [result] = await db.query<[CodeSourceRow | undefined]>(
        `RETURN $recordId.*`,
        { recordId },
      );
      return result ?? null;
    });
    return row !== null;
  }

  /**
   * Check if a source name is taken.
   */
  async nameExists(name: string): Promise<boolean> {
    const exists = await this.surrealFactory.withSystemConnection(
      {},
      async (db) => {
        const [result] = await db.query<[{ count: number }[]]>(
          `SELECT count() as count FROM codeSource WHERE name = $name GROUP ALL`,
          { name },
        );
        return (result?.[0]?.count ?? 0) > 0;
      },
    );
    return exists;
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

    // Encrypt sensitive fields
    // Provider encrypts its typeSettings sensitive fields (e.g., authToken)
    const encryptedTypeSettings = await provider.encryptSensitiveFields(
      input.typeSettings ?? {},
    );
    // Service encrypts syncSettings.webhookSecret
    const encryptedSyncSettings = await this.encryptSyncSettings(
      input.syncSettings ?? {},
    );

    // Create record (SurrealDB auto-generates ID)
    const createdRow = await this.surrealFactory.withSystemConnection(
      {},
      async (db) => {
        const [result] = await db.query<[CodeSourceRow[]]>(
          `CREATE codeSource SET
            name = $name,
            type = $type,
            typeSettings = $typeSettings,
            syncSettings = $syncSettings,
            enabled = $enabled`,
          {
            name: input.name,
            type: input.type,
            typeSettings: encryptedTypeSettings,
            syncSettings: encryptedSyncSettings,
            enabled: input.enabled ?? true,
          },
        );
        return result?.[0] ?? null;
      },
    );

    if (!createdRow) {
      throw new Error("Failed to create source record");
    }

    // Create directory via provider
    await provider.ensureDirectory(input.name);

    // Convert to CodeSource entity
    const source = await this.rowToSource(createdRow);

    // Create schedule if needed (syncable source with interval)
    await this.ensureSchedule(source);

    logger.info(
      `[CodeSource] Created source '${input.name}' (type: ${input.type})`,
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
  async update(id: string, updates: UpdateCodeSource): Promise<CodeSource> {
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
    const setFields: string[] = [];
    const params: Record<string, unknown> = {
      recordId: new RecordId("codeSource", id),
    };

    if (updates.typeSettings !== undefined) {
      const provider = this.getProvider(existing.type);
      const encrypted = await provider.encryptSensitiveFields(updates.typeSettings);
      setFields.push("typeSettings = $typeSettings");
      params.typeSettings = encrypted;
    }

    if (updates.syncSettings !== undefined) {
      const encrypted = await this.encryptSyncSettings(updates.syncSettings);
      setFields.push("syncSettings = $syncSettings");
      params.syncSettings = encrypted;
    }

    if (updates.enabled !== undefined) {
      setFields.push("enabled = $enabled");
      params.enabled = updates.enabled;
    }

    if (setFields.length === 0) {
      return existing; // Nothing to update
    }

    await this.surrealFactory.withSystemConnection({}, async (db) => {
      await db.query(
        `UPDATE $recordId SET ${setFields.join(", ")}`,
        params,
      );
    });

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
  async delete(id: string, deleteDirectory = true): Promise<void> {
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
    const recordId = new RecordId("codeSource", id);
    await this.surrealFactory.withSystemConnection({}, async (db) => {
      await db.query(`DELETE $recordId`, { recordId });
    });

    logger.info(`[CodeSource] Deleted source '${source.name}' (id: ${id})`);
  }

  /**
   * Enable or disable a source.
   */
  setEnabled(id: string, enabled: boolean): Promise<CodeSource> {
    return this.update(id, { enabled });
  }

  // ============== Sync Status Operations ==============

  /**
   * Mark sync as started. Sets lastSyncStartedAt, clears lastSyncError.
   */
  async markSyncStarted(id: string): Promise<void> {
    const recordId = new RecordId("codeSource", id);
    await this.surrealFactory.withSystemConnection({}, async (db) => {
      await db.query(
        `UPDATE $recordId SET
          lastSyncStartedAt = time::now(),
          lastSyncError = NONE`,
        { recordId },
      );
    });
  }

  /**
   * Mark sync as completed. Sets lastSyncAt, clears error and startedAt.
   */
  async markSyncCompleted(id: string): Promise<void> {
    const recordId = new RecordId("codeSource", id);
    await this.surrealFactory.withSystemConnection({}, async (db) => {
      await db.query(
        `UPDATE $recordId SET
          lastSyncAt = time::now(),
          lastSyncStartedAt = NONE,
          lastSyncError = NONE`,
        { recordId },
      );
    });
  }

  /**
   * Mark sync as failed. Sets lastSyncError, clears startedAt.
   */
  async markSyncFailed(id: string, error: string): Promise<void> {
    const recordId = new RecordId("codeSource", id);
    await this.surrealFactory.withSystemConnection({}, async (db) => {
      await db.query(
        `UPDATE $recordId SET
          lastSyncError = $error,
          lastSyncStartedAt = NONE`,
        { recordId, error },
      );
    });
  }

  // ============== Schedule Management ==============

  /**
   * Get the schedule name for a source.
   */
  private getScheduleName(sourceId: string): string {
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
  private async deleteSchedule(sourceId: string): Promise<void> {
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
  async pauseSchedule(sourceId: string): Promise<void> {
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
  async resumeSchedule(sourceId: string): Promise<void> {
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
  async triggerManualSync(id: string): Promise<Job | null> {
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
    id: string,
    providedSecret: string,
  ): Promise<Job | null> {
    const source = await this.getById(id);
    if (!source) {
      throw new SourceNotFoundError(id);
    }

    // Check if webhooks are enabled for this source
    if (!source.syncSettings.webhookEnabled) {
      throw new WebhookDisabledError(source.name);
    }

    // Validate webhook secret only if one is configured
    const expectedSecret = source.syncSettings.webhookSecret;
    if (expectedSecret && !constantTimeCompare(expectedSecret, providedSecret)) {
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
  async syncSource(id: string, token: CancellationToken): Promise<SyncResult> {
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
  async isEditable(id: string): Promise<boolean> {
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
  async isSyncable(id: string): Promise<boolean> {
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

    // Validate URL format - only HTTPS is supported
    // SSH URLs (git@github.com:user/repo.git) are not supported because
    // isomorphic-git only supports HTTP/HTTPS protocols
    if (!s.url.startsWith("https://")) {
      if (s.url.startsWith("git@") || s.url.startsWith("ssh://")) {
        throw new InvalidSourceConfigError(
          "SSH URLs are not supported. Please use HTTPS URL instead (e.g., https://github.com/user/repo.git). " +
          "For private repositories, use the Authentication Token field with a personal access token.",
        );
      }
      if (s.url.startsWith("git://")) {
        throw new InvalidSourceConfigError(
          "The git:// protocol is not supported. Please use HTTPS URL instead (e.g., https://github.com/user/repo.git).",
        );
      }
      throw new InvalidSourceConfigError(
        "Git URL must use HTTPS (e.g., https://github.com/user/repo.git). SSH and git:// protocols are not supported.",
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
      syncSettings.webhookEnabled !== undefined &&
      typeof syncSettings.webhookEnabled !== "boolean"
    ) {
      throw new InvalidSourceConfigError(
        "syncSettings.webhookEnabled must be a boolean",
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
   * Encrypt webhookSecret in sync settings.
   * Only encrypts if webhookSecret is present.
   */
  private async encryptSyncSettings(settings: SyncSettings): Promise<SyncSettings> {
    if (!settings.webhookSecret) {
      return settings;
    }
    return {
      ...settings,
      webhookSecret: await this.encryptionService.encrypt(settings.webhookSecret),
    };
  }

  /**
   * Decrypt webhookSecret in sync settings.
   * Only decrypts if webhookSecret is present.
   */
  private async decryptSyncSettings(settings: SyncSettings): Promise<SyncSettings> {
    if (!settings.webhookSecret) {
      return settings;
    }
    try {
      return {
        ...settings,
        webhookSecret: await this.encryptionService.decrypt(settings.webhookSecret),
      };
    } catch (error) {
      logger.error(
        `[CodeSource] Failed to decrypt webhookSecret, returning as-is:`,
        error,
      );
      return settings;
    }
  }


  /**
   * Convert an optional value to Date or null.
   */
  private toOptionalDate(value: Date | unknown | null): Date | null {
    if (value === null || value === undefined) {
      return null;
    }
    return toDate(value);
  }

  /**
   * Convert database row to CodeSource entity.
   * Decrypts both syncSettings.webhookSecret and typeSettings sensitive fields.
   */
  private async rowToSource(row: CodeSourceRow): Promise<CodeSource> {
    // Validate type
    const typeStr = row.type as string;
    if (!isCodeSourceType(typeStr)) {
      throw new Error(`Invalid source type in database: ${typeStr}`);
    }

    // Extract ID from RecordId
    const id = row.id.id as string;

    // Decrypt syncSettings.webhookSecret
    const syncSettings = await this.decryptSyncSettings(row.syncSettings ?? {});

    // Decrypt typeSettings via provider (if provider is registered)
    let typeSettings = row.typeSettings ?? {};
    if (this.providers.has(typeStr)) {
      const provider = this.providers.get(typeStr)!;
      typeSettings = await provider.decryptSensitiveFields(typeSettings);
    }

    return {
      id,
      name: row.name,
      type: typeStr,
      typeSettings,
      syncSettings,
      lastSyncStartedAt: this.toOptionalDate(row.lastSyncStartedAt),
      lastSyncAt: this.toOptionalDate(row.lastSyncAt),
      lastSyncError: row.lastSyncError ?? null,
      enabled: row.enabled,
      createdAt: toDate(row.createdAt),
      updatedAt: toDate(row.updatedAt),
    };
  }
}
