/**
 * Validation utilities for function definitions.
 */

const VALID_METHODS = [
  "GET",
  "POST",
  "PUT",
  "DELETE",
  "PATCH",
  "HEAD",
  "OPTIONS",
];

/**
 * Validates that a function name is non-empty
 */
export function validateFunctionName(name: string): boolean {
  return name.trim().length > 0;
}

/**
 * Validates that a function path starts with / and has no double slashes
 */
export function validateFunctionPath(path: string): boolean {
  if (!path || !path.startsWith("/")) return false;
  if (path !== "/" && path.includes("//")) return false;
  return true;
}

/**
 * Validates that HTTP methods are from the allowed list
 */
export function validateMethods(methods: string[]): boolean {
  if (!methods || methods.length === 0) return false;
  return methods.every((m) => VALID_METHODS.includes(m));
}

/**
 * Get list of valid HTTP methods
 */
export function getValidMethods(): string[] {
  return [...VALID_METHODS];
}
