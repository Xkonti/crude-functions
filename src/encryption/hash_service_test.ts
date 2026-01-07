import { expect } from "@std/expect";
import { HashService } from "./hash_service.ts";

// Test hash key (32 bytes base64-encoded)
// Generated via: openssl rand -base64 32
const TEST_HASH_KEY = "aGFzaGtleWhhc2hrZXloYXNoa2V5aGFzaGtleWhhc2g=";

Deno.test("HashService - HMAC-SHA256 consistency", async () => {
  const service = new HashService({ hashKey: TEST_HASH_KEY });
  const hash1 = await service.computeHash("test-value");
  const hash2 = await service.computeHash("test-value");

  expect(hash1).toBe(hash2);
  expect(hash1.length).toBeGreaterThan(20); // Base64 SHA256 = 44 chars
});

Deno.test("HashService - Different inputs produce different hashes", async () => {
  const service = new HashService({ hashKey: TEST_HASH_KEY });
  const hash1 = await service.computeHash("value1");
  const hash2 = await service.computeHash("value2");

  expect(hash1).not.toBe(hash2);
});

Deno.test("HashService - Different keys produce different hashes", async () => {
  const service1 = new HashService({ hashKey: TEST_HASH_KEY });
  const service2 = new HashService({
    hashKey: "ZGVhZGJlZWZkZWFkYmVlZmRlYWRiZWVmZGVhZGJlZWY="
  });

  const hash1 = await service1.computeHash("same-value");
  const hash2 = await service2.computeHash("same-value");

  expect(hash1).not.toBe(hash2);
});

Deno.test("HashService - Timing-safe comparison true cases", () => {
  const service = new HashService({ hashKey: TEST_HASH_KEY });

  expect(service.timingSafeEqual("abc", "abc")).toBe(true);
  expect(service.timingSafeEqual("", "")).toBe(true);
  expect(service.timingSafeEqual("longstring123", "longstring123")).toBe(true);
});

Deno.test("HashService - Timing-safe comparison false cases", () => {
  const service = new HashService({ hashKey: TEST_HASH_KEY });

  expect(service.timingSafeEqual("abc", "abd")).toBe(false);
  expect(service.timingSafeEqual("abc", "abcd")).toBe(false);
  expect(service.timingSafeEqual("abc", "")).toBe(false);
  expect(service.timingSafeEqual("", "abc")).toBe(false);
});

Deno.test("HashService - Invalid key length throws", () => {
  expect(() => {
    new HashService({ hashKey: "dG9vc2hvcnQ=" }); // Only 8 bytes
  }).toThrow("must be exactly 32 bytes");
});

Deno.test("HashService - Empty string hashing works", async () => {
  const service = new HashService({ hashKey: TEST_HASH_KEY });
  const hash = await service.computeHash("");

  expect(hash.length).toBeGreaterThan(0);
  expect(typeof hash).toBe("string");
});

Deno.test("HashService - Hash output is base64 encoded", async () => {
  const service = new HashService({ hashKey: TEST_HASH_KEY });
  const hash = await service.computeHash("test");

  // Base64 regex: only A-Z, a-z, 0-9, +, /, and = for padding
  expect(/^[A-Za-z0-9+/]+=*$/.test(hash)).toBe(true);

  // HMAC-SHA256 produces 32 bytes → 44 base64 characters (with padding)
  expect(hash.length).toBe(44);
});

Deno.test("HashService - Deterministic output for same input", async () => {
  const service = new HashService({ hashKey: TEST_HASH_KEY });

  const inputs = [
    "test-key-1",
    "test-key-2",
    "very-long-api-key-with-many-characters-1234567890",
    "short",
    "",
  ];

  for (const input of inputs) {
    const hash1 = await service.computeHash(input);
    const hash2 = await service.computeHash(input);
    const hash3 = await service.computeHash(input);

    expect(hash1).toBe(hash2);
    expect(hash2).toBe(hash3);
  }
});
