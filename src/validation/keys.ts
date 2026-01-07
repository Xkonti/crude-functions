/**
 * Validation utilities for API keys and groups.
 */

// Key groups: lowercase a-z, 0-9, underscore, dash
const KEY_GROUP_REGEX = /^[a-z0-9_-]+$/;

// Key names: lowercase a-z, 0-9, underscore, dash (same as groups)
const KEY_NAME_REGEX = /^[a-z0-9_-]+$/;

// Key values: a-z, A-Z, 0-9, underscore, dash
const KEY_VALUE_REGEX = /^[a-zA-Z0-9_-]+$/;

/**
 * Validates that a key group name contains only allowed characters
 */
export function validateKeyGroup(group: string): boolean {
  return KEY_GROUP_REGEX.test(group);
}

/**
 * Validates that a key name contains only allowed characters
 */
export function validateKeyName(name: string): boolean {
  return KEY_NAME_REGEX.test(name);
}

/**
 * Validates that a key value contains only allowed characters
 */
export function validateKeyValue(value: string): boolean {
  return KEY_VALUE_REGEX.test(value);
}
