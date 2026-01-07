import { resolve, normalize as pathNormalize } from "@std/path";

/**
 * Validation utilities for file paths with security checks.
 */

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
