import type { DatabaseService } from "../database/database_service.ts";

/**
 * Represents an API key with its metadata
 */
export interface ApiKey {
  /** Unique identifier for the key (used for deletion) */
  id: number;
  /** The actual key value */
  value: string;
  /** Optional description of the key's purpose */
  description?: string;
}

// Key groups: lowercase a-z, 0-9, underscore, dash
const KEY_GROUP_REGEX = /^[a-z0-9_-]+$/;

// Key values: a-z, A-Z, 0-9, underscore, dash
const KEY_VALUE_REGEX = /^[a-zA-Z0-9_-]+$/;

/**
 * Validates that a key group name contains only allowed characters
 */
export function validateKeyGroup(group: string): boolean {
  return KEY_GROUP_REGEX.test(group);
}

/**
 * Validates that a key value contains only allowed characters
 */
export function validateKeyValue(value: string): boolean {
  return KEY_VALUE_REGEX.test(value);
}

export interface ApiKeyServiceOptions {
  /** Database service instance */
  db: DatabaseService;
  /** Management API key from environment variable (optional) */
  managementKeyFromEnv?: string;
}

/** Synthetic ID for environment-provided management key */
const ENV_KEY_ID = -1;

/**
 * Service for managing API keys stored in SQLite database.
 * No caching - always reads from database for simplicity and consistency.
 */
export class ApiKeyService {
  private readonly db: DatabaseService;
  private readonly managementKeyFromEnv?: string;

  constructor(options: ApiKeyServiceOptions) {
    this.db = options.db;
    this.managementKeyFromEnv = options.managementKeyFromEnv;
  }

  /**
   * Get all API keys grouped by their group name.
   * Includes environment-provided management key if configured.
   */
  async getAll(): Promise<Map<string, ApiKey[]>> {
    const rows = await this.db.queryAll<{
      id: number;
      key_group: string;
      value: string;
      description: string | null;
    }>("SELECT id, key_group, value, description FROM api_keys ORDER BY key_group, value");

    const result = new Map<string, ApiKey[]>();
    for (const row of rows) {
      const existing = result.get(row.key_group) || [];
      existing.push({
        id: row.id,
        value: row.value,
        description: row.description ?? undefined,
      });
      result.set(row.key_group, existing);
    }

    // Merge env management key if present
    if (this.managementKeyFromEnv) {
      const mgmtKeys = result.get("management") || [];
      if (!mgmtKeys.some((k) => k.value === this.managementKeyFromEnv)) {
        mgmtKeys.push({
          id: ENV_KEY_ID,
          value: this.managementKeyFromEnv,
          description: "from environment",
        });
        result.set("management", mgmtKeys);
      }
    }

    return result;
  }

  /**
   * Get all API keys for a specific group.
   * @param group - The group name (will be normalized to lowercase)
   * @returns Array of keys or null if group doesn't exist
   */
  async getKeys(group: string): Promise<ApiKey[] | null> {
    const normalizedGroup = group.toLowerCase();
    const rows = await this.db.queryAll<{
      id: number;
      value: string;
      description: string | null;
    }>("SELECT id, value, description FROM api_keys WHERE key_group = ?", [
      normalizedGroup,
    ]);

    const keys: ApiKey[] = rows.map((r) => ({
      id: r.id,
      value: r.value,
      description: r.description ?? undefined,
    }));

    // Add env key for management group
    if (normalizedGroup === "management" && this.managementKeyFromEnv) {
      if (!keys.some((k) => k.value === this.managementKeyFromEnv)) {
        keys.push({
          id: ENV_KEY_ID,
          value: this.managementKeyFromEnv,
          description: "from environment",
        });
      }
    }

    return keys.length > 0 ? keys : null;
  }

  /**
   * Check if a specific key value exists in a group.
   * @param group - The group name (will be normalized to lowercase)
   * @param keyValue - The key value to check
   */
  async hasKey(group: string, keyValue: string): Promise<boolean> {
    const normalizedGroup = group.toLowerCase();

    // Check env key first
    if (
      normalizedGroup === "management" &&
      keyValue === this.managementKeyFromEnv
    ) {
      return true;
    }

    const row = await this.db.queryOne(
      "SELECT 1 FROM api_keys WHERE key_group = ? AND value = ?",
      [normalizedGroup, keyValue]
    );
    return row !== null;
  }

  /**
   * Add a new API key to a group.
   * Silently ignores if the exact (group, value) pair already exists.
   * @param group - The group name (will be normalized to lowercase)
   * @param value - The key value
   * @param description - Optional description
   */
  async addKey(
    group: string,
    value: string,
    description?: string
  ): Promise<void> {
    const normalizedGroup = group.toLowerCase();
    // Use INSERT OR IGNORE to handle duplicate (group, value) silently
    await this.db.execute(
      "INSERT OR IGNORE INTO api_keys (key_group, value, description) VALUES (?, ?, ?)",
      [normalizedGroup, value, description ?? null]
    );
  }

  /**
   * Remove a specific key by group and value.
   * @param group - The group name (will be normalized to lowercase)
   * @param keyValue - The key value to remove
   * @throws Error if attempting to remove environment-provided management key
   */
  async removeKey(group: string, keyValue: string): Promise<void> {
    const normalizedGroup = group.toLowerCase();

    // Cannot remove env management key
    if (
      normalizedGroup === "management" &&
      keyValue === this.managementKeyFromEnv
    ) {
      throw new Error("Cannot remove environment-provided management key");
    }

    await this.db.execute(
      "DELETE FROM api_keys WHERE key_group = ? AND value = ?",
      [normalizedGroup, keyValue]
    );
  }

  /**
   * Remove a key by its unique ID.
   * Useful for web UI where passing the key value over the wire is undesirable.
   * @param id - The unique key ID
   * @throws Error if attempting to remove environment-provided management key (id = -1)
   */
  async removeKeyById(id: number): Promise<void> {
    // Cannot remove env management key
    if (id === ENV_KEY_ID) {
      throw new Error("Cannot remove environment-provided management key");
    }

    await this.db.execute("DELETE FROM api_keys WHERE id = ?", [id]);
  }

  /**
   * Remove all keys in a group.
   * @param group - The group name (will be normalized to lowercase)
   */
  async removeGroup(group: string): Promise<void> {
    const normalizedGroup = group.toLowerCase();
    await this.db.execute("DELETE FROM api_keys WHERE key_group = ?", [
      normalizedGroup,
    ]);
  }
}
