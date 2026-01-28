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

/**
 * Convert SurrealDB DateTime to JavaScript Date.
 *
 * SurrealDB returns DateTime objects which have a toDate() method.
 * This helper safely converts any value that might be a DateTime to a proper JS Date.
 *
 * @param value - The value to convert (DateTime, Date, string, or number)
 * @returns A JavaScript Date object
 */
export function toDate(value: Date | unknown): Date {
  if (value instanceof Date) {
    return value;
  }
  // SurrealDB's DateTime has a toDate() method
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    return value.toDate() as Date;
  }
  // Try to construct from string/number
  return new Date(value as string | number);
}
