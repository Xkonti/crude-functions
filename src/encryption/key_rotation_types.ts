/**
 * Types for the key rotation service.
 */

import type { DatabaseService } from "../database/database_service.ts";
import type { VersionedEncryptionService } from "./versioned_encryption_service.ts";
import type { KeyStorageService } from "./key_storage_service.ts";

/**
 * Configuration for key rotation.
 */
export interface KeyRotationConfig {
  /** How long between rotations (days). Default: 90 days */
  rotationIntervalDays: number;
  /** Batch size for re-encryption. Default: 100 */
  batchSize: number;
  /** Sleep between batches (ms). Default: 100 */
  batchSleepMs: number;
}

/**
 * Options for the KeyRotationService.
 */
export interface KeyRotationServiceOptions {
  /** Database service for reading/writing encrypted records */
  db: DatabaseService;
  /** Encryption service for encrypt/decrypt operations */
  encryptionService: VersionedEncryptionService;
  /** Key storage service for managing encryption keys file */
  keyStorage: KeyStorageService;
  /** Rotation configuration */
  config: KeyRotationConfig;
}

/**
 * Tables that contain encrypted data and need key rotation.
 */
export type EncryptedTable = "secrets" | "apiKeys" | "settings";

/**
 * A record from an encrypted table that needs re-encryption.
 * Satisfies the Row constraint for database queries.
 */
export interface EncryptedRecord {
  [key: string]: unknown;
  id: number;
  value: string;
  updatedAt: string;
}

/**
 * Default configuration values for key rotation.
 */
export const DEFAULT_KEY_ROTATION_CONFIG: KeyRotationConfig = {
  rotationIntervalDays: 90,
  batchSize: 100,
  batchSleepMs: 100,
};
