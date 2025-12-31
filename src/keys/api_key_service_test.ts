import { expect } from "@std/expect";
import {
  parseKeysFile,
  serializeKeysFile,
  validateKeyName,
  validateKeyValue,
  type ApiKey,
} from "./api_key_service.ts";

Deno.test("parseKeysFile returns empty map for empty content", () => {
  const result = parseKeysFile("");
  expect(result.size).toBe(0);
});

Deno.test("parseKeysFile parses single entry without description", () => {
  const result = parseKeysFile("management=abc123");

  expect(result.size).toBe(1);
  expect(result.has("management")).toBe(true);

  const keys = result.get("management")!;
  expect(keys.length).toBe(1);
  expect(keys[0].value).toBe("abc123");
  expect(keys[0].description).toBeUndefined();
});

Deno.test("parseKeysFile parses entry with description", () => {
  const result = parseKeysFile("management=abc123 # used by service A");

  const keys = result.get("management")!;
  expect(keys[0].value).toBe("abc123");
  expect(keys[0].description).toBe("used by service A");
});

Deno.test("parseKeysFile consolidates multiple entries for same name", () => {
  const content = `management=key1 # first key
management=key2 # second key
email=key3`;

  const result = parseKeysFile(content);

  expect(result.size).toBe(2);
  expect(result.get("management")!.length).toBe(2);
  expect(result.get("email")!.length).toBe(1);
});

Deno.test("parseKeysFile normalizes names to lowercase", () => {
  const result = parseKeysFile("MANAGEMENT=abc123\nEmail-Service=xyz789");

  expect(result.has("management")).toBe(true);
  expect(result.has("email-service")).toBe(true);
  expect(result.has("MANAGEMENT")).toBe(false);
});

Deno.test("parseKeysFile skips empty lines and comment-only lines", () => {
  const content = `# This is a comment
management=key1

# Another comment
email=key2
`;

  const result = parseKeysFile(content);
  expect(result.size).toBe(2);
});

Deno.test("parseKeysFile skips malformed lines without equals sign", () => {
  const content = `management=key1
this line has no equals
email=key2`;

  const result = parseKeysFile(content);
  expect(result.size).toBe(2);
});

Deno.test("parseKeysFile deduplicates same name+value (keeps first description)", () => {
  const content = `management=key1 # first description
management=key1 # second description
management=key2`;

  const result = parseKeysFile(content);
  const keys = result.get("management")!;

  // Should have 2 entries, not 3 (duplicate key1 removed)
  expect(keys.length).toBe(2);

  // First description should be kept
  const key1Entry = keys.find((k) => k.value === "key1");
  expect(key1Entry?.description).toBe("first description");
});

// Validation tests
Deno.test("validateKeyName accepts valid names", () => {
  expect(validateKeyName("management")).toBe(true);
  expect(validateKeyName("email-service")).toBe(true);
  expect(validateKeyName("test_key")).toBe(true);
  expect(validateKeyName("key123")).toBe(true);
  expect(validateKeyName("a")).toBe(true);
});

Deno.test("validateKeyName rejects invalid names", () => {
  expect(validateKeyName("")).toBe(false);
  expect(validateKeyName("UPPERCASE")).toBe(false);
  expect(validateKeyName("has space")).toBe(false);
  expect(validateKeyName("has.dot")).toBe(false);
  expect(validateKeyName("has@special")).toBe(false);
});

Deno.test("validateKeyValue accepts valid values", () => {
  expect(validateKeyValue("abc123")).toBe(true);
  expect(validateKeyValue("ABC123")).toBe(true);
  expect(validateKeyValue("key-with-dashes")).toBe(true);
  expect(validateKeyValue("key_with_underscores")).toBe(true);
});

Deno.test("validateKeyValue rejects invalid values", () => {
  expect(validateKeyValue("")).toBe(false);
  expect(validateKeyValue("has space")).toBe(false);
  expect(validateKeyValue("has.dot")).toBe(false);
  expect(validateKeyValue("has@special")).toBe(false);
  expect(validateKeyValue("has#hash")).toBe(false);
});

// Serialization tests
Deno.test("serializeKeysFile produces valid format", () => {
  const keys = new Map<string, ApiKey[]>([
    ["management", [{ value: "key1", description: "first" }]],
    ["email", [{ value: "key2" }]],
  ]);

  const result = serializeKeysFile(keys);
  const lines = result.split("\n").filter((l) => l.trim());

  expect(lines.length).toBe(2);
  expect(lines).toContain("management=key1 # first");
  expect(lines).toContain("email=key2");
});

Deno.test("serializeKeysFile handles multiple keys per name", () => {
  const keys = new Map<string, ApiKey[]>([
    [
      "management",
      [
        { value: "key1", description: "first" },
        { value: "key2", description: "second" },
      ],
    ],
  ]);

  const result = serializeKeysFile(keys);
  const lines = result.split("\n").filter((l) => l.trim());

  expect(lines.length).toBe(2);
  expect(lines).toContain("management=key1 # first");
  expect(lines).toContain("management=key2 # second");
});

