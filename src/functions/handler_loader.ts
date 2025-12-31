import type { FunctionHandler, HandlerModule } from "./types.ts";
import {
  HandlerError,
  HandlerNotFoundError,
  HandlerExportError,
  HandlerSyntaxError,
  HandlerLoadError,
} from "./errors.ts";

export interface HandlerLoaderOptions {
  /** Base directory for resolving relative paths (e.g., "./" or project root) */
  baseDirectory?: string;
}

export interface LoadedHandler {
  handler: FunctionHandler;
  /** File modification time when handler was loaded */
  fileModTime: number;
  filePath: string;
}

/**
 * Dynamically loads and caches function handlers.
 * Handles cache invalidation based on file modification time.
 */
export class HandlerLoader {
  private readonly baseDirectory: string;
  private readonly cache = new Map<string, LoadedHandler>();

  constructor(options: HandlerLoaderOptions = {}) {
    this.baseDirectory = options.baseDirectory ?? Deno.cwd();
  }

  /**
   * Load a handler, using cache if available and file unchanged
   * @param handlerPath - Relative path like "code/hello.ts"
   * @param forceReload - Force reload even if cached
   */
  async load(handlerPath: string, forceReload = false): Promise<FunctionHandler> {
    const absolutePath = this.resolveAbsolutePath(handlerPath);

    // Check if file exists and get its modification time
    const stat = await this.getFileStat(absolutePath);
    if (!stat) {
      throw new HandlerNotFoundError(handlerPath);
    }

    const cached = this.cache.get(handlerPath);
    const fileModTime = stat.mtime?.getTime() ?? 0;

    // Use cache if file hasn't been modified since last load
    if (!forceReload && cached && cached.fileModTime === fileModTime) {
      return cached.handler;
    }

    // Dynamic import with cache-busting query string
    const module = await this.importModule(absolutePath, handlerPath);

    // Validate the module has a default export that is a function
    if (typeof module.default !== "function") {
      throw new HandlerExportError(handlerPath);
    }

    const handler = module.default as FunctionHandler;

    // Cache the handler with the file's modification time
    this.cache.set(handlerPath, {
      handler,
      fileModTime,
      filePath: absolutePath,
    });

    return handler;
  }

  /**
   * Import module with cache-busting query parameter
   */
  private async importModule(
    absolutePath: string,
    handlerPath: string
  ): Promise<HandlerModule> {
    // Use timestamp to bust Deno's module cache
    const cacheBuster = Date.now();
    const importUrl = `file://${absolutePath}?v=${cacheBuster}`;

    try {
      return await import(importUrl);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new HandlerSyntaxError(handlerPath, error);
      }
      throw new HandlerLoadError(handlerPath, error);
    }
  }

  /**
   * Resolve handler path to absolute file system path.
   * Validates that the resolved path stays within the base directory.
   */
  private resolveAbsolutePath(handlerPath: string): string {
    // Handle both "code/hello.ts" and "./code/hello.ts" formats
    const normalized = handlerPath.replace(/^\.\//, "");

    // Reject absolute paths from input - must be relative
    if (normalized.startsWith("/")) {
      throw new HandlerError(
        "Handler paths must be relative to code directory",
        handlerPath
      );
    }

    // Reject paths with traversal attempts
    if (normalized.includes("..")) {
      throw new HandlerError(
        "Handler path cannot contain path traversal sequences",
        handlerPath
      );
    }

    // Combine with base directory
    return `${this.baseDirectory}/${normalized}`;
  }

  /**
   * Get file stats, returning null if file doesn't exist
   */
  private async getFileStat(path: string): Promise<Deno.FileInfo | null> {
    try {
      return await Deno.stat(path);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Invalidate cache for a specific handler
   */
  invalidate(handlerPath: string): void {
    this.cache.delete(handlerPath);
  }

  /**
   * Invalidate all cached handlers
   */
  invalidateAll(): void {
    this.cache.clear();
  }

  /**
   * Get the number of cached handlers
   */
  get cacheSize(): number {
    return this.cache.size;
  }
}
