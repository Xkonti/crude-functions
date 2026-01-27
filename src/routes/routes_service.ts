import { Mutex } from "@core/asyncutil/mutex";
import { RecordId } from "surrealdb";
import type { SurrealConnectionFactory } from "../database/surreal_connection_factory.ts";
import type { SecretsService } from "../secrets/secrets_service.ts";
import { recordIdToString } from "../database/surreal_helpers.ts";

/**
 * Represents a function route configuration.
 * ID is RecordId at runtime - convert to string only at API/Web UI boundaries.
 */
export interface FunctionRoute {
  /** Unique identifier for the route (SurrealDB RecordId) */
  id: RecordId;
  /** Route name (unique identifier for display and lookup) */
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
  /** Whether the route is enabled */
  enabled: boolean;
}

/** Input type for adding new routes (id and enabled are auto-generated/defaulted) */
export type NewFunctionRoute = Omit<FunctionRoute, "id" | "enabled">;

export interface RoutesServiceOptions {
  /** SurrealDB connection factory */
  surrealFactory: SurrealConnectionFactory;
  /** Optional - when provided, function-scoped secrets are cascade deleted with routes */
  secretsService?: SecretsService;
}

/** Database row type for routes */
interface RouteRow {
  id: RecordId;
  name: string;
  description: string | null;
  handler: string;
  routePath: string;
  methods: string[];
  keys: string[] | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Service for managing function routes stored in SurrealDB.
 *
 * Features:
 * - Dirty flag tracking for efficient rebuild detection
 * - Mutex-protected rebuilds to prevent concurrent router regeneration
 * - Write operations wait for any in-progress rebuild before modifying
 */
export class RoutesService {
  private readonly surrealFactory: SurrealConnectionFactory;
  private readonly secretsService?: SecretsService;
  private readonly rebuildMutex = new Mutex();
  private dirty = true; // Start dirty to force initial build

  constructor(options: RoutesServiceOptions) {
    this.surrealFactory = options.surrealFactory;
    this.secretsService = options.secretsService;
  }

  // ============== Change Detection & Rebuild Coordination ==============

  /**
   * Check if routes need rebuilding and rebuild if necessary.
   * Coordinates concurrent access to prevent duplicate rebuilds.
   * The mutex in performRebuild ensures only one rebuild runs at a time.
   *
   * @param rebuilder - Callback function that receives the routes and performs the rebuild
   */
  async rebuildIfNeeded(
    rebuilder: (routes: FunctionRoute[]) => void
  ): Promise<void> {
    // Fast path: not dirty, no rebuild needed (safe to check without lock)
    if (!this.dirty) {
      return;
    }

    // Delegate to performRebuild which handles all synchronization
    await this.performRebuild(rebuilder);
  }

  private async performRebuild(
    rebuilder: (routes: FunctionRoute[]) => void
  ): Promise<void> {
    using _lock = await this.rebuildMutex.acquire();

    // Double-check dirty flag after acquiring lock
    // (another request may have completed the rebuild while we waited)
    if (!this.dirty) {
      return;
    }

    // Fetch routes from database and call rebuilder
    const routes = await this.getAll();
    rebuilder(routes);

    // Clear dirty flag after successful rebuild
    this.dirty = false;
  }

  private markDirty(): void {
    this.dirty = true;
  }

  // ============== Read Operations ==============

  /**
   * Get all routes from the database.
   */
  async getAll(): Promise<FunctionRoute[]> {
    return await this.surrealFactory.withSystemConnection({}, async (db) => {
      const [rows] = await db.query<[RouteRow[]]>(
        "SELECT * FROM route ORDER BY name"
      );

      return (rows ?? []).map((row) => this.rowToRoute(row));
    });
  }

  /**
   * Get a single route by name.
   */
  async getByName(name: string): Promise<FunctionRoute | null> {
    return await this.surrealFactory.withSystemConnection({}, async (db) => {
      const [rows] = await db.query<[RouteRow[]]>(
        "SELECT * FROM route WHERE name = $name LIMIT 1",
        { name }
      );

      const row = rows?.[0];
      if (!row) return null;

      return this.rowToRoute(row);
    });
  }

