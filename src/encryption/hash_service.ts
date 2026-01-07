/**
 * Service for computing HMAC-SHA256 hashes of API keys.
 * Used for constant-time API key lookup without decryption.
 *
 * NOT for password hashing - API keys are already high-entropy random values.
 * Uses HMAC-SHA256 for cryptographic strength and authentication.
 */

import { base64ToBytes, bytesToBase64 } from "./utils.ts";

export interface HashServiceOptions {
  /** Base64-encoded 256-bit HMAC key */
  hashKey: string;
}

/**
 * Service for computing HMAC-SHA256 hashes of API keys.
 *
 * Provides:
 * - Constant-time hash computation for O(1) lookups
 * - Timing-safe comparison to prevent side-channel attacks
 * - Web Crypto API integration (hardware-accelerated)
 */
export class HashService {
  private key: CryptoKey | null = null;
  private readonly rawKey: Uint8Array;

  constructor(options: HashServiceOptions) {
    this.rawKey = base64ToBytes(options.hashKey);

    if (this.rawKey.length !== 32) {
      throw new Error(
        `Hash key must be exactly 32 bytes (256 bits), got ${this.rawKey.length} bytes`
      );
    }
  }

  /**
   * Computes HMAC-SHA256 hash of plaintext API key.
   * Returns base64-encoded hash for database storage.
   *
   * @param plaintext - The plaintext API key value
   * @returns Base64-encoded HMAC-SHA256 hash (44 characters)
   */
  async computeHash(plaintext: string): Promise<string> {
    const key = await this.getKey();
    const data = new TextEncoder().encode(plaintext);

    const signature = await crypto.subtle.sign("HMAC", key, data);

    return bytesToBase64(new Uint8Array(signature));
  }

  /**
   * Timing-safe comparison of two hash strings.
   * Prevents timing attacks on hash comparison by ensuring
   * constant execution time regardless of where strings differ.
   *
   * @param a - First hash string
   * @param b - Second hash string
   * @returns True if hashes are equal, false otherwise
   */
  timingSafeEqual(a: string, b: string): boolean {
    // Different lengths = not equal (early return is safe here)
    if (a.length !== b.length) return false;

    const aBytes = new TextEncoder().encode(a);
    const bBytes = new TextEncoder().encode(b);

    // XOR all bytes - any difference will set diff to non-zero
    // Constant time: always processes all bytes
    let diff = 0;
    for (let i = 0; i < aBytes.length; i++) {
      diff |= aBytes[i] ^ bBytes[i];
    }

    return diff === 0;
  }

  /**
   * Lazily imports the raw key as a CryptoKey.
   * Cached after first call for performance.
   *
   * @returns The imported CryptoKey for HMAC operations
   */
  private async getKey(): Promise<CryptoKey> {
    if (!this.key) {
      this.key = await crypto.subtle.importKey(
        "raw",
        this.rawKey.buffer as ArrayBuffer,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign", "verify"]
      );
    }
    return this.key;
  }
}
