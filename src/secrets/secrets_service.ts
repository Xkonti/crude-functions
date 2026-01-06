import type { DatabaseService } from "../database/database_service.ts";
import type { IEncryptionService } from "../encryption/types.ts";
import type { Secret, SecretRow, SecretPreview } from "./types.ts";
import { SecretScope } from "./types.ts";

export interface SecretsServiceOptions {
  db: DatabaseService;
  encryptionService: IEncryptionService;
}

// Secret names: A-Z, a-z, 0-9, underscore, dash
const SECRET_NAME_REGEX = /^[a-zA-Z0-9_-]+$/;

/**
 * Service for managing secrets with encryption at rest.
 * Handles CRUD operations for secrets across all scopes (global, function, group, key).
 */
export class SecretsService {
  private readonly db: DatabaseService;
  private readonly encryptionService: IEncryptionService;

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
      `SELECT id, name, comment, createdAt, updatedAt
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
      functionId: number | null;
      apiGroupId: number | null;
      apiKeyId: number | null;
      createdAt: string;
      updatedAt: string;
    }>(
      `SELECT id, name, value, comment, scope,
              functionId, apiGroupId, apiKeyId,
              createdAt, updatedAt
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
        functionId: row.functionId,
        apiGroupId: row.apiGroupId,
        apiKeyId: row.apiKeyId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
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
      functionId: number | null;
      apiGroupId: number | null;
      apiKeyId: number | null;
      createdAt: string;
      updatedAt: string;
    }>(
      `SELECT id, name, value, comment, scope,
              functionId, apiGroupId, apiKeyId,
              createdAt, updatedAt
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
      functionId: row.functionId,
      apiGroupId: row.apiGroupId,
      apiKeyId: row.apiKeyId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
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
      `INSERT INTO secrets (name, value, comment, scope, createdAt, updatedAt)
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
       SET value = ?, comment = ?, updatedAt = CURRENT_TIMESTAMP
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
      functionId: number | null;
      apiGroupId: number | null;
      apiKeyId: number | null;
      createdAt: string;
      updatedAt: string;
    }>(
      `SELECT id, name, value, comment, scope,
              functionId, apiGroupId, apiKeyId,
              createdAt, updatedAt
       FROM secrets
       WHERE scope = ? AND functionId = ?
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
        functionId: row.functionId,
        apiGroupId: row.apiGroupId,
        apiKeyId: row.apiKeyId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
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
      functionId: number | null;
      apiGroupId: number | null;
      apiKeyId: number | null;
      createdAt: string;
      updatedAt: string;
    }>(
      `SELECT id, name, value, comment, scope,
              functionId, apiGroupId, apiKeyId,
              createdAt, updatedAt
       FROM secrets
       WHERE id = ? AND scope = ? AND functionId = ?`,
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
      functionId: row.functionId,
      apiGroupId: row.apiGroupId,
      apiKeyId: row.apiKeyId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
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
      `INSERT INTO secrets (name, value, comment, scope, functionId, createdAt, updatedAt)
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
       SET value = ?, comment = ?, updatedAt = CURRENT_TIMESTAMP
       WHERE id = ? AND scope = ? AND functionId = ?`,
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
       WHERE id = ? AND scope = ? AND functionId = ?`,
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
      functionId: number | null;
      apiGroupId: number | null;
      apiKeyId: number | null;
      createdAt: string;
      updatedAt: string;
    }>(
      `SELECT id, name, value, comment, scope,
              functionId, apiGroupId, apiKeyId,
              createdAt, updatedAt
       FROM secrets
       WHERE scope = ? AND apiGroupId = ?
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
        functionId: row.functionId,
        apiGroupId: row.apiGroupId,
        apiKeyId: row.apiKeyId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
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
      functionId: number | null;
      apiGroupId: number | null;
      apiKeyId: number | null;
      createdAt: string;
      updatedAt: string;
    }>(
      `SELECT id, name, value, comment, scope,
              functionId, apiGroupId, apiKeyId,
              createdAt, updatedAt
       FROM secrets
       WHERE id = ? AND scope = ? AND apiGroupId = ?`,
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
      functionId: row.functionId,
      apiGroupId: row.apiGroupId,
      apiKeyId: row.apiKeyId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
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
      `INSERT INTO secrets (name, value, comment, scope, apiGroupId, createdAt, updatedAt)
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
       SET value = ?, comment = ?, updatedAt = CURRENT_TIMESTAMP
       WHERE id = ? AND scope = ? AND apiGroupId = ?`,
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
       WHERE id = ? AND scope = ? AND apiGroupId = ?`,
      [secretId, SecretScope.Group, groupId]
    );

    if (result.changes === 0) {
      throw new Error(
        `Secret with ID ${secretId} not found for this group`
      );
    }
  }

  // ============== Key Scope Operations ==============

  /**
   * Get all secrets for a specific API key (with decrypted values)
   */
  async getKeySecrets(keyId: number): Promise<Secret[]> {
    const rows = await this.db.queryAll<{
      id: number;
      name: string;
      value: string;
      comment: string | null;
      scope: number;
      functionId: number | null;
      apiGroupId: number | null;
      apiKeyId: number | null;
      createdAt: string;
      updatedAt: string;
    }>(
      `SELECT id, name, value, comment, scope,
              functionId, apiGroupId, apiKeyId,
              createdAt, updatedAt
       FROM secrets
       WHERE scope = ? AND apiKeyId = ?
       ORDER BY name ASC`,
      [SecretScope.Key, keyId]
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
        functionId: row.functionId,
        apiGroupId: row.apiGroupId,
        apiKeyId: row.apiKeyId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      });
    }

    return secrets;
  }

  /**
   * Get a key secret by ID (with decrypted value)
   */
  async getKeySecretById(
    keyId: number,
    secretId: number
  ): Promise<Secret | null> {
    const row = await this.db.queryOne<{
      id: number;
      name: string;
      value: string;
      comment: string | null;
      scope: number;
      functionId: number | null;
      apiGroupId: number | null;
      apiKeyId: number | null;
      createdAt: string;
      updatedAt: string;
    }>(
      `SELECT id, name, value, comment, scope,
              functionId, apiGroupId, apiKeyId,
              createdAt, updatedAt
       FROM secrets
       WHERE id = ? AND scope = ? AND apiKeyId = ?`,
      [secretId, SecretScope.Key, keyId]
    );

    if (!row) return null;

    const decryptedValue = await this.encryptionService.decrypt(row.value);

    return {
      id: row.id,
      name: row.name,
      value: decryptedValue,
      comment: row.comment,
      scope: row.scope,
      functionId: row.functionId,
      apiGroupId: row.apiGroupId,
      apiKeyId: row.apiKeyId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * Create a new key secret
   * @throws Error if name is invalid or already exists for this key
   */
  async createKeySecret(
    keyId: number,
    name: string,
    value: string,
    comment?: string
  ): Promise<void> {
    // Validate name format
    this.validateSecretName(name);

    // Check for duplicates within this key's scope
    const isDuplicate = await this.checkDuplicateKey(keyId, name);
    if (isDuplicate) {
      throw new Error(
        `A secret with name '${name}' already exists for this API key`
      );
    }

    // Encrypt value
    const encryptedValue = await this.encryptionService.encrypt(value);

    // Insert into database
    await this.db.execute(
      `INSERT INTO secrets (name, value, comment, scope, apiKeyId, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [name, encryptedValue, comment ?? null, SecretScope.Key, keyId]
    );
  }

  /**
   * Update a key secret's value and/or comment
   * @throws Error if secret not found
   */
  async updateKeySecret(
    keyId: number,
    secretId: number,
    value: string,
    comment?: string
  ): Promise<void> {
    // Verify secret exists and belongs to this key
    const existing = await this.getKeySecretById(keyId, secretId);
    if (!existing) {
      throw new Error(
        `Secret with ID ${secretId} not found for this API key`
      );
    }

    // Encrypt new value
    const encryptedValue = await this.encryptionService.encrypt(value);

    // Update in database
    await this.db.execute(
      `UPDATE secrets
       SET value = ?, comment = ?, updatedAt = CURRENT_TIMESTAMP
       WHERE id = ? AND scope = ? AND apiKeyId = ?`,
      [
        encryptedValue,
        comment ?? null,
        secretId,
        SecretScope.Key,
        keyId,
      ]
    );
  }

  /**
   * Delete a key secret
   * @throws Error if secret not found
   */
  async deleteKeySecret(
    keyId: number,
    secretId: number
  ): Promise<void> {
    const result = await this.db.execute(
      `DELETE FROM secrets
       WHERE id = ? AND scope = ? AND apiKeyId = ?`,
      [secretId, SecretScope.Key, keyId]
    );

    if (result.changes === 0) {
      throw new Error(
        `Secret with ID ${secretId} not found for this API key`
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
       WHERE name = ? AND scope = ? AND functionId = ?`,
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
       WHERE name = ? AND scope = ? AND apiGroupId = ?`,
      [name, SecretScope.Group, groupId]
    );

    return (row?.count ?? 0) > 0;
  }

  /**
   * Check if a key secret with the given name already exists
   */
  private async checkDuplicateKey(
    keyId: number,
    name: string
  ): Promise<boolean> {
    const row = await this.db.queryOne<{ count: number }>(
      `SELECT COUNT(*) as count
       FROM secrets
       WHERE name = ? AND scope = ? AND apiKeyId = ?`,
      [name, SecretScope.Key, keyId]
    );

    return (row?.count ?? 0) > 0;
  }

  // ============== Preview Operations ==============

  /**
   * Get all secrets available to a function for preview purposes.
   * Returns secrets grouped by name with their sources across all scopes.
   * Only includes group/key secrets from groups the function accepts.
   */
  async getSecretsPreviewForFunction(
    functionId: number,
    acceptedGroupNames: string[]
  ): Promise<SecretPreview[]> {
    const previewMap = new Map<string, SecretPreview>();

    // 1. Load global secrets
    const globalSecrets = await this.getGlobalSecretsWithValues();
    for (const secret of globalSecrets) {
      if (!previewMap.has(secret.name)) {
        previewMap.set(secret.name, { name: secret.name, sources: [] });
      }
      previewMap.get(secret.name)!.sources.push({
        scope: 'global',
        value: secret.value,
      });
    }

    // 2. Load function-specific secrets
    const functionSecrets = await this.getFunctionSecrets(functionId);
    for (const secret of functionSecrets) {
      if (!previewMap.has(secret.name)) {
        previewMap.set(secret.name, { name: secret.name, sources: [] });
      }
      previewMap.get(secret.name)!.sources.push({
        scope: 'function',
        value: secret.value,
      });
    }

    // 3. Load group and key secrets (only for accepted groups)
    if (acceptedGroupNames.length > 0) {
      // Get group IDs for accepted group names
      const placeholders = acceptedGroupNames.map(() => '?').join(',');
      const groupsQuery = `
        SELECT id, name FROM apiKeyGroups
        WHERE name IN (${placeholders})
      `;
      const groups = await this.db.queryAll<{ id: number; name: string }>(
        groupsQuery,
        acceptedGroupNames
      );

      for (const group of groups) {
        // Get group-level secrets
        const groupSecrets = await this.getGroupSecrets(group.id);
        for (const secret of groupSecrets) {
          if (!previewMap.has(secret.name)) {
            previewMap.set(secret.name, { name: secret.name, sources: [] });
          }
          previewMap.get(secret.name)!.sources.push({
            scope: 'group',
            value: secret.value,
            groupId: group.id,
            groupName: group.name,
          });
        }

        // Get key-level secrets for this group
        const keySecretsQuery = `
          SELECT s.id, s.name, s.value, s.apiKeyId, k.name as key_name
          FROM secrets s
          JOIN apiKeys k ON s.apiKeyId = k.id
          WHERE s.scope = ? AND k.groupId = ?
          ORDER BY s.name ASC, k.name ASC
        `;
        const keySecretRows = await this.db.queryAll<{
          id: number;
          name: string;
          value: string;
          apiKeyId: number;
          key_name: string;
        }>(keySecretsQuery, [SecretScope.Key, group.id]);

        for (const row of keySecretRows) {
          const decryptedValue = await this.encryptionService.decrypt(row.value);
          if (!previewMap.has(row.name)) {
            previewMap.set(row.name, { name: row.name, sources: [] });
          }
          previewMap.get(row.name)!.sources.push({
            scope: 'key',
            value: decryptedValue,
            groupId: group.id,
            groupName: group.name,
            keyId: row.apiKeyId,
            keyName: row.key_name,
          });
        }
      }
    }

    // Convert map to sorted array
    return Array.from(previewMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }

  // ============== Name-Based Lookup Methods (for Handler Context) ==============

  /**
   * Get secret value by name for a specific scope
   * Used by ctx.getSecret() when scope is explicitly provided
   * @param name - Secret name
   * @param scope - Specific scope to query
   * @param functionId - Function ID (required for Function scope)
   * @param apiGroupId - API key group ID (required for Group scope)
   * @param apiKeyId - API key ID (required for Key scope)
   * @returns Decrypted secret value or undefined if not found
   */
  async getSecretByNameAndScope(
    name: string,
    scope: SecretScope,
    functionId?: number,
    apiGroupId?: number,
    apiKeyId?: number
  ): Promise<string | undefined> {
    let query: string;
    let params: (string | number)[];

    switch (scope) {
      case SecretScope.Global:
        query = `SELECT value FROM secrets WHERE name = ? AND scope = ?`;
        params = [name, SecretScope.Global];
        break;

      case SecretScope.Function:
        if (functionId === undefined) return undefined;
        query = `SELECT value FROM secrets WHERE name = ? AND scope = ? AND functionId = ?`;
        params = [name, SecretScope.Function, functionId];
        break;

      case SecretScope.Group:
        if (apiGroupId === undefined) return undefined;
        query = `SELECT value FROM secrets WHERE name = ? AND scope = ? AND apiGroupId = ?`;
        params = [name, SecretScope.Group, apiGroupId];
        break;

      case SecretScope.Key:
        if (apiKeyId === undefined) return undefined;
        query = `SELECT value FROM secrets WHERE name = ? AND scope = ? AND apiKeyId = ?`;
        params = [name, SecretScope.Key, apiKeyId];
        break;
    }

    const row = await this.db.queryOne<{ value: string }>(query, params);
    if (!row) return undefined;

    return await this.encryptionService.decrypt(row.value);
  }

  /**
   * Get secret with hierarchical resolution (most specific scope wins)
   * Resolution order: Key > Group > Function > Global
   * @param name - Secret name
   * @param functionId - Function (route) ID
   * @param apiGroupId - API key group ID (optional, if authenticated)
   * @param apiKeyId - API key ID (optional, if authenticated)
   * @returns Decrypted secret value or undefined if not found in any scope
   */
  async getSecretHierarchical(
    name: string,
    functionId: number,
    apiGroupId?: number,
    apiKeyId?: number
  ): Promise<string | undefined> {
    // 1. Key scope (most specific)
    if (apiKeyId !== undefined) {
      const keySecret = await this.getSecretByNameAndScope(
        name,
        SecretScope.Key,
        undefined,
        undefined,
        apiKeyId
      );
      if (keySecret !== undefined) return keySecret;
    }

    // 2. Group scope
    if (apiGroupId !== undefined) {
      const groupSecret = await this.getSecretByNameAndScope(
        name,
        SecretScope.Group,
        undefined,
        apiGroupId,
        undefined
      );
      if (groupSecret !== undefined) return groupSecret;
    }

    // 3. Function scope
    const functionSecret = await this.getSecretByNameAndScope(
      name,
      SecretScope.Function,
      functionId,
      undefined,
      undefined
    );
    if (functionSecret !== undefined) return functionSecret;

    // 4. Global scope (least specific)
    return await this.getSecretByNameAndScope(
      name,
      SecretScope.Global,
      undefined,
      undefined,
      undefined
    );
  }

  /**
   * Get complete secret details across all scopes
   * Used by ctx.getCompleteSecret()
   * @param name - Secret name
   * @param functionId - Function (route) ID
   * @param apiGroupId - API key group ID (optional, if authenticated)
   * @param apiKeyId - API key ID (optional, if authenticated)
   * @returns Object with values from all scopes, or undefined if not found in any scope
   */
  async getCompleteSecret(
    name: string,
    functionId: number,
    apiGroupId?: number,
    apiKeyId?: number
  ): Promise<
    | {
        global?: string;
        function?: string;
        group?: { value: string; groupId: number; groupName: string };
        key?: {
          value: string;
          groupId: number;
          groupName: string;
          keyId: number;
          keyName: string;
        };
      }
    | undefined
  > {
    let hasAnySecret = false;
    const result: {
      global?: string;
      function?: string;
      group?: { value: string; groupId: number; groupName: string };
      key?: {
        value: string;
        groupId: number;
        groupName: string;
        keyId: number;
        keyName: string;
      };
    } = {};

    // 1. Global scope
    const globalSecret = await this.getSecretByNameAndScope(
      name,
      SecretScope.Global
    );
    if (globalSecret !== undefined) {
      result.global = globalSecret;
      hasAnySecret = true;
    }

    // 2. Function scope
    const functionSecret = await this.getSecretByNameAndScope(
      name,
      SecretScope.Function,
      functionId
    );
    if (functionSecret !== undefined) {
      result.function = functionSecret;
      hasAnySecret = true;
    }

    // 3. Group scope (with metadata)
    if (apiGroupId !== undefined) {
      const groupRow = await this.db.queryOne<{
        value: string;
        group_id: number;
        group_name: string;
      }>(
        `SELECT s.value, s.apiGroupId as group_id, g.name as group_name
         FROM secrets s
         JOIN apiKeyGroups g ON s.apiGroupId = g.id
         WHERE s.name = ? AND s.scope = ? AND s.apiGroupId = ?`,
        [name, SecretScope.Group, apiGroupId]
      );

      if (groupRow) {
        const decryptedValue = await this.encryptionService.decrypt(
          groupRow.value
        );
        result.group = {
          value: decryptedValue,
          groupId: groupRow.group_id,
          groupName: groupRow.group_name,
        };
        hasAnySecret = true;
      }
    }

    // 4. Key scope (with metadata)
    if (apiKeyId !== undefined) {
      const keyRow = await this.db.queryOne<{
        value: string;
        key_id: number;
        group_id: number;
        group_name: string;
        key_name: string;
      }>(
        `SELECT s.value, s.apiKeyId as key_id, g.id as group_id,
                g.name as group_name, k.name as key_name
         FROM secrets s
         JOIN apiKeys k ON s.apiKeyId = k.id
         JOIN apiKeyGroups g ON k.groupId = g.id
         WHERE s.name = ? AND s.scope = ? AND s.apiKeyId = ?`,
        [name, SecretScope.Key, apiKeyId]
      );

      if (keyRow) {
        const decryptedSecretValue = await this.encryptionService.decrypt(
          keyRow.value
        );
        result.key = {
          value: decryptedSecretValue,
          groupId: keyRow.group_id,
          groupName: keyRow.group_name,
          keyId: keyRow.key_id,
          keyName: keyRow.key_name,
        };
        hasAnySecret = true;
      }
    }

    return hasAnySecret ? result : undefined;
  }
}
