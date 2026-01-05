import { expect } from "@std/expect";
import { VersionedEncryptionService } from "./versioned_encryption_service.ts";
import { InvalidKeyError, DecryptionError } from "./errors.ts";

// Valid test keys (32 bytes base64-encoded)
const TEST_KEY_A = "YTJhNGY2ZDhiMWU3YzNhOGYyZDZiNGU4YzFhN2YzZDk=";
const TEST_KEY_B = "YjJiNGY2ZDhiMWU3YzNhOGYyZDZiNGU4YzFhN2YzZTA=";

// =====================
// Constructor validation tests
// =====================

Deno.test("VersionedEncryptionService - Constructor validation", async (t) => {
  await t.step("accepts valid 256-bit base64 key", () => {
    const service = new VersionedEncryptionService({
      currentKey: TEST_KEY_A,
      currentVersion: "A",
    });
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
    const service = new VersionedEncryptionService({
      currentKey: TEST_KEY_B,
      currentVersion: "B",
      phasedOutKey: TEST_KEY_A,
      phasedOutVersion: "A",
    });
    expect(service.version).toBe("B");
    expect(service.phasedOutVersionChar).toBe("A");
  });
});

// =====================
// Encryption tests
// =====================

Deno.test("VersionedEncryptionService - Encryption", async (t) => {
  await t.step("encrypts plaintext with version prefix", async () => {
    const service = new VersionedEncryptionService({
      currentKey: TEST_KEY_A,
      currentVersion: "A",
    });

    const encrypted = await service.encrypt("hello world");

    // First character should be the version
    expect(encrypted.charAt(0)).toBe("A");
    // Rest should be valid base64
    const base64Part = encrypted.slice(1);
    expect(() => atob(base64Part)).not.toThrow();
  });

  await t.step("produces different output for same input (random IV)", async () => {
    const service = new VersionedEncryptionService({
      currentKey: TEST_KEY_A,
      currentVersion: "A",
    });

    const encrypted1 = await service.encrypt("test");
    const encrypted2 = await service.encrypt("test");

    expect(encrypted1).not.toBe(encrypted2);
  });

  await t.step("uses current version in output", async () => {
    const service = new VersionedEncryptionService({
      currentKey: TEST_KEY_A,
      currentVersion: "M",
    });

    const encrypted = await service.encrypt("test");
    expect(encrypted.charAt(0)).toBe("M");
  });
});

// =====================
// Decryption tests
// =====================

Deno.test("VersionedEncryptionService - Decryption", async (t) => {
  await t.step("decrypts encrypted data back to original", async () => {
    const service = new VersionedEncryptionService({
      currentKey: TEST_KEY_A,
      currentVersion: "A",
    });

    const original = "hello world";
    const encrypted = await service.encrypt(original);
    const decrypted = await service.decrypt(encrypted);

    expect(decrypted).toBe(original);
  });

  await t.step("handles multi-byte UTF-8 strings (emoji, unicode)", async () => {
    const service = new VersionedEncryptionService({
      currentKey: TEST_KEY_A,
      currentVersion: "A",
    });

    const original = "Hello! Caf\u00e9 \u2615";
    const encrypted = await service.encrypt(original);
    const decrypted = await service.decrypt(encrypted);

    expect(decrypted).toBe(original);
  });

  await t.step("decrypts with phased out key when version matches", async () => {
    // First encrypt with key A (version A)
    const serviceA = new VersionedEncryptionService({
      currentKey: TEST_KEY_A,
      currentVersion: "A",
    });
    const encrypted = await serviceA.encrypt("secret data");

    // Now create service with B as current and A as phased out
    const serviceB = new VersionedEncryptionService({
      currentKey: TEST_KEY_B,
      currentVersion: "B",
      phasedOutKey: TEST_KEY_A,
      phasedOutVersion: "A",
    });

    // Should decrypt with phased out key
    const decrypted = await serviceB.decrypt(encrypted);
    expect(decrypted).toBe("secret data");
  });

  await t.step("throws DecryptionError for unknown version", async () => {
    const service = new VersionedEncryptionService({
      currentKey: TEST_KEY_A,
      currentVersion: "A",
    });

    // Manually create encrypted data with version X
    const fakeEncrypted = "X" + btoa("fake-encrypted-data");

    await expect(service.decrypt(fakeEncrypted)).rejects.toThrow(DecryptionError);
  });

  await t.step("throws DecryptionError for tampered data", async () => {
    const service = new VersionedEncryptionService({
      currentKey: TEST_KEY_A,
      currentVersion: "A",
    });

    const encrypted = await service.encrypt("test");
    // Tamper with the encrypted data (change a character in the middle)
    const tampered = encrypted.slice(0, 10) + "X" + encrypted.slice(11);

    await expect(service.decrypt(tampered)).rejects.toThrow(DecryptionError);
  });

  await t.step("throws DecryptionError for too short data", async () => {
    const service = new VersionedEncryptionService({
      currentKey: TEST_KEY_A,
      currentVersion: "A",
    });

    await expect(service.decrypt("A")).rejects.toThrow(DecryptionError);
  });

  await t.step("throws DecryptionError for wrong key", async () => {
    const serviceA = new VersionedEncryptionService({
      currentKey: TEST_KEY_A,
      currentVersion: "A",
    });
    const encrypted = await serviceA.encrypt("test");

    // Create new service with different key but same version
    const serviceB = new VersionedEncryptionService({
      currentKey: TEST_KEY_B,
      currentVersion: "A",
    });

    await expect(serviceB.decrypt(encrypted)).rejects.toThrow(DecryptionError);
  });
});

