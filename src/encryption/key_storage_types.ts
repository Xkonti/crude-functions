/**
 * Types for encryption key storage and rotation.
 *
 * Keys are stored in a JSON file separate from the database for security:
 * if the database is compromised, the encryption keys remain protected.
 */

/**
 * Structure of the encryption keys JSON file.
 * Stored at ./data/encryption-keys.json
 */
export interface EncryptionKeyFile {
  /** Base64-encoded current encryption key (AES-256, 32 bytes) */
  current_key: string;
  /** Single character A-Z identifying the current key version */
  current_version: string;
  /** Base64-encoded previous key being phased out (null if no rotation in progress) */
  phased_out_key: string | null;
  /** Version character of the phased out key (null if no rotation in progress) */
  phased_out_version: string | null;
  /** ISO timestamp when last rotation completed successfully */
  last_rotation_finished_at: string;
  /** Session signing key for Better Auth */
  better_auth_secret: string;
  /** Base64-encoded HMAC key for API key hashing (256 bits, 32 bytes) */
  hash_key: string;
}

/**
 * Options for the KeyStorageService.
 */
export interface KeyStorageServiceOptions {
  /** Path to the encryption keys JSON file. Defaults to ./data/encryption-keys.json */
  keyFilePath?: string;

  /**
   * Optional custom key generator function for testing.
   * When provided, this replaces the openssl-based key generation.
   * Should return a base64-encoded 32-byte key.
   */
  keyGenerator?: () => Promise<string>;
}
