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
