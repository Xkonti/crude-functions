/**
 * Service for automatic encryption key rotation.
 *
 * Performs key rotation when invoked by the job system:
 * - Check if it's time for key rotation (based on last_rotation_finished_at)
 * - Resume incomplete rotations (if both current and phased_out keys exist)
 * - Generate new keys and re-encrypt all secrets/api_keys in batches
 * - Update Better Auth secret (causing session invalidation)
 *
 * This service is invoked by the job system via the scheduling service.
 * It does not maintain its own timer - scheduling is handled externally.
 */

import type { DatabaseService } from "../database/database_service.ts";
import type { VersionedEncryptionService } from "./versioned_encryption_service.ts";
import type { KeyStorageService } from "./key_storage_service.ts";
import type { EncryptionKeyFile } from "./key_storage_types.ts";
import type {
  KeyRotationConfig,
  KeyRotationServiceOptions,
  EncryptedTable,
  EncryptedRecord,
} from "./key_rotation_types.ts";
import type { CancellationToken } from "../jobs/types.ts";
import type { DynamicScheduleResult } from "../scheduling/types.ts";
import { logger } from "../utils/logger.ts";

/**
 * Tables containing encrypted data that need key rotation.
 */
const ENCRYPTED_TABLES: EncryptedTable[] = ["secrets", "apiKeys", "settings"];

/**
 * Result of a key rotation check.
 * Extends DynamicScheduleResult to provide the next run time for the schedule.
 */
export interface KeyRotationCheckResult extends DynamicScheduleResult {
  /** Whether a rotation was performed during this check */
  rotationPerformed: boolean;
  /** Whether an incomplete rotation was resumed */
  resumedIncomplete: boolean;
}

/**
 * Service for automatic encryption key rotation.
 *
 * Follows the algorithm from .ai/key-rotation-plan.md:
 * 1. Check in-memory lock (exit if rotation in progress)
 * 2. Check for incomplete rotation (2 keys exist) → resume
 * 3. Check if time for rotation (last_rotation_finished_at + interval <= now)
 * 4. Generate new key, swap keys, begin re-encryption
 * 5. Process tables in batches with locking
 * 6. Complete rotation, clear phased_out key
 *
 * ## Key Retention and Data Recovery
 *
 * **Version cycling**: Encryption key versions use letters A-Z and wrap from Z back to A
 * after 26 rotations. This is a design choice to keep version identifiers single-character.
 *
 * **Old key disposal**: After each rotation completes, the phased_out key is permanently
 * discarded. Only the current key remains. All encrypted data is re-encrypted during
 * rotation to use the new current key.
 *
 * **Backup restoration implications**: Database backups can only be decrypted using the
 * encryption keys that were active when the backup was created. Once a key rotation
 * completes, the old key is gone. This means:
 * - Encrypted database backups older than one rotation cycle cannot be restored
 * - With default 90-day rotation interval, backups older than ~90 days are unrecoverable
 * - Plan backup retention policies accordingly
 *
 * **Incomplete rotation recovery**: If rotation fails partway through, the phased_out key
 * remains available. The service will automatically resume incomplete rotations on the next
 * check cycle, ensuring no data becomes permanently inaccessible due to partial rotation.
 */
export class KeyRotationService {
  private readonly db: DatabaseService;
  private readonly encryptionService: VersionedEncryptionService;
  private readonly keyStorage: KeyStorageService;
  private readonly config: KeyRotationConfig;

  /** In-memory lock to prevent concurrent rotation */
  private isRotating = false;
  /** Flag for graceful cancellation mid-rotation */
  private stopRequested = false;

  constructor(options: KeyRotationServiceOptions) {
    this.db = options.db;
    this.encryptionService = options.encryptionService;
    this.keyStorage = options.keyStorage;
    this.config = options.config;
  }

  /**
   * Get current rotation status for monitoring/alerting.
   * Returns information about the rotation service state.
   */
  async getRotationStatus(): Promise<{
    isRotating: boolean;
    hasIncompleteRotation: boolean;
  }> {
    let hasIncompleteRotation = false;

    try {
      const keys = await this.keyStorage.loadKeys();
      if (keys) {
        hasIncompleteRotation = this.keyStorage.isRotationInProgress(keys);
      }
    } catch {
      // Ignore errors loading keys for status check
    }

    return {
      isRotating: this.isRotating,
      hasIncompleteRotation,
    };
  }

