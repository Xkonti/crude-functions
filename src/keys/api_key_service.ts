import { Mutex } from "@core/asyncutil/mutex";
import { RecordId } from "surrealdb";
import type { SurrealConnectionFactory } from "../database/surreal_connection_factory.ts";
import type { IEncryptionService } from "../encryption/types.ts";
import type { HashService } from "../encryption/hash_service.ts";
import { validateKeyName } from "../validation/keys.ts";

/**
 * Represents an API key group
 */
export interface ApiKeyGroup {
  /** Unique identifier for the group (SurrealDB record ID) */
  id: string;
  /** Group name (lowercase alphanumeric with dashes/underscores) */
  name: string;
  /** Optional description */
  description?: string;
}

/**
 * Represents an API key with its metadata
 */
export interface ApiKey {
  /** Unique identifier for the key (SurrealDB record ID) */
  id: string;
  /** User-friendly name for the key (unique within group) */
  name: string;
  /** The actual key value */
  value: string;
  /** Optional description of the key's purpose */
  description?: string;
}

export interface ApiKeyServiceOptions {
  /** SurrealDB connection factory */
  surrealFactory: SurrealConnectionFactory;
  /** Encryption service for encrypting API keys at rest */
  encryptionService: IEncryptionService;
  /** Hash service for O(1) API key lookups */
  hashService: HashService;
}

/** Database row type for API key groups */
interface ApiKeyGroupRow {
  id: RecordId;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Database row type for API keys */
interface ApiKeyRow {
  id: RecordId;
  groupId: RecordId;
  name: string;
  value: string;
  valueHash: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Service for managing API keys and key groups stored in SurrealDB.
 * No caching - always reads from database for simplicity and consistency.
 */
export class ApiKeyService {
  private readonly surrealFactory: SurrealConnectionFactory;
  private readonly encryptionService: IEncryptionService;
  private readonly hashService: HashService;
  private readonly writeMutex = new Mutex();

  constructor(options: ApiKeyServiceOptions) {
    this.surrealFactory = options.surrealFactory;
    this.encryptionService = options.encryptionService;
    this.hashService = options.hashService;
  }

  // ============== Bootstrap ==============

  /**
   * Ensure the management group exists.
   * Called during application startup.
   */
  async bootstrapManagementGroup(): Promise<void> {
    using _lock = await this.writeMutex.acquire();

    await this.surrealFactory.withSystemConnection({}, async (db) => {
      // INSERT IGNORE creates if not exists, preserves existing
      await db.query(
        `INSERT IGNORE INTO apiKeyGroup {
          id: apiKeyGroup:management,
          name: 'management',
          description: 'Management API keys'
        }`
      );
    });
  }

  // ============== Group Operations ==============

  /**
   * Get all API key groups.
   */
  async getGroups(): Promise<ApiKeyGroup[]> {
    return await this.surrealFactory.withSystemConnection({}, async (db) => {
      const [rows] = await db.query<[ApiKeyGroupRow[]]>(
        "SELECT * FROM apiKeyGroup ORDER BY name"
      );

      return (rows ?? []).map((row) => ({
        id: row.id.id as string,
        name: row.name,
        description: row.description ?? undefined,
      }));
    });
  }

  /**
   * Get a group by name.
   */
  async getGroupByName(name: string): Promise<ApiKeyGroup | null> {
    const normalizedName = name.toLowerCase();

    return await this.surrealFactory.withSystemConnection({}, async (db) => {
      const [rows] = await db.query<[ApiKeyGroupRow[]]>(
        "SELECT * FROM apiKeyGroup WHERE name = $name LIMIT 1",
        { name: normalizedName }
      );

      const row = rows?.[0];
      if (!row) return null;

      return {
        id: row.id.id as string,
        name: row.name,
        description: row.description ?? undefined,
      };
    });
  }

  /**
   * Get a group by ID.
   */
  async getGroupById(id: string): Promise<ApiKeyGroup | null> {
    const recordId = new RecordId("apiKeyGroup", id);

    return await this.surrealFactory.withSystemConnection({}, async (db) => {
      const [row] = await db.query<[ApiKeyGroupRow | undefined]>(
        "RETURN $recordId.*",
        { recordId }
      );

      if (!row) return null;

      return {
        id: row.id.id as string,
        name: row.name,
        description: row.description ?? undefined,
      };
    });
  }

