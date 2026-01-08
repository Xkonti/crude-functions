import { expect } from "@std/expect";
import {
  validateKeyGroup,
  validateKeyName,
  validateKeyValue,
} from "./keys.ts";

// =====================
// validateKeyGroup - valid cases
// =====================

Deno.test("validateKeyGroup accepts lowercase letters", () => {
  expect(validateKeyGroup("abc")).toBe(true);
});

Deno.test("validateKeyGroup accepts numbers", () => {
  expect(validateKeyGroup("123")).toBe(true);
});

Deno.test("validateKeyGroup accepts mixed lowercase and numbers", () => {
  expect(validateKeyGroup("a1b2c3")).toBe(true);
});

Deno.test("validateKeyGroup accepts underscores", () => {
  expect(validateKeyGroup("key_group")).toBe(true);
});

Deno.test("validateKeyGroup accepts dashes", () => {
  expect(validateKeyGroup("key-group")).toBe(true);
});

Deno.test("validateKeyGroup accepts all allowed characters", () => {
  expect(validateKeyGroup("my_key-group_123")).toBe(true);
});

// =====================
// validateKeyGroup - invalid cases
// =====================

Deno.test("validateKeyGroup rejects empty string", () => {
  expect(validateKeyGroup("")).toBe(false);
});

Deno.test("validateKeyGroup rejects uppercase letters", () => {
  expect(validateKeyGroup("ABC")).toBe(false);
});

Deno.test("validateKeyGroup rejects mixed case", () => {
  expect(validateKeyGroup("Key")).toBe(false);
});

Deno.test("validateKeyGroup rejects spaces", () => {
  expect(validateKeyGroup("key group")).toBe(false);
});

Deno.test("validateKeyGroup rejects leading space", () => {
  expect(validateKeyGroup(" key")).toBe(false);
});

Deno.test("validateKeyGroup rejects trailing space", () => {
  expect(validateKeyGroup("key ")).toBe(false);
});

Deno.test("validateKeyGroup rejects special characters", () => {
  expect(validateKeyGroup("key@special")).toBe(false);
});

Deno.test("validateKeyGroup rejects dots", () => {
  expect(validateKeyGroup("key.group")).toBe(false);
});

// =====================
// validateKeyName - valid cases
// =====================

Deno.test("validateKeyName accepts lowercase letters", () => {
  expect(validateKeyName("mykey")).toBe(true);
});

Deno.test("validateKeyName accepts numbers", () => {
  expect(validateKeyName("456")).toBe(true);
});

Deno.test("validateKeyName accepts underscores and dashes", () => {
  expect(validateKeyName("my_key-name")).toBe(true);
});

// =====================
// validateKeyName - invalid cases
// =====================

Deno.test("validateKeyName rejects empty string", () => {
  expect(validateKeyName("")).toBe(false);
});

Deno.test("validateKeyName rejects uppercase", () => {
  expect(validateKeyName("MyKey")).toBe(false);
});

Deno.test("validateKeyName rejects spaces", () => {
  expect(validateKeyName("my key")).toBe(false);
});

Deno.test("validateKeyName rejects special characters", () => {
  expect(validateKeyName("my!key")).toBe(false);
});

// =====================
// validateKeyValue - valid cases
// =====================

Deno.test("validateKeyValue accepts lowercase letters", () => {
  expect(validateKeyValue("abc")).toBe(true);
});

Deno.test("validateKeyValue accepts uppercase letters", () => {
  expect(validateKeyValue("ABC")).toBe(true);
});

Deno.test("validateKeyValue accepts mixed case", () => {
  expect(validateKeyValue("AbCdEf")).toBe(true);
});

Deno.test("validateKeyValue accepts numbers", () => {
  expect(validateKeyValue("123456")).toBe(true);
});

Deno.test("validateKeyValue accepts underscores", () => {
  expect(validateKeyValue("key_value")).toBe(true);
});

Deno.test("validateKeyValue accepts dashes", () => {
  expect(validateKeyValue("key-value")).toBe(true);
});

Deno.test("validateKeyValue accepts complex valid value", () => {
  expect(validateKeyValue("MyApiKey_v2-PRODUCTION")).toBe(true);
});

// =====================
// validateKeyValue - invalid cases
// =====================

Deno.test("validateKeyValue rejects empty string", () => {
  expect(validateKeyValue("")).toBe(false);
});

Deno.test("validateKeyValue rejects spaces", () => {
  expect(validateKeyValue("key value")).toBe(false);
});

Deno.test("validateKeyValue rejects dots", () => {
  expect(validateKeyValue("key.value")).toBe(false);
});

Deno.test("validateKeyValue rejects special characters", () => {
  expect(validateKeyValue("key@value")).toBe(false);
});

Deno.test("validateKeyValue rejects slashes", () => {
  expect(validateKeyValue("key/value")).toBe(false);
});

Deno.test("validateKeyValue rejects equals sign", () => {
  expect(validateKeyValue("key=value")).toBe(false);
});
