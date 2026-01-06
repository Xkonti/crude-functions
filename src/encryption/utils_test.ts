import { expect } from "@std/expect";
import { base64ToBytes, bytesToBase64 } from "./utils.ts";

// =====================
// bytesToBase64 tests
// =====================

Deno.test("bytesToBase64 - basic encoding", () => {
  const bytes = new TextEncoder().encode("Hello, World!");
  const base64 = bytesToBase64(bytes);
  expect(base64).toBe("SGVsbG8sIFdvcmxkIQ==");
});

Deno.test("bytesToBase64 - empty array", () => {
  const bytes = new Uint8Array(0);
  const base64 = bytesToBase64(bytes);
  expect(base64).toBe("");
});

Deno.test("bytesToBase64 - handles data near 16KB limit", () => {
  const largeBytes = new Uint8Array(16 * 1024);
  // Fill with non-zero data to ensure proper encoding
  for (let i = 0; i < largeBytes.length; i++) {
    largeBytes[i] = i % 256;
  }
  expect(() => bytesToBase64(largeBytes)).not.toThrow();

  // Verify round-trip works
  const base64 = bytesToBase64(largeBytes);
  const decoded = base64ToBytes(base64);
  expect(decoded).toEqual(largeBytes);
});

// =====================
// base64ToBytes tests
// =====================

Deno.test("base64ToBytes - basic decoding", () => {
  const bytes = base64ToBytes("SGVsbG8sIFdvcmxkIQ==");
  const text = new TextDecoder().decode(bytes);
  expect(text).toBe("Hello, World!");
});

Deno.test("base64ToBytes - empty string", () => {
  const bytes = base64ToBytes("");
  expect(bytes.length).toBe(0);
});

Deno.test("base64ToBytes - throws on invalid base64", () => {
  expect(() => base64ToBytes("not-valid-base64!!!")).toThrow();
});

// =====================
// Round-trip tests
// =====================

Deno.test("base64 round-trip preserves data", () => {
  const original = new Uint8Array([0, 1, 127, 128, 255]);
  const base64 = bytesToBase64(original);
  const decoded = base64ToBytes(base64);
  expect(decoded).toEqual(original);
});
