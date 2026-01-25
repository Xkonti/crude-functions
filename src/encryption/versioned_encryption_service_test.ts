import { integrationTest } from "../test/test_helpers.ts";
import { expect } from "@std/expect";
import { VersionedEncryptionService } from "./versioned_encryption_service.ts";
import { InvalidKeyError, DecryptionError, OversizedPlaintextError } from "./errors.ts";

// Valid test keys (32 bytes base64-encoded)
const TEST_KEY_A = "YTJhNGY2ZDhiMWU3YzNhOGYyZDZiNGU4YzFhN2YzZDk=";
const TEST_KEY_B = "YjJiNGY2ZDhiMWU3YzNhOGYyZDZiNGU4YzFhN2YzZTA=";

// =====================
// Test Helper Builder
// =====================

/**
 * Builder for creating VersionedEncryptionService instances in tests.
 * Inspired by TestSetupBuilder pattern, focused on encryption service needs.
 */
class EncryptionServiceBuilder {
  private currentKey = TEST_KEY_A;
  private currentVersion = "A";
  private phasedOutKey?: string;
  private phasedOutVersion?: string;

  static create(): EncryptionServiceBuilder {
    return new EncryptionServiceBuilder();
  }

  withCurrentKey(key: string, version: string): this {
    this.currentKey = key;
    this.currentVersion = version;
    return this;
  }

  withPhasedOutKey(key: string, version: string): this {
    this.phasedOutKey = key;
    this.phasedOutVersion = version;
    return this;
  }

  build(): VersionedEncryptionService {
    return new VersionedEncryptionService({
      currentKey: this.currentKey,
      currentVersion: this.currentVersion,
      phasedOutKey: this.phasedOutKey,
      phasedOutVersion: this.phasedOutVersion,
    });
  }
}

/**
 * Helper methods for common test patterns
 */
class TestHelpers {
  static async expectRoundTrip(
    service: VersionedEncryptionService,
    plaintext: string
  ): Promise<void> {
    const encrypted = await service.encrypt(plaintext);
    const decrypted = await service.decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  }

  static async expectEncryptionFails(
    service: VersionedEncryptionService,
    plaintext: string,
    // deno-lint-ignore no-explicit-any
    errorType: new (...args: any[]) => Error
  ): Promise<void> {
    await expect(service.encrypt(plaintext)).rejects.toThrow(errorType);
  }

  static async expectDecryptionFails(
    service: VersionedEncryptionService,
    encrypted: string,
    // deno-lint-ignore no-explicit-any
    errorType: new (...args: any[]) => Error
  ): Promise<void> {
    await expect(service.decrypt(encrypted)).rejects.toThrow(errorType);
  }

  static expectVersionPrefix(encrypted: string, expectedVersion: string): void {
    expect(encrypted.charAt(0)).toBe(expectedVersion);
  }

  static expectValidBase64(encrypted: string): void {
    const base64Part = encrypted.slice(1);
    expect(() => atob(base64Part)).not.toThrow();
  }
}

// =====================
// Constructor validation tests
// =====================