  /**
   * Manually trigger a key rotation.
   * This bypasses the normal rotation interval check and forces immediate rotation.
   *
   * @returns Promise that resolves when rotation completes or rejects on error
   * @throws Error if rotation is already in progress
   */
  async triggerManualRotation(): Promise<void> {
    // Check if rotation already in progress
    if (this.isRotating) {
      throw new Error("Key rotation is already in progress");
    }

    logger.info("[KeyRotation] Manual rotation triggered");

    // Load current keys
    const keys = await this.keyStorage.loadKeys();
    if (!keys) {
      throw new Error("No keys file found");
    }

    // Check if previous rotation incomplete (resume it)
    if (this.keyStorage.isRotationInProgress(keys)) {
      logger.info("[KeyRotation] Resuming incomplete rotation");
      this.stopRequested = false;
      await this.performRotation(keys);
      return;
    }

    // Start new rotation (bypass interval check)
    this.stopRequested = false;
    await this.startNewRotation(keys);
  }

  /**
   * Perform rotation check. Called by job handler.
   * Returns next run time for dynamic schedule.
   *
   * @param token - Optional cancellation token for graceful cancellation
   * @returns Result including next run time for the schedule
   */
  async performRotationCheck(token?: CancellationToken): Promise<KeyRotationCheckResult> {
    const rotationIntervalMs = this.config.rotationIntervalDays * 24 * 60 * 60 * 1000;

    // Check in-memory lock
    if (this.isRotating) {
      logger.debug("[KeyRotation] Rotation already in progress, will check again soon");
      return {
        nextRunAt: new Date(Date.now() + 60000), // Check again in 1 min
        rotationPerformed: false,
        resumedIncomplete: false,
      };
    }

    // Load keys
    const keys = await this.keyStorage.loadKeys();
    if (!keys) {
      throw new Error("No encryption keys found");
    }

    // Check for incomplete rotation
    if (this.keyStorage.isRotationInProgress(keys)) {
      logger.warn(
        "[KeyRotation] Detected incomplete rotation from previous run. " +
          "Both current and phased_out keys exist. Resuming rotation..."
      );
      this.stopRequested = false;
      await this.performRotation(keys, token);

      return {
        nextRunAt: new Date(Date.now() + rotationIntervalMs),
        rotationPerformed: true,
        resumedIncomplete: true,
      };
    }

    // Check if time for new rotation
    const lastRotation = new Date(keys.last_rotation_finished_at);
    const nextRotationDue = new Date(lastRotation.getTime() + rotationIntervalMs);

    if (new Date() < nextRotationDue) {
      logger.debug(`[KeyRotation] Not time yet (next: ${nextRotationDue.toISOString()})`);
      return {
        nextRunAt: nextRotationDue,
        rotationPerformed: false,
        resumedIncomplete: false,
      };
    }

    // Start new rotation
    logger.info("[KeyRotation] Starting new key rotation");
    this.stopRequested = false;
    await this.startNewRotation(keys, token);

    return {
      nextRunAt: new Date(Date.now() + rotationIntervalMs),
      rotationPerformed: true,
      resumedIncomplete: false,
    };
  }

  /**
   * Start a new key rotation.
   * Generates new keys, swaps them, and begins re-encryption.
   */
  private async startNewRotation(keys: EncryptionKeyFile, token?: CancellationToken): Promise<void> {
    // Generate new encryption key and auth secret
    const [newKey, newAuthSecret] = await Promise.all([
      this.keyStorage.generateKey(),
      this.keyStorage.generateKey(),
    ]);

    const newVersion = this.keyStorage.getNextVersion(keys.current_version);

    // Swap keys: current becomes phased_out, new becomes current
    const updatedKeys: EncryptionKeyFile = {
      current_key: newKey,
      current_version: newVersion,
      phased_out_key: keys.current_key,
      phased_out_version: keys.current_version,
      last_rotation_finished_at: keys.last_rotation_finished_at, // Don't update until complete
      better_auth_secret: newAuthSecret,
      hash_key: keys.hash_key, // Hash key doesn't rotate
    };

    try {
      await this.keyStorage.saveKeys(updatedKeys);
    } catch (error) {
      logger.error(
        "[KeyRotation] CRITICAL: Failed to save keys during rotation start. " +
        "Rotation will not proceed. Error:",
        error
      );
      throw error;
    }

    // Update encryption service with new keys
    await this.encryptionService.updateKeys({
      currentKey: updatedKeys.current_key,
      currentVersion: updatedKeys.current_version,
      phasedOutKey: updatedKeys.phased_out_key!,
      phasedOutVersion: updatedKeys.phased_out_version!,
    });

    logger.info(
      `[KeyRotation] Keys swapped (${keys.current_version} → ${newVersion}), starting re-encryption`
    );

    await this.performRotation(updatedKeys, token);
  }