Deno.test("serializeKeysFile roundtrips with parseKeysFile", () => {
  const original = `management=key1 # first
management=key2 # second
email=key3`;

  const parsed = parseKeysFile(original);
  const serialized = serializeKeysFile(parsed);
  const reparsed = parseKeysFile(serialized);

  expect(reparsed.size).toBe(parsed.size);
  expect(reparsed.get("management")!.length).toBe(2);
  expect(reparsed.get("email")!.length).toBe(1);
});

// ApiKeyService tests
import { ApiKeyService } from "./api_key_service.ts";

Deno.test("ApiKeyService creates empty file if missing and returns empty map", async () => {
  const tempDir = await Deno.makeTempDir();
  const configPath = `${tempDir}/keys.config`;

  try {
    const service = new ApiKeyService({ configPath });
    const keys = await service.getAll();

    expect(keys.size).toBe(0);
    // File should now exist
    const stat = await Deno.stat(configPath);
    expect(stat.isFile).toBe(true);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("ApiKeyService reads keys from existing file", async () => {
  const tempDir = await Deno.makeTempDir();
  const configPath = `${tempDir}/keys.config`;

  try {
    await Deno.writeTextFile(configPath, "management=key1 # admin\nemail=key2");

    const service = new ApiKeyService({ configPath });
    const keys = await service.getAll();

    expect(keys.size).toBe(2);
    expect(keys.get("management")![0].value).toBe("key1");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("ApiKeyService includes env management key", async () => {
  const tempDir = await Deno.makeTempDir();
  const configPath = `${tempDir}/keys.config`;

  try {
    await Deno.writeTextFile(configPath, "management=filekey");

    const service = new ApiKeyService({
      configPath,
      managementKeyFromEnv: "envkey",
    });
    const keys = await service.getAll();

    const mgmtKeys = keys.get("management")!;
    expect(mgmtKeys.length).toBe(2);
    expect(mgmtKeys.some((k) => k.value === "filekey")).toBe(true);
    expect(mgmtKeys.some((k) => k.value === "envkey")).toBe(true);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("ApiKeyService.hasKey returns true for valid key", async () => {
  const tempDir = await Deno.makeTempDir();
  const configPath = `${tempDir}/keys.config`;

  try {
    await Deno.writeTextFile(configPath, "management=key1");

    const service = new ApiKeyService({ configPath });

    expect(await service.hasKey("management", "key1")).toBe(true);
    expect(await service.hasKey("management", "wrongkey")).toBe(false);
    expect(await service.hasKey("nonexistent", "key1")).toBe(false);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("ApiKeyService.addKey adds key to file", async () => {
  const tempDir = await Deno.makeTempDir();
  const configPath = `${tempDir}/keys.config`;

  try {
    await Deno.writeTextFile(configPath, "");

    const service = new ApiKeyService({ configPath });
    await service.addKey("email", "newkey", "test description");

    // Verify it was added
    expect(await service.hasKey("email", "newkey")).toBe(true);

    // Verify file was updated
    const content = await Deno.readTextFile(configPath);
    expect(content).toContain("email=newkey");
    expect(content).toContain("test description");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("ApiKeyService.removeKey removes specific key", async () => {
  const tempDir = await Deno.makeTempDir();
  const configPath = `${tempDir}/keys.config`;

  try {
    await Deno.writeTextFile(configPath, "management=key1\nmanagement=key2");

    const service = new ApiKeyService({ configPath });
    await service.removeKey("management", "key1");

    expect(await service.hasKey("management", "key1")).toBe(false);
    expect(await service.hasKey("management", "key2")).toBe(true);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("ApiKeyService.removeName removes all keys for name", async () => {
  const tempDir = await Deno.makeTempDir();
  const configPath = `${tempDir}/keys.config`;

  try {
    await Deno.writeTextFile(configPath, "management=key1\nemail=key2");

    const service = new ApiKeyService({ configPath });
    await service.removeName("email");

    const keys = await service.getAll();
    expect(keys.has("email")).toBe(false);
    expect(keys.has("management")).toBe(true);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("ApiKeyService cannot remove env management key", async () => {
  const tempDir = await Deno.makeTempDir();
  const configPath = `${tempDir}/keys.config`;

  try {
    await Deno.writeTextFile(configPath, "management=filekey");

    const service = new ApiKeyService({
      configPath,
      managementKeyFromEnv: "envkey",
    });

    // Try to remove env key - should throw or be ignored
    await expect(service.removeKey("management", "envkey")).rejects.toThrow();

    // Env key should still exist
    expect(await service.hasKey("management", "envkey")).toBe(true);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
