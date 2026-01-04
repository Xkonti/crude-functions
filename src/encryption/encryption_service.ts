import type { EncryptionServiceOptions } from "./types.ts";
import { base64ToBytes, bytesToBase64 } from "./utils.ts";
import { EncryptionError, DecryptionError, InvalidKeyError } from "./errors.ts";

/**
 * Generic encryption service using AES-256-GCM.
 *
 * Features:
 * - AES-256-GCM for authenticated encryption
 * - Random 12-byte IV per encryption
 * - Base64 storage format: base64(IV || ciphertext || auth_tag)
 * - Stateless (no database dependency)
 *
 * Usage:
 * ```typescript
 * const service = new EncryptionService({ encryptionKey: "base64-key" });
 * const encrypted = await service.encrypt("sensitive data");
 * const decrypted = await service.decrypt(encrypted);
 * ```
 */
export class EncryptionService {
  private key: CryptoKey | null = null;
  private readonly rawKey: Uint8Array;

  constructor(options: EncryptionServiceOptions) {
    // Validate and store raw key
    try {
      this.rawKey = base64ToBytes(options.encryptionKey);
    } catch (error) {
      throw new InvalidKeyError(
        `Invalid encryption key format: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    if (this.rawKey.length !== 32) {
      throw new InvalidKeyError(
        `Encryption key must be exactly 32 bytes (256 bits), got ${this.rawKey.length} bytes`
      );
    }
  }

  /**
   * Encrypts plaintext and returns base64-encoded encrypted data
   *
   * @param plaintext - String to encrypt
   * @returns Base64-encoded: IV || ciphertext || auth_tag
   * @throws EncryptionError if encryption fails
   */
  async encrypt(plaintext: string): Promise<string> {
    try {
      const key = await this.getKey();

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

      return bytesToBase64(combined);
    } catch (error) {
      throw new EncryptionError("Failed to encrypt data", error);
    }
  }

  /**
   * Decrypts base64-encoded encrypted data
   *
   * @param encrypted - Base64-encoded: IV || ciphertext || auth_tag
   * @returns Decrypted plaintext
   * @throws DecryptionError if decryption fails or authentication fails
   */
  async decrypt(encrypted: string): Promise<string> {
    try {
      const key = await this.getKey();

      // Decode base64 to bytes
      const combined = base64ToBytes(encrypted);

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
      // Authentication failure or corrupted data
      throw new DecryptionError(
        "Failed to decrypt data (wrong key or tampered data)",
        error
      );
    }
  }

  /**
   * Lazily imports the raw key as a CryptoKey
   * Cached after first call for performance
   */
  private async getKey(): Promise<CryptoKey> {
    if (!this.key) {
      this.key = await crypto.subtle.importKey(
        "raw",
        this.rawKey.buffer as ArrayBuffer,
        { name: "AES-GCM" },
        false,
        ["encrypt", "decrypt"]
      );
    }
    return this.key;
  }
}
