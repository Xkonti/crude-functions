import { resolve, normalize as pathNormalize } from "@std/path";

/**
 * Validates that a file path is in a valid format.
 * Rejects empty paths, paths with null bytes, and absolute paths.
 */
export function validateFilePath(path: string): boolean {
  if (!path || path.length === 0) return false;
  if (path.includes("\0")) return false;
  if (path.startsWith("/")) return false;
  return true;
}

/**
 * Normalizes a file path by trimming whitespace,
 * removing redundant slashes, and removing trailing slashes.
 */
export function normalizePath(path: string): string {
  return path.trim().replace(/\/+/g, "/").replace(/\/$/, "");
}

/**
 * Checks if a path is safe (no directory traversal).
 * Rejects paths containing ".." or starting with "./".
 * @deprecated Use resolveAndValidatePath instead for proper security
 */
export function isPathSafe(path: string): boolean {
  const normalized = normalizePath(path);
  if (normalized.includes("..")) return false;
  if (normalized.startsWith("./")) return false;
  return true;
}

/**
 * Resolves and validates a path within a base directory.
 * Prevents directory traversal including symlink escapes.
 * @throws Error if path escapes base directory
 */
export async function resolveAndValidatePath(
  basePath: string,
  relativePath: string
): Promise<string> {
  // Normalize the relative path
  const normalized = normalizePath(relativePath);

  // Reject absolute paths from input - must be relative
  if (normalized.startsWith("/")) {
    throw new Error(`Path must be relative: ${relativePath}`);
  }

  // Resolve to absolute path (handles .., and normalization)
  const resolvedPath = resolve(basePath, normalized);
  const normalizedBase = pathNormalize(basePath);

  // CRITICAL: Verify the resolved path is within base directory
  if (
    !resolvedPath.startsWith(normalizedBase + "/") &&
    resolvedPath !== normalizedBase
  ) {
    throw new Error(`Path escapes base directory: ${relativePath}`);
  }

  // Check for symlink escapes by verifying the real path of each component
  // Start from the base and walk up to the target path
  const pathComponents = resolvedPath.substring(normalizedBase.length + 1).split("/");
  let currentPath = normalizedBase;

  for (const component of pathComponents) {
    if (!component) continue; // Skip empty components

    currentPath = `${currentPath}/${component}`;

    try {
      // Check if this component exists (could be file, dir, or symlink)
      const stat = await Deno.lstat(currentPath); // lstat doesn't follow symlinks

      // If it's a symlink, verify where it points
      if (stat.isSymlink) {
        const realPath = await Deno.realPath(currentPath);
        // Verify the symlink target is still within base directory
        if (
          !realPath.startsWith(normalizedBase + "/") &&
          realPath !== normalizedBase
        ) {
          throw new Error(`Path escapes base directory: ${relativePath}`);
        }
      }
    } catch (error) {
      // If lstat/realPath fails with our security error, re-throw it
      if (error instanceof Error && error.message.includes("escapes base directory")) {
        throw error;
      }
      // If component doesn't exist (NotFound), that's okay - it might be created later
      // Other errors (permission) are also okay for path validation
    }
  }

  return resolvedPath;
}

export interface FileMetadata {
  path: string;
  size: number;
  mtime: Date;
}

export interface FileServiceOptions {
  basePath: string;
}

export class FileService {
  private basePath: string;

  constructor(options: FileServiceOptions) {
    this.basePath = options.basePath;
  }

  /**
   * Resolves a relative path to an absolute path within the base directory.
   * Uses secure path validation to prevent traversal attacks.
   */
  private async resolvePath(relativePath: string): Promise<string> {
    return await resolveAndValidatePath(this.basePath, relativePath);
  }

  /**
   * Lists all files in the base directory recursively.
   * Returns a sorted flat list of relative paths.
   */
  async listFiles(): Promise<string[]> {
    const files: string[] = [];
    await this.scanDirectory(this.basePath, "", files);
    return files.sort();
  }

  /**
   * Lists all files in the base directory recursively with metadata.
   * Returns a list sorted by path, including size and modification time.
   */
  async listFilesWithMetadata(): Promise<FileMetadata[]> {
    const files: FileMetadata[] = [];
    await this.scanDirectoryWithMetadata(this.basePath, "", files);
    return files.sort((a, b) => a.path.localeCompare(b.path));
  }

  private async scanDirectoryWithMetadata(
    absolutePath: string,
    relativePath: string,
    files: FileMetadata[]
  ): Promise<void> {
    try {
      for await (const entry of Deno.readDir(absolutePath)) {
        const entryRelPath = relativePath
          ? `${relativePath}/${entry.name}`
          : entry.name;
        const entryAbsPath = `${absolutePath}/${entry.name}`;

        if (entry.isFile) {
          const stat = await Deno.stat(entryAbsPath);
          files.push({
            path: entryRelPath,
            size: stat.size,
            mtime: stat.mtime ?? new Date(0),
          });
        } else if (entry.isDirectory) {
          await this.scanDirectoryWithMetadata(entryAbsPath, entryRelPath, files);
        }
      }
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return;
      }
      throw error;
    }
  }

  private async scanDirectory(
    absolutePath: string,
    relativePath: string,
    files: string[]
  ): Promise<void> {
    try {
      for await (const entry of Deno.readDir(absolutePath)) {
        const entryRelPath = relativePath
          ? `${relativePath}/${entry.name}`
          : entry.name;
        const entryAbsPath = `${absolutePath}/${entry.name}`;

        if (entry.isFile) {
          files.push(entryRelPath);
        } else if (entry.isDirectory) {
          await this.scanDirectory(entryAbsPath, entryRelPath, files);
        }
      }
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return;
      }
      throw error;
    }
  }

  /**
   * Gets the content of a file by its relative path.
   * Returns null if the file doesn't exist.
   */
  async getFile(path: string): Promise<string | null> {
    const absPath = await this.resolvePath(path);
    try {
      return await Deno.readTextFile(absPath);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Checks if a file exists at the given relative path.
   */
  async fileExists(path: string): Promise<boolean> {
    const absPath = await this.resolvePath(path);
    try {
      const stat = await Deno.stat(absPath);
      return stat.isFile;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Writes content to a file at the given relative path.
   * Creates parent directories if they don't exist.
   * Returns true if the file was created, false if it was updated.
   */
  async writeFile(path: string, content: string): Promise<boolean> {
    const absPath = await this.resolvePath(path);
    const exists = await this.fileExists(path);

    // Ensure parent directories exist
    const lastSlash = absPath.lastIndexOf("/");
    if (lastSlash > 0) {
      const parentDir = absPath.substring(0, lastSlash);
      await Deno.mkdir(parentDir, { recursive: true });
    }

    await Deno.writeTextFile(absPath, content);
    return !exists;
  }

  /**
   * Deletes a file at the given relative path.
   */
  async deleteFile(path: string): Promise<void> {
    const absPath = await this.resolvePath(path);
    await Deno.remove(absPath);
  }
}
