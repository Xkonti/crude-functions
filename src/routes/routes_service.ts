import { Mutex } from "@core/asyncutil/mutex";
import type { DatabaseService } from "../database/database_service.ts";

export interface FunctionRoute {
  name: string;
  description?: string;
  handler: string;
  route: string;
  methods: string[];
  keys?: string[];
}

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
  private rebuildPromise: Promise<void> | null = null;

  constructor(options: RoutesServiceOptions) {
    this.db = options.db;
  }

  // ============== Change Detection & Rebuild Coordination ==============

  /**
   * Check if routes need rebuilding and rebuild if necessary.
   * Coordinates concurrent access to prevent duplicate rebuilds.
   *
   * @param rebuilder - Callback function that receives the routes and performs the rebuild
   */
  async rebuildIfNeeded(
    rebuilder: (routes: FunctionRoute[]) => void
  ): Promise<void> {
    // Fast path: not dirty, no rebuild needed
    if (!this.dirty) {
      return;
    }

    // If a rebuild is already in progress, wait for it
    if (this.rebuildPromise) {
      await this.rebuildPromise;
      return;
    }

    // Acquire the rebuild lock and perform rebuild
    this.rebuildPromise = this.performRebuild(rebuilder);
    try {
      await this.rebuildPromise;
    } finally {
      this.rebuildPromise = null;
    }
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

  private rowToFunctionRoute(row: RouteRow): FunctionRoute {
    const route: FunctionRoute = {
      name: row.name,
      handler: row.handler,
      route: row.route,
      methods: JSON.parse(row.methods) as string[],
    };

    if (row.description) {
      route.description = row.description;
    }

    if (row.keys) {
      route.keys = JSON.parse(row.keys) as string[];
    }

    return route;
  }

  // ============== Write Operations (must wait on rebuild lock) ==============

  /**
   * Add a new route to the database.
   * Waits for any in-progress rebuild to complete before modifying.
   */
  async addRoute(route: FunctionRoute): Promise<void> {
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
}
