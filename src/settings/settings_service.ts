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
  userId: string | null;
  value: string | null;
  isEncrypted: number;
  updatedAt: string;
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
 * Settings can be global (userId is NULL) or user-specific.
 * Values are stored as strings and parsed by consumers as needed.
 *
 * Supports optional encryption for sensitive settings (via isEncrypted flag).
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
      `SELECT * FROM settings WHERE name = ? AND userId IS NULL`,
      [name]
    );

    if (!row) return null;

    // Handle encrypted values
    if (row.isEncrypted && this.encryptionService && row.value) {
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
      `SELECT * FROM settings WHERE name = ? AND userId = ?`,
      [name, userId]
    );

    if (!row) return null;

    // Handle encrypted values
    if (row.isEncrypted && this.encryptionService && row.value) {
      return await this.encryptionService.decrypt(row.value);
    }

    return row.value;
  }

  /**
   * Get all global settings.
   * @returns Record of setting names to values
   */
  async getAllGlobalSettings(): Promise<Record<string, string>> {
    const rows = await this.db.queryAll<SettingRow>(
      `SELECT * FROM settings WHERE userId IS NULL`
    );

    const result: Record<string, string> = {};
    for (const row of rows) {
      let value = row.value ?? "";

      // Handle encrypted values
      if (row.isEncrypted && this.encryptionService && value) {
        value = await this.encryptionService.decrypt(value);
      }

      result[row.name] = value;
    }

    return result;
  }

  /**
   * Get all user-specific settings for a given user.
   * @param userId - The user ID
   * @returns Record of setting names to values
   */
  async getAllUserSettings(userId: string): Promise<Record<string, string>> {
    const rows = await this.db.queryAll<SettingRow>(
      `SELECT * FROM settings WHERE userId = ?`,
      [userId]
    );

    const result: Record<string, string> = {};
    for (const row of rows) {
      let value = row.value ?? "";

      // Handle encrypted values
      if (row.isEncrypted && this.encryptionService && value) {
        value = await this.encryptionService.decrypt(value);
      }

      result[row.name] = value;
    }

    return result;
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
      `INSERT INTO settings (name, userId, value, isEncrypted, updatedAt)
       VALUES (?, NULL, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT (name, COALESCE(userId, ''))
       DO UPDATE SET value = ?, isEncrypted = ?, updatedAt = CURRENT_TIMESTAMP`,
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
      `INSERT INTO settings (name, userId, value, isEncrypted, updatedAt)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT (name, COALESCE(userId, ''))
       DO UPDATE SET value = ?, isEncrypted = ?, updatedAt = CURRENT_TIMESTAMP`,
      [name, userId, finalValue, encrypted ? 1 : 0, finalValue, encrypted ? 1 : 0]
    );
  }

  /**
   * Set multiple global settings in a single transaction.
   * If any setting update fails, all changes are rolled back.
   * Settings are stored unencrypted (encrypted=false).
   * @param settings - Record of setting names to values
   * @throws Error if transaction fails or any setting name is invalid
   */
  async setGlobalSettings(settings: Record<string, string>): Promise<void> {
    await this.db.transaction(async (tx) => {
      for (const [name, value] of Object.entries(settings)) {
        await tx.execute(
          `INSERT INTO settings (name, userId, value, isEncrypted, updatedAt)
           VALUES (?, NULL, ?, 0, CURRENT_TIMESTAMP)
           ON CONFLICT (name, COALESCE(userId, ''))
           DO UPDATE SET value = ?, isEncrypted = 0, updatedAt = CURRENT_TIMESTAMP`,
          [name, value, value]
        );
      }
    });
  }

  /**
   * Set multiple user-specific settings in a single transaction.
   * If any setting update fails, all changes are rolled back.
   * Settings are stored unencrypted (encrypted=false).
   * @param userId - The user ID
   * @param settings - Record of setting names to values
   * @throws Error if transaction fails or any setting name is invalid
   */
  async setUserSettings(userId: string, settings: Record<string, string>): Promise<void> {
    await this.db.transaction(async (tx) => {
      for (const [name, value] of Object.entries(settings)) {
        await tx.execute(
          `INSERT INTO settings (name, userId, value, isEncrypted, updatedAt)
           VALUES (?, ?, ?, 0, CURRENT_TIMESTAMP)
           ON CONFLICT (name, COALESCE(userId, ''))
           DO UPDATE SET value = ?, isEncrypted = 0, updatedAt = CURRENT_TIMESTAMP`,
          [name, userId, value, value]
        );
      }
    });
  }

  // ============== Bootstrap Operations ==============

  /**
   * Create all global settings with default values if they don't exist.
   * Called during application startup to ensure all settings are present.
   */
  async bootstrapGlobalSettings(): Promise<void> {
    for (const [name, defaultValue] of Object.entries(GlobalSettingDefaults)) {
      const existing = await this.db.queryOne<{ id: number }>(
        `SELECT id FROM settings WHERE name = ? AND userId IS NULL`,
        [name]
      );

      if (!existing) {
        await this.db.execute(
          `INSERT INTO settings (name, userId, value, isEncrypted, updatedAt)
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
