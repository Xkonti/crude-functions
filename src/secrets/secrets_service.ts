import { RecordId } from "surrealdb";
import { Mutex } from "@core/asyncutil/mutex";
import type { SurrealConnectionFactory } from "../database/surreal_connection_factory.ts";
import type { IEncryptionService } from "../encryption/types.ts";
import type { Secret, SecretRow, SecretPreview, SecretScopeType } from "./types.ts";
import { validateSecretName as isValidSecretName } from "../validation/secrets.ts";

export interface SecretsServiceOptions {
  surrealFactory: SurrealConnectionFactory;
  encryptionService: IEncryptionService;
}

/**
 * Service for managing secrets with encryption at rest.
 * Handles CRUD operations for secrets across all scopes (global, function, group, key).
 *
 * ID Handling: All IDs are RecordId internally. Convert to string only at API/UI boundaries.
 */
export class SecretsService {
  private readonly surrealFactory: SurrealConnectionFactory;
  private readonly encryptionService: IEncryptionService;
  private readonly writeMutex = new Mutex();

  constructor(options: SecretsServiceOptions) {
    this.surrealFactory = options.surrealFactory;
    this.encryptionService = options.encryptionService;
  }

  // ============== Helper Methods ==============

  /**
   * Decrypt secrets from raw database rows
   */
  private async decryptSecrets(rows: SecretRow[]): Promise<Secret[]> {
    const secrets: Secret[] = [];
    for (const row of rows) {
      let decryptedValue = "";
      let decryptionError: string | undefined;
      try {
        decryptedValue = await this.encryptionService.decrypt(row.value);
      } catch (error) {
        decryptionError =
          error instanceof Error ? error.message : "Decryption failed";
      }
      secrets.push({
        id: row.id,
        name: row.name,
        value: decryptedValue,
        decryptionError,
        comment: row.comment,
        scopeType: row.scopeType,
        scopeRef: row.scopeRef,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      });
    }
    return secrets;
  }

  /**
   * Validates secret name format
   * @throws Error if name is invalid
   */
  private validateSecretName(name: string): void {
    if (!name || name.trim().length === 0) {
      throw new Error("Secret name cannot be empty");
    }

    if (!isValidSecretName(name)) {
      throw new Error(
        "Secret name can only contain letters, numbers, underscores, and dashes"
      );
    }
  }

  // ============== Global Scope Operations ==============

  /**
   * Get all global secrets with decrypted values
   */
  async getGlobalSecrets(): Promise<Secret[]> {
    return await this.surrealFactory.withSystemConnection({}, async (db) => {
      const [rows] = await db.query<[SecretRow[]]>(
        `SELECT * FROM secret WHERE scopeType = "global" ORDER BY name`
      );
      return await this.decryptSecrets(rows ?? []);
    });
  }

  /**
   * Get a global secret by ID (with decrypted value)
   */
  async getGlobalSecretById(id: string): Promise<Secret | null> {
    return await this.surrealFactory.withSystemConnection({}, async (db) => {
      const recordId = new RecordId("secret", id);
      const [rows] = await db.query<[SecretRow[]]>(
        `SELECT * FROM $recordId WHERE scopeType = "global"`,
        { recordId }
      );
      const row = rows?.[0];
      if (!row) return null;
      return (await this.decryptSecrets([row]))[0];
    });
  }

