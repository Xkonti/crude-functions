/**
 * Types for the key rotation service.
 */

import type { RecordId } from "surrealdb";
import type { SurrealConnectionFactory } from "../database/surreal_connection_factory.ts";
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
  /** SurrealDB connection factory for reading/writing encrypted records */
  surrealFactory: SurrealConnectionFactory;
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
export type EncryptedTable = "secret" | "apiKey" | "setting";

/**
 * A record from an encrypted table that needs re-encryption.
 * Uses SurrealDB types (RecordId, Date).
 */
export interface EncryptedRecord {
  [key: string]: unknown;
  id: RecordId;
  value: string;
  updatedAt: Date;
}

/**
 * Default configuration values for key rotation.
 */
export const DEFAULT_KEY_ROTATION_CONFIG: KeyRotationConfig = {
  rotationIntervalDays: 90,
  batchSize: 100,
  batchSleepMs: 100,
};
