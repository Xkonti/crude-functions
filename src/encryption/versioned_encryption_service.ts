/**
 * Versioned encryption service with key rotation support.
 *
 * Features:
 * - AES-256-GCM for authenticated encryption
 * - Version character prepended to encrypted output for key identification
 * - Support for two keys during rotation (current + phased_out)
 * - Rotation lock to block operations during batch re-encryption
 *
 * Encrypted format: VERSION_CHAR + base64(IV || ciphertext || auth_tag)
 * Example: "A" + "base64data..." where "A" identifies the key version
 */

import { Mutex } from "@core/asyncutil/mutex";
import type { VersionedEncryptionServiceOptions } from "./types.ts";
import { base64ToBytes, bytesToBase64 } from "./utils.ts";
import { EncryptionError, DecryptionError, InvalidKeyError } from "./errors.ts";
import { logger } from "../utils/logger.ts";

/**
 * Versioned encryption service supporting key rotation.
 *
 * During normal operation, uses a single current key.
 * During rotation, maintains both current and phased_out keys
 * to allow gradual re-encryption of existing data.
 */
export class VersionedEncryptionService {
  private currentKey: CryptoKey | null = null;
  private phasedOutKey: CryptoKey | null = null;
  private rawCurrentKey!: Uint8Array;
  private rawPhasedOutKey!: Uint8Array | null;
  private currentVersion!: string;
  private phasedOutVersion!: string | null;

  // Mutex for thread-safe key updates
  private readonly keyMutex = new Mutex();

  // Rotation lock - when acquired, blocks all encrypt/decrypt operations
  private readonly rotationLock = new Mutex();

  constructor(options: VersionedEncryptionServiceOptions) {
    this.validateAndSetKeys(options);
  }

  /**
   * Validate and set keys from options.
   */
  private validateAndSetKeys(options: VersionedEncryptionServiceOptions): void {
    // Validate current key
    try {
      this.rawCurrentKey = base64ToBytes(options.currentKey);
    } catch (error) {
      throw new InvalidKeyError(
        `Invalid current key format: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    if (this.rawCurrentKey.length !== 32) {
      throw new InvalidKeyError(
        `Current key must be exactly 32 bytes (256 bits), got ${this.rawCurrentKey.length} bytes`
      );
    }

    // Validate version
    if (
      options.currentVersion.length !== 1 ||
      options.currentVersion < "A" ||
      options.currentVersion > "Z"
    ) {
      throw new InvalidKeyError(
        `Invalid current version: must be A-Z, got "${options.currentVersion}"`
      );
    }
    this.currentVersion = options.currentVersion;

    // Reject partial phased out configuration
    const hasPhasedOutKey = options.phasedOutKey !== undefined;
    const hasPhasedOutVersion = options.phasedOutVersion !== undefined;
    if (hasPhasedOutKey !== hasPhasedOutVersion) {
      throw new InvalidKeyError(
        "Partial phased out configuration: both phasedOutKey and phasedOutVersion must be provided together, or neither"
      );
    }

    // Validate phased out key if present
    if (options.phasedOutKey && options.phasedOutVersion) {
      try {
        this.rawPhasedOutKey = base64ToBytes(options.phasedOutKey);
      } catch (error) {
        throw new InvalidKeyError(
          `Invalid phased out key format: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }

      if (this.rawPhasedOutKey.length !== 32) {
        throw new InvalidKeyError(
          `Phased out key must be exactly 32 bytes (256 bits), got ${this.rawPhasedOutKey.length} bytes`
        );
      }

      if (
        options.phasedOutVersion.length !== 1 ||
        options.phasedOutVersion < "A" ||
        options.phasedOutVersion > "Z"
      ) {
        throw new InvalidKeyError(
          `Invalid phased out version: must be A-Z, got "${options.phasedOutVersion}"`
        );
      }

      // Reject duplicate versions
      if (options.phasedOutVersion === options.currentVersion) {
        throw new InvalidKeyError(
          `Current and phased out versions cannot be the same: "${options.currentVersion}"`
        );
      }

      this.phasedOutVersion = options.phasedOutVersion;
    } else {
      this.rawPhasedOutKey = null;
      this.phasedOutVersion = null;
    }

    // Clear cached CryptoKeys when raw keys change
    this.currentKey = null;
    this.phasedOutKey = null;
  }

  /**
   * Encrypts plaintext with the current key.
   * Output format: VERSION_CHAR + base64(IV || ciphertext || auth_tag)
   *
   * @param plaintext - String to encrypt
   * @returns Versioned encrypted string
   * @throws EncryptionError if encryption fails
   */
  async encrypt(plaintext: string): Promise<string> {
    // Acquire rotation lock to ensure we're not in the middle of a rotation batch
    using _lock = await this.rotationLock.acquire();
    return this.encryptUnlocked(plaintext);
  }

