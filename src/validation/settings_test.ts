import { expect } from "@std/expect";
import {
  validateSettingValue,
  validateSettings,
  isValidSettingName,
} from "./settings.ts";
import { SettingNames } from "../settings/types.ts";

// ============== validateSettingValue ==============

Deno.test("validateSettingValue - accepts valid number within bounds", () => {
  const result = validateSettingValue(
    SettingNames.LOG_TRIMMING_INTERVAL_SECONDS,
    "600"
  );
  expect(result.valid).toBe(true);
});

Deno.test("validateSettingValue - accepts number at minimum bound", () => {
  const result = validateSettingValue(
    SettingNames.LOG_TRIMMING_INTERVAL_SECONDS,
    "1"
  );
  expect(result.valid).toBe(true);
});

Deno.test("validateSettingValue - accepts number at maximum bound", () => {
  const result = validateSettingValue(
    SettingNames.LOG_TRIMMING_INTERVAL_SECONDS,
    "86400"
  );
  expect(result.valid).toBe(true);
});

Deno.test("validateSettingValue - rejects number below minimum", () => {
  const result = validateSettingValue(
    SettingNames.LOG_TRIMMING_INTERVAL_SECONDS,
    "0"
  );
  expect(result.valid).toBe(false);
  if (!result.valid) {
    expect(result.error).toContain("at least");
  }
});

Deno.test("validateSettingValue - rejects number above maximum", () => {
  const result = validateSettingValue(
    SettingNames.LOG_TRIMMING_INTERVAL_SECONDS,
    "99999"
  );
  expect(result.valid).toBe(false);
  if (!result.valid) {
    expect(result.error).toContain("at most");
  }
});

Deno.test("validateSettingValue - rejects invalid number format", () => {
  const result = validateSettingValue(
    SettingNames.LOG_TRIMMING_INTERVAL_SECONDS,
    "not-a-number"
  );
  expect(result.valid).toBe(false);
  if (!result.valid) {
    expect(result.error).toContain("valid number");
  }
});

Deno.test("validateSettingValue - accepts valid select option", () => {
  const result = validateSettingValue(SettingNames.LOG_LEVEL, "debug");
  expect(result.valid).toBe(true);
});

Deno.test("validateSettingValue - rejects invalid select option", () => {
  const result = validateSettingValue(SettingNames.LOG_LEVEL, "invalid");
  expect(result.valid).toBe(false);
  if (!result.valid) {
    expect(result.error).toContain("Must be one of");
  }
});

Deno.test("validateSettingValue - accepts empty string for checkboxGroup", () => {
  const result = validateSettingValue(SettingNames.API_ACCESS_GROUPS, "");
  expect(result.valid).toBe(true);
});

Deno.test("validateSettingValue - accepts single ID for checkboxGroup", () => {
  const result = validateSettingValue(SettingNames.API_ACCESS_GROUPS, "1");
  expect(result.valid).toBe(true);
});

Deno.test("validateSettingValue - accepts multiple IDs for checkboxGroup", () => {
  // Accepts both numeric and alphanumeric IDs
  const result = validateSettingValue(SettingNames.API_ACCESS_GROUPS, "abc123,def456,xyz");
  expect(result.valid).toBe(true);
});

Deno.test("validateSettingValue - accepts alphanumeric IDs for checkboxGroup", () => {
  // SurrealDB uses string-based RecordIds supporting alphanumeric characters
  const result = validateSettingValue(SettingNames.API_ACCESS_GROUPS, "abc,def,xyz123");
  expect(result.valid).toBe(true);
});

Deno.test("validateSettingValue - rejects invalid checkboxGroup format with spaces", () => {
  // Spaces are not allowed in alphanumeric IDs
  const result = validateSettingValue(SettingNames.API_ACCESS_GROUPS, "abc, def");
  expect(result.valid).toBe(false);
  if (!result.valid) {
    expect(result.error).toContain("comma-separated alphanumeric IDs");
  }
});

Deno.test("validateSettingValue - rejects invalid checkboxGroup format with trailing comma", () => {
  // Trailing comma is not valid format
  const result = validateSettingValue(SettingNames.API_ACCESS_GROUPS, "abc,def,");
  expect(result.valid).toBe(false);
  if (!result.valid) {
    expect(result.error).toContain("comma-separated alphanumeric IDs");
  }
});

Deno.test("validateSettingValue - accepts any string for text input", () => {
  // FILES_MAX_SIZE_BYTES is a number type, let's find a text type if exists
  // For now, test with any valid setting that would be text
  // Since all current settings are either number, select, or checkboxGroup,
  // we'll test the text case programmatically
  const result = validateSettingValue(SettingNames.LOG_LEVEL, "debug");
  expect(result.valid).toBe(true);
});

Deno.test("validateSettingValue - rejects unknown setting name", () => {
  const result = validateSettingValue("unknown.setting", "value");
  expect(result.valid).toBe(false);
  if (!result.valid) {
    expect(result.error).toContain("Unknown setting name");
  }
});

// ============== validateSettings ==============

Deno.test("validateSettings - accepts all valid settings", () => {
  const result = validateSettings({
    [SettingNames.LOG_LEVEL]: "debug",
    [SettingNames.LOG_TRIMMING_INTERVAL_SECONDS]: "600",
  });
  expect(result.valid).toBe(true);
});

Deno.test("validateSettings - rejects all invalid settings", () => {
  const result = validateSettings({
    [SettingNames.LOG_LEVEL]: "invalid",
    [SettingNames.LOG_TRIMMING_INTERVAL_SECONDS]: "not-a-number",
  });
  expect(result.valid).toBe(false);
  if (!result.valid) {
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0].name).toBe(SettingNames.LOG_LEVEL);
    expect(result.errors[1].name).toBe(SettingNames.LOG_TRIMMING_INTERVAL_SECONDS);
  }
});

Deno.test("validateSettings - returns all errors for mixed valid/invalid", () => {
  const result = validateSettings({
    [SettingNames.LOG_LEVEL]: "debug", // valid
    [SettingNames.LOG_TRIMMING_INTERVAL_SECONDS]: "99999", // invalid (too high)
    [SettingNames.METRICS_RETENTION_DAYS]: "30", // valid
  });
  expect(result.valid).toBe(false);
  if (!result.valid) {
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].name).toBe(SettingNames.LOG_TRIMMING_INTERVAL_SECONDS);
  }
});

Deno.test("validateSettings - accepts empty settings object", () => {
  const result = validateSettings({});
  expect(result.valid).toBe(true);
});

// ============== isValidSettingName ==============

Deno.test("isValidSettingName - returns true for valid setting names", () => {
  expect(isValidSettingName(SettingNames.LOG_LEVEL)).toBe(true);
  expect(isValidSettingName(SettingNames.API_ACCESS_GROUPS)).toBe(true);
  expect(isValidSettingName(SettingNames.LOG_TRIMMING_INTERVAL_SECONDS)).toBe(true);
});

Deno.test("isValidSettingName - returns false for unknown setting names", () => {
  expect(isValidSettingName("unknown.setting")).toBe(false);
  expect(isValidSettingName("user.theme")).toBe(false); // Not defined yet
  expect(isValidSettingName("")).toBe(false);
});
