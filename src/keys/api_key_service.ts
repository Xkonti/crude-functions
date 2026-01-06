import type { DatabaseService } from "../database/database_service.ts";
import type { IEncryptionService } from "../encryption/types.ts";
import type { HashService } from "../encryption/hash_service.ts";

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
  /** User-friendly name for the key (unique within group) */
  name: string;
  /** The actual key value */
  value: string;
  /** Optional description of the key's purpose */
  description?: string;
}

// Key groups: lowercase a-z, 0-9, underscore, dash
const KEY_GROUP_REGEX = /^[a-z0-9_-]+$/;

// Key names: lowercase a-z, 0-9, underscore, dash (same as groups)
const KEY_NAME_REGEX = /^[a-z0-9_-]+$/;

// Key values: a-z, A-Z, 0-9, underscore, dash
const KEY_VALUE_REGEX = /^[a-zA-Z0-9_-]+$/;

/**
 * Validates that a key group name contains only allowed characters
 */
export function validateKeyGroup(group: string): boolean {
  return KEY_GROUP_REGEX.test(group);
}

/**
 * Validates that a key name contains only allowed characters
 */
export function validateKeyName(name: string): boolean {
  return KEY_NAME_REGEX.test(name);
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
  /** Encryption service for encrypting API keys at rest */
  encryptionService: IEncryptionService;
  /** Hash service for O(1) API key lookups */
  hashService: HashService;
}

/**
 * Service for managing API keys and key groups stored in SQLite database.
 * No caching - always reads from database for simplicity and consistency.
 */
export class ApiKeyService {
  private readonly db: DatabaseService;
  private readonly encryptionService: IEncryptionService;
  private readonly hashService: HashService;

