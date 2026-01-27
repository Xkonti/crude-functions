/**
 * Common validation utilities shared across domains.
 */

/**
 * Maximum valid SQLite integer ID (32-bit signed integer max)
 */
export const MAX_SQLITE_ID = 2147483647;

/**
 * Validate that an ID is a positive integer within valid range.
 * Returns the validated ID or null if invalid.
 */
export function validateId(value: string | number): number | null {
  const id = typeof value === "string" ? parseInt(value, 10) : value;

  if (isNaN(id) || id <= 0 || id > MAX_SQLITE_ID) {
    return null;
  }

  return id;
}

/**
 * Validate that an ID is a valid SurrealDB record ID string.
 * SurrealDB auto-generated IDs use alphanumeric characters with underscores and hyphens.
 * Returns the validated ID or null if invalid.
 */
export function validateSurrealId(value: string | undefined): string | null {
  if (!value || value.length === 0) {
    return null;
  }
  // Match SurrealDB's default ID format (alphanumeric with underscores/hyphens)
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
    return null;
  }
  return value;
}
