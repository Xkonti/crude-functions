import { Mutex } from "@core/asyncutil/mutex";
import { RecordId } from "surrealdb";
import type { SurrealConnectionFactory } from "../database/surreal_connection_factory.ts";
import type { SecretsService } from "../secrets/secrets_service.ts";
import type { CorsConfig } from "../functions/types.ts";
import { normalizeRoutePattern } from "../functions/route_helpers.ts";

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
    // SurrealDB returns set<string> as a JavaScript Set, convert to array for interface compatibility
    const methods = record.methods instanceof Set
      ? Array.from(record.methods)
      : record.methods;

    const func: FunctionDefinition = {
      id: record.id,
      name: record.name,
      handler: record.handler,
      routePath: record.routePath,
      methods: methods,
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
      const normalizedRoute = normalizeRoutePattern(func.routePath);

      // Create the function definition
      // Database handles validation via:
      // - unique_functionDef_name index (duplicate name check)
      // - idx_functionDef_route_methods index (exact route+methods duplicate)
      // - check_route_method_overlap event (overlapping methods on same route)
      // Note: For option<T> fields, undefined maps to NONE, null is not valid
      let records: FunctionDefRecord[];
      try {
        [records] = await db.query<[FunctionDefRecord[]]>(
          `CREATE functionDef SET
            name = $name,
            description = $description,
            handler = $handler,
            routePath = $routePath,
            normalizedRoute = $normalizedRoute,
            methods = <set>$methods,
            keys = $keys,
            cors = $cors,
            enabled = true`,
          {
            name: func.name,
            description: func.description,
            handler: func.handler,
            routePath: func.routePath,
            normalizedRoute: normalizedRoute,
            methods: func.methods,
            keys: func.keys && func.keys.length > 0 ? func.keys : undefined,
            cors: func.cors,
          }
        );
      } catch (error) {
        // DEBUG: Print error details to understand SurrealDB error format
        console.error("SurrealDB CREATE error:", error);
        console.error("Error type:", typeof error);
        console.error("Error name:", (error as Error)?.name);
        console.error("Error message:", (error as Error)?.message);
        console.error("Error constructor:", (error as Error)?.constructor?.name);
        if (error && typeof error === "object") {
          console.error("Error keys:", Object.keys(error));
          console.error("Full error object:", JSON.stringify(error, null, 2));
        }
        throw error;
      }

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

      const normalizedRoute = normalizeRoutePattern(func.routePath);

      // Update the function definition
      // Database handles validation via:
      // - unique_functionDef_name index (duplicate name check)
      // - idx_functionDef_route_methods index (exact route+methods duplicate)
      // - check_route_method_overlap event (overlapping methods on same route)
      // Note: For option<T> fields, undefined maps to NONE, null is not valid
      try {
        await db.query(
          `UPDATE $recordId SET
            name = $name,
            description = $description,
            handler = $handler,
            routePath = $routePath,
            normalizedRoute = $normalizedRoute,
            methods = <set>$methods,
            keys = $keys,
            cors = $cors`,
          {
            recordId,
            name: func.name,
            description: func.description,
            handler: func.handler,
            routePath: func.routePath,
            normalizedRoute: normalizedRoute,
            methods: func.methods,
            keys: func.keys && func.keys.length > 0 ? func.keys : undefined,
            cors: func.cors,
          }
        );
      } catch (error) {
        // DEBUG: Print error details to understand SurrealDB error format
        console.error("SurrealDB UPDATE error:", error);
        console.error("Error type:", typeof error);
        console.error("Error name:", (error as Error)?.name);
        console.error("Error message:", (error as Error)?.message);
        console.error("Error constructor:", (error as Error)?.constructor?.name);
        if (error && typeof error === "object") {
          console.error("Error keys:", Object.keys(error));
          console.error("Full error object:", JSON.stringify(error, null, 2));
        }
        throw error;
      }

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