  constructor(options: ApiKeyServiceOptions) {
    this.db = options.db;
    this.encryptionService = options.encryptionService;
    this.hashService = options.hashService;
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
   */
  async getAll(): Promise<Map<string, ApiKey[]>> {
    const rows = await this.db.queryAll<{
      id: number;
      group_name: string;
      name: string;
      value: string;
      description: string | null;
    }>(`
      SELECT ak.id, g.name as group_name, ak.name, ak.value, ak.description
      FROM api_keys ak
      JOIN api_key_groups g ON g.id = ak.group_id
      ORDER BY g.name, ak.name
    `);

    // Decrypt all keys in parallel
    const decryptedRows = await Promise.all(
      rows.map(async (row) => ({
        ...row,
        value: await this.decryptKey(row.value),
      }))
    );

    // Group by group_name
    const result = new Map<string, ApiKey[]>();
    for (const row of decryptedRows) {
      const existing = result.get(row.group_name) || [];
      existing.push({
        id: row.id,
        name: row.name,
        value: row.value,
        description: row.description ?? undefined,
      });
      result.set(row.group_name, existing);
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
    if (!groupRow) {
      return null;
    }

    const rows = await this.db.queryAll<{
      id: number;
      name: string;
      value: string;
      description: string | null;
    }>("SELECT id, name, value, description FROM api_keys WHERE group_id = ? ORDER BY name", [
      groupRow.id,
    ]);

    // Decrypt all keys in parallel
    const decryptedKeys = await Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        name: r.name,
        value: await this.decryptKey(r.value),
        description: r.description ?? undefined,
      }))
    );

    return decryptedKeys;
  }

  /**
   * Get an API key by ID
   * Returns both the key and its associated group
   */
  async getById(
    keyId: number
  ): Promise<{ key: ApiKey; group: ApiKeyGroup } | null> {
    const row = await this.db.queryOne<{
      key_id: number;
      key_name: string;
      key_value: string;
      key_description: string | null;
      group_id: number;
      group_name: string;
      group_description: string | null;
    }>(
      `SELECT
         k.id as key_id,
         k.name as key_name,
         k.value as key_value,
         k.description as key_description,
         g.id as group_id,
         g.name as group_name,
         g.description as group_description
       FROM api_keys k
       JOIN api_key_groups g ON k.group_id = g.id
       WHERE k.id = ?`,
      [keyId]
    );

    if (!row) return null;

    // Decrypt the key value
    const decryptedValue = await this.decryptKey(row.key_value);

    return {
      key: {
        id: row.key_id,
        name: row.key_name,
        value: decryptedValue,
        description: row.key_description ?? undefined,
      },
      group: {
        id: row.group_id,
        name: row.group_name,
        description: row.group_description ?? undefined,
      },
    };
  }

  /**
   * Check if a specific key value exists in a group.
   * Uses hash-based O(1) lookup instead of O(n) decryption.
   * @param group - The group name (will be normalized to lowercase)
   * @param keyValue - The key value to check
   */
  async hasKey(group: string, keyValue: string): Promise<boolean> {
    const normalizedGroup = group.toLowerCase();

    const groupRow = await this.getGroupByName(normalizedGroup);
    if (!groupRow) {
      return false;
    }

    // O(1) hash-based lookup eliminates timing attack
    const valueHash = await this.hashService.computeHash(keyValue);
    const row = await this.db.queryOne<{ id: number }>(
      "SELECT id FROM api_keys WHERE group_id = ? AND value_hash = ?",
      [groupRow.id, valueHash]
    );

    return row !== null;
  }

  /**
   * Get key and group IDs for a specific key value in a group.
   * Uses hash-based O(1) lookup instead of O(n) decryption.
   * Used by ApiKeyValidator to obtain IDs for secret resolution.
   * @param group - The group name (will be normalized to lowercase)
   * @param keyValue - The key value to look up
   * @returns Object with keyId, groupId, and keyName, or null if not found
   */
  async getKeyByValue(
    group: string,
    keyValue: string
  ): Promise<{ keyId: number; groupId: number; keyName: string } | null> {
    const normalizedGroup = group.toLowerCase();

    const groupRow = await this.getGroupByName(normalizedGroup);
    if (!groupRow) {
      return null;
    }

    // O(1) hash-based lookup eliminates timing attack
    const valueHash = await this.hashService.computeHash(keyValue);
    const row = await this.db.queryOne<{ id: number; name: string }>(
      "SELECT id, name FROM api_keys WHERE group_id = ? AND value_hash = ?",
      [groupRow.id, valueHash]
    );

    if (!row) {
      return null;
    }

    return {
      keyId: row.id,
      groupId: groupRow.id,
      keyName: row.name,
    };
  }

  /**
   * Add a new API key to a group.
   * Creates the group if it doesn't exist.
   * Silently ignores if the exact (group, value) pair already exists.
   * @param group - The group name (will be normalized to lowercase)
   * @param name - The key name (will be normalized to lowercase, must be unique within group)
   * @param value - The key value
   * @param description - Optional description
   */
  async addKey(
    group: string,
    name: string,
    value: string,
    description?: string
  ): Promise<void> {
    const normalizedGroup = group.toLowerCase();
    const normalizedName = name.toLowerCase();

    // Validate key name format
    if (!validateKeyName(normalizedName)) {
      throw new Error(
        "Invalid key name. Must contain only lowercase letters, numbers, dashes, and underscores."
      );
    }

    // Check if key already exists (silently ignore duplicates)
    // With encryption, we can't rely on DB unique constraint since each
    // encryption produces different ciphertext
    if (await this.hasKey(normalizedGroup, value)) {
      return; // Silently ignore duplicate
    }

    // Get or create the group
    const groupId = await this.getOrCreateGroup(normalizedGroup);

    // Check if name already exists in this group
    const existingKeyWithName = await this.db.queryOne<{ id: number }>(
      "SELECT id FROM api_keys WHERE group_id = ? AND name = ?",
      [groupId, normalizedName]
    );

    if (existingKeyWithName) {
      throw new Error(
        `A key with name '${normalizedName}' already exists in group '${normalizedGroup}'`
      );
    }

    // Encrypt the key value before storage
    const encryptedValue = await this.encryptKey(value);

    // Compute hash for O(1) constant-time lookup
    const valueHash = await this.hashService.computeHash(value);

    // Insert the encrypted key with hash
    await this.db.execute(
      "INSERT INTO api_keys (group_id, name, value, value_hash, description, created_at, modified_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
      [groupId, normalizedName, encryptedValue, valueHash, description ?? null]
    );
  }

  /**
   * Remove a specific key by group and value.
   * Uses hash-based O(1) lookup instead of O(n) decryption.
   * @param group - The group name (will be normalized to lowercase)
   * @param keyValue - The key value to remove
   */
  async removeKey(group: string, keyValue: string): Promise<void> {
    const normalizedGroup = group.toLowerCase();

    const groupRow = await this.getGroupByName(normalizedGroup);
    if (!groupRow) {
      return; // Group doesn't exist, nothing to remove
    }

    // O(1) hash-based lookup and delete
    const valueHash = await this.hashService.computeHash(keyValue);
    await this.db.execute(
      "DELETE FROM api_keys WHERE group_id = ? AND value_hash = ?",
      [groupRow.id, valueHash]
    );
  }

  /**
   * Remove a key by its unique ID.
   * Useful for web UI where passing the key value over the wire is undesirable.
   * @param id - The unique key ID
   */
  async removeKeyById(id: number): Promise<void> {
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

  // ============== Private Encryption Helpers ==============

  /**
   * Encrypts an API key value for storage
   * @param plaintext - The plaintext API key
   * @returns Base64-encoded encrypted value
   */
  private async encryptKey(plaintext: string): Promise<string> {
    return await this.encryptionService.encrypt(plaintext);
  }

  /**
   * Decrypts an encrypted API key value
   * @param encrypted - Base64-encoded encrypted value
   * @returns Plaintext API key
   */
  private async decryptKey(encrypted: string): Promise<string> {
    return await this.encryptionService.decrypt(encrypted);
  }
}
