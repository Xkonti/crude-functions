import { Mutex } from "@core/asyncutil/mutex";
import type { DatabaseService } from "../database/database_service.ts";

export interface FunctionRoute {
  id: number;
  name: string;
  description?: string;
  handler: string;
  route: string;
  methods: string[];
  keys?: number[];
  enabled: boolean;
}

/** Input type for adding new routes (id and enabled are auto-generated/defaulted) */
export type NewFunctionRoute = Omit<FunctionRoute, "id" | "enabled">;

export interface RoutesServiceOptions {
  db: DatabaseService;
}

// Row type for database queries
interface RouteRow {
  [key: string]: unknown; // Index signature for Row compatibility
  id: number;
  name: string;
  description: string | null;
  handler: string;
  route: string;
  methods: string; // JSON string
  keys: string | null; // JSON string or null
  enabled: number; // SQLite integer: 1 = enabled, 0 = disabled
}

/**
 * Service for managing function routes stored in SQLite database.
 *
 * Features:
 * - Dirty flag tracking for efficient rebuild detection
 * - Mutex-protected rebuilds to prevent concurrent router regeneration
 * - Write operations wait for any in-progress rebuild before modifying
 */
export class RoutesService {
  private readonly db: DatabaseService;
  private readonly rebuildMutex = new Mutex();
  private dirty = true; // Start dirty to force initial build

