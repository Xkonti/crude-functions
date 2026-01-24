/**
 * CSRF token generation and validation service.
 *
 * Uses HMAC-SHA256 for token signing with the hash_key from KeyStorageService.
 * Token format: {random}.{timestamp}.{signature}
 * - random: 16 bytes of cryptographically secure random data (base64url)
 * - timestamp: Unix timestamp in milliseconds when token was created
 * - signature: HMAC-SHA256 of "random.timestamp" (base64url)
 */

import type { CsrfServiceOptions, ParsedToken } from "./types.ts";

const DEFAULT_TOKEN_VALIDITY_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Service for generating and validating CSRF tokens.
 *
 * Tokens are signed using HMAC-SHA256 and include a timestamp for expiry.
 * This implements a double-submit cookie pattern where the token is stored
 * in a cookie and must be submitted with each state-changing request.
 */
export class CsrfService {
  private readonly secret: Uint8Array;
  private readonly tokenValidityMs: number;
  private cryptoKey: CryptoKey | null = null;

  constructor(options: CsrfServiceOptions) {
    // Decode the base64 secret to raw bytes
    this.secret = Uint8Array.from(atob(options.secret), (c) => c.charCodeAt(0));
    this.tokenValidityMs = options.tokenValidityMs ?? DEFAULT_TOKEN_VALIDITY_MS;
  }

  /**
   * Get or create the CryptoKey for HMAC operations.
   */
  private async getCryptoKey(): Promise<CryptoKey> {
    if (!this.cryptoKey) {
      this.cryptoKey = await crypto.subtle.importKey(
        "raw",
        this.secret.buffer as ArrayBuffer,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign", "verify"]
      );
    }
    return this.cryptoKey;
  }

  /**
   * Generate a new CSRF token.
   *
   * @returns A signed token string in format: random.timestamp.signature
   */
  async generateToken(): Promise<string> {
    // Generate 16 bytes of random data
    const randomBytes = new Uint8Array(16);
    crypto.getRandomValues(randomBytes);
    const random = this.toBase64Url(randomBytes);

    // Current timestamp
    const timestamp = Date.now();

    // Create signature
    const dataToSign = `${random}.${timestamp}`;
    const signature = await this.sign(dataToSign);

    return `${random}.${timestamp}.${signature}`;
  }

  /**
   * Validate a CSRF token.
   *
   * Checks that:
   * 1. Token has valid format
   * 2. Signature is valid (not tampered)
   * 3. Token is not expired
   *
   * @param token The token to validate
   * @returns true if token is valid, false otherwise
   */
  async validateToken(token: string): Promise<boolean> {
    const parsed = this.parseToken(token);
    if (!parsed) {
      return false;
    }

    // Check expiry
    const now = Date.now();
    if (now - parsed.timestamp > this.tokenValidityMs) {
      return false;
    }

    // Verify signature
    const dataToSign = `${parsed.random}.${parsed.timestamp}`;
    const expectedSignature = await this.sign(dataToSign);

    // Constant-time comparison to prevent timing attacks
    return this.constantTimeEquals(parsed.signature, expectedSignature);
  }

  /**
   * Parse a token string into its components.
   *
   * @param token The token string to parse
   * @returns Parsed token or null if invalid format
   */
  private parseToken(token: string): ParsedToken | null {
    if (!token || typeof token !== "string") {
      return null;
    }

    const parts = token.split(".");
    if (parts.length !== 3) {
      return null;
    }

    const [random, timestampStr, signature] = parts;

    // Validate random part (should be base64url)
    if (!random || !/^[A-Za-z0-9_-]+$/.test(random)) {
      return null;
    }

    // Validate timestamp
    const timestamp = parseInt(timestampStr, 10);
    if (isNaN(timestamp) || timestamp <= 0) {
      return null;
    }

    // Validate signature format (should be base64url)
    if (!signature || !/^[A-Za-z0-9_-]+$/.test(signature)) {
      return null;
    }

    return { random, timestamp, signature };
  }

  /**
   * Sign data using HMAC-SHA256.
   */
  private async sign(data: string): Promise<string> {
    const key = await this.getCryptoKey();
    const encoder = new TextEncoder();
    const dataBytes = encoder.encode(data);

    const signatureBuffer = await crypto.subtle.sign("HMAC", key, dataBytes);
    return this.toBase64Url(new Uint8Array(signatureBuffer));
  }

  /**
   * Convert bytes to base64url encoding.
   */
  private toBase64Url(bytes: Uint8Array): string {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
  }

  /**
   * Constant-time string comparison to prevent timing attacks.
   */
  private constantTimeEquals(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }

    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
  }
}