  /**
   * Create a new group.
   * @returns The ID of the created group
   */
  async createGroup(name: string, description?: string): Promise<string> {
    using _lock = await this.writeMutex.acquire();

    const normalizedName = name.toLowerCase();

    return await this.surrealFactory.withSystemConnection({}, async (db) => {
      const [rows] = await db.query<[ApiKeyGroupRow[]]>(
        "CREATE apiKeyGroup SET name = $name, description = $description",
        { name: normalizedName, description: description ?? null }
      );

      const row = rows?.[0];
      if (!row) {
        throw new Error("Failed to create API key group");
      }

      return row.id.id as string;
    });
  }

  /**
   * Update a group's description.
   */
  async updateGroup(id: string, description: string): Promise<void> {
    using _lock = await this.writeMutex.acquire();

    const recordId = new RecordId("apiKeyGroup", id);

    await this.surrealFactory.withSystemConnection({}, async (db) => {
      await db.query(
        "UPDATE $recordId SET description = $description",
        { recordId, description }
      );
    });
  }

  /**
   * Delete a group by ID.
   * Manually cascades to all keys in the group (SurrealDB doesn't auto-cascade).
   */
  async deleteGroup(id: string): Promise<void> {
    using _lock = await this.writeMutex.acquire();

    const recordId = new RecordId("apiKeyGroup", id);

    await this.surrealFactory.withSystemConnection({}, async (db) => {
      // Delete all keys in group first (manual cascade)
      await db.query(
        "DELETE apiKey WHERE groupId = $recordId",
        { recordId }
      );
      // Then delete the group
      await db.query(
        "DELETE $recordId",
        { recordId }
      );
    });
  }

  /**
   * Get the count of keys in a group.
   * Used to check before group deletion.
   */
  async getKeyCountForGroup(groupId: string): Promise<number> {
    const recordId = new RecordId("apiKeyGroup", groupId);

    return await this.surrealFactory.withSystemConnection({}, async (db) => {
      const [rows] = await db.query<[{ count: number }[]]>(
        "SELECT count() as count FROM apiKey WHERE groupId = $groupId",
        { groupId: recordId }
      );

      return rows?.[0]?.count ?? 0;
    });
  }

