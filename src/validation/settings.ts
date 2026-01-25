import {
  SettingsMetadata,
  SettingNames,
  type SettingName,
} from "../settings/types.ts";

/**
 * Validation result for a single setting
 */
export type SettingValidationResult =
  | { valid: true }
  | { valid: false; error: string };

/**
 * Validation error for batch validation
 */
export interface SettingValidationError {
  name: string;
  error: string;
}

/**
 * Validation result for multiple settings
 */
export type SettingsValidationResult =
  | { valid: true }
  | { valid: false; errors: SettingValidationError[] };

/**
 * Validates a single setting value against its metadata.
 *
 * @param name - The setting name
 * @param value - The value to validate
 * @returns Validation result with error message if invalid
 *
 * @example
 * ```typescript
 * const result = validateSettingValue("log.level", "debug");
 * if (!result.valid) {
 *   console.error(result.error);
 * }
 * ```
 */
export function validateSettingValue(
  name: string,
  value: string
): SettingValidationResult {
  // Check if setting name exists
  if (!isValidSettingName(name)) {
    return { valid: false, error: `Unknown setting name: ${name}` };
  }

  const metadata = SettingsMetadata[name as SettingName];

  // Validate based on input type
  switch (metadata.inputType) {
    case "number": {
      const num = parseInt(value, 10);
      if (isNaN(num)) {
        return { valid: false, error: "Must be a valid number" };
      }
      if (metadata.min !== undefined && num < metadata.min) {
        return {
          valid: false,
          error: `Must be at least ${metadata.min}`,
        };
      }
      if (metadata.max !== undefined && num > metadata.max) {
        return {
          valid: false,
          error: `Must be at most ${metadata.max}`,
        };
      }
      break;
    }

    case "select": {
      if (!metadata.options || !metadata.options.includes(value)) {
        const validOptions = metadata.options?.join(", ") || "none";
        return {
          valid: false,
          error: `Invalid value. Must be one of: ${validOptions}`,
        };
      }
      break;
    }

    case "checkboxGroup": {
      // Validate format: comma-separated numeric IDs (e.g., "1,3,5")
      // Empty string is valid (no groups selected)
      if (value !== "" && !/^(\d+)(,\d+)*$/.test(value)) {
        return {
          valid: false,
          error: "Invalid format. Must be comma-separated numeric IDs",
        };
      }
      break;
    }

    case "text": {
      // Text values are always valid
      break;
    }
  }

  return { valid: true };
}

/**
 * Validates multiple settings at once.
 * Returns all validation errors, not just the first one.
 *
 * @param settings - Object mapping setting names to values
 * @returns Validation result with all errors
 *
 * @example
 * ```typescript
 * const result = validateSettings({
 *   "log.level": "debug",
 *   "log.trimming.interval-seconds": "600"
 * });
 * if (!result.valid) {
 *   console.error(result.errors);
 * }
 * ```
 */
export function validateSettings(
  settings: Record<string, string>
): SettingsValidationResult {
  const errors: SettingValidationError[] = [];

  for (const [name, value] of Object.entries(settings)) {
    const result = validateSettingValue(name, value);
    if (!result.valid) {
      errors.push({ name, error: result.error });
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true };
}

/**
 * Validates that a setting name exists in the SettingNames registry.
 *
 * @param name - The setting name to validate
 * @returns True if the name is a valid setting
 *
 * @example
 * ```typescript
 * isValidSettingName("log.level");     // true
 * isValidSettingName("unknown.name");  // false
 * ```
 */
export function isValidSettingName(name: string): boolean {
  return Object.values(SettingNames).includes(name as SettingName);
}
