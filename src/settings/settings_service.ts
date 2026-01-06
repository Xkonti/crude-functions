import type { DatabaseService } from "../database/database_service.ts";
import type { IEncryptionService } from "../encryption/types.ts";
import {
  type SettingName,
  GlobalSettingDefaults,
} from "./types.ts";

/** Database row shape for settings queries */
interface SettingRow {
  id: number;
  name: string;
  user_id: string | null;
  value: string | null;
  is_encrypted: number;
  modified_at: string;
  [key: string]: unknown; // Index signature for Row compatibility
}

/**
 * Options for constructing a SettingsService.
 */
export interface SettingsServiceOptions {
  db: DatabaseService;
  /** Optional encryption service for encrypted settings (future use) */
  encryptionService?: IEncryptionService;
}

/**
 * Service for managing application settings stored in the database.
 *
 * Settings can be global (user_id is NULL) or user-specific.
 * Values are stored as strings and parsed by consumers as needed.
 *
 * Supports optional encryption for sensitive settings (via is_encrypted flag).
 */
export class SettingsService {
  private readonly db: DatabaseService;
  private readonly encryptionService?: IEncryptionService;

  constructor(options: SettingsServiceOptions) {
    this.db = options.db;
    this.encryptionService = options.encryptionService;
  }

  // ============== Read Operations ==============

  /**
   * Read a global setting by name.
   * @param name - The setting name
   * @returns The setting value, or null if not found
   */
  async getGlobalSetting(name: SettingName): Promise<string | null> {
    const row = await this.db.queryOne<SettingRow>(
      `SELECT * FROM settings WHERE name = ? AND user_id IS NULL`,
      [name]
    );

    if (!row) return null;

    // Handle encrypted values
    if (row.is_encrypted && this.encryptionService && row.value) {
      return await this.encryptionService.decrypt(row.value);
    }

    return row.value;
  }

  /**
   * Read a user-specific setting by name.
   * @param name - The setting name
   * @param userId - The user ID
   * @returns The setting value, or null if not found
   */
  async getUserSetting(name: SettingName, userId: string): Promise<string | null> {
    const row = await this.db.queryOne<SettingRow>(
      `SELECT * FROM settings WHERE name = ? AND user_id = ?`,
      [name, userId]
    );

    if (!row) return null;

    // Handle encrypted values
    if (row.is_encrypted && this.encryptionService && row.value) {
      return await this.encryptionService.decrypt(row.value);
    }

    return row.value;
  }

  // ============== Write Operations ==============

  /**
   * Set a global setting (upsert - insert or update if exists).
   * @param name - The setting name
   * @param value - The value to store
   * @param encrypted - Whether to encrypt the value (default: false)
   */
  async setGlobalSetting(
    name: SettingName,
    value: string,
    encrypted = false
  ): Promise<void> {
    const finalValue =
      encrypted && this.encryptionService
        ? await this.encryptionService.encrypt(value)
        : value;

    await this.db.execute(
      `INSERT INTO settings (name, user_id, value, is_encrypted, modified_at)
       VALUES (?, NULL, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT (name, COALESCE(user_id, ''))
       DO UPDATE SET value = ?, is_encrypted = ?, modified_at = CURRENT_TIMESTAMP`,
      [name, finalValue, encrypted ? 1 : 0, finalValue, encrypted ? 1 : 0]
    );
  }

  /**
   * Set a user-specific setting (upsert - insert or update if exists).
   * @param name - The setting name
   * @param userId - The user ID
   * @param value - The value to store
   * @param encrypted - Whether to encrypt the value (default: false)
   */
  async setUserSetting(
    name: SettingName,
    userId: string,
    value: string,
    encrypted = false
  ): Promise<void> {
    const finalValue =
      encrypted && this.encryptionService
        ? await this.encryptionService.encrypt(value)
        : value;

    await this.db.execute(
      `INSERT INTO settings (name, user_id, value, is_encrypted, modified_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT (name, COALESCE(user_id, ''))
       DO UPDATE SET value = ?, is_encrypted = ?, modified_at = CURRENT_TIMESTAMP`,
      [name, userId, finalValue, encrypted ? 1 : 0, finalValue, encrypted ? 1 : 0]
    );
  }

  // ============== Bootstrap Operations ==============

  /**
   * Create all global settings with default values if they don't exist.
   * Called during application startup to ensure all settings are present.
   */
  async bootstrapGlobalSettings(): Promise<void> {
    for (const [name, defaultValue] of Object.entries(GlobalSettingDefaults)) {
      const existing = await this.db.queryOne<{ id: number }>(
        `SELECT id FROM settings WHERE name = ? AND user_id IS NULL`,
        [name]
      );

      if (!existing) {
        await this.db.execute(
          `INSERT INTO settings (name, user_id, value, is_encrypted, modified_at)
           VALUES (?, NULL, ?, 0, CURRENT_TIMESTAMP)`,
          [name, defaultValue]
        );
      }
    }
  }

  /**
   * Bootstrap user-specific settings for a given user.
   * Currently a no-op as no user settings are defined yet.
   * @param _userId - The user ID (unused for now)
   */
  bootstrapUserSettings(_userId: string): Promise<void> {
    // No user-specific settings defined yet
    return Promise.resolve();
  }
}
