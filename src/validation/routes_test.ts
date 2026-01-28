import { expect } from "@std/expect";
import {
  getValidMethods,
  validateMethods,
  validateFunctionName,
  validateFunctionPath,
} from "./routes.ts";

// =====================
// validateFunctionName - valid cases
// =====================

Deno.test("validateFunctionName accepts simple name", () => {
  expect(validateFunctionName("hello")).toBe(true);
});

Deno.test("validateFunctionName accepts name with spaces (has content after trim)", () => {
  expect(validateFunctionName("  hello  ")).toBe(true);
});

Deno.test("validateFunctionName accepts single character", () => {
  expect(validateFunctionName("a")).toBe(true);
});

Deno.test("validateFunctionName accepts name with special characters", () => {
  expect(validateFunctionName("hello-world_v2")).toBe(true);
});

// =====================
// validateFunctionName - invalid cases
// =====================

Deno.test("validateFunctionName rejects empty string", () => {
  expect(validateFunctionName("")).toBe(false);
});

Deno.test("validateFunctionName rejects whitespace only", () => {
  expect(validateFunctionName("   ")).toBe(false);
});

Deno.test("validateFunctionName rejects tabs only", () => {
  expect(validateFunctionName("\t\t")).toBe(false);
});

// =====================
// validateFunctionPath - valid cases
// =====================

Deno.test("validateFunctionPath accepts root path", () => {
  expect(validateFunctionPath("/")).toBe(true);
});

Deno.test("validateFunctionPath accepts simple path", () => {
  expect(validateFunctionPath("/hello")).toBe(true);
});

Deno.test("validateFunctionPath accepts nested path", () => {
  expect(validateFunctionPath("/api/v1/users")).toBe(true);
});

Deno.test("validateFunctionPath accepts path with dashes", () => {
  expect(validateFunctionPath("/my-route")).toBe(true);
});

Deno.test("validateFunctionPath accepts path with underscores", () => {
  expect(validateFunctionPath("/my_route")).toBe(true);
});

Deno.test("validateFunctionPath accepts path with numbers", () => {
  expect(validateFunctionPath("/api/v2/route123")).toBe(true);
});

// =====================
// validateFunctionPath - invalid cases
// =====================

Deno.test("validateFunctionPath rejects empty string", () => {
  expect(validateFunctionPath("")).toBe(false);
});

Deno.test("validateFunctionPath rejects path without leading slash", () => {
  expect(validateFunctionPath("hello")).toBe(false);
});

Deno.test("validateFunctionPath rejects double slash at start", () => {
  expect(validateFunctionPath("//double")).toBe(false);
});

Deno.test("validateFunctionPath rejects double slash in middle", () => {
  expect(validateFunctionPath("/path//middle")).toBe(false);
});

Deno.test("validateFunctionPath rejects multiple consecutive slashes", () => {
  expect(validateFunctionPath("/path///triple")).toBe(false);
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
