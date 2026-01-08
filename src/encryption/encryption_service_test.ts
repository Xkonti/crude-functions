import { expect } from "@std/expect";
import { EncryptionService } from "./encryption_service.ts";
import { DecryptionError, InvalidKeyError } from "./errors.ts";
import { base64ToBytes } from "./utils.ts";
import { KeyStorageService } from "./key_storage_service.ts";
import type { EncryptionKeyFile } from "./key_storage_types.ts";

// Invalid keys for testing validation
const INVALID_BASE64 = "not-valid-base64!!!";
const TOO_SHORT_KEY = btoa("short"); // Less than 32 bytes
const TOO_LONG_KEY = btoa("a".repeat(64)); // More than 32 bytes

/**
 * Test context for EncryptionService tests.
 * Provides minimal setup with production-like encryption keys.
 */
interface EncryptionTestContext {
  tempDir: string;
  keys: EncryptionKeyFile;
  service: EncryptionService;
  cleanup: () => Promise<void>;
}

/**
 * Create a lightweight test context with real encryption keys.
 * Uses KeyStorageService for production-like key generation without
 * spinning up database, migrations, or other unrelated services.
 */
async function createTestContext(): Promise<EncryptionTestContext> {
  const tempDir = await Deno.makeTempDir();
  const keyFilePath = `${tempDir}/encryption-keys.json`;

  // Use real KeyStorageService for production-like key generation
  const keyStorage = new KeyStorageService({ keyFilePath });
  const keys = await keyStorage.ensureInitialized();

  const service = new EncryptionService({ encryptionKey: keys.current_key });

  const cleanup = async () => {
    try {
      await Deno.remove(tempDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  };

  return { tempDir, keys, service, cleanup };
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
      expect(typeof ctx.service).toBe("object");
    } finally {
      await ctx.cleanup();
    }
  });
});

Deno.test("EncryptionService - Encryption", async (t) => {
  const ctx = await createTestContext();
  try {
    await t.step("encrypts plaintext successfully", async () => {
      const plaintext = "Hello, World!";
      const encrypted = await ctx.service.encrypt(plaintext);
      expect(typeof encrypted).toBe("string");
      expect(encrypted.length).toBeGreaterThan(0);
    });

    await t.step("produces different output for same input (random IV)", async () => {
      const plaintext = "Same input";
      const encrypted1 = await ctx.service.encrypt(plaintext);
      const encrypted2 = await ctx.service.encrypt(plaintext);

      expect(encrypted1).not.toBe(encrypted2);
    });

    await t.step("output is valid base64", async () => {
      const plaintext = "Test data";
      const encrypted = await ctx.service.encrypt(plaintext);

      // Should not throw when decoding base64
      const decoded = base64ToBytes(encrypted);
      expect(decoded).toBeInstanceOf(Uint8Array);
    });

    await t.step("output has expected minimum length", async () => {
      const plaintext = "x";
      const encrypted = await ctx.service.encrypt(plaintext);
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
    await t.step("decrypts encrypted data back to original", async () => {
      const plaintext = "Secret message";
      const encrypted = await ctx.service.encrypt(plaintext);
      const decrypted = await ctx.service.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    await t.step("handles multi-byte UTF-8 strings (emoji, unicode)", async () => {
      const plaintext = "Hello 👋 世界 🌍";
      const encrypted = await ctx.service.encrypt(plaintext);
      const decrypted = await ctx.service.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    await t.step("throws DecryptionError for tampered data", async () => {
      const plaintext = "Original message";
      let encrypted = await ctx.service.encrypt(plaintext);

      // Tamper with the encrypted data
      const bytes = base64ToBytes(encrypted);
      bytes[bytes.length - 1] ^= 0xFF; // Flip bits in auth tag
      encrypted = btoa(String.fromCharCode(...bytes));

      await expect(ctx.service.decrypt(encrypted)).rejects.toThrow(DecryptionError);
    });

    await t.step("throws DecryptionError for malformed base64", async () => {
      await expect(ctx.service.decrypt("not-base64!!!")).rejects.toThrow(DecryptionError);
    });

    await t.step("throws DecryptionError for wrong key", async () => {
      const plaintext = "Secret";
      const encrypted = await ctx.service.encrypt(plaintext);

      // Create a second context with a different key
      const ctx2 = await createTestContext();
      try {
        await expect(ctx2.service.decrypt(encrypted)).rejects.toThrow(DecryptionError);
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
    await t.step("empty string", async () => {
      const plaintext = "";
      const encrypted = await ctx.service.encrypt(plaintext);
      const decrypted = await ctx.service.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    await t.step("short string", async () => {
      const plaintext = "Hi";
      const encrypted = await ctx.service.encrypt(plaintext);
      const decrypted = await ctx.service.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    await t.step("long string (1KB+)", async () => {
      const plaintext = "x".repeat(1024);
      const encrypted = await ctx.service.encrypt(plaintext);
      const decrypted = await ctx.service.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    await t.step("special characters", async () => {
      const plaintext = `!@#$%^&*()_+-=[]{}|;':",./<>?\n\t\r`;
      const encrypted = await ctx.service.encrypt(plaintext);
      const decrypted = await ctx.service.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    await t.step("unicode and emoji", async () => {
      const plaintext = "日本語 🎌 Español 🇪🇸 Русский 🇷🇺";
      const encrypted = await ctx.service.encrypt(plaintext);
      const decrypted = await ctx.service.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    await t.step("JSON data", async () => {
      const plaintext = JSON.stringify({
        username: "alice",
        password: "secret123",
        nested: { key: "value" },
      });
      const encrypted = await ctx.service.encrypt(plaintext);
      const decrypted = await ctx.service.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
      expect(JSON.parse(decrypted).username).toBe("alice");
    });
  } finally {
    await ctx.cleanup();
  }
});
