import { Mutex } from "@core/asyncutil/mutex";
import { RecordId } from "surrealdb";
import type { SurrealConnectionFactory } from "../database/surreal_connection_factory.ts";
import type { SecretsService } from "../secrets/secrets_service.ts";
import type { CorsConfig } from "../functions/types.ts";

/**
 * Represents a function definition.
 * ID is RecordId at runtime - convert to string only at API/Web UI boundaries.
 */
export interface FunctionDefinition {
  /** Unique identifier for the function definition (SurrealDB RecordId) */
  id: RecordId;
  /** Function name (unique identifier for display and lookup) */
  name: string;
  /** Optional description */
  description?: string;
  /** Path to the handler file (relative to code directory) */
  handler: string;
  /** URL path pattern (e.g., "/api/hello" or "/users/:id") */
  routePath: string;
  /** Allowed HTTP methods (e.g., ["GET", "POST"]) */
  methods: string[];
  /** API key group IDs required for access (optional) */
  keys?: string[];
  /** CORS configuration (optional). When present, enables automatic CORS handling */
  cors?: CorsConfig;
  /** Whether the function is enabled */
  enabled: boolean;
}

/** Input type for adding new function definitions (id and enabled are auto-generated/defaulted) */
export type NewFunctionDefinition = Omit<FunctionDefinition, "id" | "enabled">;

export interface FunctionsServiceOptions {
  /** SurrealDB connection factory */
  surrealFactory: SurrealConnectionFactory;
  /** Optional - when provided, function-scoped secrets are cascade deleted with function definitions */
  secretsService?: SecretsService;
}

/** Database record type for function definitions (SurrealDB uses records, not rows) */
interface FunctionDefRecord {
  id: RecordId;
  name: string;
  description: string | null;
  handler: string;
  routePath: string;
  methods: string[];
  keys: string[] | null;
  cors: CorsConfig | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Service for managing function definitions stored in SurrealDB.
 *
 * Features:
 * - Dirty flag tracking for efficient rebuild detection
 * - Mutex-protected rebuilds to prevent concurrent router regeneration
 * - Write operations wait for any in-progress rebuild before modifying
 */
export class FunctionsService {
  private readonly surrealFactory: SurrealConnectionFactory;
  private readonly secretsService?: SecretsService;
  private readonly rebuildMutex = new Mutex();
  private dirty = true; // Start dirty to force initial build

  constructor(options: FunctionsServiceOptions) {
    this.surrealFactory = options.surrealFactory;
    this.secretsService = options.secretsService;
  }

  // ============== Change Detection & Rebuild Coordination ==============

  /**
   * Check if function definitions need rebuilding and rebuild if necessary.
   * Coordinates concurrent access to prevent duplicate rebuilds.
   * The mutex in performRebuild ensures only one rebuild runs at a time.
   *
   * @param rebuilder - Callback function that receives the function definitions and performs the rebuild
   */
  async rebuildIfNeeded(
    rebuilder: (functions: FunctionDefinition[]) => void
  ): Promise<void> {
    // Fast path: not dirty, no rebuild needed (safe to check without lock)
    if (!this.dirty) {
      return;
    }

    // Delegate to performRebuild which handles all synchronization
    await this.performRebuild(rebuilder);
  }

  private async performRebuild(
    rebuilder: (functions: FunctionDefinition[]) => void
  ): Promise<void> {
    using _lock = await this.rebuildMutex.acquire();

    // Double-check dirty flag after acquiring lock
    // (another request may have completed the rebuild while we waited)
    if (!this.dirty) {
      return;
    }

    // Fetch function definitions from database and call rebuilder
    const functions = await this.getAll();
    rebuilder(functions);

    // Clear dirty flag after successful rebuild
    this.dirty = false;
  }

  private markDirty(): void {
    this.dirty = true;
  }

  // ============== Read Operations ==============

  /**
   * Get all function definitions from the database.
   */
  async getAll(): Promise<FunctionDefinition[]> {
    return await this.surrealFactory.withSystemConnection({}, async (db) => {
      const [records] = await db.query<[FunctionDefRecord[]]>(
        "SELECT * FROM functionDef ORDER BY name"
      );

      return (records ?? []).map((record) => this.recordToFunctionDef(record));
    });
  }

