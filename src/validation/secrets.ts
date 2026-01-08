/**
 * Validation utilities for secrets management.
 */

// Secret names: A-Z, a-z, 0-9, underscore, dash
const SECRET_NAME_REGEX = /^[a-zA-Z0-9_-]+$/;

// Valid secret scopes
const VALID_SCOPES = ["global", "function", "group", "key"] as const;
type SecretScopeString = typeof VALID_SCOPES[number];

/**
 * Validates that a secret name contains only allowed characters
 */
export function validateSecretName(name: string): boolean {
  return SECRET_NAME_REGEX.test(name);
}

/**
 * Validates that a scope is one of the allowed values
 */
export function validateScope(scope: string): scope is SecretScopeString {
  return VALID_SCOPES.includes(scope as SecretScopeString);
}

/**
 * Validates that a secret value is not empty
 */
export function validateSecretValue(value: string): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Returns the list of valid scope strings
 */
export function getValidScopes(): readonly string[] {
  return VALID_SCOPES;
}
