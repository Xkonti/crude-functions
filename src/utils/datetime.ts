/**
 * Datetime utilities for consistent timestamp handling across the application.
 *
 * This module provides centralized timestamp formatting to ensure consistency
 * between database storage and display formatting.
 *
 * **Key Principles:**
 * - Display timestamps include milliseconds: "YYYY-MM-DD HH:MM:SS.sss"
 * - All timestamps are stored and compared in UTC
 *
 * @module datetime
 */

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
