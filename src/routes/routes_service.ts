import { FileWatcher } from "../watcher/file_watcher.ts";

export interface FunctionRoute {
  name: string;
  description?: string;
  handler: string;
  route: string;
  methods: string[];
  keys?: string[];
}

export interface RoutesServiceOptions {
  configPath: string;
  refreshInterval?: number;
}

const VALID_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"];

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

export function parseRoutesFile(content: string): FunctionRoute[] {
  if (!content || content.trim() === "") return [];

  const parsed = JSON.parse(content);
  if (!Array.isArray(parsed)) {
    throw new Error("Routes file must contain a JSON array");
  }

  return parsed as FunctionRoute[];
}

export function serializeRoutesFile(routes: FunctionRoute[]): string {
  return JSON.stringify(routes, null, 2);
}

export function hasDuplicateRouteMethod(
  routes: FunctionRoute[],
  route: string,
  method: string
): boolean {
  return routes.some(
    (r) => r.route === route && r.methods.includes(method)
  );
}

export class RoutesService {
  private readonly configPath: string;
  private readonly watcher: FileWatcher;

  constructor(options: RoutesServiceOptions) {
    this.configPath = options.configPath;
    this.watcher = new FileWatcher({
      path: options.configPath,
      refreshInterval: options.refreshInterval ?? 10000,
    });
  }

  private async ensureFileExists(): Promise<void> {
    try {
      await Deno.stat(this.configPath);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        await Deno.writeTextFile(this.configPath, "[]");
      } else {
        throw error;
      }
    }
  }

  private async readRoutes(): Promise<FunctionRoute[]> {
    await this.ensureFileExists();
    const content = await Deno.readTextFile(this.configPath);
    return parseRoutesFile(content);
  }

  private async writeRoutes(routes: FunctionRoute[]): Promise<void> {
    const content = serializeRoutesFile(routes);
    await Deno.writeTextFile(this.configPath, content);
    // Force watcher refresh so subsequent loadIfChanged returns null
    await this.watcher.forceCheck();
  }

  async loadIfChanged(): Promise<FunctionRoute[] | null> {
    await this.ensureFileExists();
    const result = await this.watcher.check();

    if (result.changed) {
      return await this.readRoutes();
    }

    return null;
  }

  async getAll(): Promise<FunctionRoute[]> {
    return await this.readRoutes();
  }

  async getByName(name: string): Promise<FunctionRoute | null> {
    const routes = await this.readRoutes();
    return routes.find((r) => r.name === name) ?? null;
  }

  async addRoute(route: FunctionRoute): Promise<void> {
    const routes = await this.readRoutes();

    // Check for duplicate name
    if (routes.some((r) => r.name === route.name)) {
      throw new Error(`Route with name '${route.name}' already exists`);
    }

    // Check for duplicate route+method
    for (const method of route.methods) {
      if (hasDuplicateRouteMethod(routes, route.route, method)) {
        throw new Error(
          `Route '${route.route}' with method '${method}' already exists`
        );
      }
    }

    routes.push(route);
    await this.writeRoutes(routes);
  }

  async removeRoute(name: string): Promise<void> {
    const routes = await this.readRoutes();
    const filtered = routes.filter((r) => r.name !== name);

    if (filtered.length !== routes.length) {
      await this.writeRoutes(filtered);
    }
  }
}