  /**
   * Get a single function definition by name.
   */
  async getByName(name: string): Promise<FunctionDefinition | null> {
    return await this.surrealFactory.withSystemConnection({}, async (db) => {
      const [records] = await db.query<[FunctionDefRecord[]]>(
        "SELECT * FROM functionDef WHERE name = $name LIMIT 1",
        { name }
      );

      const record = records?.[0];
      if (!record) return null;

      return this.recordToFunctionDef(record);
    });
  }

  /**
   * Get a single function definition by ID.
   * @param id - The string ID part of the RecordId
   */
  async getById(id: string): Promise<FunctionDefinition | null> {
    const recordId = new RecordId("functionDef", id);

    return await this.surrealFactory.withSystemConnection({}, async (db) => {
      const [record] = await db.query<[FunctionDefRecord | undefined]>(
        "RETURN $recordId.*",
        { recordId }
      );

      if (!record) return null;

      return this.recordToFunctionDef(record);
    });
  }

  private recordToFunctionDef(record: FunctionDefRecord): FunctionDefinition {
    const func: FunctionDefinition = {
      id: record.id,
      name: record.name,
      handler: record.handler,
      routePath: record.routePath,
      methods: record.methods,
      enabled: record.enabled,
    };

    if (record.description) {
      func.description = record.description;
    }

    if (record.keys && record.keys.length > 0) {
      func.keys = record.keys;
    }

    if (record.cors) {
      func.cors = record.cors;
    }

    return func;
  }

  // ============== Write Operations (must wait on rebuild lock) ==============

  /**
   * Add a new function definition to the database.
   * Waits for any in-progress rebuild to complete before modifying.
   * @returns The created function definition with its assigned ID
   */
  async addFunction(func: NewFunctionDefinition): Promise<FunctionDefinition> {
    // Wait for any in-progress rebuild to complete
    using _lock = await this.rebuildMutex.acquire();

    return await this.surrealFactory.withSystemConnection({}, async (db) => {
      // Validate: check for duplicate name
      const [existingByName] = await db.query<[FunctionDefRecord[]]>(
        "SELECT id FROM functionDef WHERE name = $name LIMIT 1",
        { name: func.name }
      );
      if (existingByName && existingByName.length > 0) {
        throw new Error(`Function with name '${func.name}' already exists`);
      }

      // Validate: check for duplicate routePath+method combinations
      const [existingFunctions] = await db.query<[FunctionDefRecord[]]>(
        "SELECT name, methods FROM functionDef WHERE routePath = $routePath",
        { routePath: func.routePath }
      );

      for (const existing of existingFunctions ?? []) {
        for (const method of func.methods) {
          if (existing.methods.includes(method)) {
            throw new Error(
              `Route '${func.routePath}' with method '${method}' already exists (function: '${existing.name}')`
            );
          }
        }
      }

      // Create the function definition
      // Note: For option<T> fields, undefined maps to NONE, null is not valid
      const [records] = await db.query<[FunctionDefRecord[]]>(
        `CREATE functionDef SET
          name = $name,
          description = $description,
          handler = $handler,
          routePath = $routePath,
          methods = $methods,
          keys = $keys,
          cors = $cors,
          enabled = true`,
        {
          name: func.name,
          description: func.description,
          handler: func.handler,
          routePath: func.routePath,
          methods: func.methods,
          keys: func.keys && func.keys.length > 0 ? func.keys : undefined,
          cors: func.cors,
        }
      );

      const created = records?.[0];
      if (!created) {
        throw new Error("Failed to create function definition");
      }

      this.markDirty();
      return this.recordToFunctionDef(created);
    });
  }

  /**
   * Remove a function definition by name.
   * Waits for any in-progress rebuild to complete before modifying.
   * Note: Function-scoped secrets are cascade-deleted by SurrealDB event.
   */
  async removeFunction(name: string): Promise<void> {
    // Wait for any in-progress rebuild to complete
    using _lock = await this.rebuildMutex.acquire();

    await this.surrealFactory.withSystemConnection({}, async (db) => {
      // Get the function ID first (for logging purposes and to check if exists)
      const [records] = await db.query<[FunctionDefRecord[]]>(
        "SELECT id FROM functionDef WHERE name = $name LIMIT 1",
        { name }
      );

      const func = records?.[0];
      if (!func) return; // No-op if doesn't exist

      // Delete the function definition (secrets cascade-deleted by SurrealDB event)
      await db.query("DELETE $recordId", { recordId: func.id });
      this.markDirty();
    });
  }

