import type { FunctionHandler, HandlerModule } from "./types.ts";
import {
  HandlerError,
  HandlerNotFoundError,
  HandlerExportError,
  HandlerSyntaxError,
  HandlerLoadError,
} from "./errors.ts";
import { logger } from "../utils/logger.ts";
import { resolve, normalize } from "@std/path";

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
    // Convert relative base directory to absolute path
    const base = options.baseDirectory ?? Deno.cwd();
    if (base.startsWith("/")) {
      this.baseDirectory = base;
    } else {
      // Normalize: remove ./ prefix, join with cwd, collapse multiple slashes
      const normalized = base.replace(/^\.\//, "");
      this.baseDirectory = `${Deno.cwd()}/${normalized}`.replace(/\/+/g, "/");
    }
  }

  /**
   * Load a handler, using cache if available and file unchanged
   * @param handlerPath - Relative path like "code/hello.ts"
   * @param forceReload - Force reload even if cached
   */
  async load(handlerPath: string, forceReload = false): Promise<FunctionHandler> {
    logger.debug(`Loading handler: ${handlerPath}`);
    const absolutePath = this.resolveAbsolutePath(handlerPath);
    logger.debug(`Resolved absolute path: ${absolutePath}`);

    // Check if file exists and get its modification time
    const stat = await this.getFileStat(absolutePath);
    if (!stat) {
      logger.debug(`Handler file not found: ${absolutePath}`);
      throw new HandlerNotFoundError(handlerPath);
    }
    logger.debug(`Handler file exists, mtime: ${stat.mtime}`);

    // SECURITY: Verify the real path (following symlinks) is still within base directory
    await this.validateRealPath(absolutePath, handlerPath);

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
    logger.debug(`Importing module from: ${importUrl}`);

    try {
      const module = await import(importUrl);
      logger.debug(`Module imported successfully, exports: ${Object.keys(module).join(", ")}`);
      return module;
    } catch (error) {
      logger.debug(`Module import failed: ${error}`);
      if (error instanceof Error) {
        logger.debug(`Error name: ${error.name}, message: ${error.message}`);
        if (error.stack) {
          logger.debug(`Stack trace: ${error.stack}`);
        }
      }
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

    // Resolve to absolute path (handles .., symlinks, and normalization)
    const resolvedPath = resolve(this.baseDirectory, normalized);
    const normalizedBase = normalize(this.baseDirectory);

    // CRITICAL: Verify the resolved path is within base directory
    // This catches symlinks, .., and any other escape attempts
    if (!resolvedPath.startsWith(normalizedBase + "/") && resolvedPath !== normalizedBase) {
      throw new HandlerError(
        `Handler path escapes base directory: ${handlerPath}`,
        handlerPath
      );
    }

    return resolvedPath;
  }

  /**
   * Validates that the real path (following symlinks) is within base directory.
   * This prevents symlink-based directory traversal attacks.
   */
  private async validateRealPath(absolutePath: string, handlerPath: string): Promise<void> {
    try {
      // Get the real path following all symlinks
      const realPath = await Deno.realPath(absolutePath);
      const normalizedBase = normalize(this.baseDirectory);

      // Verify the real path is still within base directory
      if (!realPath.startsWith(normalizedBase + "/") && realPath !== normalizedBase) {
        throw new HandlerError(
          `Handler path escapes base directory: ${handlerPath}`,
          handlerPath
        );
      }
    } catch (error) {
      // If realpath fails, it might be a broken symlink or permission issue
      // Re-throw HandlerError as-is, wrap other errors
      if (error instanceof HandlerError) {
        throw error;
      }
      throw new HandlerError(
        `Failed to validate handler path: ${handlerPath}`,
        handlerPath
      );
    }
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