integrationTest("VersionedEncryptionService - Constructor validation", async (t) => {
  await t.step("accepts valid 256-bit base64 key", () => {
    const service = EncryptionServiceBuilder.create().build();
    expect(service.version).toBe("A");
  });

  await t.step("rejects invalid base64 keys", () => {
    expect(() => {
      new VersionedEncryptionService({
        currentKey: "not-valid-base64!!!",
        currentVersion: "A",
      });
    }).toThrow(InvalidKeyError);
  });

  await t.step("rejects keys that are too short", () => {
    expect(() => {
      new VersionedEncryptionService({
        currentKey: "c2hvcnQ=", // "short" in base64 = 5 bytes
        currentVersion: "A",
      });
    }).toThrow(InvalidKeyError);
  });

  await t.step("rejects keys that are too long", () => {
    // 48 bytes = too long
    const longKey = btoa("a".repeat(48));
    expect(() => {
      new VersionedEncryptionService({
        currentKey: longKey,
        currentVersion: "A",
      });
    }).toThrow(InvalidKeyError);
  });

  await t.step("rejects invalid version character (lowercase)", () => {
    expect(() => {
      new VersionedEncryptionService({
        currentKey: TEST_KEY_A,
        currentVersion: "a",
      });
    }).toThrow(InvalidKeyError);
  });

  await t.step("rejects invalid version character (number)", () => {
    expect(() => {
      new VersionedEncryptionService({
        currentKey: TEST_KEY_A,
        currentVersion: "1",
      });
    }).toThrow(InvalidKeyError);
  });

  await t.step("rejects invalid version character (multi-char)", () => {
    expect(() => {
      new VersionedEncryptionService({
        currentKey: TEST_KEY_A,
        currentVersion: "AB",
      });
    }).toThrow(InvalidKeyError);
  });

  await t.step("accepts valid phased out key and version", () => {
    const service = EncryptionServiceBuilder.create()
      .withCurrentKey(TEST_KEY_B, "B")
      .withPhasedOutKey(TEST_KEY_A, "A")
      .build();
    expect(service.version).toBe("B");
    expect(service.phasedOutVersionChar).toBe("A");
  });

  await t.step("rejects partial config: phasedOutKey without phasedOutVersion", () => {
    expect(() => {
      new VersionedEncryptionService({
        currentKey: TEST_KEY_A,
        currentVersion: "A",
        phasedOutKey: TEST_KEY_B,
        // phasedOutVersion intentionally omitted
      });
    }).toThrow(InvalidKeyError);
  });

  await t.step("rejects partial config: phasedOutVersion without phasedOutKey", () => {
    expect(() => {
      new VersionedEncryptionService({
        currentKey: TEST_KEY_A,
        currentVersion: "A",
        // phasedOutKey intentionally omitted
        phasedOutVersion: "B",
      });
    }).toThrow(InvalidKeyError);
  });

  await t.step("rejects same version for current and phased out", () => {
    expect(() => {
      new VersionedEncryptionService({
        currentKey: TEST_KEY_A,
        currentVersion: "A",
        phasedOutKey: TEST_KEY_B,
        phasedOutVersion: "A", // Same as currentVersion
      });
    }).toThrow(InvalidKeyError);
  });
});

// =====================
// Encryption tests
// =====================

integrationTest("VersionedEncryptionService - Encryption", async (t) => {
  await t.step("encrypts plaintext with version prefix", async () => {
    const service = EncryptionServiceBuilder.create().build();
    const encrypted = await service.encrypt("hello world");

    TestHelpers.expectVersionPrefix(encrypted, "A");
    TestHelpers.expectValidBase64(encrypted);
  });

  await t.step("produces different output for same input (random IV)", async () => {
    const service = EncryptionServiceBuilder.create().build();

    const encrypted1 = await service.encrypt("test");
    const encrypted2 = await service.encrypt("test");

    expect(encrypted1).not.toBe(encrypted2);
  });

  await t.step("uses current version in output", async () => {
    const service = EncryptionServiceBuilder.create()
      .withCurrentKey(TEST_KEY_A, "M")
      .build();

    const encrypted = await service.encrypt("test");
    TestHelpers.expectVersionPrefix(encrypted, "M");
  });
});

// =====================
// Size validation tests
// =====================

