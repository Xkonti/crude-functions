import { Hono } from "@hono/hono";
import { ApiKeyService, validateKeyGroup, validateKeyValue } from "./api_key_service.ts";
import { validateId } from "../utils/validation.ts";

export function createApiKeyRoutes(service: ApiKeyService): Hono {
  const routes = new Hono();

  // ============== Group Endpoints ==============

  // GET /api/keys/groups - List all key groups with metadata
  routes.get("/groups", async (c) => {
    const groups = await service.getGroups();
    return c.json({ groups });
  });

  // POST /api/keys/groups - Create a new group
  routes.post("/groups", async (c) => {
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

    const id = await service.createGroup(name, body.description);
    return c.json({ id, name }, 201);
  });

  // GET /api/keys/groups/:id - Get a group by ID
  routes.get("/groups/:id", async (c) => {
    const id = validateId(c.req.param("id"));
    if (id === null) {
      return c.json({ error: "Invalid group ID" }, 400);
    }

    const group = await service.getGroupById(id);
    if (!group) {
      return c.json({ error: "Group not found" }, 404);
    }

    return c.json(group);
  });

  // PUT /api/keys/groups/:id - Update a group
  routes.put("/groups/:id", async (c) => {
    const id = validateId(c.req.param("id"));
    if (id === null) {
      return c.json({ error: "Invalid group ID" }, 400);
    }

    const group = await service.getGroupById(id);
    if (!group) {
      return c.json({ error: "Group not found" }, 404);
    }

    let body: { description?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    await service.updateGroup(id, body.description ?? "");
    return c.json({ success: true });
  });

  // DELETE /api/keys/groups/:id - Delete a group (cascades to keys)
  routes.delete("/groups/:id", async (c) => {
    const id = validateId(c.req.param("id"));
    if (id === null) {
      return c.json({ error: "Invalid group ID" }, 400);
    }

    const group = await service.getGroupById(id);
    if (!group) {
      return c.json({ error: "Group not found" }, 404);
    }

    // Prevent deleting management group
    if (group.name === "management") {
      return c.json({ error: "Cannot delete management group" }, 403);
    }

    await service.deleteGroup(id);
    return c.json({ success: true });
  });

  // ============== Key Endpoints ==============

  // GET /api/keys - List all key groups (legacy compatibility)
  routes.get("/", async (c) => {
    const all = await service.getAll();
    const groups = [...all.keys()].sort();
    return c.json({ groups });
  });

  // GET /api/keys/:group - Get keys for a specific group
  routes.get("/:group", async (c) => {
    const group = c.req.param("group").toLowerCase();
    const keys = await service.getKeys(group);

    if (!keys) {
      return c.json({ error: `Key group '${group}' not found` }, 404);
    }

    return c.json({ group, keys });
  });

  // POST /api/keys/:group - Add a new key
  routes.post("/:group", async (c) => {
    const group = c.req.param("group").toLowerCase();

    if (!validateKeyGroup(group)) {
      return c.json({ error: "Invalid key group. Must be lowercase alphanumeric with dashes/underscores." }, 400);
    }

    let body: { value?: string; description?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    if (!body.value) {
      return c.json({ error: "Missing required field: value" }, 400);
    }

    if (!validateKeyValue(body.value)) {
      return c.json({ error: "Invalid key value. Must be alphanumeric with dashes/underscores." }, 400);
    }

    await service.addKey(group, body.value, body.description);
    return c.json({ success: true }, 201);
  });

  // DELETE /api/keys/by-id/:id - Delete a key by ID (for web UI)
  routes.delete("/by-id/:id", async (c) => {
    const id = validateId(c.req.param("id"));
    if (id === null) {
      return c.json({ error: "Invalid key ID" }, 400);
    }

    await service.removeKeyById(id);
    return c.json({ success: true });
  });

  // DELETE /api/keys/:group - Delete all keys for a group
  routes.delete("/:group", async (c) => {
    const group = c.req.param("group").toLowerCase();
    const keys = await service.getKeys(group);

    if (!keys) {
      return c.json({ error: `Key group '${group}' not found` }, 404);
    }

    await service.removeGroup(group);
    return c.json({ success: true });
  });

  return routes;
}
