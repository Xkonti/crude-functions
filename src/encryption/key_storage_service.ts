/**
 * Service for managing encryption key storage.
 *
 * Handles reading/writing the encryption keys JSON file,
 * generating new keys, and managing key versions.
 */

import type {
  EncryptionKeyFile,
  KeyStorageServiceOptions,
} from "./key_storage_types.ts";
import { logger } from "../utils/logger.ts";
import { InvalidKeyError, KeyStorageCorruptionError } from "./errors.ts";

const DEFAULT_KEY_FILE_PATH = "./data/encryption-keys.json";
const INITIAL_VERSION = "A";

/**
 * Service for managing encryption key storage and generation.
 *
 * Keys are stored in a JSON file separate from the database for security:
 * if the database is compromised, the encryption keys remain protected.
 */
export class KeyStorageService {
  private readonly keyFilePath: string;
  private readonly customKeyGenerator?: () => Promise<string>;

  constructor(options?: KeyStorageServiceOptions) {
    this.keyFilePath = options?.keyFilePath ?? DEFAULT_KEY_FILE_PATH;
    this.customKeyGenerator = options?.keyGenerator;
  }

  /**
   * Load keys from the JSON file.
   * @returns The key file contents, or null if the file doesn't exist.
   * @throws KeyStorageCorruptionError if the file is corrupted or invalid
   */
  async loadKeys(): Promise<EncryptionKeyFile | null> {
    try {
      const content = await Deno.readTextFile(this.keyFilePath);

      // Try to parse JSON
      let keys: EncryptionKeyFile;
      try {
        keys = JSON.parse(content) as EncryptionKeyFile;
      } catch (parseError) {
        throw new KeyStorageCorruptionError(
          "Failed to parse encryption keys file. The file may be corrupted. " +
          "Restore from your backup and restart the application.",
          parseError
        );
      }

      // Validate structure
      try {
        this.validateKeysStructure(keys);
      } catch (validationError) {
        throw new KeyStorageCorruptionError(
          "Encryption keys file has invalid structure. " +
          "Restore from your backup and restart the application.",
          validationError
        );
      }

      // Generate hash key if missing (for upgrades from older versions)
      if (!keys.hash_key) {
        logger.info("[KeyStorage] hash_key missing, generating...");
        keys.hash_key = await this.generateKey();
        await this.saveKeys(keys);
        logger.info("[KeyStorage] hash_key generated and saved");
      }

      return keys;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return null;
      }
      // Re-throw KeyStorageCorruptionError and InvalidKeyError as-is
      if (error instanceof KeyStorageCorruptionError || error instanceof InvalidKeyError) {
        throw error;
      }
      throw error;
    }
  }

  /**
   * Save keys to the JSON file using atomic write (write-to-temp-then-rename).
   * Creates the parent directory if it doesn't exist.
   * @param keys - The key file contents to save.
   * @throws InvalidKeyError if keys validation fails
   */
  async saveKeys(keys: EncryptionKeyFile): Promise<void> {
    // Validate keys structure before writing
    this.validateKeysStructure(keys);

    // Ensure parent directory exists
    const parentDir = this.keyFilePath.substring(0, this.keyFilePath.lastIndexOf("/"));
    if (parentDir) {
      try {
        await Deno.mkdir(parentDir, { recursive: true });
      } catch (error) {
        // Ignore if directory already exists
        if (!(error instanceof Deno.errors.AlreadyExists)) {
          throw error;
        }
      }
    }

    // Atomic write using temp-then-rename pattern
    // Create temp file in same directory (required for atomic rename)
    const tempFile = await Deno.makeTempFile({
      dir: parentDir || ".",
      prefix: ".encryption-keys.tmp.",
      suffix: ".json",
    });

    try {
      // Write to temp file
      const content = JSON.stringify(keys, null, 2);
      await Deno.writeTextFile(tempFile, content);

      // Fsync to ensure data is on disk before rename
      const file = await Deno.open(tempFile, { read: true, write: true });
      try {
        await file.sync();
      } finally {
        file.close();
      }

      // Atomic rename (POSIX guarantee)
      await Deno.rename(tempFile, this.keyFilePath);

      logger.debug("[KeyStorage] Keys saved atomically to file");
    } catch (error) {
      // Cleanup temp file on any error
      try {
        await Deno.remove(tempFile);
      } catch {
        // Ignore cleanup errors
      }
      throw error;
    }
  }

  /**
   * Generate a new 256-bit encryption key.
   * Uses custom key generator if provided, otherwise uses openssl.
   * @returns Base64-encoded 32-byte key.
   */
  async generateKey(): Promise<string> {
    // Use custom generator if provided (for testing)
    if (this.customKeyGenerator) {
      return this.customKeyGenerator();
    }

    const command = new Deno.Command("openssl", {
      args: ["rand", "-base64", "32"],
      stdout: "piped",
      stderr: "piped",
    });

    const { code, stdout, stderr } = await command.output();

    if (code !== 0) {
      const errorText = new TextDecoder().decode(stderr);
      throw new Error(`Failed to generate key: ${errorText}`);
    }

    // Remove trailing newline from openssl output
    const key = new TextDecoder().decode(stdout).trim();
    return key;
  }

  /**
   * Get the next version letter in sequence.
   * Wraps from Z back to A.
   * @param current - The current version letter (A-Z).
   * @returns The next version letter.
   */
  getNextVersion(current: string): string {
    if (current.length !== 1 || current < "A" || current > "Z") {
      throw new Error(`Invalid version character: ${current}`);
    }

    // A=65, Z=90. Wrap Z (90) back to A (65)
    const charCode = current.charCodeAt(0);
    const nextCharCode = charCode === 90 ? 65 : charCode + 1;
    return String.fromCharCode(nextCharCode);
  }

  /**
   * Ensure the keys file exists and is initialized.
   * If the file doesn't exist, generates initial keys.
   * @returns The key file contents (existing or newly created).
   */
  async ensureInitialized(): Promise<EncryptionKeyFile> {
    const existingKeys = await this.loadKeys();
    if (existingKeys) {
      logger.info(
        `[KeyStorage] Loaded existing keys (version ${existingKeys.current_version})`
      );
      return existingKeys;
    }

    logger.info("[KeyStorage] No keys file found, generating initial keys...");

    // Generate encryption key, auth secret, and hash key
    const [encryptionKey, authSecret, hashKey] = await Promise.all([
      this.generateKey(),
      this.generateKey(),
      this.generateKey(),
    ]);

    const keys: EncryptionKeyFile = {
      current_key: encryptionKey,
      current_version: INITIAL_VERSION,
      phased_out_key: null,
      phased_out_version: null,
      last_rotation_finished_at: new Date().toISOString(),
      better_auth_secret: authSecret,
      hash_key: hashKey,
    };

    await this.saveKeys(keys);
    logger.info(
      `[KeyStorage] Generated initial keys (version ${INITIAL_VERSION})`
    );

    return keys;
  }

  /**
   * Check if a rotation is currently in progress.
   * A rotation is in progress if both current and phased_out keys exist.
   */
  isRotationInProgress(keys: EncryptionKeyFile): boolean {
    return keys.phased_out_key !== null && keys.phased_out_version !== null;
  }

  /**
   * Get the path to the keys file.
   */
  get path(): string {
    return this.keyFilePath;
  }

  /**
   * Validate the structure and format of encryption keys.
   * @param keys - The keys object to validate
   * @throws InvalidKeyError if validation fails
   */
  private validateKeysStructure(keys: EncryptionKeyFile): void {
    // Validate required fields exist
    if (!keys.current_key || typeof keys.current_key !== "string") {
      throw new InvalidKeyError("Missing or invalid current_key");
    }
    if (!keys.current_version || typeof keys.current_version !== "string") {
      throw new InvalidKeyError("Missing or invalid current_version");
    }
    if (!keys.better_auth_secret || typeof keys.better_auth_secret !== "string") {
      throw new InvalidKeyError("Missing or invalid better_auth_secret");
    }
    if (!keys.hash_key || typeof keys.hash_key !== "string") {
      throw new InvalidKeyError("Missing or invalid hash_key");
    }
    if (!keys.last_rotation_finished_at || typeof keys.last_rotation_finished_at !== "string") {
      throw new InvalidKeyError("Missing or invalid last_rotation_finished_at");
    }

    // Validate current_version format (A-Z)
    if (
      keys.current_version.length !== 1 ||
      keys.current_version < "A" ||
      keys.current_version > "Z"
    ) {
      throw new InvalidKeyError(
        `Invalid current_version: must be A-Z, got "${keys.current_version}"`
      );
    }

    // Validate phased_out fields (both must be present or both null)
    const hasPhasedOutKey = keys.phased_out_key !== null;
    const hasPhasedOutVersion = keys.phased_out_version !== null;
    if (hasPhasedOutKey !== hasPhasedOutVersion) {
      throw new InvalidKeyError(
        "Partial phased_out configuration: both phased_out_key and phased_out_version must be provided together, or both null"
      );
    }

    // Validate phased_out_version format if present
    if (
      keys.phased_out_version &&
      (keys.phased_out_version.length !== 1 ||
        keys.phased_out_version < "A" ||
        keys.phased_out_version > "Z")
    ) {
      throw new InvalidKeyError(
        `Invalid phased_out_version: must be A-Z, got "${keys.phased_out_version}"`
      );
    }

    // Validate versions are not the same
    if (keys.phased_out_version && keys.phased_out_version === keys.current_version) {
      throw new InvalidKeyError(
        `Current and phased_out versions cannot be the same: "${keys.current_version}"`
      );
    }

    // Validate base64 format (basic check - should decode without error)
    try {
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();

      // Validate current_key is valid base64
      atob(keys.current_key);

      // Validate better_auth_secret is valid base64
      atob(keys.better_auth_secret);

      // Validate hash_key is valid base64
      atob(keys.hash_key);

      // Validate phased_out_key if present
      if (keys.phased_out_key) {
        atob(keys.phased_out_key);
      }
    } catch (error) {
      throw new InvalidKeyError(
        `Invalid base64 encoding in key data: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    // Validate timestamp format (should be valid ISO string)
    const timestamp = new Date(keys.last_rotation_finished_at);
    if (isNaN(timestamp.getTime())) {
      throw new InvalidKeyError(
        `Invalid last_rotation_finished_at timestamp: "${keys.last_rotation_finished_at}"`
      );
    }
  }
}
