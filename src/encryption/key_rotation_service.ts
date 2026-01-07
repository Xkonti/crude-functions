/**
 * Background service for automatic encryption key rotation.
 *
 * Runs on a configurable interval to:
 * - Check if it's time for key rotation (based on last_rotation_finished_at)
 * - Resume incomplete rotations (if both current and phased_out keys exist)
 * - Generate new keys and re-encrypt all secrets/api_keys in batches
 * - Update Better Auth secret (causing session invalidation)
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
import { logger } from "../utils/logger.ts";

/**
 * Tables containing encrypted data that need key rotation.
 */
const ENCRYPTED_TABLES: EncryptedTable[] = ["secrets", "apiKeys", "settings"];

/**
 * Maximum consecutive failures before auto-stopping.
 */
const MAX_CONSECUTIVE_FAILURES = 5;

/**
 * Timeout for graceful stop (ms).
 */
const STOP_TIMEOUT_MS = 60000;

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

  private timerId: number | null = null;
  private isStarting = false;
  private isRotating = false;
  private stopRequested = false;
  private consecutiveFailures = 0;

  constructor(options: KeyRotationServiceOptions) {
    this.db = options.db;
    this.encryptionService = options.encryptionService;
    this.keyStorage = options.keyStorage;
    this.config = options.config;
  }

  /**
   * Start the rotation check timer.
   * Checks immediately on start, then on configured interval.
   * Timer only starts if initial check succeeds.
   */
  start(): void {
    if (this.timerId !== null) {
      logger.warn("[KeyRotation] Already running");
      return;
    }

    if (this.isStarting) {
      logger.warn("[KeyRotation] Start already in progress");
      return;
    }

    logger.info(
      `[KeyRotation] Starting with check interval ${this.config.checkIntervalSeconds}s, ` +
        `rotation interval ${this.config.rotationIntervalDays} days`
    );

    this.isStarting = true;

    // Run initial check first, only start timer if it succeeds
    this.checkAndRotate()
      .then(() => {
        this.consecutiveFailures = 0;

        // Check if stop was requested during initial check
        if (this.stopRequested) {
          this.isStarting = false;
          logger.debug(
            "[KeyRotation] Stop requested during startup, timer not started"
          );
          return;
        }

        // Initial check succeeded, start the timer
        this.timerId = setInterval(() => {
          this.checkAndRotate()
            .then(() => {
              this.consecutiveFailures = 0;
            })
            .catch((error) => {
              this.consecutiveFailures++;
              logger.error(
                `[KeyRotation] Check failed (${this.consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}):`,
                error
              );

              // Auto-shutdown after max failures
              if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                // Check if we're stopping mid-rotation
                this.keyStorage
                  .loadKeys()
                  .then((keys) => {
                    const midRotation =
                      keys !== null && this.keyStorage.isRotationInProgress(keys);
                    if (midRotation) {
                      logger.error(
                        "[KeyRotation] CRITICAL: Max consecutive failures reached while rotation in progress!"
                      );
                      logger.error(
                        "[KeyRotation] The system has both current and phased_out keys. " +
                          "Some records may be encrypted with the old key."
                      );
                      logger.error(
                        "[KeyRotation] Recovery: Restart the service to automatically resume rotation, " +
                          "or manually trigger rotation via the API."
                      );
                    } else {
                      logger.error(
                        "[KeyRotation] Max consecutive failures reached, stopping service"
                      );
                    }
                  })
                  .catch(() => {
                    logger.error(
                      "[KeyRotation] Max consecutive failures reached, stopping service (could not check rotation state)"
                    );
                  });

                if (this.timerId !== null) {
                  clearInterval(this.timerId);
                  this.timerId = null;
                }
              }
            });
        }, this.config.checkIntervalSeconds * 1000);

        this.isStarting = false;
        logger.debug("[KeyRotation] Timer started successfully");
      })
      .catch((error) => {
        this.consecutiveFailures++;
        this.isStarting = false;
        logger.error(
          "[KeyRotation] Initial check failed, timer not started:",
          error
        );
      });
  }

  /**
   * Stop the rotation service.
   * Waits for any in-progress startup or rotation to complete (with timeout).
   */
  async stop(): Promise<void> {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }

    this.stopRequested = true;

    // Wait for startup or rotation to complete with timeout
    const startTime = Date.now();
    while (this.isStarting || this.isRotating) {
      if (Date.now() - startTime > STOP_TIMEOUT_MS) {
        logger.warn(
          "[KeyRotation] Stop timeout exceeded, startup/rotation may still be running"
        );
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    this.stopRequested = false;
    logger.info("[KeyRotation] Stopped");
  }

  /**
   * Get current rotation status for monitoring/alerting.
   * Returns information about the rotation service state.
   */
  async getRotationStatus(): Promise<{
    isRunning: boolean;
    isRotating: boolean;
    hasIncompleteRotation: boolean;
    consecutiveFailures: number;
    maxConsecutiveFailures: number;
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
      isRunning: this.timerId !== null,
      isRotating: this.isRotating,
      hasIncompleteRotation,
      consecutiveFailures: this.consecutiveFailures,
      maxConsecutiveFailures: MAX_CONSECUTIVE_FAILURES,
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
      await this.performRotation(keys);
      return;
    }

    // Start new rotation (bypass interval check)
    await this.startNewRotation(keys);
  }

  /**
   * Main rotation check - called by timer.
   * Determines if rotation is needed and performs it.
   */
  private async checkAndRotate(): Promise<void> {
    // 1. Check if stop was requested
    if (this.stopRequested) {
      return;
    }

    // 2. Check in-memory lock
    if (this.isRotating) {
      logger.debug("[KeyRotation] Rotation already in progress, skipping");
      return;
    }

    // 3. Load current keys
    const keys = await this.keyStorage.loadKeys();
    if (!keys) {
      logger.error("[KeyRotation] No keys file found");
      return;
    }

    // 4. Check if previous rotation incomplete (2 keys exist)
    if (this.keyStorage.isRotationInProgress(keys)) {
      logger.warn(
        "[KeyRotation] Detected incomplete rotation from previous run. " +
          "Both current and phased_out keys exist. Resuming rotation..."
      );
      // Reset failure counter - this is a fresh attempt after restart
      this.consecutiveFailures = 0;
      await this.performRotation(keys);
      return;
    }

    // 5. Check if time for new rotation
    const lastRotation = new Date(keys.last_rotation_finished_at);
    const nextRotation = new Date(
      lastRotation.getTime() +
        this.config.rotationIntervalDays * 24 * 60 * 60 * 1000
    );

    if (new Date() < nextRotation) {
      logger.debug(
        `[KeyRotation] Not time for rotation yet (next: ${nextRotation.toISOString()})`
      );
      return;
    }

    // 6. Final check before starting rotation (in case stop was called during checks)
    if (this.stopRequested) {
      return;
    }

    // 7. Start new rotation
    logger.info("[KeyRotation] Starting new key rotation");
    await this.startNewRotation(keys);
  }

  /**
   * Start a new key rotation.
   * Generates new keys, swaps them, and begins re-encryption.
   */
  private async startNewRotation(keys: EncryptionKeyFile): Promise<void> {
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

    await this.performRotation(updatedKeys);
  }

  /**
   * Perform the key rotation (re-encrypt all data).
   */
  private async performRotation(keys: EncryptionKeyFile): Promise<void> {
    this.isRotating = true;

    try {
      if (!keys.phased_out_version) {
        logger.error("[KeyRotation] No phased out version, cannot rotate");
        return;
      }

      // Process each table
      for (const table of ENCRYPTED_TABLES) {
        if (this.stopRequested) {
          logger.info("[KeyRotation] Stop requested, pausing rotation");
          return;
        }
        await this.reencryptTable(table, keys.phased_out_version);
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
    phasedOutVersion: string
  ): Promise<void> {
    logger.info(`[KeyRotation] Starting re-encryption of ${table}`);
    let totalProcessed = 0;

    while (!this.stopRequested) {
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
        const processed = await this.reencryptBatch(table, records);
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
    records: EncryptedRecord[]
  ): Promise<number> {
    let successCount = 0;

    for (const record of records) {
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
