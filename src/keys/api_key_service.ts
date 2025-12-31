export interface ApiKey {
  value: string;
  description?: string;
}

// Key names: lowercase a-z, 0-9, underscore, dash
const KEY_NAME_REGEX = /^[a-z0-9_-]+$/;

// Key values: a-z, A-Z, 0-9, underscore, dash
const KEY_VALUE_REGEX = /^[a-zA-Z0-9_-]+$/;

export function validateKeyName(name: string): boolean {
  return KEY_NAME_REGEX.test(name);
}

export function validateKeyValue(value: string): boolean {
  return KEY_VALUE_REGEX.test(value);
}

export function serializeKeysFile(keys: Map<string, ApiKey[]>): string {
  const lines: string[] = [];

  // Sort names for consistent output
  const sortedNames = [...keys.keys()].sort();

  for (const name of sortedNames) {
    const keyList = keys.get(name)!;
    for (const key of keyList) {
      if (key.description) {
        lines.push(`${name}=${key.value} # ${key.description}`);
      } else {
        lines.push(`${name}=${key.value}`);
      }
    }
  }

  return lines.join("\n");
}

export function parseKeysFile(content: string): Map<string, ApiKey[]> {
  const result = new Map<string, ApiKey[]>();

  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) continue;

    const name = trimmed.slice(0, equalsIndex).trim().toLowerCase();
    const rest = trimmed.slice(equalsIndex + 1);

    // Parse value and optional description (separated by #)
    const hashIndex = rest.indexOf("#");
    let value: string;
    let description: string | undefined;

    if (hashIndex !== -1) {
      value = rest.slice(0, hashIndex).trim();
      description = rest.slice(hashIndex + 1).trim();
    } else {
      value = rest.trim();
    }

    if (!name || !value) continue;

    const existing = result.get(name) || [];
    // Deduplicate: only add if value doesn't already exist (first description wins)
    if (!existing.some((k) => k.value === value)) {
      existing.push({ value, description });
    }
    result.set(name, existing);
  }

  return result;
}

export interface ApiKeyServiceOptions {
  configPath: string;
  refreshInterval?: number;
  managementKeyFromEnv?: string;
}

export class ApiKeyService {
  private readonly configPath: string;
  private readonly managementKeyFromEnv?: string;
  private cache: Map<string, ApiKey[]> = new Map();
  private initialized = false;

  constructor(options: ApiKeyServiceOptions) {
    this.configPath = options.configPath;
    this.managementKeyFromEnv = options.managementKeyFromEnv;
  }

  private async ensureFileExists(): Promise<void> {
    try {
      await Deno.stat(this.configPath);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        await Deno.writeTextFile(this.configPath, "");
      } else {
        throw error;
      }
    }
  }

  private async load(): Promise<void> {
    await this.ensureFileExists();
    const content = await Deno.readTextFile(this.configPath);
    this.cache = parseKeysFile(content);
    this.initialized = true;
  }

  private async save(): Promise<void> {
    // Only save file-based keys (exclude env management key)
    const fileKeys = new Map<string, ApiKey[]>();
    for (const [name, keys] of this.cache) {
      if (name === "management" && this.managementKeyFromEnv) {
        // Filter out env key
        const filtered = keys.filter((k) => k.value !== this.managementKeyFromEnv);
        if (filtered.length > 0) {
          fileKeys.set(name, filtered);
        }
      } else {
        fileKeys.set(name, keys);
      }
    }
    const content = serializeKeysFile(fileKeys);
    await Deno.writeTextFile(this.configPath, content);
  }

  async getAll(): Promise<Map<string, ApiKey[]>> {
    if (!this.initialized) {
      await this.load();
    }

    // Merge env management key if present
    const result = new Map(this.cache);
    if (this.managementKeyFromEnv) {
      const mgmtKeys = result.get("management") || [];
      if (!mgmtKeys.some((k) => k.value === this.managementKeyFromEnv)) {
        mgmtKeys.push({ value: this.managementKeyFromEnv, description: "from environment" });
        result.set("management", mgmtKeys);
      }
    }

    return result;
  }

  async getKeys(name: string): Promise<ApiKey[] | null> {
    const all = await this.getAll();
    return all.get(name.toLowerCase()) || null;
  }

  async hasKey(name: string, keyValue: string): Promise<boolean> {
    const keys = await this.getKeys(name);
    if (!keys) return false;
    return keys.some((k) => k.value === keyValue);
  }

  async addKey(name: string, value: string, description?: string): Promise<void> {
    if (!this.initialized) {
      await this.load();
    }

    const normalizedName = name.toLowerCase();
    const existing = this.cache.get(normalizedName) || [];

    // Don't add duplicate
    if (existing.some((k) => k.value === value)) {
      return;
    }

    existing.push({ value, description });
    this.cache.set(normalizedName, existing);
    await this.save();
  }

  async removeKey(name: string, keyValue: string): Promise<void> {
    // Cannot remove env management key
    if (name.toLowerCase() === "management" && keyValue === this.managementKeyFromEnv) {
      throw new Error("Cannot remove environment-provided management key");
    }

    if (!this.initialized) {
      await this.load();
    }

    const normalizedName = name.toLowerCase();
    const existing = this.cache.get(normalizedName);
    if (!existing) return;

    const filtered = existing.filter((k) => k.value !== keyValue);
    if (filtered.length === 0) {
      this.cache.delete(normalizedName);
    } else {
      this.cache.set(normalizedName, filtered);
    }
    await this.save();
  }

  async removeName(name: string): Promise<void> {
    if (!this.initialized) {
      await this.load();
    }

    const normalizedName = name.toLowerCase();
    this.cache.delete(normalizedName);
    await this.save();
  }
}
