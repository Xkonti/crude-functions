import { expect } from "@std/expect";
import { EncryptionService } from "./encryption_service.ts";
import { DecryptionError, InvalidKeyError } from "./errors.ts";
import { base64ToBytes } from "./utils.ts";

// Valid test key (32 bytes base64-encoded)
// Generated with: openssl rand -base64 32
const VALID_KEY = "YzJhNGY2ZDhiMWU3YzNhOGYyZDZiNGU4YzFhN2YzZDk=";

// Invalid keys for testing
const INVALID_BASE64 = "not-valid-base64!!!";
const TOO_SHORT_KEY = btoa("short"); // Less than 32 bytes
const TOO_LONG_KEY = btoa("a".repeat(64)); // More than 32 bytes

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

  await t.step("accepts valid 256-bit base64 keys", () => {
    const service = new EncryptionService({ encryptionKey: VALID_KEY });
    expect(typeof service).toBe("object");
  });
});

Deno.test("EncryptionService - Encryption", async (t) => {
  const service = new EncryptionService({ encryptionKey: VALID_KEY });

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
});

Deno.test("EncryptionService - Decryption", async (t) => {
  const service = new EncryptionService({ encryptionKey: VALID_KEY });

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
    const service1 = new EncryptionService({ encryptionKey: VALID_KEY });

    // Generate a different 32-byte key (proper way)
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) bytes[i] = i; // Different from VALID_KEY
    const differentKey = btoa(String.fromCharCode(...bytes));
    const service2 = new EncryptionService({ encryptionKey: differentKey });

    const plaintext = "Secret";
    const encrypted = await service1.encrypt(plaintext);

    await expect(service2.decrypt(encrypted)).rejects.toThrow(DecryptionError);
  });
});

Deno.test("EncryptionService - Round-trip tests", async (t) => {
  const service = new EncryptionService({ encryptionKey: VALID_KEY });

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
});