  /**
   * Get a single route by ID.
   * @param id - The string ID part of the RecordId
   */
  async getById(id: string): Promise<FunctionRoute | null> {
    const recordId = new RecordId("route", id);

    return await this.surrealFactory.withSystemConnection({}, async (db) => {
      const [row] = await db.query<[RouteRow | undefined]>(
        "RETURN $recordId.*",
        { recordId }
      );

      if (!row) return null;

      return this.rowToRoute(row);
    });
  }

  private rowToRoute(row: RouteRow): FunctionRoute {
    const route: FunctionRoute = {
      id: row.id,
      name: row.name,
      handler: row.handler,
      routePath: row.routePath,
      methods: row.methods,
      enabled: row.enabled,
    };

    if (row.description) {
      route.description = row.description;
    }

    if (row.keys && row.keys.length > 0) {
      route.keys = row.keys;
    }

    return route;
  }

  // ============== Write Operations (must wait on rebuild lock) ==============

  /**
   * Add a new route to the database.
   * Waits for any in-progress rebuild to complete before modifying.
   * @returns The created route with its assigned ID
   */
  async addRoute(route: NewFunctionRoute): Promise<FunctionRoute> {
    // Wait for any in-progress rebuild to complete
    using _lock = await this.rebuildMutex.acquire();

    return await this.surrealFactory.withSystemConnection({}, async (db) => {
      // Validate: check for duplicate name
      const [existingByName] = await db.query<[RouteRow[]]>(
        "SELECT id FROM route WHERE name = $name LIMIT 1",
        { name: route.name }
      );
      if (existingByName && existingByName.length > 0) {
        throw new Error(`Route with name '${route.name}' already exists`);
      }

      // Validate: check for duplicate routePath+method combinations
      const [existingRoutes] = await db.query<[RouteRow[]]>(
        "SELECT name, methods FROM route WHERE routePath = $routePath",
        { routePath: route.routePath }
      );

      for (const existing of existingRoutes ?? []) {
        for (const method of route.methods) {
          if (existing.methods.includes(method)) {
            throw new Error(
              `Route '${route.routePath}' with method '${method}' already exists (route: '${existing.name}')`
            );
          }
        }
      }

      // Create the route
      // Note: For option<T> fields, undefined maps to NONE, null is not valid
      const [rows] = await db.query<[RouteRow[]]>(
        `CREATE route SET
          name = $name,
          description = $description,
          handler = $handler,
          routePath = $routePath,
          methods = $methods,
          keys = $keys,
          enabled = true`,
        {
          name: route.name,
          description: route.description,
          handler: route.handler,
          routePath: route.routePath,
          methods: route.methods,
          keys: route.keys && route.keys.length > 0 ? route.keys : undefined,
        }
      );

      const created = rows?.[0];
      if (!created) {
        throw new Error("Failed to create route");
      }

      this.markDirty();
      return this.rowToRoute(created);
    });
  }

  /**
   * Remove a route by name.
   * Waits for any in-progress rebuild to complete before modifying.
   * Note: Function-scoped secrets are cascade-deleted by SurrealDB event.
   */
  async removeRoute(name: string): Promise<void> {
    // Wait for any in-progress rebuild to complete
    using _lock = await this.rebuildMutex.acquire();

    await this.surrealFactory.withSystemConnection({}, async (db) => {
      // Get the route ID first (for logging purposes and to check if exists)
      const [rows] = await db.query<[RouteRow[]]>(
        "SELECT id FROM route WHERE name = $name LIMIT 1",
        { name }
      );

      const route = rows?.[0];
      if (!route) return; // No-op if doesn't exist

      // Delete the route (secrets cascade-deleted by SurrealDB event)
      await db.query("DELETE $recordId", { recordId: route.id });
      this.markDirty();
    });
  }