  /**
   * Encrypts plaintext without acquiring the rotation lock.
   * Use this only when the caller already holds the rotation lock.
   *
   * @param plaintext - String to encrypt
   * @returns Versioned encrypted string
   * @throws EncryptionError if encryption fails
   */
  async encryptUnlocked(plaintext: string): Promise<string> {
    try {
      const key = await this.getCurrentKey();

      // Generate random 12-byte IV
      const iv = crypto.getRandomValues(new Uint8Array(12));

      // Encode plaintext to bytes
      const encoded = new TextEncoder().encode(plaintext);

      // Encrypt with AES-GCM (auth tag automatically appended)
      const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        encoded
      );

      // Combine: IV + ciphertext (which includes auth tag)
      const combined = new Uint8Array(iv.length + ciphertext.byteLength);
      combined.set(iv);
      combined.set(new Uint8Array(ciphertext), iv.length);

      // Prepend version character
      return this.currentVersion + bytesToBase64(combined);
    } catch (error) {
      if (error instanceof EncryptionError) {
        throw error;
      }
      throw new EncryptionError("Failed to encrypt data", error);
    }
  }

  /**
   * Decrypts versioned encrypted data.
   * Reads the version character to determine which key to use.
   *
   * @param encrypted - Versioned encrypted string (VERSION_CHAR + base64 data)
   * @returns Decrypted plaintext
   * @throws DecryptionError if decryption fails or version doesn't match any key
   */
  async decrypt(encrypted: string): Promise<string> {
    // Acquire rotation lock to ensure we're not in the middle of a rotation batch
    using _lock = await this.rotationLock.acquire();
    return this.decryptUnlocked(encrypted);
  }

  /**
   * Decrypts versioned encrypted data without acquiring the rotation lock.
   * Use this only when the caller already holds the rotation lock.
   *
   * @param encrypted - Versioned encrypted string (VERSION_CHAR + base64 data)
   * @returns Decrypted plaintext
   * @throws DecryptionError if decryption fails or version doesn't match any key
   */
  async decryptUnlocked(encrypted: string): Promise<string> {
    try {
      if (encrypted.length < 2) {
        throw new DecryptionError("Invalid encrypted data: too short");
      }

      const version = encrypted.charAt(0);
      const data = encrypted.slice(1);

      // Determine which key to use
      const key = await this.getKeyForVersion(version);

      // Decode base64 to bytes
      const combined = base64ToBytes(data);

      // Extract IV (first 12 bytes) and ciphertext (rest)
      const iv = combined.slice(0, 12);
      const ciphertext = combined.slice(12);

      // Decrypt with AES-GCM (verifies auth tag automatically)
      const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        key,
        ciphertext
      );

      return new TextDecoder().decode(decrypted);
    } catch (error) {
      if (error instanceof DecryptionError) {
        throw error;
      }
      throw new DecryptionError(
        "Failed to decrypt data (wrong key or tampered data)",
        error
      );
    }
  }

  /**
   * Update keys (called when rotation starts or completes).
   * Thread-safe via mutex.
   *
   * @param options - New key configuration
   */
  async updateKeys(options: VersionedEncryptionServiceOptions): Promise<void> {
    using _lock = await this.keyMutex.acquire();
    this.validateAndSetKeys(options);
    logger.info(
      `[VersionedEncryption] Keys updated (current: ${this.currentVersion}, phased_out: ${this.phasedOutVersion ?? "none"})`
    );
  }

  /**
   * Acquire the rotation lock.
   * While held, all encrypt/decrypt operations will block.
   * Use this during batch re-encryption.
   *
   * @returns A release function to call when done
   */
  async acquireRotationLock(): Promise<Disposable> {
    const lock = await this.rotationLock.acquire();
    logger.debug("[VersionedEncryption] Rotation lock acquired");
    return {
      [Symbol.dispose]: () => {
        lock[Symbol.dispose]();
        logger.debug("[VersionedEncryption] Rotation lock released");
      },
    };
  }

  /**
   * Check if a value is encrypted with the phased out key.
   * Used during rotation to identify values that need re-encryption.
   *
   * @param encrypted - Versioned encrypted string
   * @returns true if encrypted with phased out key, false otherwise
   */
  isEncryptedWithPhasedOutKey(encrypted: string): boolean {
    if (!this.phasedOutVersion || encrypted.length < 1) {
      return false;
    }
    return encrypted.charAt(0) === this.phasedOutVersion;
  }

  /**
   * Get the current version character.
   */
  get version(): string {
    return this.currentVersion;
  }

  /**
   * Check if rotation is in progress (phased out key exists).
   */
  get isRotating(): boolean {
    return this.phasedOutVersion !== null;
  }

  /**
   * Get the phased out version character, if any.
   */
  get phasedOutVersionChar(): string | null {
    return this.phasedOutVersion;
  }

  /**
   * Get the CryptoKey for a specific version.
   */
  private getKeyForVersion(version: string): Promise<CryptoKey> {
    if (version === this.currentVersion) {
      return this.getCurrentKey();
    }

    if (version === this.phasedOutVersion && this.rawPhasedOutKey) {
      return this.getPhasedOutKey();
    }

    throw new DecryptionError(
      `Unknown key version: ${version}. Current: ${this.currentVersion}, Phased out: ${this.phasedOutVersion ?? "none"}`
    );
  }

  /**
   * Lazily imports the current raw key as a CryptoKey.
   * Cached after first call for performance.
   */
  private async getCurrentKey(): Promise<CryptoKey> {
    if (!this.currentKey) {
      this.currentKey = await crypto.subtle.importKey(
        "raw",
        this.rawCurrentKey.buffer as ArrayBuffer,
        { name: "AES-GCM" },
        false,
        ["encrypt", "decrypt"]
      );
    }
    return this.currentKey;
  }

  /**
   * Lazily imports the phased out raw key as a CryptoKey.
   * Cached after first call for performance.
   */
  private async getPhasedOutKey(): Promise<CryptoKey> {
    if (!this.phasedOutKey && this.rawPhasedOutKey) {
      this.phasedOutKey = await crypto.subtle.importKey(
        "raw",
        this.rawPhasedOutKey.buffer as ArrayBuffer,
        { name: "AES-GCM" },
        false,
        ["encrypt", "decrypt"]
      );
    }
    if (!this.phasedOutKey) {
      throw new DecryptionError("Phased out key not available");
    }
    return this.phasedOutKey;
  }
}