integrationTest("VersionedEncryptionService - Size validation", async (t) => {
  const service = EncryptionServiceBuilder.create().build();

  await t.step("accepts plaintext at exactly 16KB", async () => {
    const plaintext = "x".repeat(16 * 1024);
    await TestHelpers.expectRoundTrip(service, plaintext);
  });

  await t.step("rejects plaintext over 16KB", async () => {
    const plaintext = "x".repeat(16 * 1024 + 1);
    await TestHelpers.expectEncryptionFails(service, plaintext, OversizedPlaintextError);
  });

  await t.step("rejects large plaintext with helpful error message", async () => {
    const plaintext = "x".repeat(20 * 1024);
    try {
      await service.encrypt(plaintext);
      throw new Error("Should have thrown OversizedPlaintextError");
    } catch (error) {
      expect(error).toBeInstanceOf(OversizedPlaintextError);
      expect((error as Error).message).toContain("20480 bytes");
      expect((error as Error).message).toContain("16384 bytes");
      expect((error as Error).message).toContain("16KB");
    }
  });

  await t.step("validates size correctly with multi-byte UTF-8 characters", async () => {
    const emoji = "😀"; // 4 bytes
    const count = Math.floor((16 * 1024) / 4);
    const plaintext = emoji.repeat(count);

    await TestHelpers.expectRoundTrip(service, plaintext);
  });

  await t.step("rejects oversized UTF-8 plaintext", async () => {
    const emoji = "😀"; // 4 bytes
    const count = Math.floor((16 * 1024) / 4) + 1;
    const plaintext = emoji.repeat(count);

    await TestHelpers.expectEncryptionFails(service, plaintext, OversizedPlaintextError);
  });
});

// =====================
// Decryption tests
// =====================

integrationTest("VersionedEncryptionService - Decryption", async (t) => {
  await t.step("decrypts encrypted data back to original", async () => {
    const service = EncryptionServiceBuilder.create().build();
    await TestHelpers.expectRoundTrip(service, "hello world");
  });

  await t.step("handles multi-byte UTF-8 strings (emoji, unicode)", async () => {
    const service = EncryptionServiceBuilder.create().build();
    await TestHelpers.expectRoundTrip(service, "Hello! Caf\u00e9 \u2615");
  });

  await t.step("decrypts with phased out key when version matches", async () => {
    // Encrypt with key A
    const serviceA = EncryptionServiceBuilder.create().build();
    const encrypted = await serviceA.encrypt("secret data");

    // Create service with B as current and A as phased out
    const serviceB = EncryptionServiceBuilder.create()
      .withCurrentKey(TEST_KEY_B, "B")
      .withPhasedOutKey(TEST_KEY_A, "A")
      .build();

    const decrypted = await serviceB.decrypt(encrypted);
    expect(decrypted).toBe("secret data");
  });

  await t.step("throws DecryptionError for unknown version", async () => {
    const service = EncryptionServiceBuilder.create().build();
    const fakeEncrypted = "X" + btoa("fake-encrypted-data");

    await TestHelpers.expectDecryptionFails(service, fakeEncrypted, DecryptionError);
  });

  await t.step("throws DecryptionError for tampered data", async () => {
    const service = EncryptionServiceBuilder.create().build();
    const encrypted = await service.encrypt("test");
    // Use a different character than what's at position 10 to guarantee tampering
    const originalChar = encrypted.charAt(10);
    const replacementChar = originalChar === "X" ? "Y" : "X";
    const tampered = encrypted.slice(0, 10) + replacementChar + encrypted.slice(11);

    await TestHelpers.expectDecryptionFails(service, tampered, DecryptionError);
  });

  await t.step("throws DecryptionError for too short data", async () => {
    const service = EncryptionServiceBuilder.create().build();
    await TestHelpers.expectDecryptionFails(service, "A", DecryptionError);
  });

  await t.step("throws DecryptionError with clear message for truncated base64 data", async () => {
    const service = EncryptionServiceBuilder.create().build();
    const truncatedData = "A" + btoa("0123456789");

    try {
      await service.decrypt(truncatedData);
      throw new Error("Should have thrown DecryptionError");
    } catch (error) {
      expect(error).toBeInstanceOf(DecryptionError);
      expect((error as Error).message).toContain("Corrupted encrypted data");
      expect((error as Error).message).toContain("10");
      expect((error as Error).message).toContain("28");
    }
  });

  await t.step("throws DecryptionError for wrong key", async () => {
    const serviceA = EncryptionServiceBuilder.create().build();
    const encrypted = await serviceA.encrypt("test");

    // Create service with different key but same version
    const serviceB = EncryptionServiceBuilder.create()
      .withCurrentKey(TEST_KEY_B, "A")
      .build();

    await TestHelpers.expectDecryptionFails(serviceB, encrypted, DecryptionError);
  });
});