  /**
   * Create a new global secret
   * @returns RecordId of the created secret
   * @throws Error if name is invalid or already exists
   */
  async createGlobalSecret(
    name: string,
    value: string,
    comment?: string
  ): Promise<RecordId> {
    using _lock = await this.writeMutex.acquire();
    this.validateSecretName(name);

    const encryptedValue = await this.encryptionService.encrypt(value);

    try {
      return await this.surrealFactory.withSystemConnection({}, async (db) => {
        const [rows] = await db.query<[{ id: RecordId }[]]>(
          `CREATE secret SET
            name = $name,
            value = $value,
            comment = $comment,
            scopeType = "global",
            scopeRef = NONE`,
          { name, value: encryptedValue, comment }
        );
        return rows[0].id;
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("unique_secret_name_scope")) {
        throw new Error(`A global secret with name '${name}' already exists`);
      }
      throw error;
    }
  }

  /**
   * Update a global secret's value and/or comment
   * @throws Error if secret not found
   */
  async updateGlobalSecret(
    id: string,
    value: string,
    comment?: string
  ): Promise<void> {
    using _lock = await this.writeMutex.acquire();

    const existing = await this.getGlobalSecretById(id);
    if (!existing) {
      throw new Error(`Secret with ID ${id} not found`);
    }

    const encryptedValue = await this.encryptionService.encrypt(value);
    const recordId = new RecordId("secret", id);

    await this.surrealFactory.withSystemConnection({}, async (db) => {
      await db.query(
        `UPDATE $recordId SET
          value = $value,
          comment = $comment,
          updatedAt = time::now()`,
        { recordId, value: encryptedValue, comment }
      );
    });
  }

  /**
   * Delete a global secret
   * @throws Error if secret not found
   */
  async deleteGlobalSecret(id: string): Promise<void> {
    using _lock = await this.writeMutex.acquire();

    const recordId = new RecordId("secret", id);

    await this.surrealFactory.withSystemConnection({}, async (db) => {
      const [rows] = await db.query<[{ id: RecordId }[]]>(
        `DELETE $recordId WHERE scopeType = "global" RETURN BEFORE`,
        { recordId }
      );
      if (!rows || rows.length === 0) {
        throw new Error(`Secret with ID ${id} not found`);
      }
    });
  }

  // ============== Function Scope Operations ==============

  /**
   * Get all secrets for a specific function (with decrypted values)
   */
  async getFunctionSecrets(functionId: string): Promise<Secret[]> {
    const scopeRef = new RecordId("route", functionId);

    return await this.surrealFactory.withSystemConnection({}, async (db) => {
      const [rows] = await db.query<[SecretRow[]]>(
        `SELECT * FROM secret WHERE scopeType = "function" AND scopeRef = $scopeRef ORDER BY name`,
        { scopeRef }
      );
      return await this.decryptSecrets(rows ?? []);
    });
  }

  /**
   * Get a function secret by ID (with decrypted value)
   */
  async getFunctionSecretById(
    functionId: string,
    secretId: string
  ): Promise<Secret | null> {
    const scopeRef = new RecordId("route", functionId);
    const recordId = new RecordId("secret", secretId);

    return await this.surrealFactory.withSystemConnection({}, async (db) => {
      const [rows] = await db.query<[SecretRow[]]>(
        `SELECT * FROM $recordId WHERE scopeType = "function" AND scopeRef = $scopeRef`,
        { recordId, scopeRef }
      );
      const row = rows?.[0];
      if (!row) return null;
      return (await this.decryptSecrets([row]))[0];
    });
  }

  /**
   * Create a new function secret
   * @returns RecordId of the created secret
   * @throws Error if name is invalid or already exists for this function
   */
  async createFunctionSecret(
    functionId: string,
    name: string,
    value: string,
    comment?: string
  ): Promise<RecordId> {
    using _lock = await this.writeMutex.acquire();
    this.validateSecretName(name);

    const encryptedValue = await this.encryptionService.encrypt(value);
    const scopeRef = new RecordId("route", functionId);

    try {
      return await this.surrealFactory.withSystemConnection({}, async (db) => {
        const [rows] = await db.query<[{ id: RecordId }[]]>(
          `CREATE secret SET
            name = $name,
            value = $value,
            comment = $comment,
            scopeType = "function",
            scopeRef = $scopeRef`,
          { name, value: encryptedValue, comment, scopeRef }
        );
        return rows[0].id;
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("unique_secret_name_scope")) {
        throw new Error(`A secret with name '${name}' already exists for this function`);
      }
      throw error;
    }
  }

  /**
   * Update a function secret's value and/or comment
   * @throws Error if secret not found
   */
  async updateFunctionSecret(
    functionId: string,
    secretId: string,
    value: string,
    comment?: string
  ): Promise<void> {
    using _lock = await this.writeMutex.acquire();

    const existing = await this.getFunctionSecretById(functionId, secretId);
    if (!existing) {
      throw new Error(`Secret with ID ${secretId} not found for this function`);
    }

    const encryptedValue = await this.encryptionService.encrypt(value);
    const recordId = new RecordId("secret", secretId);

    await this.surrealFactory.withSystemConnection({}, async (db) => {
      await db.query(
        `UPDATE $recordId SET
          value = $value,
          comment = $comment,
          updatedAt = time::now()`,
        { recordId, value: encryptedValue, comment }
      );
    });
  }

  /**
   * Delete a function secret
   * @throws Error if secret not found
   */
  async deleteFunctionSecret(
    functionId: string,
    secretId: string
  ): Promise<void> {
    using _lock = await this.writeMutex.acquire();

    const scopeRef = new RecordId("route", functionId);
    const recordId = new RecordId("secret", secretId);

    await this.surrealFactory.withSystemConnection({}, async (db) => {
      const [rows] = await db.query<[{ id: RecordId }[]]>(
        `DELETE $recordId WHERE scopeType = "function" AND scopeRef = $scopeRef RETURN BEFORE`,
        { recordId, scopeRef }
      );
      if (!rows || rows.length === 0) {
        throw new Error(`Secret with ID ${secretId} not found for this function`);
      }
    });
  }

  /**
   * Delete all function-scoped secrets for a given function ID
   * Used for cascade delete when a route is deleted
   */
  async deleteFunctionSecretsByFunctionId(functionId: string): Promise<void> {
    using _lock = await this.writeMutex.acquire();

    const scopeRef = new RecordId("route", functionId);

    await this.surrealFactory.withSystemConnection({}, async (db) => {
      await db.query(
        `DELETE secret WHERE scopeType = "function" AND scopeRef = $scopeRef`,
        { scopeRef }
      );
    });
  }

  // ============== Group Scope Operations ==============

  /**
   * Get all secrets for a specific API key group (with decrypted values)
   */
  async getGroupSecrets(groupId: string): Promise<Secret[]> {
    const scopeRef = new RecordId("apiKeyGroup", groupId);

    return await this.surrealFactory.withSystemConnection({}, async (db) => {
      const [rows] = await db.query<[SecretRow[]]>(
        `SELECT * FROM secret WHERE scopeType = "group" AND scopeRef = $scopeRef ORDER BY name`,
        { scopeRef }
      );
      return await this.decryptSecrets(rows ?? []);
    });
  }

  /**
   * Get a group secret by ID (with decrypted value)
   */
  async getGroupSecretById(
    groupId: string,
    secretId: string
  ): Promise<Secret | null> {
    const scopeRef = new RecordId("apiKeyGroup", groupId);
    const recordId = new RecordId("secret", secretId);

    return await this.surrealFactory.withSystemConnection({}, async (db) => {
      const [rows] = await db.query<[SecretRow[]]>(
        `SELECT * FROM $recordId WHERE scopeType = "group" AND scopeRef = $scopeRef`,
        { recordId, scopeRef }
      );
      const row = rows?.[0];
      if (!row) return null;
      return (await this.decryptSecrets([row]))[0];
    });
  }

  /**
   * Create a new group secret
   * @returns RecordId of the created secret
   * @throws Error if name is invalid or already exists for this group
   */
  async createGroupSecret(
    groupId: string,
    name: string,
    value: string,
    comment?: string
  ): Promise<RecordId> {
    using _lock = await this.writeMutex.acquire();
    this.validateSecretName(name);

    const encryptedValue = await this.encryptionService.encrypt(value);
    const scopeRef = new RecordId("apiKeyGroup", groupId);

    try {
      return await this.surrealFactory.withSystemConnection({}, async (db) => {
        const [rows] = await db.query<[{ id: RecordId }[]]>(
          `CREATE secret SET
            name = $name,
            value = $value,
            comment = $comment,
            scopeType = "group",
            scopeRef = $scopeRef`,
          { name, value: encryptedValue, comment, scopeRef }
        );
        return rows[0].id;
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("unique_secret_name_scope")) {
        throw new Error(`A secret with name '${name}' already exists for this group`);
      }
      throw error;
    }
  }

  /**
   * Update a group secret's value and/or comment
   * @throws Error if secret not found
   */
  async updateGroupSecret(
    groupId: string,
    secretId: string,
    value: string,
    comment?: string
  ): Promise<void> {
    using _lock = await this.writeMutex.acquire();

    const existing = await this.getGroupSecretById(groupId, secretId);
    if (!existing) {
      throw new Error(`Secret with ID ${secretId} not found for this group`);
    }

    const encryptedValue = await this.encryptionService.encrypt(value);
    const recordId = new RecordId("secret", secretId);

    await this.surrealFactory.withSystemConnection({}, async (db) => {
      await db.query(
        `UPDATE $recordId SET
          value = $value,
          comment = $comment,
          updatedAt = time::now()`,
        { recordId, value: encryptedValue, comment }
      );
    });
  }

  /**
   * Delete a group secret
   * @throws Error if secret not found
   */
  async deleteGroupSecret(groupId: string, secretId: string): Promise<void> {
    using _lock = await this.writeMutex.acquire();

    const scopeRef = new RecordId("apiKeyGroup", groupId);
    const recordId = new RecordId("secret", secretId);

    await this.surrealFactory.withSystemConnection({}, async (db) => {
      const [rows] = await db.query<[{ id: RecordId }[]]>(
        `DELETE $recordId WHERE scopeType = "group" AND scopeRef = $scopeRef RETURN BEFORE`,
        { recordId, scopeRef }
      );
      if (!rows || rows.length === 0) {
        throw new Error(`Secret with ID ${secretId} not found for this group`);
      }
    });
  }

  // ============== Key Scope Operations ==============

  /**
   * Get all secrets for a specific API key (with decrypted values)
   */
  async getKeySecrets(keyId: string): Promise<Secret[]> {
    const scopeRef = new RecordId("apiKey", keyId);

    return await this.surrealFactory.withSystemConnection({}, async (db) => {
      const [rows] = await db.query<[SecretRow[]]>(
        `SELECT * FROM secret WHERE scopeType = "key" AND scopeRef = $scopeRef ORDER BY name`,
        { scopeRef }
      );
      return await this.decryptSecrets(rows ?? []);
    });
  }

  /**
   * Get a key secret by ID (with decrypted value)
   */
  async getKeySecretById(
    keyId: string,
    secretId: string
  ): Promise<Secret | null> {
    const scopeRef = new RecordId("apiKey", keyId);
    const recordId = new RecordId("secret", secretId);

    return await this.surrealFactory.withSystemConnection({}, async (db) => {
      const [rows] = await db.query<[SecretRow[]]>(
        `SELECT * FROM $recordId WHERE scopeType = "key" AND scopeRef = $scopeRef`,
        { recordId, scopeRef }
      );
      const row = rows?.[0];
      if (!row) return null;
      return (await this.decryptSecrets([row]))[0];
    });
  }

  /**
   * Create a new key secret
   * @returns RecordId of the created secret
   * @throws Error if name is invalid or already exists for this key
   */
  async createKeySecret(
    keyId: string,
    name: string,
    value: string,
    comment?: string
  ): Promise<RecordId> {
    using _lock = await this.writeMutex.acquire();
    this.validateSecretName(name);

    const encryptedValue = await this.encryptionService.encrypt(value);
    const scopeRef = new RecordId("apiKey", keyId);

    try {
      return await this.surrealFactory.withSystemConnection({}, async (db) => {
        const [rows] = await db.query<[{ id: RecordId }[]]>(
          `CREATE secret SET
            name = $name,
            value = $value,
            comment = $comment,
            scopeType = "key",
            scopeRef = $scopeRef`,
          { name, value: encryptedValue, comment, scopeRef }
        );
        return rows[0].id;
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("unique_secret_name_scope")) {
        throw new Error(`A secret with name '${name}' already exists for this key`);
      }
      throw error;
    }
  }

  /**
   * Update a key secret's value and/or comment
   * @throws Error if secret not found
   */
  async updateKeySecret(
    keyId: string,
    secretId: string,
    value: string,
    comment?: string
  ): Promise<void> {
    using _lock = await this.writeMutex.acquire();

    const existing = await this.getKeySecretById(keyId, secretId);
    if (!existing) {
      throw new Error(`Secret with ID ${secretId} not found for this API key`);
    }

    const encryptedValue = await this.encryptionService.encrypt(value);
    const recordId = new RecordId("secret", secretId);

    await this.surrealFactory.withSystemConnection({}, async (db) => {
      await db.query(
        `UPDATE $recordId SET
          value = $value,
          comment = $comment,
          updatedAt = time::now()`,
        { recordId, value: encryptedValue, comment }
      );
    });
  }

  /**
   * Delete a key secret
   * @throws Error if secret not found
   */
  async deleteKeySecret(keyId: string, secretId: string): Promise<void> {
    using _lock = await this.writeMutex.acquire();

    const scopeRef = new RecordId("apiKey", keyId);
    const recordId = new RecordId("secret", secretId);

    await this.surrealFactory.withSystemConnection({}, async (db) => {
      const [rows] = await db.query<[{ id: RecordId }[]]>(
        `DELETE $recordId WHERE scopeType = "key" AND scopeRef = $scopeRef RETURN BEFORE`,
        { recordId, scopeRef }
      );
      if (!rows || rows.length === 0) {
        throw new Error(`Secret with ID ${secretId} not found for this API key`);
      }
    });
  }

  // ============== Name-Based Lookup Methods (for Handler Context) ==============

  /**
   * Get secret value by name for a specific scope
   * Internal method used by public getSecretByScope
   */
  private async getSecretValueByNameAndScope(
    name: string,
    scopeType: SecretScopeType,
    scopeRef: RecordId | undefined
  ): Promise<string | undefined> {
    return await this.surrealFactory.withSystemConnection({}, async (db) => {
      // Handle global scope (NONE) differently - can't compare null with NONE directly
      const query = scopeRef === null
        ? `SELECT * FROM secret WHERE name = $name AND scopeType = $scopeType AND scopeRef IS NONE LIMIT 1`
        : `SELECT * FROM secret WHERE name = $name AND scopeType = $scopeType AND scopeRef = $scopeRef LIMIT 1`;
      const [rows] = await db.query<[SecretRow[]]>(query, { name, scopeType, scopeRef });
      const row = rows?.[0];
      if (!row) return undefined;
      return await this.encryptionService.decrypt(row.value);
    });
  }

  /**
   * Get secret value by name for a specific scope.
   * Used by ctx.getSecret() when scope is explicitly provided.
   * @param name - Secret name
   * @param scopeType - Scope type to query
   * @param functionId - Function ID (required for "function" scope)
   * @param apiGroupId - API key group ID (required for "group" scope)
   * @param apiKeyId - API key ID (required for "key" scope)
   * @returns Decrypted secret value or undefined if not found
   */
  async getSecretByScope(
    name: string,
    scopeType: SecretScopeType,
    functionId?: string,
    apiGroupId?: string,
    apiKeyId?: string
  ): Promise<string | undefined> {
    let scopeRef: RecordId | undefined;

    switch (scopeType) {
      case "global":
        scopeRef = undefined;
        break;
      case "function":
        if (functionId === undefined) return undefined;
        scopeRef = new RecordId("route", functionId);
        break;
      case "group":
        if (apiGroupId === undefined) return undefined;
        scopeRef = new RecordId("apiKeyGroup", apiGroupId);
        break;
      case "key":
        if (apiKeyId === undefined) return undefined;
        scopeRef = new RecordId("apiKey", apiKeyId);
        break;
    }

    return await this.getSecretValueByNameAndScope(name, scopeType, scopeRef);
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
    functionId: string,
    apiGroupId?: string,
    apiKeyId?: string
  ): Promise<string | undefined> {
    // 1. Key scope (most specific)
    if (apiKeyId !== undefined) {
      const scopeRef = new RecordId("apiKey", apiKeyId);
      const keySecret = await this.getSecretValueByNameAndScope(name, "key", scopeRef);
      if (keySecret !== undefined) return keySecret;
    }

    // 2. Group scope
    if (apiGroupId !== undefined) {
      const scopeRef = new RecordId("apiKeyGroup", apiGroupId);
      const groupSecret = await this.getSecretValueByNameAndScope(name, "group", scopeRef);
      if (groupSecret !== undefined) return groupSecret;
    }

    // 3. Function scope
    const functionScopeRef = new RecordId("route", functionId);
    const functionSecret = await this.getSecretValueByNameAndScope(name, "function", functionScopeRef);
    if (functionSecret !== undefined) return functionSecret;

    // 4. Global scope (least specific)
    return await this.getSecretValueByNameAndScope(name, "global", undefined);
  }

  /**
   * Get complete secret details across all scopes
   * Used by ctx.getCompleteSecret()
   */
  async getCompleteSecret(
    name: string,
    functionId: string,
    apiGroupId?: string,
    apiKeyId?: string
  ): Promise<
    | {
        global?: string;
        function?: string;
        group?: { value: string; groupId: string; groupName: string };
        key?: {
          value: string;
          groupId: string;
          groupName: string;
          keyId: string;
          keyName: string;
        };
      }
    | undefined
  > {
    let hasAnySecret = false;
    const result: {
      global?: string;
      function?: string;
      group?: { value: string; groupId: string; groupName: string };
      key?: {
        value: string;
        groupId: string;
        groupName: string;
        keyId: string;
        keyName: string;
      };
    } = {};

    // 1. Global scope
    const globalSecret = await this.getSecretValueByNameAndScope(name, "global", undefined);
    if (globalSecret !== undefined) {
      result.global = globalSecret;
      hasAnySecret = true;
    }

    // 2. Function scope
    const functionScopeRef = new RecordId("route", functionId);
    const functionSecret = await this.getSecretValueByNameAndScope(name, "function", functionScopeRef);
    if (functionSecret !== undefined) {
      result.function = functionSecret;
      hasAnySecret = true;
    }

    // 3. Group scope (with metadata)
    if (apiGroupId !== undefined) {
      const groupScopeRef = new RecordId("apiKeyGroup", apiGroupId);
      const groupSecretValue = await this.getSecretValueByNameAndScope(name, "group", groupScopeRef);

      if (groupSecretValue !== undefined) {
        // Get group name
        const groupRecord = await this.surrealFactory.withSystemConnection({}, async (db) => {
          const groupRecordId = new RecordId("apiKeyGroup", apiGroupId);
          const [rows] = await db.query<[{ name: string }[]]>(
            `SELECT name FROM $groupRecordId`,
            { groupRecordId }
          );
          return rows?.[0];
        });

        result.group = {
          value: groupSecretValue,
          groupId: apiGroupId,
          groupName: groupRecord?.name ?? "Unknown",
        };
        hasAnySecret = true;
      }
    }

    // 4. Key scope (with metadata)
    if (apiKeyId !== undefined) {
      const keyScopeRef = new RecordId("apiKey", apiKeyId);
      const keySecretValue = await this.getSecretValueByNameAndScope(name, "key", keyScopeRef);

      if (keySecretValue !== undefined) {
        // Get key and group info
        const keyRecord = await this.surrealFactory.withSystemConnection({}, async (db) => {
          const keyRecordId = new RecordId("apiKey", apiKeyId);
          const [rows] = await db.query<[{ name: string; groupId: RecordId; groupName: string }[]]>(
            `SELECT name, groupId, groupId.name as groupName FROM $keyRecordId`,
            { keyRecordId }
          );
          return rows?.[0];
        });

        if (keyRecord) {
          result.key = {
            value: keySecretValue,
            groupId: keyRecord.groupId.id as string,
            groupName: keyRecord.groupName,
            keyId: apiKeyId,
            keyName: keyRecord.name,
          };
          hasAnySecret = true;
        }
      }
    }

    return hasAnySecret ? result : undefined;
  }

  // ============== Preview Operations ==============

  /**
   * Get all secrets available to a function for preview purposes.
   * Returns secrets grouped by name with their sources across all scopes.
   * Only includes group/key secrets from groups the function accepts.
   */
  async getSecretsPreviewForFunction(
    functionId: string,
    acceptedGroupIds: string[]
  ): Promise<SecretPreview[]> {
    const previewMap = new Map<string, SecretPreview>();

    // 1. Load global secrets
    const globalSecrets = await this.getGlobalSecrets();
    for (const secret of globalSecrets) {
      if (!previewMap.has(secret.name)) {
        previewMap.set(secret.name, { name: secret.name, sources: [] });
      }
      previewMap.get(secret.name)!.sources.push({
        scope: "global",
        value: secret.value,
        decryptionError: secret.decryptionError,
      });
    }

    // 2. Load function-specific secrets
    const functionSecrets = await this.getFunctionSecrets(functionId);
    for (const secret of functionSecrets) {
      if (!previewMap.has(secret.name)) {
        previewMap.set(secret.name, { name: secret.name, sources: [] });
      }
      previewMap.get(secret.name)!.sources.push({
        scope: "function",
        value: secret.value,
        decryptionError: secret.decryptionError,
      });
    }

    // 3. Load group and key secrets (only for accepted groups)
    for (const groupId of acceptedGroupIds) {
      // Get group name
      const groupRecord = await this.surrealFactory.withSystemConnection({}, async (db) => {
        const groupRecordId = new RecordId("apiKeyGroup", groupId);
        const [rows] = await db.query<[{ name: string }[]]>(
          `SELECT name FROM $groupRecordId`,
          { groupRecordId }
        );
        return rows?.[0];
      });

      if (!groupRecord) continue;
      const groupName = groupRecord.name;

      // Get group-level secrets
      const groupSecrets = await this.getGroupSecrets(groupId);
      for (const secret of groupSecrets) {
        if (!previewMap.has(secret.name)) {
          previewMap.set(secret.name, { name: secret.name, sources: [] });
        }
        previewMap.get(secret.name)!.sources.push({
          scope: "group",
          value: secret.value,
          decryptionError: secret.decryptionError,
          groupId,
          groupName,
        });
      }

      // Get key-level secrets for this group
      // First get all API keys in the group
      const groupRecordId = new RecordId("apiKeyGroup", groupId);
      const keySecrets = await this.surrealFactory.withSystemConnection({}, async (db) => {
        // Get keys in this group
        const [keys] = await db.query<[{ id: RecordId; name: string }[]]>(
          `SELECT id, name FROM apiKey WHERE groupId = $groupRecordId`,
          { groupRecordId }
        );

        const results: {
          secretName: string;
          secretValue: string;
          keyId: RecordId;
          keyName: string;
        }[] = [];

        // Get secrets for each key
        for (const key of (keys ?? [])) {
          const [secrets] = await db.query<[SecretRow[]]>(
            `SELECT * FROM secret WHERE scopeType = "key" AND scopeRef = $keyId`,
            { keyId: key.id }
          );
          for (const secret of (secrets ?? [])) {
            results.push({
              secretName: secret.name,
              secretValue: secret.value,
              keyId: key.id,
              keyName: key.name,
            });
          }
        }
        return results;
      });

      for (const row of keySecrets) {
        let decryptedValue = "";
        let decryptionError: string | undefined;
        try {
          decryptedValue = await this.encryptionService.decrypt(row.secretValue);
        } catch (error) {
          decryptionError =
            error instanceof Error ? error.message : "Decryption failed";
        }

        if (!previewMap.has(row.secretName)) {
          previewMap.set(row.secretName, { name: row.secretName, sources: [] });
        }
        previewMap.get(row.secretName)!.sources.push({
          scope: "key",
          value: decryptedValue,
          decryptionError,
          groupId,
          groupName,
          keyId: row.keyId.id as string,
          keyName: row.keyName,
        });
      }
    }

    // Convert map to sorted array
    return Array.from(previewMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }

  // ============== Generic REST API Operations ==============

  /**
   * Get a secret by ID regardless of scope
   * Returns full secret with decrypted value
   */
  async getSecretById(id: string): Promise<Secret | null> {
    return await this.surrealFactory.withSystemConnection({}, async (db) => {
      const recordId = new RecordId("secret", id);
      const [rows] = await db.query<[SecretRow[]]>(
        `SELECT * FROM $recordId`,
        { recordId }
      );
      const row = rows?.[0];
      if (!row) return null;
      return (await this.decryptSecrets([row]))[0];
    });
  }

  /**
   * Search for secrets by name across all scopes or specific scope
   * Returns array of secrets with decrypted values
   */
  async getSecretsByName(
    name: string,
    scopeType?: SecretScopeType
  ): Promise<Secret[]> {
    return await this.surrealFactory.withSystemConnection({}, async (db) => {
      let query: string;
      let params: Record<string, unknown>;

      if (scopeType) {
        query = `SELECT * FROM secret WHERE name = $name AND scopeType = $scopeType ORDER BY scopeType, id`;
        params = { name, scopeType };
      } else {
        query = `SELECT * FROM secret WHERE name = $name ORDER BY scopeType, id`;
        params = { name };
      }

      const [rows] = await db.query<[SecretRow[]]>(query, params);
      return await this.decryptSecrets(rows ?? []);
    });
  }

  /**
   * Get all secrets with optional filtering
   */
  async getAllSecrets(options: {
    scopeType?: SecretScopeType;
    functionId?: string;
    groupId?: string;
    keyId?: string;
  } = {}): Promise<Secret[]> {
    const { scopeType, functionId, groupId, keyId } = options;

    return await this.surrealFactory.withSystemConnection({}, async (db) => {
      let query = `SELECT * FROM secret WHERE true`;
      const params: Record<string, unknown> = {};

      if (scopeType) {
        query += ` AND scopeType = $scopeType`;
        params.scopeType = scopeType;
      }

      if (functionId !== undefined) {
        const scopeRef = new RecordId("route", functionId);
        query += ` AND scopeRef = $scopeRef`;
        params.scopeRef = scopeRef;
      } else if (groupId !== undefined) {
        const scopeRef = new RecordId("apiKeyGroup", groupId);
        query += ` AND scopeRef = $scopeRef`;
        params.scopeRef = scopeRef;
      } else if (keyId !== undefined) {
        const scopeRef = new RecordId("apiKey", keyId);
        query += ` AND scopeRef = $scopeRef`;
        params.scopeRef = scopeRef;
      }

      query += ` ORDER BY name`;

      const [rows] = await db.query<[SecretRow[]]>(query, params);
      return await this.decryptSecrets(rows ?? []);
    });
  }

  /**
   * Create a secret for any scope
   * Returns the RecordId of the new secret
   */
  async createSecret(data: {
    name: string;
    value: string;
    comment?: string;
    scopeType: SecretScopeType;
    functionId?: string;
    groupId?: string;
    keyId?: string;
  }): Promise<RecordId> {
    const { name, value, comment, scopeType, functionId, groupId, keyId } = data;

    switch (scopeType) {
      case "global":
        return await this.createGlobalSecret(name, value, comment);

      case "function":
        if (functionId === undefined) {
          throw new Error("functionId is required for function-scoped secrets");
        }
        return await this.createFunctionSecret(functionId, name, value, comment);

      case "group":
        if (groupId === undefined) {
          throw new Error("groupId is required for group-scoped secrets");
        }
        return await this.createGroupSecret(groupId, name, value, comment);

      case "key":
        if (keyId === undefined) {
          throw new Error("keyId is required for key-scoped secrets");
        }
        return await this.createKeySecret(keyId, name, value, comment);

      default:
        throw new Error(`Unsupported scope type: ${scopeType}`);
    }
  }

  /**
   * Update a secret by ID
   * Updates value and/or comment
   */
  async updateSecretById(
    id: string,
    updates: {
      value?: string;
      comment?: string;
    }
  ): Promise<void> {
    using _lock = await this.writeMutex.acquire();

    const { value, comment } = updates;

    // Get the current secret
    const current = await this.getSecretById(id);
    if (!current) {
      throw new Error(`Secret with ID ${id} not found`);
    }

    const recordId = new RecordId("secret", id);

    await this.surrealFactory.withSystemConnection({}, async (db) => {
      const updateFields: string[] = [];
      const params: Record<string, unknown> = { recordId };

      if (value !== undefined) {
        const encryptedValue = await this.encryptionService.encrypt(value);
        updateFields.push("value = $value");
        params.value = encryptedValue;
      }

      if (comment !== undefined) {
        updateFields.push("comment = $comment");
        params.comment = comment;
      }

      if (updateFields.length === 0) {
        throw new Error("At least one field must be provided for update");
      }

      updateFields.push("updatedAt = time::now()");

      const query = `UPDATE $recordId SET ${updateFields.join(", ")}`;
      await db.query(query, params);
    });
  }

  /**
   * Delete a secret by ID
   */
  async deleteSecretById(id: string): Promise<void> {
    using _lock = await this.writeMutex.acquire();

    const recordId = new RecordId("secret", id);

    await this.surrealFactory.withSystemConnection({}, async (db) => {
      const [rows] = await db.query<[{ id: RecordId }[]]>(
        `DELETE $recordId RETURN BEFORE`,
        { recordId }
      );
      if (!rows || rows.length === 0) {
        throw new Error(`Secret with ID ${id} not found`);
      }
    });
  }
}