// =====================
// updateKeys tests
// =====================

Deno.test("VersionedEncryptionService - updateKeys", async (t) => {
  await t.step("updates to new key and version", async () => {
    const service = new VersionedEncryptionService({
      currentKey: TEST_KEY_A,
      currentVersion: "A",
    });

    expect(service.version).toBe("A");

    await service.updateKeys({
      currentKey: TEST_KEY_B,
      currentVersion: "B",
    });

    expect(service.version).toBe("B");

    // New encryptions should use version B
    const encrypted = await service.encrypt("test");
    expect(encrypted.charAt(0)).toBe("B");
  });

  await t.step("can add phased out key", async () => {
    const service = new VersionedEncryptionService({
      currentKey: TEST_KEY_A,
      currentVersion: "A",
    });

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
    const service = new VersionedEncryptionService({
      currentKey: TEST_KEY_B,
      currentVersion: "B",
      phasedOutKey: TEST_KEY_A,
      phasedOutVersion: "A",
    });

    expect(service.isRotating).toBe(true);

    await service.updateKeys({
      currentKey: TEST_KEY_B,
      currentVersion: "B",
    });

    expect(service.isRotating).toBe(false);
    expect(service.phasedOutVersionChar).toBe(null);
  });
});

// =====================
// isEncryptedWithPhasedOutKey tests
// =====================

Deno.test("VersionedEncryptionService - isEncryptedWithPhasedOutKey", async (t) => {
  await t.step("returns false when no phased out key", async () => {
    const service = new VersionedEncryptionService({
      currentKey: TEST_KEY_A,
      currentVersion: "A",
    });

    const encrypted = await service.encrypt("test");
    expect(service.isEncryptedWithPhasedOutKey(encrypted)).toBe(false);
  });

  await t.step("returns false for current version", async () => {
    const service = new VersionedEncryptionService({
      currentKey: TEST_KEY_B,
      currentVersion: "B",
      phasedOutKey: TEST_KEY_A,
      phasedOutVersion: "A",
    });

    const encrypted = await service.encrypt("test");
    expect(service.isEncryptedWithPhasedOutKey(encrypted)).toBe(false);
  });

  await t.step("returns true for phased out version", async () => {
    // First encrypt with A
    const serviceA = new VersionedEncryptionService({
      currentKey: TEST_KEY_A,
      currentVersion: "A",
    });
    const encrypted = await serviceA.encrypt("test");

    // Create service with B current and A phased out
    const serviceB = new VersionedEncryptionService({
      currentKey: TEST_KEY_B,
      currentVersion: "B",
      phasedOutKey: TEST_KEY_A,
      phasedOutVersion: "A",
    });

    expect(serviceB.isEncryptedWithPhasedOutKey(encrypted)).toBe(true);
  });

  await t.step("returns false for empty string", () => {
    const service = new VersionedEncryptionService({
      currentKey: TEST_KEY_B,
      currentVersion: "B",
      phasedOutKey: TEST_KEY_A,
      phasedOutVersion: "A",
    });

    expect(service.isEncryptedWithPhasedOutKey("")).toBe(false);
  });
});

