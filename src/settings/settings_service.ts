import { Mutex } from "@core/asyncutil/mutex";
import type { SurrealConnectionFactory } from "../database/surreal_connection_factory.ts";
import type { IEncryptionService } from "../encryption/types.ts";
import {
  type SettingName,
  GlobalSettingDefaults,
} from "./types.ts";
import { RecordId } from "surrealdb";

/** SurrealDB setting record shape */
interface Setting {
  name: string;
  value: string;
  isEncrypted: boolean;
  updatedAt: string;
}

/**
 * Options for constructing a SettingsService.
 */
export interface SettingsServiceOptions {
  surrealFactory: SurrealConnectionFactory;
  encryptionService?: IEncryptionService;
  namespace?: string;  // Default "system"
  database?: string;   // Default "system"
}

const tableName = "setting";

/**
 * Service for managing application settings stored in SurrealDB.
 *
 * Settings are global only - user-specific settings have been temporarily removed.
 * Values are stored as strings and parsed by consumers as needed.
 *
 * Supports optional encryption for sensitive settings (via isEncrypted flag).
 * Uses RecordID-based direct access for O(1) lookups.
 *
 * Write operations are mutex-protected to prevent SurrealDB transaction conflicts
 * when multiple concurrent writes target the same setting.
 */
export class SettingsService {
  private readonly surrealFactory: SurrealConnectionFactory;
  private readonly encryptionService?: IEncryptionService;
  private readonly namespace: string;
  private readonly database: string;
  private readonly writeMutex = new Mutex();

  constructor(options: SettingsServiceOptions) {
    this.surrealFactory = options.surrealFactory;
    this.encryptionService = options.encryptionService;
    this.namespace = options.namespace ?? "system";
    this.database = options.database ?? "system";
  }

  // ============== Read Operations ==============

  /**
   * Read a global setting by name.
   * @param name - The setting name
   * @returns The setting value, or null if not found
   */
  async getGlobalSetting(name: SettingName): Promise<string | undefined> {
    const db = await this.surrealFactory.connect({
      namespace: this.namespace,
      database: this.database,
    });

    try {
      const settingId = new RecordId("setting", name);
      const result = await db.query<[Setting | undefined]>(
        `RETURN $settingId.*`,
        { settingId: settingId }
      );

      console.log("Get query result:", result)

      const setting = result[0];
      if (!setting) return undefined;

      

      // Decrypt if needed
      if (setting.isEncrypted && this.encryptionService) {
        return await this.encryptionService.decrypt(setting.value);
      }

      return setting.value;
    } finally {
      await db.close();
    }
  }

  // ============== Write Operations ==============

  /**
   * Set a global setting (upsert - insert or update if exists).
   * Mutex-protected to prevent transaction conflicts on concurrent writes.
   * @param name - The setting name
   * @param value - The value to store
   * @param encrypted - Whether to encrypt the value (default: false)
   */
  async setGlobalSetting(
    name: SettingName,
    value: string,
    encrypted = false
  ): Promise<void> {
    using _lock = await this.writeMutex.acquire();

    const finalValue =
      encrypted && this.encryptionService
        ? await this.encryptionService.encrypt(value)
        : value;

    const db = await this.surrealFactory.connect({
      namespace: this.namespace,
      database: this.database,
    });

    const settingId = new RecordId("setting", name);

    try {
      const response = await db.query(
        `UPSERT $settingId SET
          name = $name,
          value = $newValue,
          isEncrypted = $encrypted`,
        {
          settingId,
          name,
          newValue: finalValue,
          encrypted,
        }
      );
      console.log("Set query result:", response)
    } finally {
      await db.close();
    }
  }

  /**
   * Set multiple global settings at once.
   * Mutex-protected to prevent transaction conflicts.
   * @param settings - Map of setting names to values
   */
  async setGlobalSettingsBatch(settings: Map<SettingName, string>): Promise<void> {
    using _lock = await this.writeMutex.acquire();

    const db = await this.surrealFactory.connect({
      namespace: this.namespace,
      database: this.database,
    });

    try {
      for (const [name, value] of settings) {
        const settingId = new RecordId("setting", name);
        await db.query(
          `UPSERT $settingId SET
            name = $name,
            value = $newValue,
            isEncrypted = false`,
          { settingId, name, newValue: value }
        );
      }
    } finally {
      await db.close();
    }
  }

  // ============== Batch Read Operations ==============

  /**
   * Get all global settings as a Map.
   * @returns Map of setting names to values
   */
  async getAllGlobalSettings(): Promise<Map<SettingName, string>> {
    const db = await this.surrealFactory.connect({
      namespace: this.namespace,
      database: this.database,
    });

    try {
      // Table scan - acceptable for settings UI (low frequency)
      const result = await db.query<[Setting[]]>("SELECT * FROM setting");
      const settings = result?.[0] ?? [];
      const resultMap = new Map<SettingName, string>();

      for (const setting of settings) {
        if (!setting.value) continue;

        // Decrypt if needed
        const value = setting.isEncrypted && this.encryptionService
          ? await this.encryptionService.decrypt(setting.value)
          : setting.value;

        resultMap.set(setting.name as SettingName, value);
      }

      return resultMap;
    } finally {
      await db.close();
    }
  }

  // ============== Reset Operations ==============

  /**
   * Reset global settings to their default values.
   * Mutex-protected to prevent transaction conflicts.
   * @param names - Array of setting names to reset
   */
  async resetGlobalSettings(names: SettingName[]): Promise<void> {
    using _lock = await this.writeMutex.acquire();

    const db = await this.surrealFactory.connect({
      namespace: this.namespace,
      database: this.database,
    });

    try {
      for (const name of names) {
        const settingId = new RecordId("setting", name);
        const defaultValue = GlobalSettingDefaults[name];
        await db.query(
          `UPSERT $settingId SET
            name = $name,
            value = $newValue,
            isEncrypted = false`,
          { settingId, name, newValue: defaultValue }
        );
      }
    } finally {
      await db.close();
    }
  }

  // ============== Bootstrap Operations ==============

  /**
   * Create all global settings with default values if they don't exist.
   * Called during application startup to ensure all settings are present.
   * Idempotent - won't overwrite existing values.
   * Mutex-protected to prevent transaction conflicts.
   */
  async bootstrapGlobalSettings(): Promise<void> {
    using _lock = await this.writeMutex.acquire();

    const db = await this.surrealFactory.connect({
      namespace: this.namespace,
      database: this.database,
    });

    try {
      for (const [name, defaultValue] of Object.entries(GlobalSettingDefaults)) {
        const settingId = new RecordId("setting", name);

        // INSERT IGNORE skips if record already exists, preserving existing values
        await db.query(
          `INSERT IGNORE INTO setting {
            id: $settingId,
            name: $name,
            value: $newValue,
            isEncrypted: false
          }`,
          { settingId, name, newValue: defaultValue }
        );
      }
    } finally {
      await db.close();
    }
  }
}
