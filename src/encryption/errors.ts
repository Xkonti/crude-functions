/**
 * Thrown when encryption operation fails
 */
export class EncryptionError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "EncryptionError";
    this.cause = cause;
  }
}

/**
 * Thrown when decryption operation fails
 * Could indicate data tampering, wrong key, or corrupted data
 */
export class DecryptionError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "DecryptionError";
    this.cause = cause;
  }
}

/**
 * Thrown when encryption key is invalid format or length
 */
export class InvalidKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidKeyError";
  }
}