  /**
   * Get or create a group by name.
   * @returns The group ID
   */
  async getOrCreateGroup(name: string, description?: string): Promise<string> {
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
    const rows = await this.surrealFactory.withSystemConnection({}, async (db) => {
      const [result] = await db.query<[Array<ApiKeyRow & { groupName: string }>]>(
        `SELECT *, groupId.name as groupName FROM apiKey ORDER BY groupId.name, name`
      );
      return result ?? [];
    });

    // Decrypt all keys in parallel
    const decryptedRows = await Promise.all(
      rows.map(async (row) => ({
        id: row.id.id as string,
        groupName: row.groupName,
        name: row.name,
        value: await this.decryptKey(row.value),
        description: row.description ?? undefined,
      }))
    );

    // Group by group_name
    const result = new Map<string, ApiKey[]>();
    for (const row of decryptedRows) {
      const existing = result.get(row.groupName) || [];
      existing.push({
        id: row.id,
        name: row.name,
        value: row.value,
        description: row.description,
      });
      result.set(row.groupName, existing);
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

    const groupRecordId = new RecordId("apiKeyGroup", groupRow.id);

    const rows = await this.surrealFactory.withSystemConnection({}, async (db) => {
      const [result] = await db.query<[ApiKeyRow[]]>(
        "SELECT * FROM apiKey WHERE groupId = $groupId ORDER BY name",
        { groupId: groupRecordId }
      );
      return result ?? [];
    });

    // Decrypt all keys in parallel
    const decryptedKeys = await Promise.all(
      rows.map(async (r) => ({
        id: r.id.id as string,
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
    keyId: string
  ): Promise<{ key: ApiKey; group: ApiKeyGroup } | null> {
    const recordId = new RecordId("apiKey", keyId);

    const result = await this.surrealFactory.withSystemConnection({}, async (db) => {
      const [row] = await db.query<[
        (ApiKeyRow & {
          groupRecord: ApiKeyGroupRow;
        }) | undefined
      ]>(
        `SELECT *, groupId.* as groupRecord FROM apiKey WHERE id = $recordId LIMIT 1`,
        { recordId }
      );
      return row ?? null;
    });

    if (!result) return null;

    // Decrypt the key value
    const decryptedValue = await this.decryptKey(result.value);

    return {
      key: {
        id: result.id.id as string,
        name: result.name,
        value: decryptedValue,
        description: result.description ?? undefined,
      },
      group: {
        id: result.groupRecord.id.id as string,
        name: result.groupRecord.name,
        description: result.groupRecord.description ?? undefined,
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

    return this.hasKeyInGroup(groupRow.id, keyValue);
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
  ): Promise<{ keyId: string; groupId: string; keyName: string } | null> {
    const normalizedGroup = group.toLowerCase();

    const groupRow = await this.getGroupByName(normalizedGroup);
    if (!groupRow) {
      return null;
    }

    const result = await this.getKeyByValueInGroup(groupRow.id, keyValue);
    if (!result) {
      return null;
    }

    return {
      keyId: result.keyId,
      groupId: result.groupId,
      keyName: result.keyName,
    };
  }

  // ============== ID-Based Key Operations ==============

  /**
   * Get all API keys for a specific group by ID.
   * @param groupId - The group ID
   * @returns Array of keys or null if group doesn't exist
   */
  async getKeysByGroupId(groupId: string): Promise<ApiKey[] | null> {
    const groupRow = await this.getGroupById(groupId);
    if (!groupRow) {
      return null;
    }

    const groupRecordId = new RecordId("apiKeyGroup", groupId);

    const rows = await this.surrealFactory.withSystemConnection({}, async (db) => {
      const [result] = await db.query<[ApiKeyRow[]]>(
        "SELECT * FROM apiKey WHERE groupId = $groupId ORDER BY name",
        { groupId: groupRecordId }
      );
      return result ?? [];
    });

    // Decrypt all keys in parallel
    const decryptedKeys = await Promise.all(
      rows.map(async (r) => ({
        id: r.id.id as string,
        name: r.name,
        value: await this.decryptKey(r.value),
        description: r.description ?? undefined,
      }))
    );

    return decryptedKeys;
  }

  /**
   * Check if a specific key value exists in a group by ID.
   * Uses hash-based O(1) lookup instead of O(n) decryption.
   * @param groupId - The group ID
   * @param keyValue - The key value to check
   */
  async hasKeyInGroup(groupId: string, keyValue: string): Promise<boolean> {
    const valueHash = await this.hashService.computeHash(keyValue);
    const groupRecordId = new RecordId("apiKeyGroup", groupId);

    return await this.surrealFactory.withSystemConnection({}, async (db) => {
      const [rows] = await db.query<[{ id: RecordId }[]]>(
        "SELECT id FROM apiKey WHERE groupId = $groupId AND valueHash = $valueHash LIMIT 1",
        { groupId: groupRecordId, valueHash }
      );

      return (rows?.length ?? 0) > 0;
    });
  }

  /**
   * Get key and group IDs for a specific key value in a group by ID.
   * Uses hash-based O(1) lookup instead of O(n) decryption.
   * Used by ApiKeyValidator to obtain IDs for secret resolution.
   * @param groupId - The group ID
   * @param keyValue - The key value to look up
   * @returns Object with keyId, groupId, keyName, and groupName, or null if not found
   */
  async getKeyByValueInGroup(
    groupId: string,
    keyValue: string
  ): Promise<{ keyId: string; groupId: string; keyName: string; groupName: string } | null> {
    const valueHash = await this.hashService.computeHash(keyValue);
    const groupRecordId = new RecordId("apiKeyGroup", groupId);

    return await this.surrealFactory.withSystemConnection({}, async (db) => {
      const [rows] = await db.query<[Array<{ id: RecordId; name: string; groupName: string }>]>(
        `SELECT id, name, groupId.name as groupName FROM apiKey
         WHERE groupId = $groupId AND valueHash = $valueHash LIMIT 1`,
        { groupId: groupRecordId, valueHash }
      );

      const row = rows?.[0];
      if (!row) {
        return null;
      }

      return {
        keyId: row.id.id as string,
        groupId: groupId,
        keyName: row.name,
        groupName: row.groupName,
      };
    });
  }

  /**
   * Add a new API key to a group by ID.
   * Does NOT create the group if it doesn't exist (unlike addKey).
   * Silently ignores if the exact (group, value) pair already exists.
   * @param groupId - The group ID (must exist)
   * @param name - The key name (will be normalized to lowercase, must be unique within group)
   * @param value - The key value
   * @param description - Optional description
   * @returns The ID of the created key
   * @throws Error if group doesn't exist or name conflicts
   */
  async addKeyToGroup(
    groupId: string,
    name: string,
    value: string,
    description?: string
  ): Promise<string> {
    using _lock = await this.writeMutex.acquire();

    const normalizedName = name.toLowerCase();

    // Validate key name format
    if (!validateKeyName(normalizedName)) {
      throw new Error(
        "Invalid key name. Must contain only lowercase letters, numbers, dashes, and underscores."
      );
    }

    // Verify group exists
    const group = await this.getGroupById(groupId);
    if (!group) {
      throw new Error(`Group with id ${groupId} not found`);
    }

    // Check if key already exists (silently ignore duplicates)
    if (await this.hasKeyInGroup(groupId, value)) {
      // Return the existing key's ID
      const existing = await this.getKeyByValueInGroup(groupId, value);
      return existing!.keyId;
    }

    const groupRecordId = new RecordId("apiKeyGroup", groupId);

    // Check if name already exists in this group
    const nameExists = await this.surrealFactory.withSystemConnection({}, async (db) => {
      const [rows] = await db.query<[{ id: RecordId }[]]>(
        "SELECT id FROM apiKey WHERE groupId = $groupId AND name = $name LIMIT 1",
        { groupId: groupRecordId, name: normalizedName }
      );
      return (rows?.length ?? 0) > 0;
    });

    if (nameExists) {
      throw new Error(
        `A key with name '${normalizedName}' already exists in group '${group.name}'`
      );
    }

    // Encrypt the key value before storage
    const encryptedValue = await this.encryptKey(value);

    // Compute hash for O(1) constant-time lookup
    const valueHash = await this.hashService.computeHash(value);

    // Insert the encrypted key with hash
    return await this.surrealFactory.withSystemConnection({}, async (db) => {
      const [rows] = await db.query<[ApiKeyRow[]]>(
        `CREATE apiKey SET
          groupId = $groupId,
          name = $name,
          value = $value,
          valueHash = $valueHash,
          description = $description`,
        {
          groupId: groupRecordId,
          name: normalizedName,
          value: encryptedValue,
          valueHash,
          description: description ?? null,
        }
      );

      const row = rows?.[0];
      if (!row) {
        throw new Error("Failed to create API key");
      }

      return row.id.id as string;
    });
  }

  /**
   * Get all keys (optionally filtered by group ID).
   * Returns keys with their group information.
   * @param groupId - Optional group ID to filter by
   */
  async getAllKeys(
    groupId?: string
  ): Promise<Array<ApiKey & { groupId: string; groupName: string }>> {
    const groupRecordId = groupId ? new RecordId("apiKeyGroup", groupId) : undefined;

    const rows = await this.surrealFactory.withSystemConnection({}, async (db) => {
      if (groupRecordId) {
        const [result] = await db.query<[Array<ApiKeyRow & { groupName: string }>]>(
          `SELECT *, groupId.name as groupName FROM apiKey
           WHERE groupId = $groupId ORDER BY groupId.name, name`,
          { groupId: groupRecordId }
        );
        return result ?? [];
      } else {
        const [result] = await db.query<[Array<ApiKeyRow & { groupName: string }>]>(
          `SELECT *, groupId.name as groupName FROM apiKey ORDER BY groupId.name, name`
        );
        return result ?? [];
      }
    });

    // Decrypt all keys in parallel
    const decryptedKeys = await Promise.all(
      rows.map(async (r) => ({
        id: r.id.id as string,
        name: r.name,
        value: await this.decryptKey(r.value),
        description: r.description ?? undefined,
        groupId: r.groupId.id as string,
        groupName: r.groupName,
      }))
    );

    return decryptedKeys;
  }

  // ============== Legacy Name-Based Key Operations ==============

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
    if (await this.hasKey(normalizedGroup, value)) {
      return; // Silently ignore duplicate
    }

    // Get or create the group
    const groupId = await this.getOrCreateGroup(normalizedGroup);

    // Use addKeyToGroup for the rest (which handles name conflict checking)
    try {
      await this.addKeyToGroup(groupId, normalizedName, value, description);
    } catch (error) {
      // Re-throw name conflicts, but ignore "key already exists" from addKeyToGroup
      // since we already checked hasKey above
      if (error instanceof Error && error.message.includes("already exists in group")) {
        throw error;
      }
      throw error;
    }
  }

  /**
   * Remove a specific key by group and value.
   * Uses hash-based O(1) lookup instead of O(n) decryption.
   * @param group - The group name (will be normalized to lowercase)
   * @param keyValue - The key value to remove
   */
  async removeKey(group: string, keyValue: string): Promise<void> {
    using _lock = await this.writeMutex.acquire();

    const normalizedGroup = group.toLowerCase();

    const groupRow = await this.getGroupByName(normalizedGroup);
    if (!groupRow) {
      return; // Group doesn't exist, nothing to remove
    }

    const valueHash = await this.hashService.computeHash(keyValue);
    const groupRecordId = new RecordId("apiKeyGroup", groupRow.id);

    await this.surrealFactory.withSystemConnection({}, async (db) => {
      await db.query(
        "DELETE apiKey WHERE groupId = $groupId AND valueHash = $valueHash",
        { groupId: groupRecordId, valueHash }
      );
    });
  }

  /**
   * Remove a key by its unique ID.
   * Useful for web UI where passing the key value over the wire is undesirable.
   * @param id - The unique key ID
   */
  async removeKeyById(id: string): Promise<void> {
    using _lock = await this.writeMutex.acquire();

    const recordId = new RecordId("apiKey", id);

    await this.surrealFactory.withSystemConnection({}, async (db) => {
      await db.query("DELETE $recordId", { recordId });
    });
  }

  /**
   * Update an existing API key.
   * @param keyId - The key ID to update
   * @param updates - Fields to update (all optional)
   * @throws Error if key not found or name conflicts
   */
  async updateKey(
    keyId: string,
    updates: { name?: string; value?: string; description?: string }
  ): Promise<void> {
    using _lock = await this.writeMutex.acquire();

    // Get existing key
    const existing = await this.getById(keyId);
    if (!existing) {
      throw new Error(`API key with id ${keyId} not found`);
    }

    const setFields: string[] = [];
    const params: Record<string, unknown> = {
      recordId: new RecordId("apiKey", keyId),
    };

    // Handle name update
    if (updates.name !== undefined) {
      const normalizedName = updates.name.toLowerCase();
      if (!validateKeyName(normalizedName)) {
        throw new Error(
          "Invalid key name. Must contain only lowercase letters, numbers, dashes, and underscores."
        );
      }

      // Check for duplicate name in same group (excluding current key)
      const groupRecordId = new RecordId("apiKeyGroup", existing.group.id);
      const keyRecordId = new RecordId("apiKey", keyId);

      const duplicateExists = await this.surrealFactory.withSystemConnection({}, async (db) => {
        const [rows] = await db.query<[{ id: RecordId }[]]>(
          "SELECT id FROM apiKey WHERE groupId = $groupId AND name = $name AND id != $keyId LIMIT 1",
          { groupId: groupRecordId, name: normalizedName, keyId: keyRecordId }
        );
        return (rows?.length ?? 0) > 0;
      });

      if (duplicateExists) {
        throw new Error(
          `A key with name '${normalizedName}' already exists in group '${existing.group.name}'`
        );
      }

      setFields.push("name = $name");
      params.name = normalizedName;
    }

    // Handle value update
    if (updates.value !== undefined) {
      const encryptedValue = await this.encryptKey(updates.value);
      const valueHash = await this.hashService.computeHash(updates.value);
      setFields.push("value = $value");
      params.value = encryptedValue;
      setFields.push("valueHash = $valueHash");
      params.valueHash = valueHash;
    }

    // Handle description update
    if (updates.description !== undefined) {
      setFields.push("description = $description");
      params.description = updates.description || null;
    }

    if (setFields.length === 0) {
      return; // Nothing to update
    }

    await this.surrealFactory.withSystemConnection({}, async (db) => {
      await db.query(
        `UPDATE $recordId SET ${setFields.join(", ")}`,
        params
      );
    });
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
