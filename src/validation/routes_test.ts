import { expect } from "@std/expect";
import {
  getValidMethods,
  validateMethods,
  validateRouteName,
  validateRoutePath,
} from "./routes.ts";

// =====================
// validateRouteName - valid cases
// =====================

Deno.test("validateRouteName accepts simple name", () => {
  expect(validateRouteName("hello")).toBe(true);
});

Deno.test("validateRouteName accepts name with spaces (has content after trim)", () => {
  expect(validateRouteName("  hello  ")).toBe(true);
});

Deno.test("validateRouteName accepts single character", () => {
  expect(validateRouteName("a")).toBe(true);
});

Deno.test("validateRouteName accepts name with special characters", () => {
  expect(validateRouteName("hello-world_v2")).toBe(true);
});

// =====================
// validateRouteName - invalid cases
// =====================

Deno.test("validateRouteName rejects empty string", () => {
  expect(validateRouteName("")).toBe(false);
});

Deno.test("validateRouteName rejects whitespace only", () => {
  expect(validateRouteName("   ")).toBe(false);
});

Deno.test("validateRouteName rejects tabs only", () => {
  expect(validateRouteName("\t\t")).toBe(false);
});

// =====================
// validateRoutePath - valid cases
// =====================

Deno.test("validateRoutePath accepts root path", () => {
  expect(validateRoutePath("/")).toBe(true);
});

Deno.test("validateRoutePath accepts simple path", () => {
  expect(validateRoutePath("/hello")).toBe(true);
});

Deno.test("validateRoutePath accepts nested path", () => {
  expect(validateRoutePath("/api/v1/users")).toBe(true);
});

Deno.test("validateRoutePath accepts path with dashes", () => {
  expect(validateRoutePath("/my-route")).toBe(true);
});

Deno.test("validateRoutePath accepts path with underscores", () => {
  expect(validateRoutePath("/my_route")).toBe(true);
});

Deno.test("validateRoutePath accepts path with numbers", () => {
  expect(validateRoutePath("/api/v2/route123")).toBe(true);
});

// =====================
// validateRoutePath - invalid cases
// =====================

Deno.test("validateRoutePath rejects empty string", () => {
  expect(validateRoutePath("")).toBe(false);
});

Deno.test("validateRoutePath rejects path without leading slash", () => {
  expect(validateRoutePath("hello")).toBe(false);
});

Deno.test("validateRoutePath rejects double slash at start", () => {
  expect(validateRoutePath("//double")).toBe(false);
});

Deno.test("validateRoutePath rejects double slash in middle", () => {
  expect(validateRoutePath("/path//middle")).toBe(false);
});

Deno.test("validateRoutePath rejects multiple consecutive slashes", () => {
  expect(validateRoutePath("/path///triple")).toBe(false);
});

// =====================
// validateMethods - valid cases
// =====================

Deno.test("validateMethods accepts single GET", () => {
  expect(validateMethods(["GET"])).toBe(true);
});

Deno.test("validateMethods accepts single POST", () => {
  expect(validateMethods(["POST"])).toBe(true);
});

Deno.test("validateMethods accepts multiple methods", () => {
  expect(validateMethods(["GET", "POST"])).toBe(true);
});

Deno.test("validateMethods accepts all valid methods", () => {
  expect(
    validateMethods(["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"])
  ).toBe(true);
});

Deno.test("validateMethods accepts PUT", () => {
  expect(validateMethods(["PUT"])).toBe(true);
});

Deno.test("validateMethods accepts DELETE", () => {
  expect(validateMethods(["DELETE"])).toBe(true);
});

Deno.test("validateMethods accepts PATCH", () => {
  expect(validateMethods(["PATCH"])).toBe(true);
});

Deno.test("validateMethods accepts HEAD", () => {
  expect(validateMethods(["HEAD"])).toBe(true);
});

Deno.test("validateMethods accepts OPTIONS", () => {
  expect(validateMethods(["OPTIONS"])).toBe(true);
});

// =====================
// validateMethods - invalid cases
// =====================

Deno.test("validateMethods rejects empty array", () => {
  expect(validateMethods([])).toBe(false);
});

Deno.test("validateMethods rejects invalid method", () => {
  expect(validateMethods(["INVALID"])).toBe(false);
});

Deno.test("validateMethods rejects lowercase method", () => {
  expect(validateMethods(["get"])).toBe(false);
});

Deno.test("validateMethods rejects mixed valid and invalid", () => {
  expect(validateMethods(["GET", "INVALID"])).toBe(false);
});

Deno.test("validateMethods rejects CONNECT method", () => {
  expect(validateMethods(["CONNECT"])).toBe(false);
});

Deno.test("validateMethods rejects TRACE method", () => {
  expect(validateMethods(["TRACE"])).toBe(false);
});

// =====================
// getValidMethods
// =====================

Deno.test("getValidMethods returns all 7 valid methods", () => {
  const methods = getValidMethods();
  expect(methods).toEqual([
    "GET",
    "POST",
    "PUT",
    "DELETE",
    "PATCH",
    "HEAD",
    "OPTIONS",
  ]);
});

Deno.test("getValidMethods returns a copy (not the original array)", () => {
  const methods1 = getValidMethods();
  const methods2 = getValidMethods();
  expect(methods1).not.toBe(methods2);
  expect(methods1).toEqual(methods2);
});
