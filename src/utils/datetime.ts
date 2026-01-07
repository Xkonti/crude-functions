/**
 * Datetime utilities for consistent timestamp handling across the application.
 *
 * This module provides centralized timestamp formatting to ensure consistency
 * between database storage and display formatting.
 *
 * **Key Principles:**
 * - Database timestamps use SQLite format: "YYYY-MM-DD HH:MM:SS" (no timezone suffix)
 * - Display timestamps include milliseconds: "YYYY-MM-DD HH:MM:SS.sss"
 * - All timestamps are stored and compared in UTC
 * - Parsing handles both SQLite and ISO formats for backward compatibility
 *
 * @module datetime
 */

/**
 * Formats a Date object for SQLite database operations.
 *
 * **Use this for:**
 * - WHERE clause comparisons (`WHERE timestamp < ?`)
 * - INSERT statements with explicit timestamps
 * - Any database query that compares or stores timestamps
 *
 * **Output format:** `"YYYY-MM-DD HH:MM:SS"` (UTC, no timezone suffix)
 *
 * **IMPORTANT:** This format matches SQLite's CURRENT_TIMESTAMP format,
 * enabling correct string-based comparisons in SQL queries.
 *
 * @example
 * ```typescript
 * const date = new Date("2026-01-02T18:08:36.123Z");
 * formatForSqlite(date); // "2026-01-02 18:08:36"
 * ```
 *
 * @param date - The date to format
 * @returns SQLite-compatible timestamp string
 */
export function formatForSqlite(date: Date): string {
  return date.toISOString().replace("T", " ").slice(0, 19);
}

/**
 * Formats a Date object for web UI display with millisecond precision.
 *
 * **Use this for:**
 * - Displaying timestamps in web UI tables
 * - Log entries in the UI
 * - Any user-facing timestamp display
 *
 * **Output format:** `"YYYY-MM-DD HH:MM:SS.sss"` (UTC, with milliseconds)
 *
 * **DO NOT use for database operations** - use `formatForSqlite()` instead.
 *
 * @example
 * ```typescript
 * const date = new Date("2026-01-02T18:08:36.123Z");
 * formatForDisplay(date); // "2026-01-02 18:08:36.123"
 * ```
 *
 * @param date - The date to format
 * @returns Display-formatted timestamp string with milliseconds
 */
export function formatForDisplay(date: Date): string {
  return date.toISOString().replace("T", " ").substring(0, 23);
}

/**
 * Parses a timestamp string from the database into a Date object.
 *
 * **Handles both formats for backward compatibility:**
 * - SQLite format: `"2026-01-02 18:08:36"` (current standard)
 * - ISO format: `"2026-01-02T18:08:36.000Z"` (legacy format from bug)
 *
 * **Use this for:**
 * - Reading timestamps from database rows
 * - Converting stored timestamps back to Date objects
 *
 * **Timezone handling:** Both formats are interpreted as UTC.
 *
 * @example
 * ```typescript
 * // SQLite format (current)
 * parseSqliteTimestamp("2026-01-02 18:08:36");
 * // Date object representing 2026-01-02T18:08:36.000Z
 *
 * // ISO format (backward compatibility)
 * parseSqliteTimestamp("2026-01-02T18:08:36.000Z");
 * // Same Date object
 * ```
 *
 * @param timestamp - SQLite or ISO format timestamp string
 * @returns Date object (UTC)
 */
export function parseSqliteTimestamp(timestamp: string): Date {
  // SQLite format doesn't have "T" separator
  if (!timestamp.includes("T")) {
    // Append "Z" to indicate UTC before parsing
    return new Date(timestamp + "Z");
  }
  // ISO format - parse directly
  return new Date(timestamp);
}
