/**
 * SurrealDB helper utilities
 */

import type { RecordId } from "surrealdb";

/**
 * Convert RecordId to string for API/UI boundaries.
 * Use this at the point where data leaves the service layer
 * (API responses, web page rendering).
 */
export function recordIdToString(id: RecordId): string {
  return id.id as string;
}