// =====================
// updateKeys tests
// =====================

integrationTest("VersionedEncryptionService - updateKeys", async (t) => {
  await t.step("updates to new key and version", async () => {
    const service = EncryptionServiceBuilder.create().build();
    expect(service.version).toBe("A");

    await service.updateKeys({
      currentKey: TEST_KEY_B,
      currentVersion: "B",
    });

    expect(service.version).toBe("B");

    const encrypted = await service.encrypt("test");
    TestHelpers.expectVersionPrefix(encrypted, "B");
  });

  await t.step("can add phased out key", async () => {
    const service = EncryptionServiceBuilder.create().build();
    expect(service.isRotating).toBe(false);

    await service.updateKeys({
      currentKey: TEST_KEY_B,
      currentVersion: "B",
      phasedOutKey: TEST_KEY_A,
      phasedOutVersion: "A",
    });

    expect(service.isRotating).toBe(true);
    expect(service.phasedOutVersionChar).toBe("A");
  });

  await t.step("can remove phased out key", async () => {
    const service = EncryptionServiceBuilder.create()
      .withCurrentKey(TEST_KEY_B, "B")
      .withPhasedOutKey(TEST_KEY_A, "A")
      .build();

    expect(service.isRotating).toBe(true);

    await service.updateKeys({
      currentKey: TEST_KEY_B,
      currentVersion: "B",
    });

    expect(service.isRotating).toBe(false);
    expect(service.phasedOutVersionChar).toBe(null);
  });

  await t.step("blocks during encrypt operations (prevents race condition)", async () => {
    const service = EncryptionServiceBuilder.create().build();
    const results: string[] = [];

    const encryptPromise = service.encrypt("test data").then((encrypted) => {
      results.push("encrypt completed");
      return encrypted;
    });

    await new Promise((resolve) => setTimeout(resolve, 5));

    const updatePromise = service.updateKeys({
      currentKey: TEST_KEY_B,
      currentVersion: "B",
    }).then(() => {
      results.push("updateKeys completed");
    });

    const encrypted = await encryptPromise;
    await updatePromise;

    expect(results).toEqual(["encrypt completed", "updateKeys completed"]);
    TestHelpers.expectVersionPrefix(encrypted, "A");
    expect(service.version).toBe("B");

    // Add phased out key to decrypt old data
    await service.updateKeys({
      currentKey: TEST_KEY_B,
      currentVersion: "B",
      phasedOutKey: TEST_KEY_A,
      phasedOutVersion: "A",
    });
    const decrypted = await service.decrypt(encrypted);
    expect(decrypted).toBe("test data");
  });
});

// =====================
// isEncryptedWithPhasedOutKey tests
// =====================

integrationTest("VersionedEncryptionService - isEncryptedWithPhasedOutKey", async (t) => {
  await t.step("returns false when no phased out key", async () => {
    const service = EncryptionServiceBuilder.create().build();
    const encrypted = await service.encrypt("test");
    expect(service.isEncryptedWithPhasedOutKey(encrypted)).toBe(false);
  });

  await t.step("returns false for current version", async () => {
    const service = EncryptionServiceBuilder.create()
      .withCurrentKey(TEST_KEY_B, "B")
      .withPhasedOutKey(TEST_KEY_A, "A")
      .build();

    const encrypted = await service.encrypt("test");
    expect(service.isEncryptedWithPhasedOutKey(encrypted)).toBe(false);
  });

  await t.step("returns true for phased out version", async () => {
    const serviceA = EncryptionServiceBuilder.create().build();
    const encrypted = await serviceA.encrypt("test");

    const serviceB = EncryptionServiceBuilder.create()
      .withCurrentKey(TEST_KEY_B, "B")
      .withPhasedOutKey(TEST_KEY_A, "A")
      .build();

    expect(serviceB.isEncryptedWithPhasedOutKey(encrypted)).toBe(true);
  });

  await t.step("returns false for empty string", () => {
    const service = EncryptionServiceBuilder.create()
      .withCurrentKey(TEST_KEY_B, "B")
      .withPhasedOutKey(TEST_KEY_A, "A")
      .build();

    expect(service.isEncryptedWithPhasedOutKey("")).toBe(false);
  });
});