  /**
   * Update an existing function definition by ID.
   * Preserves the function ID to maintain log/metrics associations.
   * Waits for any in-progress rebuild to complete before modifying.
   * @param id - The string ID part of the RecordId
   * @returns The updated function definition
   */
  async updateFunction(id: string, func: NewFunctionDefinition): Promise<FunctionDefinition> {
    // Wait for any in-progress rebuild to complete
    using _lock = await this.rebuildMutex.acquire();

    const recordId = new RecordId("functionDef", id);

    return await this.surrealFactory.withSystemConnection({}, async (db) => {
      // Verify function definition exists
      const [existing] = await db.query<[FunctionDefRecord | undefined]>(
        "RETURN $recordId.*",
        { recordId }
      );
      if (!existing) {
        throw new Error(`Function with id '${id}' not found`);
      }

      // Validate: check for duplicate name (excluding current function)
      const [existingByName] = await db.query<[FunctionDefRecord[]]>(
        "SELECT id FROM functionDef WHERE name = $name AND id != $recordId LIMIT 1",
        { name: func.name, recordId }
      );
      if (existingByName && existingByName.length > 0) {
        throw new Error(`Function with name '${func.name}' already exists`);
      }

      // Validate: check for duplicate routePath+method combinations (excluding current function)
      const [existingFunctions] = await db.query<[FunctionDefRecord[]]>(
        "SELECT name, methods FROM functionDef WHERE routePath = $routePath AND id != $recordId",
        { routePath: func.routePath, recordId }
      );

      for (const existingFunc of existingFunctions ?? []) {
        for (const method of func.methods) {
          if (existingFunc.methods.includes(method)) {
            throw new Error(
              `Route '${func.routePath}' with method '${method}' already exists (function: '${existingFunc.name}')`
            );
          }
        }
      }

      // Update the function definition
      // Note: For option<T> fields, undefined maps to NONE, null is not valid
      await db.query(
        `UPDATE $recordId SET
          name = $name,
          description = $description,
          handler = $handler,
          routePath = $routePath,
          methods = $methods,
          keys = $keys,
          cors = $cors`,
        {
          recordId,
          name: func.name,
          description: func.description,
          handler: func.handler,
          routePath: func.routePath,
          methods: func.methods,
          keys: func.keys && func.keys.length > 0 ? func.keys : undefined,
          cors: func.cors,
        }
      );

      this.markDirty();

      // Fetch and return the updated function definition
      const updated = await this.getById(id);
      if (!updated) {
        throw new Error("Failed to retrieve updated function definition");
      }
      return updated;
    });
  }

  /**
   * Remove a function definition by ID.
   * Waits for any in-progress rebuild to complete before modifying.
   * Note: Function-scoped secrets are cascade-deleted by SurrealDB event.
   * @param id - The string ID part of the RecordId
   */
  async removeFunctionById(id: string): Promise<void> {
    // Wait for any in-progress rebuild to complete
    using _lock = await this.rebuildMutex.acquire();

    const recordId = new RecordId("functionDef", id);

    await this.surrealFactory.withSystemConnection({}, async (db) => {
      // Check if function definition exists first
      const [existing] = await db.query<[FunctionDefRecord | undefined]>(
        "RETURN $recordId.*",
        { recordId }
      );
      if (!existing) return; // No-op if doesn't exist

      // Delete the function definition (secrets cascade-deleted by SurrealDB event)
      await db.query("DELETE $recordId", { recordId });
      this.markDirty();
    });
  }

  /**
   * Set the enabled state of a function definition by ID.
   * Waits for any in-progress rebuild to complete before modifying.
   * @param id - The string ID part of the RecordId
   * @returns The updated function definition
   */
  async setFunctionEnabled(id: string, enabled: boolean): Promise<FunctionDefinition> {
    // Wait for any in-progress rebuild to complete
    using _lock = await this.rebuildMutex.acquire();

    const recordId = new RecordId("functionDef", id);

    return await this.surrealFactory.withSystemConnection({}, async (db) => {
      // Verify function definition exists
      const [existing] = await db.query<[FunctionDefRecord | undefined]>(
        "RETURN $recordId.*",
        { recordId }
      );
      if (!existing) {
        throw new Error(`Function with id '${id}' not found`);
      }

      // Update the enabled state
      await db.query(
        "UPDATE $recordId SET enabled = $enabled",
        { recordId, enabled }
      );

      this.markDirty();

      // Fetch and return the updated function definition
      const updated = await this.getById(id);
      if (!updated) {
        throw new Error("Failed to retrieve updated function definition");
      }
      return updated;
    });
  }
}
