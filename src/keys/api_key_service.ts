import type { DatabaseService } from "../database/database_service.ts";

/**
 * Represents an API key group
 */
export interface ApiKeyGroup {
  /** Unique identifier for the group */
  id: number;
  /** Group name (lowercase alphanumeric with dashes/underscores) */
  name: string;
  /** Optional description */
  description?: string;
}

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
 * Service for managing API keys and key groups stored in SQLite database.
 * No caching - always reads from database for simplicity and consistency.
 */
export class ApiKeyService {
  private readonly db: DatabaseService;
  private readonly managementKeyFromEnv?: string;

  constructor(options: ApiKeyServiceOptions) {
    this.db = options.db;
    this.managementKeyFromEnv = options.managementKeyFromEnv;
  }

  // ============== Group Operations ==============

  /**
   * Get all API key groups.
   */
  async getGroups(): Promise<ApiKeyGroup[]> {
    const rows = await this.db.queryAll<{
      id: number;
      name: string;
      description: string | null;
    }>("SELECT id, name, description FROM api_key_groups ORDER BY name");

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
    }));
  }

  /**
   * Get a group by name.
   */
  async getGroupByName(name: string): Promise<ApiKeyGroup | null> {
    const normalizedName = name.toLowerCase();
    const row = await this.db.queryOne<{
      id: number;
      name: string;
      description: string | null;
    }>("SELECT id, name, description FROM api_key_groups WHERE name = ?", [
      normalizedName,
    ]);

    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
    };
  }

  /**
   * Get a group by ID.
   */
  async getGroupById(id: number): Promise<ApiKeyGroup | null> {
    const row = await this.db.queryOne<{
      id: number;
      name: string;
      description: string | null;
    }>("SELECT id, name, description FROM api_key_groups WHERE id = ?", [id]);

    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
    };
  }

  /**
   * Create a new group.
   * @returns The ID of the created group
   */
  async createGroup(name: string, description?: string): Promise<number> {
    const normalizedName = name.toLowerCase();
    const result = await this.db.execute(
      "INSERT INTO api_key_groups (name, description) VALUES (?, ?)",
      [normalizedName, description ?? null]
    );
    return Number(result.lastInsertRowId);
  }

  /**
   * Update a group's description.
   */
  async updateGroup(id: number, description: string): Promise<void> {
    await this.db.execute(
      "UPDATE api_key_groups SET description = ? WHERE id = ?",
      [description, id]
    );
  }

  /**
   * Delete a group by ID. Cascades to all keys in the group.
   */
  async deleteGroup(id: number): Promise<void> {
    await this.db.execute("DELETE FROM api_key_groups WHERE id = ?", [id]);
  }

  /**
   * Get or create a group by name.
   * @returns The group ID
   */
  async getOrCreateGroup(name: string, description?: string): Promise<number> {
    const normalizedName = name.toLowerCase();
    const existing = await this.getGroupByName(normalizedName);
    if (existing) {
      return existing.id;
    }
    return this.createGroup(normalizedName, description);
  }

  // ============== Key Operations ==============

  /**
   * Get all API keys grouped by their group name.
   * Includes environment-provided management key if configured.
   */
  async getAll(): Promise<Map<string, ApiKey[]>> {
    const rows = await this.db.queryAll<{
      id: number;
      group_name: string;
      value: string;
      description: string | null;
    }>(`
      SELECT ak.id, g.name as group_name, ak.value, ak.description
      FROM api_keys ak
      JOIN api_key_groups g ON g.id = ak.group_id
      ORDER BY g.name, ak.value
    `);

    const result = new Map<string, ApiKey[]>();
    for (const row of rows) {
      const existing = result.get(row.group_name) || [];
      existing.push({
        id: row.id,
        value: row.value,
        description: row.description ?? undefined,
      });
      result.set(row.group_name, existing);
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

    const groupRow = await this.getGroupByName(normalizedGroup);

    // For management group, allow access even if group doesn't exist in DB
    // (could be env-only)
    if (!groupRow && normalizedGroup !== "management") {
      return null;
    }

    const keys: ApiKey[] = [];

    if (groupRow) {
      const rows = await this.db.queryAll<{
        id: number;
        value: string;
        description: string | null;
      }>("SELECT id, value, description FROM api_keys WHERE group_id = ?", [
        groupRow.id,
      ]);

      for (const r of rows) {
        keys.push({
          id: r.id,
          value: r.value,
          description: r.description ?? undefined,
        });
      }
    }

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

    return keys.length > 0 || groupRow ? keys : null;
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

    const groupRow = await this.getGroupByName(normalizedGroup);
    if (!groupRow) {
      return false;
    }

    const row = await this.db.queryOne(
      "SELECT 1 FROM api_keys WHERE group_id = ? AND value = ?",
      [groupRow.id, keyValue]
    );
    return row !== null;
  }

  /**
   * Add a new API key to a group.
   * Creates the group if it doesn't exist.
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

    // Get or create the group
    const groupId = await this.getOrCreateGroup(normalizedGroup);

    // Use INSERT OR IGNORE to handle duplicate (group_id, value) silently
    await this.db.execute(
      "INSERT OR IGNORE INTO api_keys (group_id, value, description) VALUES (?, ?, ?)",
      [groupId, value, description ?? null]
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

    const groupRow = await this.getGroupByName(normalizedGroup);
    if (!groupRow) {
      return; // Group doesn't exist, nothing to remove
    }

    await this.db.execute(
      "DELETE FROM api_keys WHERE group_id = ? AND value = ?",
      [groupRow.id, keyValue]
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
   * Note: This removes keys but keeps the group. Use deleteGroup() to remove both.
   * @param group - The group name (will be normalized to lowercase)
   */
  async removeGroup(group: string): Promise<void> {
    const normalizedGroup = group.toLowerCase();
    const groupRow = await this.getGroupByName(normalizedGroup);
    if (!groupRow) {
      return;
    }

    await this.db.execute("DELETE FROM api_keys WHERE group_id = ?", [
      groupRow.id,
    ]);
  }

  /**
   * Remove a group and all its keys.
   * @param group - The group name (will be normalized to lowercase)
   */
  async removeGroupEntirely(group: string): Promise<void> {
    const normalizedGroup = group.toLowerCase();
    const groupRow = await this.getGroupByName(normalizedGroup);
    if (!groupRow) {
      return;
    }

    // CASCADE will delete keys automatically
    await this.db.execute("DELETE FROM api_key_groups WHERE id = ?", [
      groupRow.id,
    ]);
  }
}
