import { expect } from "@std/expect";
import { Hono } from "@hono/hono";
import { DatabaseService } from "../database/database_service.ts";
import { KeyRotationService } from "./key_rotation_service.ts";
import { KeyStorageService } from "./key_storage_service.ts";
import { VersionedEncryptionService } from "./versioned_encryption_service.ts";
import { createRotationRoutes } from "./rotation_routes.ts";
import type { EncryptionKeyFile } from "./key_storage_types.ts";
import type { KeyRotationConfig } from "./key_rotation_types.ts";

// Test keys (32 bytes base64-encoded)
const TEST_KEY_A = "YTJhNGY2ZDhiMWU3YzNhOGYyZDZiNGU4YzFhN2YzZDk=";
const TEST_KEY_B = "YjJiNGY2ZDhiMWU3YzNhOGYyZDZiNGU4YzFhN2YzZTA=";

// Mock key generator
function createMockKeyGenerator() {
  const keys = [TEST_KEY_B, TEST_KEY_A];
  let index = 0;
  return () => {
    const key = keys[index % keys.length];
    index++;
    return Promise.resolve(key);
  };
}

const SECRETS_SCHEMA = `
  CREATE TABLE secrets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    value TEXT NOT NULL,
    comment TEXT,
    scope INTEGER NOT NULL DEFAULT 0,
    functionId INTEGER,
    apiGroupId INTEGER,
    apiKeyId INTEGER,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
    updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
  );
`;

const API_KEYS_SCHEMA = `
  CREATE TABLE apiKeyGroups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE apiKeys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    groupId INTEGER NOT NULL REFERENCES apiKeyGroups(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    value TEXT NOT NULL,
    valueHash TEXT,
    description TEXT,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
    updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
  );
`;

const SETTINGS_SCHEMA = `
  CREATE TABLE settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    userId TEXT,
    value TEXT,
    isEncrypted INTEGER NOT NULL DEFAULT 0,
    updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
  );
`;

async function createTestApp(): Promise<{
  app: Hono;
  keyRotationService: KeyRotationService;
  keyStorageService: KeyStorageService;
  db: DatabaseService;
  tempDir: string;
}> {
  const tempDir = await Deno.makeTempDir();
  const keyFilePath = `${tempDir}/encryption-keys.json`;

  // Create key storage with mock key generator
  const keyStorageService = new KeyStorageService({
    keyFilePath,
    keyGenerator: createMockKeyGenerator(),
  });

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

  // Create database
  const db = new DatabaseService({ databasePath: `${tempDir}/test.db` });
  await db.open();
  await db.exec(SECRETS_SCHEMA);
  await db.exec(API_KEYS_SCHEMA);
  await db.exec(SETTINGS_SCHEMA);

  // Create encryption service
  const encryptionService = new VersionedEncryptionService({
    currentKey: keys.current_key,
    currentVersion: keys.current_version,
  });

  // Create rotation service config (small interval for testing)
  const config: KeyRotationConfig = {
    checkIntervalSeconds: 1,
    rotationIntervalDays: 90,
    batchSize: 10,
    batchSleepMs: 10,
  };

  const keyRotationService = new KeyRotationService({
    db,
    encryptionService,
    keyStorage: keyStorageService,
    config,
  });

  const app = new Hono();
  app.route("/api/rotation", createRotationRoutes({
    keyRotationService,
    keyStorageService,
  }));

  return { app, keyRotationService, keyStorageService, db, tempDir };
}

async function cleanup(db: DatabaseService, tempDir: string): Promise<void> {
  await db.close();
  await Deno.remove(tempDir, { recursive: true });
}

// GET /api/rotation/status tests
Deno.test("GET /api/rotation/status returns rotation status", async () => {
  const { app, db, tempDir } = await createTestApp();

  try {
    const res = await app.request("/api/rotation/status");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.lastRotationAt).toBeDefined();
    expect(json.daysSinceRotation).toBeDefined();
    expect(json.currentVersion).toBe("A");
    expect(json.isInProgress).toBe(false);

    // Should be about 5 days (we set it to 5 days ago in setup)
    expect(json.daysSinceRotation).toBeGreaterThanOrEqual(4);
    expect(json.daysSinceRotation).toBeLessThanOrEqual(6);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("GET /api/rotation/status calculates days since rotation correctly", async () => {
  const { app, keyStorageService, db, tempDir } = await createTestApp();

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

    const res = await app.request("/api/rotation/status");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.daysSinceRotation).toBeGreaterThanOrEqual(9);
    expect(json.daysSinceRotation).toBeLessThanOrEqual(11);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("GET /api/rotation/status detects rotation in progress", async () => {
  const { app, keyStorageService, db, tempDir } = await createTestApp();

  try {
    // Simulate rotation in progress by having both current and phased_out keys
    const keys = await keyStorageService.loadKeys();
    await keyStorageService.saveKeys({
      ...keys!,
      phased_out_key: TEST_KEY_B,
      phased_out_version: "B",
    });

    const res = await app.request("/api/rotation/status");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.isInProgress).toBe(true);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("GET /api/rotation/status handles missing keys file", async () => {
  const tempDir = await Deno.makeTempDir();
  const keyFilePath = `${tempDir}/nonexistent-keys.json`;

  const keyStorageService = new KeyStorageService({
    keyFilePath,
    keyGenerator: createMockKeyGenerator(),
  });

  const db = new DatabaseService({ databasePath: `${tempDir}/test.db` });
  await db.open();

  const encryptionService = new VersionedEncryptionService({
    currentKey: TEST_KEY_A,
    currentVersion: "A",
  });

  const config: KeyRotationConfig = {
    checkIntervalSeconds: 1,
    rotationIntervalDays: 90,
    batchSize: 10,
    batchSleepMs: 10,
  };

  const keyRotationService = new KeyRotationService({
    db,
    encryptionService,
    keyStorage: keyStorageService,
    config,
  });

  const app = new Hono();
  app.route("/api/rotation", createRotationRoutes({
    keyRotationService,
    keyStorageService,
  }));

  try {
    const res = await app.request("/api/rotation/status");
    expect(res.status).toBe(500);

    const json = await res.json();
    expect(json.error).toBe("No keys file found");
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("GET /api/rotation/status returns current version", async () => {
  const { app, keyStorageService, db, tempDir } = await createTestApp();

  try {
    // Update to version B
    const keys = await keyStorageService.loadKeys();
    await keyStorageService.saveKeys({
      ...keys!,
      current_version: "B",
    });

    const res = await app.request("/api/rotation/status");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.currentVersion).toBe("B");
  } finally {
    await cleanup(db, tempDir);
  }
});
