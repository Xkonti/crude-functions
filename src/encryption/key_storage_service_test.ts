import { expect } from "@std/expect";
import { KeyStorageService } from "./key_storage_service.ts";
import type { EncryptionKeyFile } from "./key_storage_types.ts";

// Helper to create a temp directory for tests
async function createTestContext(): Promise<{
  tempDir: string;
  keyFilePath: string;
  service: KeyStorageService;
}> {
  const tempDir = await Deno.makeTempDir();
  const keyFilePath = `${tempDir}/encryption-keys.json`;
  const service = new KeyStorageService({ keyFilePath });
  return { tempDir, keyFilePath, service };
}

async function cleanup(tempDir: string): Promise<void> {
  await Deno.remove(tempDir, { recursive: true });
}

// =====================
// loadKeys tests
// =====================

Deno.test("KeyStorageService.loadKeys returns null when file doesn't exist", async () => {
  const { tempDir, service } = await createTestContext();

  try {
    const result = await service.loadKeys();
    expect(result).toBe(null);
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("KeyStorageService.loadKeys returns parsed JSON when file exists", async () => {
  const { tempDir, keyFilePath, service } = await createTestContext();

  const keys: EncryptionKeyFile = {
    current_key: "dGVzdGtleXRlc3RrZXl0ZXN0a2V5dGVzdGtleXRlc3Q=",
    current_version: "A",
    phased_out_key: null,
    phased_out_version: null,
    last_rotation_finished_at: "2024-01-01T00:00:00.000Z",
    better_auth_secret: "YXV0aHNlY3JldGF1dGhzZWNyZXRhdXRoc2VjcmV0YXV0",
  };

  try {
    await Deno.writeTextFile(keyFilePath, JSON.stringify(keys));
    const result = await service.loadKeys();

    expect(result).not.toBe(null);
    expect(result!.current_key).toBe(keys.current_key);
    expect(result!.current_version).toBe("A");
    expect(result!.phased_out_key).toBe(null);
  } finally {
    await cleanup(tempDir);
  }
});

// =====================
// saveKeys tests
// =====================

Deno.test("KeyStorageService.saveKeys writes JSON to file", async () => {
  const { tempDir, keyFilePath, service } = await createTestContext();

  const keys: EncryptionKeyFile = {
    current_key: "dGVzdGtleXRlc3RrZXl0ZXN0a2V5dGVzdGtleXRlc3Q=",
    current_version: "B",
    phased_out_key: "b2xka2V5b2xka2V5b2xka2V5b2xka2V5b2xka2V5b2xk",
    phased_out_version: "A",
    last_rotation_finished_at: "2024-01-01T00:00:00.000Z",
    better_auth_secret: "YXV0aHNlY3JldGF1dGhzZWNyZXRhdXRoc2VjcmV0YXV0",
  };

  try {
    await service.saveKeys(keys);

    const content = await Deno.readTextFile(keyFilePath);
    const parsed = JSON.parse(content);

    expect(parsed.current_key).toBe(keys.current_key);
    expect(parsed.current_version).toBe("B");
    expect(parsed.phased_out_key).toBe(keys.phased_out_key);
    expect(parsed.phased_out_version).toBe("A");
  } finally {
    await cleanup(tempDir);
  }
});

// =====================
// generateKey tests
// =====================

Deno.test("KeyStorageService.generateKey returns a base64-encoded 32-byte key", async () => {
  const { tempDir, service } = await createTestContext();

  try {
    const key = await service.generateKey();

    // Should be valid base64
    expect(typeof key).toBe("string");
    expect(key.length).toBeGreaterThan(0);

    // Decode and check length (32 bytes = 256 bits)
    const decoded = Uint8Array.from(atob(key), (c) => c.charCodeAt(0));
    expect(decoded.length).toBe(32);
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("KeyStorageService.generateKey produces unique keys each time", async () => {
  const { tempDir, service } = await createTestContext();

  try {
    const key1 = await service.generateKey();
    const key2 = await service.generateKey();

    expect(key1).not.toBe(key2);
  } finally {
    await cleanup(tempDir);
  }
});

// =====================
// getNextVersion tests
// =====================

Deno.test("KeyStorageService.getNextVersion increments A to B", () => {
  const service = new KeyStorageService();
  expect(service.getNextVersion("A")).toBe("B");
});

Deno.test("KeyStorageService.getNextVersion increments M to N", () => {
  const service = new KeyStorageService();
  expect(service.getNextVersion("M")).toBe("N");
});

Deno.test("KeyStorageService.getNextVersion wraps Z to A", () => {
  const service = new KeyStorageService();
  expect(service.getNextVersion("Z")).toBe("A");
});

Deno.test("KeyStorageService.getNextVersion throws for lowercase letters", () => {
  const service = new KeyStorageService();
  expect(() => service.getNextVersion("a")).toThrow("Invalid version character");
});

Deno.test("KeyStorageService.getNextVersion throws for numbers", () => {
  const service = new KeyStorageService();
  expect(() => service.getNextVersion("1")).toThrow("Invalid version character");
});

Deno.test("KeyStorageService.getNextVersion throws for multi-char strings", () => {
  const service = new KeyStorageService();
  expect(() => service.getNextVersion("AB")).toThrow("Invalid version character");
});

Deno.test("KeyStorageService.getNextVersion throws for empty string", () => {
  const service = new KeyStorageService();
  expect(() => service.getNextVersion("")).toThrow("Invalid version character");
});

// =====================
// ensureInitialized tests
// =====================

Deno.test("KeyStorageService.ensureInitialized creates keys if file doesn't exist", async () => {
  const { tempDir, keyFilePath, service } = await createTestContext();

  try {
    const keys = await service.ensureInitialized();

    expect(keys.current_key).toBeDefined();
    expect(keys.current_version).toBe("A");
    expect(keys.phased_out_key).toBe(null);
    expect(keys.phased_out_version).toBe(null);
    expect(keys.better_auth_secret).toBeDefined();
    expect(keys.last_rotation_finished_at).toBeDefined();

    // File should exist now
    const content = await Deno.readTextFile(keyFilePath);
    const parsed = JSON.parse(content);
    expect(parsed.current_version).toBe("A");
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("KeyStorageService.ensureInitialized returns existing keys if file exists", async () => {
  const { tempDir, keyFilePath, service } = await createTestContext();

  const existingKeys: EncryptionKeyFile = {
    current_key: "ZXhpc3Rpbmdfa2V5X2V4aXN0aW5nX2tleV9leGlzdGluZw==",
    current_version: "C",
    phased_out_key: null,
    phased_out_version: null,
    last_rotation_finished_at: "2024-06-15T12:00:00.000Z",
    better_auth_secret: "ZXhpc3Rpbmdfc2VjcmV0X2V4aXN0aW5nX3NlY3JldF9l",
  };

  try {
    await Deno.writeTextFile(keyFilePath, JSON.stringify(existingKeys));

    const keys = await service.ensureInitialized();

    expect(keys.current_key).toBe(existingKeys.current_key);
    expect(keys.current_version).toBe("C");
    expect(keys.better_auth_secret).toBe(existingKeys.better_auth_secret);
  } finally {
    await cleanup(tempDir);
  }
});

// =====================
// isRotationInProgress tests
// =====================

Deno.test("KeyStorageService.isRotationInProgress returns false when no phased_out key", () => {
  const service = new KeyStorageService();
  const keys: EncryptionKeyFile = {
    current_key: "dGVzdGtleXRlc3RrZXl0ZXN0a2V5dGVzdGtleXRlc3Q=",
    current_version: "A",
    phased_out_key: null,
    phased_out_version: null,
    last_rotation_finished_at: "2024-01-01T00:00:00.000Z",
    better_auth_secret: "YXV0aHNlY3JldGF1dGhzZWNyZXRhdXRoc2VjcmV0YXV0",
  };

  expect(service.isRotationInProgress(keys)).toBe(false);
});

Deno.test("KeyStorageService.isRotationInProgress returns true when both phased_out fields exist", () => {
  const service = new KeyStorageService();
  const keys: EncryptionKeyFile = {
    current_key: "dGVzdGtleXRlc3RrZXl0ZXN0a2V5dGVzdGtleXRlc3Q=",
    current_version: "B",
    phased_out_key: "b2xka2V5b2xka2V5b2xka2V5b2xka2V5b2xka2V5b2xk",
    phased_out_version: "A",
    last_rotation_finished_at: "2024-01-01T00:00:00.000Z",
    better_auth_secret: "YXV0aHNlY3JldGF1dGhzZWNyZXRhdXRoc2VjcmV0YXV0",
  };

  expect(service.isRotationInProgress(keys)).toBe(true);
});

// =====================
// path property tests
// =====================

Deno.test("KeyStorageService.path returns configured path", () => {
  const service = new KeyStorageService({ keyFilePath: "/custom/path/keys.json" });
  expect(service.path).toBe("/custom/path/keys.json");
});

Deno.test("KeyStorageService.path returns default path when not configured", () => {
  const service = new KeyStorageService();
  expect(service.path).toBe("./data/encryption-keys.json");
});
