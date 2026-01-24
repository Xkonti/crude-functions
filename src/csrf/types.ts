/**
 * Types for CSRF protection.
 */

/**
 * Options for creating the CSRF service.
 */
export interface CsrfServiceOptions {
  /**
   * Secret key used for signing tokens (base64 encoded).
   * Should be the hash_key from KeyStorageService.
   */
  secret: string;

  /**
   * Token validity duration in milliseconds.
   * Default: 24 hours (86400000ms)
   */
  tokenValidityMs?: number;
}

/**
 * Parsed CSRF token structure.
 */
export interface ParsedToken {
  /** Random bytes (base64url encoded) */
  random: string;
  /** Timestamp when token was created (Unix ms) */
  timestamp: number;
  /** HMAC signature (base64url encoded) */
  signature: string;
}