  /**
   * Perform the key rotation (re-encrypt all data).
   */
  private async performRotation(keys: EncryptionKeyFile, token?: CancellationToken): Promise<void> {
    this.isRotating = true;

    try {
      if (!keys.phased_out_version) {
        logger.error("[KeyRotation] No phased out version, cannot rotate");
        return;
      }

      // Process each table
      for (const table of ENCRYPTED_TABLES) {
        if (token?.isCancelled) {
          this.stopRequested = true;
        }
        if (this.stopRequested) {
          logger.info("[KeyRotation] Stop requested, pausing rotation");
          return;
        }
        await this.reencryptTable(table, keys.phased_out_version, token);
      }

      // Complete rotation - clear phased out key
      const completedKeys: EncryptionKeyFile = {
        current_key: keys.current_key,
        current_version: keys.current_version,
        phased_out_key: null,
        phased_out_version: null,
        last_rotation_finished_at: new Date().toISOString(),
        better_auth_secret: keys.better_auth_secret,
        hash_key: keys.hash_key, // Hash key doesn't rotate
      };

      try {
        await this.keyStorage.saveKeys(completedKeys);
      } catch (error) {
        logger.error(
          "[KeyRotation] WARNING: Failed to save keys after completing rotation. " +
          "All data has been re-encrypted successfully, but rotation will be retried on next check. Error:",
          error
        );
        throw error;
      }

      // Update encryption service (remove phased out key)
      await this.encryptionService.updateKeys({
        currentKey: completedKeys.current_key,
        currentVersion: completedKeys.current_version,
      });

      logger.info(
        `[KeyRotation] Rotation completed successfully (version ${keys.current_version})`
      );
    } finally {
      this.isRotating = false;
    }
  }

  /**
   * Re-encrypt all records in a table that have the phased out version.
   */
  private async reencryptTable(
    table: EncryptedTable,
    phasedOutVersion: string,
    token?: CancellationToken
  ): Promise<void> {
    logger.info(`[KeyRotation] Starting re-encryption of ${table}`);
    let totalProcessed = 0;

    while (true) {
      // Check for cancellation
      if (token?.isCancelled) {
        this.stopRequested = true;
      }
      if (this.stopRequested) {
        return;
      }

      // a. Lock encryption service
      {
        using _lock = await this.encryptionService.acquireRotationLock();

        // b. Fetch batch
        const records = await this.fetchBatch(table, phasedOutVersion);

        // c. Check if done
        if (records.length === 0) {
          logger.info(
            `[KeyRotation] Completed re-encryption of ${table} (${totalProcessed} records)`
          );
          return;
        }

        // d. Re-encrypt batch
        const processed = await this.reencryptBatch(table, records, token);
        totalProcessed += processed;

        logger.debug(
          `[KeyRotation] Re-encrypted ${processed}/${records.length} records in ${table}`
        );
      }
      // e. Lock released when block exits

      // f. Sleep between batches
      await new Promise((resolve) =>
        setTimeout(resolve, this.config.batchSleepMs)
      );
    }
  }

  /**
   * Fetch a batch of records that need re-encryption.
   * For settings table, only fetches rows where isEncrypted = 1.
   * For other tables, all rows are encrypted.
   */
  private async fetchBatch(
    table: EncryptedTable,
    phasedOutVersion: string
  ): Promise<EncryptedRecord[]> {
    let query: string;

    if (table === "settings") {
      query = `
        SELECT id, value, updatedAt FROM ${table}
        WHERE isEncrypted = 1 AND value LIKE ?
        LIMIT ?
      `;
    } else {
      query = `
        SELECT id, value, updatedAt FROM ${table}
        WHERE value LIKE ?
        LIMIT ?
      `;
    }

    const rows = await this.db.queryAll<EncryptedRecord>(query, [
      `${phasedOutVersion}%`,
      this.config.batchSize,
    ]);

    return rows;
  }

  /**
   * Re-encrypt a batch of records with optimistic concurrency.
   * Returns the number of successfully updated records.
   */
  private async reencryptBatch(
    table: EncryptedTable,
    records: EncryptedRecord[],
    token?: CancellationToken
  ): Promise<number> {
    let successCount = 0;

    for (const record of records) {
      // Check for cancellation
      if (token?.isCancelled) {
        this.stopRequested = true;
      }
      if (this.stopRequested) {
        break;
      }

      try {
        // Decrypt with old key, encrypt with new key
        // Using unlocked variants because caller already holds the rotation lock
        const plaintext = await this.encryptionService.decryptUnlocked(record.value);
        const newValue = await this.encryptionService.encryptUnlocked(plaintext);

        // Update with optimistic concurrency
        const result = await this.db.execute(
          `UPDATE ${table}
           SET value = ?, updatedAt = CURRENT_TIMESTAMP
           WHERE id = ? AND updatedAt = ?`,
          [newValue, record.id, record.updatedAt]
        );

        if (result.changes === 0) {
          logger.warn(
            `[KeyRotation] Optimistic concurrency conflict for ${table} id=${record.id}, will be picked up in next batch`
          );
        } else {
          successCount++;
        }
      } catch (error) {
        logger.error(
          `[KeyRotation] Failed to re-encrypt ${table} id=${record.id}:`,
          error
        );
      }
    }

    return successCount;
  }
}
