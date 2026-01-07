import { expect } from "@std/expect";
import { TestSetupBuilder } from "../test/test_setup_builder.ts";
import { HashService } from "./hash_service.ts";

Deno.test("HashService - HMAC-SHA256 consistency", async () => {
  const ctx = await TestSetupBuilder.create().build();
  try {
    const hash1 = await ctx.hashService.computeHash("test-value");
    const hash2 = await ctx.hashService.computeHash("test-value");

    expect(hash1).toBe(hash2);
    expect(hash1.length).toBeGreaterThan(20); // Base64 SHA256 = 44 chars
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("HashService - Different inputs produce different hashes", async () => {
  const ctx = await TestSetupBuilder.create().build();
  try {
    const hash1 = await ctx.hashService.computeHash("value1");
    const hash2 = await ctx.hashService.computeHash("value2");

    expect(hash1).not.toBe(hash2);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("HashService - Different keys produce different hashes", async () => {
  const ctx1 = await TestSetupBuilder.create().build();
  const ctx2 = await TestSetupBuilder.create().build();
  try {
    const hash1 = await ctx1.hashService.computeHash("same-value");
    const hash2 = await ctx2.hashService.computeHash("same-value");

    expect(hash1).not.toBe(hash2);
  } finally {
    await ctx1.cleanup();
    await ctx2.cleanup();
  }
});

Deno.test("HashService - Timing-safe comparison true cases", async () => {
  const ctx = await TestSetupBuilder.create().build();
  try {
    expect(ctx.hashService.timingSafeEqual("abc", "abc")).toBe(true);
    expect(ctx.hashService.timingSafeEqual("", "")).toBe(true);
    expect(ctx.hashService.timingSafeEqual("longstring123", "longstring123")).toBe(true);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("HashService - Timing-safe comparison false cases", async () => {
  const ctx = await TestSetupBuilder.create().build();
  try {
    expect(ctx.hashService.timingSafeEqual("abc", "abd")).toBe(false);
    expect(ctx.hashService.timingSafeEqual("abc", "abcd")).toBe(false);
    expect(ctx.hashService.timingSafeEqual("abc", "")).toBe(false);
    expect(ctx.hashService.timingSafeEqual("", "abc")).toBe(false);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("HashService - Invalid key length throws", () => {
  expect(() => {
    new HashService({ hashKey: "dG9vc2hvcnQ=" }); // Only 8 bytes
  }).toThrow("must be exactly 32 bytes");
});

Deno.test("HashService - Empty string hashing works", async () => {
  const ctx = await TestSetupBuilder.create().build();
  try {
    const hash = await ctx.hashService.computeHash("");

    expect(hash.length).toBeGreaterThan(0);
    expect(typeof hash).toBe("string");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("HashService - Hash output is base64 encoded", async () => {
  const ctx = await TestSetupBuilder.create().build();
  try {
    const hash = await ctx.hashService.computeHash("test");

    // Base64 regex: only A-Z, a-z, 0-9, +, /, and = for padding
    expect(/^[A-Za-z0-9+/]+=*$/.test(hash)).toBe(true);

    // HMAC-SHA256 produces 32 bytes → 44 base64 characters (with padding)
    expect(hash.length).toBe(44);
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("HashService - Deterministic output for same input", async () => {
  const ctx = await TestSetupBuilder.create().build();
  try {
    const inputs = [
      "test-key-1",
      "test-key-2",
      "very-long-api-key-with-many-characters-1234567890",
      "short",
      "",
    ];

    for (const input of inputs) {
      const hash1 = await ctx.hashService.computeHash(input);
      const hash2 = await ctx.hashService.computeHash(input);
      const hash3 = await ctx.hashService.computeHash(input);

      expect(hash1).toBe(hash2);
      expect(hash2).toBe(hash3);
    }
  } finally {
    await ctx.cleanup();
  }
});
