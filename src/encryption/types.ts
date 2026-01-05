/**
 * Common interface for encryption services.
 * Both EncryptionService and VersionedEncryptionService implement this.
 */
export interface IEncryptionService {
  /** Encrypts plaintext and returns encrypted string */
  encrypt(plaintext: string): Promise<string>;
  /** Decrypts encrypted string and returns plaintext */
  decrypt(encrypted: string): Promise<string>;
}

/**
 * Configuration options for EncryptionService
 */
export interface EncryptionServiceOptions {
  /** Base64-encoded 256-bit (32-byte) encryption key */
  encryptionKey: string;
}

/**
 * Configuration options for VersionedEncryptionService.
 * Supports key rotation with current and phased_out keys.
 */
export interface VersionedEncryptionServiceOptions {
  /** Base64-encoded current encryption key (AES-256, 32 bytes) */
  currentKey: string;
  /** Single character A-Z identifying the current key version */
  currentVersion: string;
  /** Base64-encoded previous key being phased out (optional, only during rotation) */
  phasedOutKey?: string;
  /** Version character of the phased out key (optional, only during rotation) */
  phasedOutVersion?: string;
}
