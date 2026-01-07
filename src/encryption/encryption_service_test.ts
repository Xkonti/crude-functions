import { expect } from "@std/expect";
import { EncryptionService } from "./encryption_service.ts";
import { DecryptionError, InvalidKeyError } from "./errors.ts";
import { base64ToBytes } from "./utils.ts";
import { TestSetupBuilder } from "../test/test_setup_builder.ts";
import type { TestContext } from "../test/types.ts";

// Invalid keys for testing
const INVALID_BASE64 = "not-valid-base64!!!";
const TOO_SHORT_KEY = btoa("short"); // Less than 32 bytes
const TOO_LONG_KEY = btoa("a".repeat(64)); // More than 32 bytes

/**
 * Helper to create a test context with real encryption keys.
 * This provides production-like key generation via KeyStorageService.
 */
async function createTestContext(): Promise<TestContext> {
  return await TestSetupBuilder.create().build();
}

/**
 * Helper to create an EncryptionService from test context.
 */
function createEncryptionService(ctx: TestContext): EncryptionService {
  return new EncryptionService({ encryptionKey: ctx.encryptionKeys.current_key });
}

Deno.test("EncryptionService - Constructor validation", async (t) => {
  await t.step("rejects invalid base64 keys", () => {
    expect(() => {
      new EncryptionService({ encryptionKey: INVALID_BASE64 });
    }).toThrow(InvalidKeyError);
  });

  await t.step("rejects keys that are too short", () => {
    expect(() => {
      new EncryptionService({ encryptionKey: TOO_SHORT_KEY });
    }).toThrow(InvalidKeyError);
  });

  await t.step("rejects keys that are too long", () => {
    expect(() => {
      new EncryptionService({ encryptionKey: TOO_LONG_KEY });
    }).toThrow(InvalidKeyError);
  });

  await t.step("accepts valid 256-bit base64 keys", async () => {
    const ctx = await createTestContext();
    try {
      const service = createEncryptionService(ctx);
      expect(typeof service).toBe("object");
    } finally {
      await ctx.cleanup();
    }
  });
});

Deno.test("EncryptionService - Encryption", async (t) => {
  const ctx = await createTestContext();
  try {
    const service = createEncryptionService(ctx);

    await t.step("encrypts plaintext successfully", async () => {
      const plaintext = "Hello, World!";
      const encrypted = await service.encrypt(plaintext);
      expect(typeof encrypted).toBe("string");
      expect(encrypted.length).toBeGreaterThan(0);
    });

    await t.step("produces different output for same input (random IV)", async () => {
      const plaintext = "Same input";
      const encrypted1 = await service.encrypt(plaintext);
      const encrypted2 = await service.encrypt(plaintext);

      expect(encrypted1).not.toBe(encrypted2);
    });

    await t.step("output is valid base64", async () => {
      const plaintext = "Test data";
      const encrypted = await service.encrypt(plaintext);

      // Should not throw when decoding base64
      const decoded = base64ToBytes(encrypted);
      expect(decoded).toBeInstanceOf(Uint8Array);
    });

    await t.step("output has expected minimum length", async () => {
      const plaintext = "x";
      const encrypted = await service.encrypt(plaintext);
      const decoded = base64ToBytes(encrypted);

      // IV (12) + ciphertext (at least 1) + auth tag (16) = at least 29 bytes
      expect(decoded.length).toBeGreaterThanOrEqual(29);
    });
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("EncryptionService - Decryption", async (t) => {
  const ctx = await createTestContext();
  try {
    const service = createEncryptionService(ctx);

    await t.step("decrypts encrypted data back to original", async () => {
      const plaintext = "Secret message";
      const encrypted = await service.encrypt(plaintext);
      const decrypted = await service.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    await t.step("handles multi-byte UTF-8 strings (emoji, unicode)", async () => {
      const plaintext = "Hello 👋 世界 🌍";
      const encrypted = await service.encrypt(plaintext);
      const decrypted = await service.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    await t.step("throws DecryptionError for tampered data", async () => {
      const plaintext = "Original message";
      let encrypted = await service.encrypt(plaintext);

      // Tamper with the encrypted data
      const bytes = base64ToBytes(encrypted);
      bytes[bytes.length - 1] ^= 0xFF; // Flip bits in auth tag
      encrypted = btoa(String.fromCharCode(...bytes));

      await expect(service.decrypt(encrypted)).rejects.toThrow(DecryptionError);
    });

    await t.step("throws DecryptionError for malformed base64", async () => {
      await expect(service.decrypt("not-base64!!!")).rejects.toThrow(DecryptionError);
    });

    await t.step("throws DecryptionError for wrong key", async () => {
      const plaintext = "Secret";
      const encrypted = await service.encrypt(plaintext);

      // Create a second context with a different key
      const ctx2 = await createTestContext();
      try {
        const service2 = createEncryptionService(ctx2);
        await expect(service2.decrypt(encrypted)).rejects.toThrow(DecryptionError);
      } finally {
        await ctx2.cleanup();
      }
    });
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("EncryptionService - Round-trip tests", async (t) => {
  const ctx = await createTestContext();
  try {
    const service = createEncryptionService(ctx);

    await t.step("empty string", async () => {
      const plaintext = "";
      const encrypted = await service.encrypt(plaintext);
      const decrypted = await service.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    await t.step("short string", async () => {
      const plaintext = "Hi";
      const encrypted = await service.encrypt(plaintext);
      const decrypted = await service.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    await t.step("long string (1KB+)", async () => {
      const plaintext = "x".repeat(1024);
      const encrypted = await service.encrypt(plaintext);
      const decrypted = await service.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    await t.step("special characters", async () => {
      const plaintext = `!@#$%^&*()_+-=[]{}|;':",./<>?\n\t\r`;
      const encrypted = await service.encrypt(plaintext);
      const decrypted = await service.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    await t.step("unicode and emoji", async () => {
      const plaintext = "日本語 🎌 Español 🇪🇸 Русский 🇷🇺";
      const encrypted = await service.encrypt(plaintext);
      const decrypted = await service.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    await t.step("JSON data", async () => {
      const plaintext = JSON.stringify({
        username: "alice",
        password: "secret123",
        nested: { key: "value" },
      });
      const encrypted = await service.encrypt(plaintext);
      const decrypted = await service.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
      expect(JSON.parse(decrypted).username).toBe("alice");
    });
  } finally {
    await ctx.cleanup();
  }
});
