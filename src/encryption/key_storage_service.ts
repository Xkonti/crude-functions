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
   */
  async loadKeys(): Promise<EncryptionKeyFile | null> {
    try {
      const content = await Deno.readTextFile(this.keyFilePath);
      return JSON.parse(content) as EncryptionKeyFile;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Save keys to the JSON file.
   * @param keys - The key file contents to save.
   */
  async saveKeys(keys: EncryptionKeyFile): Promise<void> {
    const content = JSON.stringify(keys, null, 2);
    await Deno.writeTextFile(this.keyFilePath, content);
    logger.debug("[KeyStorage] Keys saved to file");
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

    // Generate both encryption key and auth secret
    const [encryptionKey, authSecret] = await Promise.all([
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
}