  constructor(options: RoutesServiceOptions) {
    this.db = options.db;
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

  // ============== Read Operations (no mutex needed - WAL mode) ==============

  /**
   * Get all routes from the database.
   */
  async getAll(): Promise<FunctionRoute[]> {
    const rows = await this.db.queryAll<RouteRow>(
      "SELECT id, name, description, handler, route, methods, keys, enabled FROM routes ORDER BY name"
    );

    return rows.map((row) => this.rowToFunctionRoute(row));
  }

  /**
   * Get a single route by name.
   */
  async getByName(name: string): Promise<FunctionRoute | null> {
    const row = await this.db.queryOne<RouteRow>(
      "SELECT id, name, description, handler, route, methods, keys, enabled FROM routes WHERE name = ?",
      [name]
    );

    if (!row) {
      return null;
    }

    return this.rowToFunctionRoute(row);
  }

  /**
   * Get a single route by ID.
   */
  async getById(id: number): Promise<FunctionRoute | null> {
    const row = await this.db.queryOne<RouteRow>(
      "SELECT id, name, description, handler, route, methods, keys, enabled FROM routes WHERE id = ?",
      [id]
    );

    if (!row) {
      return null;
    }

    return this.rowToFunctionRoute(row);
  }

  private rowToFunctionRoute(row: RouteRow): FunctionRoute {
    // Parse methods with error handling
    let methods: string[];
    try {
      methods = JSON.parse(row.methods) as string[];
    } catch (error) {
      globalThis.console.error(
        `[RoutesService] Failed to parse methods for route ${row.id}: ${row.methods}`,
        error
      );
      methods = []; // Return empty array to allow other routes to load
    }

    // Parse keys with error handling
    let keys: number[] | undefined;
    if (row.keys) {
      try {
        keys = JSON.parse(row.keys) as number[];
      } catch (error) {
        globalThis.console.error(
          `[RoutesService] Failed to parse keys for route ${row.id}: ${row.keys}`,
          error
        );
        keys = undefined;
      }
    }

    const route: FunctionRoute = {
      id: row.id,
      name: row.name,
      handler: row.handler,
      route: row.route,
      methods,
      enabled: row.enabled === 1,
    };

    if (row.description) {
      route.description = row.description;
    }

    if (keys) {
      route.keys = keys;
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

    // Validate: check for duplicate name
    const existingByName = await this.db.queryOne(
      "SELECT 1 FROM routes WHERE name = ?",
      [route.name]
    );
    if (existingByName) {
      throw new Error(`Route with name '${route.name}' already exists`);
    }

    // Validate: check for duplicate route+method combinations
    // Get all existing routes with the same path
    const existingRoutes = await this.db.queryAll<{ name: string; methods: string }>(
      "SELECT name, methods FROM routes WHERE route = ?",
      [route.route]
    );

    for (const existing of existingRoutes) {
      let existingMethods: string[];
      try {
        existingMethods = JSON.parse(existing.methods) as string[];
      } catch (error) {
        globalThis.console.error(
          `[RoutesService] Failed to parse methods for route '${existing.name}': ${existing.methods}`,
          error,
        );
        existingMethods = [];
      }
      for (const method of route.methods) {
        if (existingMethods.includes(method)) {
          throw new Error(
            `Route '${route.route}' with method '${method}' already exists (route: '${existing.name}')`
          );
        }
      }
    }

    // Insert the route (enabled defaults to 1 in the schema)
    const result = await this.db.execute(
      "INSERT INTO routes (name, description, handler, route, methods, keys) VALUES (?, ?, ?, ?, ?, ?)",
      [
        route.name,
        route.description ?? null,
        route.handler,
        route.route,
        JSON.stringify(route.methods),
        route.keys ? JSON.stringify(route.keys) : null,
      ]
    );

    this.markDirty();

    // Fetch and return the created route
    const created = await this.getById(Number(result.lastInsertRowId));
    if (!created) {
      throw new Error("Failed to retrieve created route");
    }
    return created;
  }

  /**
   * Remove a route by name.
   * Waits for any in-progress rebuild to complete before modifying.
   */
  async removeRoute(name: string): Promise<void> {
    // Wait for any in-progress rebuild to complete
    using _lock = await this.rebuildMutex.acquire();

    const result = await this.db.execute("DELETE FROM routes WHERE name = ?", [
      name,
    ]);

    // Only mark dirty if we actually deleted something
    if (result.changes > 0) {
      this.markDirty();
    }
  }

  /**
   * Update an existing route by ID.
   * Preserves the route ID to maintain log/metrics associations.
   * Waits for any in-progress rebuild to complete before modifying.
   * @returns The updated route
   */
  async updateRoute(id: number, route: NewFunctionRoute): Promise<FunctionRoute> {
    // Wait for any in-progress rebuild to complete
    using _lock = await this.rebuildMutex.acquire();

    // Verify route exists
    const existing = await this.db.queryOne<{ id: number }>(
      "SELECT id FROM routes WHERE id = ?",
      [id]
    );
    if (!existing) {
      throw new Error(`Route with id '${id}' not found`);
    }

    // Validate: check for duplicate name (excluding current route)
    const existingByName = await this.db.queryOne<{ id: number }>(
      "SELECT id FROM routes WHERE name = ? AND id != ?",
      [route.name, id]
    );
    if (existingByName) {
      throw new Error(`Route with name '${route.name}' already exists`);
    }

    // Validate: check for duplicate route+method combinations (excluding current route)
    const existingRoutes = await this.db.queryAll<{ id: number; name: string; methods: string }>(
      "SELECT id, name, methods FROM routes WHERE route = ? AND id != ?",
      [route.route, id]
    );

    for (const existingRoute of existingRoutes) {
      let existingMethods: string[];
      try {
        existingMethods = JSON.parse(existingRoute.methods) as string[];
      } catch (error) {
        globalThis.console.error(
          `[RoutesService] Failed to parse methods for route '${existingRoute.name}': ${existingRoute.methods}`,
          error,
        );
        existingMethods = [];
      }
      for (const method of route.methods) {
        if (existingMethods.includes(method)) {
          throw new Error(
            `Route '${route.route}' with method '${method}' already exists (route: '${existingRoute.name}')`
          );
        }
      }
    }

    // Update the route
    await this.db.execute(
      `UPDATE routes
       SET name = ?, description = ?, handler = ?, route = ?, methods = ?, keys = ?
       WHERE id = ?`,
      [
        route.name,
        route.description ?? null,
        route.handler,
        route.route,
        JSON.stringify(route.methods),
        route.keys ? JSON.stringify(route.keys) : null,
        id,
      ]
    );

    this.markDirty();

    // Fetch and return the updated route
    const updated = await this.getById(id);
    if (!updated) {
      throw new Error("Failed to retrieve updated route");
    }
    return updated;
  }

  /**
   * Remove a route by ID.
   * Waits for any in-progress rebuild to complete before modifying.
   */
  async removeRouteById(id: number): Promise<void> {
    // Wait for any in-progress rebuild to complete
    using _lock = await this.rebuildMutex.acquire();

    const result = await this.db.execute("DELETE FROM routes WHERE id = ?", [
      id,
    ]);

    // Only mark dirty if we actually deleted something
    if (result.changes > 0) {
      this.markDirty();
    }
  }

  /**
   * Set the enabled state of a route by ID.
   * Waits for any in-progress rebuild to complete before modifying.
   * @returns The updated route
   */
  async setRouteEnabled(id: number, enabled: boolean): Promise<FunctionRoute> {
    // Wait for any in-progress rebuild to complete
    using _lock = await this.rebuildMutex.acquire();

    // Verify route exists
    const existingRoute = await this.getById(id);
    if (!existingRoute) {
      throw new Error(`Route with id '${id}' not found`);
    }

    // Update the enabled state
    await this.db.execute(
      "UPDATE routes SET enabled = ? WHERE id = ?",
      [enabled ? 1 : 0, id]
    );

    this.markDirty();

    // Fetch and return the updated route
    const updated = await this.getById(id);
    if (!updated) {
      throw new Error("Failed to retrieve updated route");
    }
    return updated;
  }
}
