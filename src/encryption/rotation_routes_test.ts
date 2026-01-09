import { expect } from "@std/expect";
import { Hono } from "@hono/hono";
import type { KeyRotationService } from "./key_rotation_service.ts";
import { KeyStorageService } from "./key_storage_service.ts";
import { createRotationRoutes } from "./rotation_routes.ts";
import type { EncryptionKeyFile } from "./key_storage_types.ts";
import type { SettingsService } from "../settings/settings_service.ts";
import { SettingNames } from "../settings/types.ts";

// Test keys (32 bytes base64-encoded)
const TEST_KEY_A = "YTJhNGY2ZDhiMWU3YzNhOGYyZDZiNGU4YzFhN2YzZDk=";
const TEST_KEY_B = "YjJiNGY2ZDhiMWU3YzNhOGYyZDZiNGU4YzFhN2YzZTA=";

/**
 * Creates a mock KeyRotationService for testing.
 */
function createMockKeyRotationService(): KeyRotationService {
  return {
    triggerManualRotation: () => Promise.resolve(),
    start: () => {},
    stop: () => {},
  } as unknown as KeyRotationService;
}

/**
 * Creates a mock SettingsService for testing.
 */
function createMockSettingsService(): SettingsService {
  return {
    getGlobalSetting: (name: string) => {
      if (name === SettingNames.ENCRYPTION_KEY_ROTATION_INTERVAL_DAYS) {
        return Promise.resolve("90"); // Default 90 days
      }
      return Promise.resolve(null);
    },
  } as unknown as SettingsService;
}

/**
 * Creates test context with KeyStorageService and Hono app.
 * No database needed - status endpoint only reads from key file.
 */
async function createTestApp(): Promise<{
  app: Hono;
  keyStorageService: KeyStorageService;
  tempDir: string;
}> {
  const tempDir = await Deno.makeTempDir();
  const keyFilePath = `${tempDir}/encryption-keys.json`;

  const keyStorageService = new KeyStorageService({ keyFilePath });

  // Create initial keys file (set last rotation to 5 days ago for testing)
  const fiveDaysAgo = new Date();
  fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

  const keys: EncryptionKeyFile = {
    current_key: TEST_KEY_A,
    current_version: "A",
    phased_out_key: null,
    phased_out_version: null,
    last_rotation_finished_at: fiveDaysAgo.toISOString(),
    better_auth_secret: "YXV0aHNlY3JldGF1dGhzZWNyZXRhdXRoc2VjcmV0YXV0",
    hash_key: "aGFzaGtleWhhc2hrZXloYXNoa2V5aGFzaGtleWhhc2g=",
  };
  await keyStorageService.saveKeys(keys);

  const app = new Hono();
  app.route("/api/encryption-keys", createRotationRoutes({
    keyRotationService: createMockKeyRotationService(),
    keyStorageService,
    settingsService: createMockSettingsService(),
  }));

  return { app, keyStorageService, tempDir };
}

async function cleanup(tempDir: string): Promise<void> {
  await Deno.remove(tempDir, { recursive: true });
}

// GET /api/encryption-keys/rotation tests
Deno.test("GET /api/encryption-keys/rotation returns rotation status", async () => {
  const { app, tempDir } = await createTestApp();

  try {
    const res = await app.request("/api/encryption-keys/rotation");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.lastRotationAt).toBeDefined();
    expect(json.daysSinceRotation).toBeDefined();
    expect(json.nextRotationAt).toBeDefined();
    expect(json.rotationIntervalDays).toBe(90);
    expect(json.currentVersion).toBe("A");
    expect(json.isInProgress).toBe(false);

    // Should be about 5 days (we set it to 5 days ago in setup)
    expect(json.daysSinceRotation).toBeGreaterThanOrEqual(4);
    expect(json.daysSinceRotation).toBeLessThanOrEqual(6);

    // Verify nextRotationAt is a valid ISO date string
    const nextRotation = new Date(json.nextRotationAt);
    expect(nextRotation.getTime()).toBeGreaterThan(0);
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("GET /api/encryption-keys/rotation calculates days since rotation correctly", async () => {
  const { app, keyStorageService, tempDir } = await createTestApp();

  try {
    // Set last rotation to exactly 10 days ago
    const tenDaysAgo = new Date();
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
    tenDaysAgo.setHours(0, 0, 0, 0); // Midnight for cleaner calculation

    const keys = await keyStorageService.loadKeys();
    await keyStorageService.saveKeys({
      ...keys!,
      last_rotation_finished_at: tenDaysAgo.toISOString(),
    });

    const res = await app.request("/api/encryption-keys/rotation");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.daysSinceRotation).toBeGreaterThanOrEqual(9);
    expect(json.daysSinceRotation).toBeLessThanOrEqual(11);
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("GET /api/encryption-keys/rotation detects rotation in progress", async () => {
  const { app, keyStorageService, tempDir } = await createTestApp();

  try {
    // Simulate rotation in progress by having both current and phased_out keys
    const keys = await keyStorageService.loadKeys();
    await keyStorageService.saveKeys({
      ...keys!,
      phased_out_key: TEST_KEY_B,
      phased_out_version: "B",
    });

    const res = await app.request("/api/encryption-keys/rotation");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.isInProgress).toBe(true);
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("GET /api/encryption-keys/rotation handles missing keys file", async () => {
  const tempDir = await Deno.makeTempDir();
  const keyFilePath = `${tempDir}/nonexistent-keys.json`;

  // KeyStorageService pointing to non-existent file
  const keyStorageService = new KeyStorageService({ keyFilePath });

  const app = new Hono();
  app.route("/api/encryption-keys", createRotationRoutes({
    keyRotationService: createMockKeyRotationService(),
    keyStorageService,
    settingsService: createMockSettingsService(),
  }));

  try {
    const res = await app.request("/api/encryption-keys/rotation");
    expect(res.status).toBe(500);

    const json = await res.json();
    expect(json.error).toBe("No keys file found");
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("GET /api/encryption-keys/rotation returns current version", async () => {
  const { app, keyStorageService, tempDir } = await createTestApp();

  try {
    // Update to version B
    const keys = await keyStorageService.loadKeys();
    await keyStorageService.saveKeys({
      ...keys!,
      current_version: "B",
    });

    const res = await app.request("/api/encryption-keys/rotation");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.currentVersion).toBe("B");
  } finally {
    await cleanup(tempDir);
  }
});
