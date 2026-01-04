import type { DatabaseService } from "../database/database_service.ts";
import type { EncryptionService } from "../encryption/encryption_service.ts";
import type { Secret, SecretRow } from "./types.ts";
import { SecretScope } from "./types.ts";

export interface SecretsServiceOptions {
  db: DatabaseService;
  encryptionService: EncryptionService;
}

// Secret names: A-Z, a-z, 0-9, underscore, dash
const SECRET_NAME_REGEX = /^[a-zA-Z0-9_-]+$/;

/**
 * Service for managing secrets with encryption at rest.
 * Handles CRUD operations for secrets across all scopes (global, function, group, key).
 */
export class SecretsService {
  private readonly db: DatabaseService;
  private readonly encryptionService: EncryptionService;

  constructor(options: SecretsServiceOptions) {
    this.db = options.db;
    this.encryptionService = options.encryptionService;
  }

  // ============== Global Scope Operations ==============

  /**
   * Get all global secrets (without values for performance)
   */
  async getGlobalSecrets(): Promise<SecretRow[]> {
    const rows = await this.db.queryAll<SecretRow>(
      `SELECT id, name, comment, created_at, modified_at
       FROM secrets
       WHERE scope = ?
       ORDER BY name ASC`,
      [SecretScope.Global]
    );

    return rows;
  }

  /**
   * Get all global secrets with decrypted values
   * Used for list page with show/hide functionality
   */
  async getGlobalSecretsWithValues(): Promise<Secret[]> {
    const rows = await this.db.queryAll<{
      id: number;
      name: string;
      value: string;
      comment: string | null;
      scope: number;
      function_id: number | null;
      api_group_id: number | null;
      api_key_id: number | null;
      created_at: string;
      modified_at: string;
    }>(
      `SELECT id, name, value, comment, scope,
              function_id, api_group_id, api_key_id,
              created_at, modified_at
       FROM secrets
       WHERE scope = ?
       ORDER BY name ASC`,
      [SecretScope.Global]
    );

    // Decrypt all values
    const secrets: Secret[] = [];
    for (const row of rows) {
      const decryptedValue = await this.encryptionService.decrypt(row.value);
      secrets.push({
        id: row.id,
        name: row.name,
        value: decryptedValue,
        comment: row.comment,
        scope: row.scope,
        functionId: row.function_id,
        apiGroupId: row.api_group_id,
        apiKeyId: row.api_key_id,
        createdAt: row.created_at,
        modifiedAt: row.modified_at,
      });
    }

    return secrets;
  }

  /**
   * Get a global secret by ID (with decrypted value)
   */
  async getGlobalSecretById(id: number): Promise<Secret | null> {
    const row = await this.db.queryOne<{
      id: number;
      name: string;
      value: string;
      comment: string | null;
      scope: number;
      function_id: number | null;
      api_group_id: number | null;
      api_key_id: number | null;
      created_at: string;
      modified_at: string;
    }>(
      `SELECT id, name, value, comment, scope,
              function_id, api_group_id, api_key_id,
              created_at, modified_at
       FROM secrets
       WHERE id = ? AND scope = ?`,
      [id, SecretScope.Global]
    );

    if (!row) return null;

    const decryptedValue = await this.encryptionService.decrypt(row.value);

    return {
      id: row.id,
      name: row.name,
      value: decryptedValue,
      comment: row.comment,
      scope: row.scope,
      functionId: row.function_id,
      apiGroupId: row.api_group_id,
      apiKeyId: row.api_key_id,
      createdAt: row.created_at,
      modifiedAt: row.modified_at,
    };
  }

