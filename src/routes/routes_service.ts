import { Mutex } from "@core/asyncutil/mutex";
import type { DatabaseService } from "../database/database_service.ts";

export interface FunctionRoute {
  id: number;
  name: string;
  description?: string;
  handler: string;
  route: string;
  methods: string[];
  keys?: string[];
}

/** Input type for adding new routes (id is auto-generated) */
export type NewFunctionRoute = Omit<FunctionRoute, "id">;

export interface RoutesServiceOptions {
  db: DatabaseService;
}

const VALID_METHODS = [
  "GET",
  "POST",
  "PUT",
  "DELETE",
  "PATCH",
  "HEAD",
  "OPTIONS",
];

export function validateRouteName(name: string): boolean {
  return name.trim().length > 0;
}

export function validateRoutePath(path: string): boolean {
  if (!path || !path.startsWith("/")) return false;
  if (path !== "/" && path.includes("//")) return false;
  return true;
}

export function validateMethods(methods: string[]): boolean {
  if (!methods || methods.length === 0) return false;
  return methods.every((m) => VALID_METHODS.includes(m));
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
      "SELECT id, name, description, handler, route, methods, keys FROM routes ORDER BY name"
    );

    return rows.map((row) => this.rowToFunctionRoute(row));
  }

  /**
   * Get a single route by name.
   */
  async getByName(name: string): Promise<FunctionRoute | null> {
    const row = await this.db.queryOne<RouteRow>(
      "SELECT id, name, description, handler, route, methods, keys FROM routes WHERE name = ?",
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
      "SELECT id, name, description, handler, route, methods, keys FROM routes WHERE id = ?",
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
    let keys: string[] | undefined;
    if (row.keys) {
      try {
        keys = JSON.parse(row.keys) as string[];
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
   */
  async addRoute(route: NewFunctionRoute): Promise<void> {
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
      const existingMethods = JSON.parse(existing.methods) as string[];
      for (const method of route.methods) {
        if (existingMethods.includes(method)) {
          throw new Error(
            `Route '${route.route}' with method '${method}' already exists (route: '${existing.name}')`
          );
        }
      }
    }

    // Insert the route
    await this.db.execute(
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
   */
  async updateRoute(id: number, route: NewFunctionRoute): Promise<void> {
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
      const existingMethods = JSON.parse(existingRoute.methods) as string[];
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
}
