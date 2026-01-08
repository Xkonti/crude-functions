import { expect } from "@std/expect";
import { MAX_SQLITE_ID, validateId } from "./common.ts";

// =====================
// validateId - valid cases
// =====================

Deno.test("validateId accepts positive integer 1", () => {
  expect(validateId(1)).toBe(1);
});

Deno.test("validateId accepts MAX_SQLITE_ID", () => {
  expect(validateId(MAX_SQLITE_ID)).toBe(MAX_SQLITE_ID);
});

Deno.test("validateId accepts typical positive integer", () => {
  expect(validateId(42)).toBe(42);
});

Deno.test("validateId parses valid string to number", () => {
  expect(validateId("42")).toBe(42);
});

Deno.test("validateId parses string at boundary", () => {
  expect(validateId(String(MAX_SQLITE_ID))).toBe(MAX_SQLITE_ID);
});

// =====================
// validateId - invalid cases
// =====================

Deno.test("validateId rejects zero", () => {
  expect(validateId(0)).toBe(null);
});

Deno.test("validateId rejects negative number", () => {
  expect(validateId(-1)).toBe(null);
});

Deno.test("validateId rejects number above MAX_SQLITE_ID", () => {
  expect(validateId(MAX_SQLITE_ID + 1)).toBe(null);
});

Deno.test("validateId rejects empty string", () => {
  expect(validateId("")).toBe(null);
});

Deno.test("validateId rejects non-numeric string", () => {
  expect(validateId("abc")).toBe(null);
});

Deno.test("validateId rejects NaN", () => {
  expect(validateId(NaN)).toBe(null);
});

Deno.test("validateId rejects string zero", () => {
  expect(validateId("0")).toBe(null);
});

Deno.test("validateId rejects negative string", () => {
  expect(validateId("-5")).toBe(null);
});

Deno.test("validateId rejects whitespace string", () => {
  expect(validateId("   ")).toBe(null);
});

Deno.test("validateId parses leading digits from mixed content string", () => {
  // parseInt("42abc", 10) returns 42, which is valid
  expect(validateId("42abc")).toBe(42);
});

// =====================
// validateId - edge cases
// =====================

Deno.test("validateId parses float string to integer portion", () => {
  // parseInt("3.14", 10) returns 3, which is valid
  expect(validateId("3.14")).toBe(3);
});

Deno.test("validateId handles large valid number", () => {
  expect(validateId(1000000)).toBe(1000000);
});