  /**
   * Create a new global secret
   * @throws Error if name is invalid or already exists
   */
  async createGlobalSecret(
    name: string,
    value: string,
    comment?: string
  ): Promise<void> {
    // Validate name format
    this.validateSecretName(name);

    // Check for duplicates
    const isDuplicate = await this.checkDuplicateGlobal(name);
    if (isDuplicate) {
      throw new Error(`A global secret with name '${name}' already exists`);
    }

    // Encrypt value
    const encryptedValue = await this.encryptionService.encrypt(value);

    // Insert into database
    await this.db.execute(
      `INSERT INTO secrets (name, value, comment, scope, created_at, modified_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [name, encryptedValue, comment ?? null, SecretScope.Global]
    );
  }

  /**
   * Update a global secret's value and/or comment
   * @throws Error if secret not found
   */
  async updateGlobalSecret(
    id: number,
    value: string,
    comment?: string
  ): Promise<void> {
    // Verify secret exists
    const existing = await this.getGlobalSecretById(id);
    if (!existing) {
      throw new Error(`Secret with ID ${id} not found`);
    }

    // Encrypt new value
    const encryptedValue = await this.encryptionService.encrypt(value);

    // Update in database
    await this.db.execute(
      `UPDATE secrets
       SET value = ?, comment = ?, modified_at = CURRENT_TIMESTAMP
       WHERE id = ? AND scope = ?`,
      [encryptedValue, comment ?? null, id, SecretScope.Global]
    );
  }

  /**
   * Delete a global secret
   * @throws Error if secret not found
   */
  async deleteGlobalSecret(id: number): Promise<void> {
    const result = await this.db.execute(
      `DELETE FROM secrets WHERE id = ? AND scope = ?`,
      [id, SecretScope.Global]
    );

    if (result.changes === 0) {
      throw new Error(`Secret with ID ${id} not found`);
    }
  }

  // ============== Function Scope Operations ==============

  /**
   * Get all secrets for a specific function (with decrypted values)
   */
  async getFunctionSecrets(functionId: number): Promise<Secret[]> {
    const rows = await this.db.queryAll<{
      id: number;
      name: string;
      value: string;
      comment: string | null;
      scope: number;
      function_id: number | null;
      api_group_id: number | null;
      api_key_id: number | null;
      created_at: string;
      modified_at: string;
    }>(
      `SELECT id, name, value, comment, scope,
              function_id, api_group_id, api_key_id,
              created_at, modified_at
       FROM secrets
       WHERE scope = ? AND function_id = ?
       ORDER BY name ASC`,
      [SecretScope.Function, functionId]
    );

    // Decrypt all values
    const secrets: Secret[] = [];
    for (const row of rows) {
      const decryptedValue = await this.encryptionService.decrypt(row.value);
      secrets.push({
        id: row.id,
        name: row.name,
        value: decryptedValue,
        comment: row.comment,
        scope: row.scope,
        functionId: row.function_id,
        apiGroupId: row.api_group_id,
        apiKeyId: row.api_key_id,
        createdAt: row.created_at,
        modifiedAt: row.modified_at,
      });
    }

    return secrets;
  }

  /**
   * Get a function secret by ID (with decrypted value)
   */
  async getFunctionSecretById(
    functionId: number,
    secretId: number
  ): Promise<Secret | null> {
    const row = await this.db.queryOne<{
      id: number;
      name: string;
      value: string;
      comment: string | null;
      scope: number;
      function_id: number | null;
      api_group_id: number | null;
      api_key_id: number | null;
      created_at: string;
      modified_at: string;
    }>(
      `SELECT id, name, value, comment, scope,
              function_id, api_group_id, api_key_id,
              created_at, modified_at
       FROM secrets
       WHERE id = ? AND scope = ? AND function_id = ?`,
      [secretId, SecretScope.Function, functionId]
    );

    if (!row) return null;

    const decryptedValue = await this.encryptionService.decrypt(row.value);

    return {
      id: row.id,
      name: row.name,
      value: decryptedValue,
      comment: row.comment,
      scope: row.scope,
      functionId: row.function_id,
      apiGroupId: row.api_group_id,
      apiKeyId: row.api_key_id,
      createdAt: row.created_at,
      modifiedAt: row.modified_at,
    };
  }

  /**
   * Create a new function secret
   * @throws Error if name is invalid or already exists for this function
   */
  async createFunctionSecret(
    functionId: number,
    name: string,
    value: string,
    comment?: string
  ): Promise<void> {
    // Validate name format
    this.validateSecretName(name);

    // Check for duplicates within this function's scope
    const isDuplicate = await this.checkDuplicateFunction(functionId, name);
    if (isDuplicate) {
      throw new Error(
        `A secret with name '${name}' already exists for this function`
      );
    }

    // Encrypt value
    const encryptedValue = await this.encryptionService.encrypt(value);

    // Insert into database
    await this.db.execute(
      `INSERT INTO secrets (name, value, comment, scope, function_id, created_at, modified_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [name, encryptedValue, comment ?? null, SecretScope.Function, functionId]
    );
  }

  /**
   * Update a function secret's value and/or comment
   * @throws Error if secret not found
   */
  async updateFunctionSecret(
    functionId: number,
    secretId: number,
    value: string,
    comment?: string
  ): Promise<void> {
    // Verify secret exists and belongs to this function
    const existing = await this.getFunctionSecretById(functionId, secretId);
    if (!existing) {
      throw new Error(
        `Secret with ID ${secretId} not found for this function`
      );
    }

    // Encrypt new value
    const encryptedValue = await this.encryptionService.encrypt(value);

    // Update in database
    await this.db.execute(
      `UPDATE secrets
       SET value = ?, comment = ?, modified_at = CURRENT_TIMESTAMP
       WHERE id = ? AND scope = ? AND function_id = ?`,
      [
        encryptedValue,
        comment ?? null,
        secretId,
        SecretScope.Function,
        functionId,
      ]
    );
  }

  /**
   * Delete a function secret
   * @throws Error if secret not found
   */
  async deleteFunctionSecret(
    functionId: number,
    secretId: number
  ): Promise<void> {
    const result = await this.db.execute(
      `DELETE FROM secrets
       WHERE id = ? AND scope = ? AND function_id = ?`,
      [secretId, SecretScope.Function, functionId]
    );

    if (result.changes === 0) {
      throw new Error(
        `Secret with ID ${secretId} not found for this function`
      );
    }
  }

  // ============== Group Scope Operations ==============

  /**
   * Get all secrets for a specific API key group (with decrypted values)
   */
  async getGroupSecrets(groupId: number): Promise<Secret[]> {
    const rows = await this.db.queryAll<{
      id: number;
      name: string;
      value: string;
      comment: string | null;
      scope: number;
      function_id: number | null;
      api_group_id: number | null;
      api_key_id: number | null;
      created_at: string;
      modified_at: string;
    }>(
      `SELECT id, name, value, comment, scope,
              function_id, api_group_id, api_key_id,
              created_at, modified_at
       FROM secrets
       WHERE scope = ? AND api_group_id = ?
       ORDER BY name ASC`,
      [SecretScope.Group, groupId]
    );

    // Decrypt all values
    const secrets: Secret[] = [];
    for (const row of rows) {
      const decryptedValue = await this.encryptionService.decrypt(row.value);
      secrets.push({
        id: row.id,
        name: row.name,
        value: decryptedValue,
        comment: row.comment,
        scope: row.scope,
        functionId: row.function_id,
        apiGroupId: row.api_group_id,
        apiKeyId: row.api_key_id,
        createdAt: row.created_at,
        modifiedAt: row.modified_at,
      });
    }

    return secrets;
  }

  /**
   * Get a group secret by ID (with decrypted value)
   */
  async getGroupSecretById(
    groupId: number,
    secretId: number
  ): Promise<Secret | null> {
    const row = await this.db.queryOne<{
      id: number;
      name: string;
      value: string;
      comment: string | null;
      scope: number;
      function_id: number | null;
      api_group_id: number | null;
      api_key_id: number | null;
      created_at: string;
      modified_at: string;
    }>(
      `SELECT id, name, value, comment, scope,
              function_id, api_group_id, api_key_id,
              created_at, modified_at
       FROM secrets
       WHERE id = ? AND scope = ? AND api_group_id = ?`,
      [secretId, SecretScope.Group, groupId]
    );

    if (!row) return null;

    const decryptedValue = await this.encryptionService.decrypt(row.value);

    return {
      id: row.id,
      name: row.name,
      value: decryptedValue,
      comment: row.comment,
      scope: row.scope,
      functionId: row.function_id,
      apiGroupId: row.api_group_id,
      apiKeyId: row.api_key_id,
      createdAt: row.created_at,
      modifiedAt: row.modified_at,
    };
  }

  /**
   * Create a new group secret
   * @throws Error if name is invalid or already exists for this group
   */
  async createGroupSecret(
    groupId: number,
    name: string,
    value: string,
    comment?: string
  ): Promise<void> {
    // Validate name format
    this.validateSecretName(name);

    // Check for duplicates within this group's scope
    const isDuplicate = await this.checkDuplicateGroup(groupId, name);
    if (isDuplicate) {
      throw new Error(
        `A secret with name '${name}' already exists for this group`
      );
    }

    // Encrypt value
    const encryptedValue = await this.encryptionService.encrypt(value);

    // Insert into database
    await this.db.execute(
      `INSERT INTO secrets (name, value, comment, scope, api_group_id, created_at, modified_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [name, encryptedValue, comment ?? null, SecretScope.Group, groupId]
    );
  }

  /**
   * Update a group secret's value and/or comment
   * @throws Error if secret not found
   */
  async updateGroupSecret(
    groupId: number,
    secretId: number,
    value: string,
    comment?: string
  ): Promise<void> {
    // Verify secret exists and belongs to this group
    const existing = await this.getGroupSecretById(groupId, secretId);
    if (!existing) {
      throw new Error(
        `Secret with ID ${secretId} not found for this group`
      );
    }

    // Encrypt new value
    const encryptedValue = await this.encryptionService.encrypt(value);

    // Update in database
    await this.db.execute(
      `UPDATE secrets
       SET value = ?, comment = ?, modified_at = CURRENT_TIMESTAMP
       WHERE id = ? AND scope = ? AND api_group_id = ?`,
      [
        encryptedValue,
        comment ?? null,
        secretId,
        SecretScope.Group,
        groupId,
      ]
    );
  }

  /**
   * Delete a group secret
   * @throws Error if secret not found
   */
  async deleteGroupSecret(
    groupId: number,
    secretId: number
  ): Promise<void> {
    const result = await this.db.execute(
      `DELETE FROM secrets
       WHERE id = ? AND scope = ? AND api_group_id = ?`,
      [secretId, SecretScope.Group, groupId]
    );

    if (result.changes === 0) {
      throw new Error(
        `Secret with ID ${secretId} not found for this group`
      );
    }
  }

  // ============== Validation ==============

  /**
   * Validates secret name format
   * @throws Error if name is invalid
   */
  private validateSecretName(name: string): void {
    if (!name || name.trim().length === 0) {
      throw new Error("Secret name cannot be empty");
    }

    if (!SECRET_NAME_REGEX.test(name)) {
      throw new Error(
        "Secret name can only contain letters, numbers, underscores, and dashes"
      );
    }
  }

  /**
   * Check if a global secret with the given name already exists
   */
  private async checkDuplicateGlobal(name: string): Promise<boolean> {
    const row = await this.db.queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM secrets WHERE name = ? AND scope = ?`,
      [name, SecretScope.Global]
    );

    return (row?.count ?? 0) > 0;
  }

  /**
   * Check if a function secret with the given name already exists
   */
  private async checkDuplicateFunction(
    functionId: number,
    name: string
  ): Promise<boolean> {
    const row = await this.db.queryOne<{ count: number }>(
      `SELECT COUNT(*) as count
       FROM secrets
       WHERE name = ? AND scope = ? AND function_id = ?`,
      [name, SecretScope.Function, functionId]
    );

    return (row?.count ?? 0) > 0;
  }

  /**
   * Check if a group secret with the given name already exists
   */
  private async checkDuplicateGroup(
    groupId: number,
    name: string
  ): Promise<boolean> {
    const row = await this.db.queryOne<{ count: number }>(
      `SELECT COUNT(*) as count
       FROM secrets
       WHERE name = ? AND scope = ? AND api_group_id = ?`,
      [name, SecretScope.Group, groupId]
    );

    return (row?.count ?? 0) > 0;
  }
}