// =====================
// Rotation lock tests
// =====================

Deno.test("VersionedEncryptionService - acquireRotationLock", async (t) => {
  await t.step("returns a disposable lock", async () => {
    const service = new VersionedEncryptionService({
      currentKey: TEST_KEY_A,
      currentVersion: "A",
    });

    const lock = await service.acquireRotationLock();
    expect(lock).toBeDefined();
    expect(typeof lock[Symbol.dispose]).toBe("function");

    // Release the lock
    lock[Symbol.dispose]();
  });

  await t.step("blocks concurrent operations while held", async () => {
    const service = new VersionedEncryptionService({
      currentKey: TEST_KEY_A,
      currentVersion: "A",
    });

    const results: string[] = [];

    // Acquire lock
    const lock = await service.acquireRotationLock();
    results.push("lock acquired");

    // Start an encryption that will be blocked
    const encryptPromise = service.encrypt("test").then(() => {
      results.push("encrypt completed");
    });

    // Give the encrypt a chance to start (it should be blocked)
    await new Promise((resolve) => setTimeout(resolve, 10));
    results.push("after delay");

    // Release lock
    lock[Symbol.dispose]();
    results.push("lock released");

    // Wait for encrypt to complete
    await encryptPromise;

    // Encrypt should complete after lock release
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

Deno.test("VersionedEncryptionService - version getter", () => {
  const service = new VersionedEncryptionService({
    currentKey: TEST_KEY_A,
    currentVersion: "Z",
  });

  expect(service.version).toBe("Z");
});

Deno.test("VersionedEncryptionService - isRotating getter", async (t) => {
  await t.step("returns false when no phased out key", () => {
    const service = new VersionedEncryptionService({
      currentKey: TEST_KEY_A,
      currentVersion: "A",
    });

    expect(service.isRotating).toBe(false);
  });

  await t.step("returns true when phased out key exists", () => {
    const service = new VersionedEncryptionService({
      currentKey: TEST_KEY_B,
      currentVersion: "B",
      phasedOutKey: TEST_KEY_A,
      phasedOutVersion: "A",
    });

    expect(service.isRotating).toBe(true);
  });
});

Deno.test("VersionedEncryptionService - phasedOutVersionChar getter", async (t) => {
  await t.step("returns null when no phased out key", () => {
    const service = new VersionedEncryptionService({
      currentKey: TEST_KEY_A,
      currentVersion: "A",
    });

    expect(service.phasedOutVersionChar).toBe(null);
  });

  await t.step("returns version char when phased out key exists", () => {
    const service = new VersionedEncryptionService({
      currentKey: TEST_KEY_B,
      currentVersion: "B",
      phasedOutKey: TEST_KEY_A,
      phasedOutVersion: "A",
    });

    expect(service.phasedOutVersionChar).toBe("A");
  });
});

// =====================
// Round-trip tests
// =====================

Deno.test("VersionedEncryptionService - Round-trip tests", async (t) => {
  const service = new VersionedEncryptionService({
    currentKey: TEST_KEY_A,
    currentVersion: "A",
  });

  await t.step("empty string", async () => {
    const original = "";
    const encrypted = await service.encrypt(original);
    const decrypted = await service.decrypt(encrypted);
    expect(decrypted).toBe(original);
  });

  await t.step("long string (1KB+)", async () => {
    const original = "x".repeat(2000);
    const encrypted = await service.encrypt(original);
    const decrypted = await service.decrypt(encrypted);
    expect(decrypted).toBe(original);
  });

  await t.step("JSON data", async () => {
    const original = JSON.stringify({ key: "value", nested: { arr: [1, 2, 3] } });
    const encrypted = await service.encrypt(original);
    const decrypted = await service.decrypt(encrypted);
    expect(decrypted).toBe(original);
  });

  await t.step("special characters", async () => {
    const original = "!@#$%^&*()_+-=[]{}|;':\",./<>?`~\n\t\r";
    const encrypted = await service.encrypt(original);
    const decrypted = await service.decrypt(encrypted);
    expect(decrypted).toBe(original);
  });
});
