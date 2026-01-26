import { Hono } from "@hono/hono";
import type { RecordId } from "surrealdb";
import { ApiKeyService, type ApiKeyGroup, type ApiKey } from "./api_key_service.ts";
import { validateKeyGroup, validateKeyName, validateKeyValue } from "../validation/keys.ts";
import { recordIdToString } from "../database/surreal_helpers.ts";

/**
 * Generate a URL-safe base64-encoded UUID for API keys.
 */
function generateApiKey(): string {
  const uuid = crypto.randomUUID().replace(/-/g, "");
  return btoa(uuid).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/**
 * Validate a SurrealDB record ID (string).
 * Must be non-empty and contain only alphanumeric characters, dashes, and underscores.
 */
function isValidSurrealId(id: string | undefined): id is string {
  return !!id && id.length > 0 && /^[a-zA-Z0-9_-]+$/.test(id);
}

/**
 * Convert ApiKeyGroup (internal with RecordId) to API response (strings).
 */
function normalizeGroup(group: ApiKeyGroup): Record<string, unknown> {
  return {
    id: recordIdToString(group.id),
    name: group.name,
    description: group.description ?? null,
  };
}

/**
 * Convert ApiKey (internal with RecordId) to API response (strings).
 */
function normalizeKey(key: ApiKey): Record<string, unknown> {
  return {
    id: recordIdToString(key.id),
    name: key.name,
    value: key.value,
    description: key.description ?? null,
  };
}

/**
 * Convert ApiKey with group info to API response (strings).
 */
function normalizeKeyWithGroup(key: ApiKey & { groupId: RecordId; groupName: string }): Record<string, unknown> {
  return {
    id: recordIdToString(key.id),
    name: key.name,
    value: key.value,
    description: key.description ?? null,
    groupId: recordIdToString(key.groupId),
    groupName: key.groupName,
  };
}

/**
 * Create routes for API key group management.
 * Mounted at /api/key-groups
 */
export function createApiKeyGroupRoutes(service: ApiKeyService): Hono {
  const routes = new Hono();

  // GET /api/key-groups - List all groups
  routes.get("/", async (c) => {
    const groups = await service.getGroups();
    return c.json({ groups: groups.map(normalizeGroup) });
  });

  // POST /api/key-groups - Create a new group
  routes.post("/", async (c) => {
    let body: { name?: string; description?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    if (!body.name) {
      return c.json({ error: "Missing required field: name" }, 400);
    }

    const name = body.name.toLowerCase();
    if (!validateKeyGroup(name)) {
      return c.json({ error: "Invalid group name. Must be lowercase alphanumeric with dashes/underscores." }, 400);
    }

    // Check if group already exists
    const existing = await service.getGroupByName(name);
    if (existing) {
      return c.json({ error: `Group '${name}' already exists` }, 409);
    }

    const recordId = await service.createGroup(name, body.description);
    return c.json({ id: recordIdToString(recordId), name }, 201);
  });

  // GET /api/key-groups/:groupId - Get a group by ID
  routes.get("/:groupId", async (c) => {
    const groupId = c.req.param("groupId");
    if (!isValidSurrealId(groupId)) {
      return c.json({ error: "Invalid group ID" }, 400);
    }

    const group = await service.getGroupById(groupId);
    if (!group) {
      return c.json({ error: "Group not found" }, 404);
    }

    return c.json(normalizeGroup(group));
  });

  // PUT /api/key-groups/:groupId - Update a group
  routes.put("/:groupId", async (c) => {
    const groupId = c.req.param("groupId");
    if (!isValidSurrealId(groupId)) {
      return c.json({ error: "Invalid group ID" }, 400);
    }

    const group = await service.getGroupById(groupId);
    if (!group) {
      return c.json({ error: "Group not found" }, 404);
    }

    let body: { description?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    await service.updateGroup(groupId, body.description ?? "");
    return c.json({ success: true });
  });

  // DELETE /api/key-groups/:groupId - Delete a group (must be empty)
  routes.delete("/:groupId", async (c) => {
    const groupId = c.req.param("groupId");
    if (!isValidSurrealId(groupId)) {
      return c.json({ error: "Invalid group ID" }, 400);
    }

    const group = await service.getGroupById(groupId);
    if (!group) {
      return c.json({ error: "Group not found" }, 404);
    }

    // Prevent deleting management group
    if (group.name === "management") {
      return c.json({ error: "Cannot delete management group" }, 403);
    }

    // Check if group has keys
    const keyCount = await service.getKeyCountForGroup(groupId);
    if (keyCount > 0) {
      return c.json({
        error: `Cannot delete group with ${keyCount} existing key(s). Delete keys first.`
      }, 409);
    }

    await service.deleteGroup(groupId);
    return c.json({ success: true });
  });

  return routes;
}

/**
 * Create routes for API key management.
 * Mounted at /api/keys
 */
export function createApiKeyRoutes(service: ApiKeyService): Hono {
  const routes = new Hono();

  // GET /api/keys - List all keys (optional ?groupId= filter)
  routes.get("/", async (c) => {
    const groupIdParam = c.req.query("groupId");
    let groupId: string | undefined;

    if (groupIdParam) {
      if (!isValidSurrealId(groupIdParam)) {
        return c.json({ error: "Invalid groupId parameter" }, 400);
      }
      groupId = groupIdParam;

      // Verify group exists
      const group = await service.getGroupById(groupId);
      if (!group) {
        return c.json({ error: "Group not found" }, 404);
      }
    }

    const keys = await service.getAllKeys(groupId);
    return c.json({ keys: keys.map(normalizeKeyWithGroup) });
  });

  // POST /api/keys - Create a new key
  routes.post("/", async (c) => {
    let body: { groupId?: string; name?: string; value?: string; description?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    // Validate groupId
    if (body.groupId === undefined) {
      return c.json({ error: "Missing required field: groupId" }, 400);
    }

    const groupId = body.groupId;
    if (!isValidSurrealId(groupId)) {
      return c.json({ error: "Invalid groupId" }, 400);
    }

    // Verify group exists
    const group = await service.getGroupById(groupId);
    if (!group) {
      return c.json({ error: "Group not found" }, 404);
    }

    // Validate name
    const name = body.name?.trim().toLowerCase();
    if (!name) {
      return c.json({ error: "Missing required field: name" }, 400);
    }

    if (!validateKeyName(name)) {
      return c.json({ error: "Invalid key name. Must be lowercase alphanumeric with dashes/underscores." }, 400);
    }

    // Auto-generate value if not provided
    const value = body.value ?? generateApiKey();

    if (!validateKeyValue(value)) {
      return c.json({ error: "Invalid key value. Must be alphanumeric with dashes/underscores." }, 400);
    }

    try {
      const keyRecordId = await service.addKeyToGroup(groupId, name, value, body.description);
      // Return the key value (important when auto-generated)
      return c.json({ id: recordIdToString(keyRecordId), name, value }, 201);
    } catch (error) {
      if (error instanceof Error && error.message.includes("already exists")) {
        return c.json({ error: error.message }, 409);
      }
      throw error;
    }
  });

  // GET /api/keys/:keyId - Get a key by ID
  routes.get("/:keyId", async (c) => {
    const keyId = c.req.param("keyId");
    if (!isValidSurrealId(keyId)) {
      return c.json({ error: "Invalid key ID" }, 400);
    }

    const result = await service.getById(keyId);
    if (!result) {
      return c.json({ error: "Key not found" }, 404);
    }

    return c.json({ key: normalizeKey(result.key), group: normalizeGroup(result.group) });
  });

  // PUT /api/keys/:keyId - Update a key
  routes.put("/:keyId", async (c) => {
    const keyId = c.req.param("keyId");
    if (!isValidSurrealId(keyId)) {
      return c.json({ error: "Invalid key ID" }, 400);
    }

    let body: { name?: string; value?: string; description?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    // Validate name format if provided
    if (body.name !== undefined) {
      const normalizedName = body.name.trim().toLowerCase();
      if (!validateKeyName(normalizedName)) {
        return c.json({ error: "Invalid key name. Must be lowercase alphanumeric with dashes/underscores." }, 400);
      }
      body.name = normalizedName;
    }

    // Validate value format if provided
    if (body.value !== undefined && !validateKeyValue(body.value)) {
      return c.json({ error: "Invalid key value. Must be alphanumeric with dashes/underscores." }, 400);
    }

    try {
      await service.updateKey(keyId, body);
      return c.json({ success: true });
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes("not found")) {
          return c.json({ error: error.message }, 404);
        }
        if (error.message.includes("already exists")) {
          return c.json({ error: error.message }, 409);
        }
      }
      throw error;
    }
  });

  // DELETE /api/keys/:keyId - Delete a key
  routes.delete("/:keyId", async (c) => {
    const keyId = c.req.param("keyId");
    if (!isValidSurrealId(keyId)) {
      return c.json({ error: "Invalid key ID" }, 400);
    }

    // Check if key exists
    const existing = await service.getById(keyId);
    if (!existing) {
      return c.json({ error: "Key not found" }, 404);
    }

    await service.removeKeyById(keyId);
    return c.json({ success: true });
  });

  return routes;
}