  /**
   * Update an existing route by ID.
   * Preserves the route ID to maintain log/metrics associations.
   * Waits for any in-progress rebuild to complete before modifying.
   * @param id - The string ID part of the RecordId
   * @returns The updated route
   */
  async updateRoute(id: string, route: NewFunctionRoute): Promise<FunctionRoute> {
    // Wait for any in-progress rebuild to complete
    using _lock = await this.rebuildMutex.acquire();

    const recordId = new RecordId("route", id);

    return await this.surrealFactory.withSystemConnection({}, async (db) => {
      // Verify route exists
      const [existing] = await db.query<[RouteRow | undefined]>(
        "RETURN $recordId.*",
        { recordId }
      );
      if (!existing) {
        throw new Error(`Route with id '${id}' not found`);
      }

      // Validate: check for duplicate name (excluding current route)
      const [existingByName] = await db.query<[RouteRow[]]>(
        "SELECT id FROM route WHERE name = $name AND id != $recordId LIMIT 1",
        { name: route.name, recordId }
      );
      if (existingByName && existingByName.length > 0) {
        throw new Error(`Route with name '${route.name}' already exists`);
      }

      // Validate: check for duplicate routePath+method combinations (excluding current route)
      const [existingRoutes] = await db.query<[RouteRow[]]>(
        "SELECT name, methods FROM route WHERE routePath = $routePath AND id != $recordId",
        { routePath: route.routePath, recordId }
      );

      for (const existingRoute of existingRoutes ?? []) {
        for (const method of route.methods) {
          if (existingRoute.methods.includes(method)) {
            throw new Error(
              `Route '${route.routePath}' with method '${method}' already exists (route: '${existingRoute.name}')`
            );
          }
        }
      }

      // Update the route
      // Note: For option<T> fields, undefined maps to NONE, null is not valid
      await db.query(
        `UPDATE $recordId SET
          name = $name,
          description = $description,
          handler = $handler,
          routePath = $routePath,
          methods = $methods,
          keys = $keys`,
        {
          recordId,
          name: route.name,
          description: route.description,
          handler: route.handler,
          routePath: route.routePath,
          methods: route.methods,
          keys: route.keys && route.keys.length > 0 ? route.keys : undefined,
        }
      );

      this.markDirty();

      // Fetch and return the updated route
      const updated = await this.getById(id);
      if (!updated) {
        throw new Error("Failed to retrieve updated route");
      }
      return updated;
    });
  }

  /**
   * Remove a route by ID.
   * Waits for any in-progress rebuild to complete before modifying.
   * Note: Function-scoped secrets are cascade-deleted by SurrealDB event.
   * @param id - The string ID part of the RecordId
   */
  async removeRouteById(id: string): Promise<void> {
    // Wait for any in-progress rebuild to complete
    using _lock = await this.rebuildMutex.acquire();

    const recordId = new RecordId("route", id);

    await this.surrealFactory.withSystemConnection({}, async (db) => {
      // Check if route exists first
      const [existing] = await db.query<[RouteRow | undefined]>(
        "RETURN $recordId.*",
        { recordId }
      );
      if (!existing) return; // No-op if doesn't exist

      // Delete the route (secrets cascade-deleted by SurrealDB event)
      await db.query("DELETE $recordId", { recordId });
      this.markDirty();
    });
  }

  /**
   * Set the enabled state of a route by ID.
   * Waits for any in-progress rebuild to complete before modifying.
   * @param id - The string ID part of the RecordId
   * @returns The updated route
   */
  async setRouteEnabled(id: string, enabled: boolean): Promise<FunctionRoute> {
    // Wait for any in-progress rebuild to complete
    using _lock = await this.rebuildMutex.acquire();

    const recordId = new RecordId("route", id);

    return await this.surrealFactory.withSystemConnection({}, async (db) => {
      // Verify route exists
      const [existing] = await db.query<[RouteRow | undefined]>(
        "RETURN $recordId.*",
        { recordId }
      );
      if (!existing) {
        throw new Error(`Route with id '${id}' not found`);
      }

      // Update the enabled state
      await db.query(
        "UPDATE $recordId SET enabled = $enabled",
        { recordId, enabled }
      );

      this.markDirty();

      // Fetch and return the updated route
      const updated = await this.getById(id);
      if (!updated) {
        throw new Error("Failed to retrieve updated route");
      }
      return updated;
    });
  }
}