// =====================
// Rotation lock tests
// =====================

integrationTest("VersionedEncryptionService - acquireRotationLock", async (t) => {
  await t.step("returns a disposable lock", async () => {
    const service = EncryptionServiceBuilder.create().build();
    const lock = await service.acquireRotationLock();
    expect(lock).toBeDefined();
    expect(typeof lock[Symbol.dispose]).toBe("function");

    lock[Symbol.dispose]();
  });

  await t.step("blocks concurrent operations while held", async () => {
    const service = EncryptionServiceBuilder.create().build();
    const results: string[] = [];

    const lock = await service.acquireRotationLock();
    results.push("lock acquired");

    const encryptPromise = service.encrypt("test").then(() => {
      results.push("encrypt completed");
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    results.push("after delay");

    lock[Symbol.dispose]();
    results.push("lock released");

    await encryptPromise;

    expect(results).toEqual([
      "lock acquired",
      "after delay",
      "lock released",
      "encrypt completed",
    ]);
  });
});

// =====================
// Getters tests
// =====================

integrationTest("VersionedEncryptionService - version getter", () => {
  const service = EncryptionServiceBuilder.create()
    .withCurrentKey(TEST_KEY_A, "Z")
    .build();

  expect(service.version).toBe("Z");
});

integrationTest("VersionedEncryptionService - isRotating getter", async (t) => {
  await t.step("returns false when no phased out key", () => {
    const service = EncryptionServiceBuilder.create().build();
    expect(service.isRotating).toBe(false);
  });

  await t.step("returns true when phased out key exists", () => {
    const service = EncryptionServiceBuilder.create()
      .withCurrentKey(TEST_KEY_B, "B")
      .withPhasedOutKey(TEST_KEY_A, "A")
      .build();

    expect(service.isRotating).toBe(true);
  });
});

integrationTest("VersionedEncryptionService - phasedOutVersionChar getter", async (t) => {
  await t.step("returns null when no phased out key", () => {
    const service = EncryptionServiceBuilder.create().build();
    expect(service.phasedOutVersionChar).toBe(null);
  });

  await t.step("returns version char when phased out key exists", () => {
    const service = EncryptionServiceBuilder.create()
      .withCurrentKey(TEST_KEY_B, "B")
      .withPhasedOutKey(TEST_KEY_A, "A")
      .build();

    expect(service.phasedOutVersionChar).toBe("A");
  });
});

// =====================
// Round-trip tests
// =====================

integrationTest("VersionedEncryptionService - Round-trip tests", async (t) => {
  const service = EncryptionServiceBuilder.create().build();

  await t.step("empty string", async () => {
    await TestHelpers.expectRoundTrip(service, "");
  });

  await t.step("long string (1KB+)", async () => {
    await TestHelpers.expectRoundTrip(service, "x".repeat(2000));
  });

  await t.step("JSON data", async () => {
    const original = JSON.stringify({ key: "value", nested: { arr: [1, 2, 3] } });
    await TestHelpers.expectRoundTrip(service, original);
  });

  await t.step("special characters", async () => {
    await TestHelpers.expectRoundTrip(service, "!@#$%^&*()_+-=[]{}|;':\",./<>?`~\n\t\r");
  });
});
