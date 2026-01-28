/**
 * Common validation utilities shared across domains.
 */

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
