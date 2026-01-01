import { Hono } from "@hono/hono";
import { ApiKeyService, validateKeyGroup, validateKeyValue } from "./api_key_service.ts";

export function createApiKeyRoutes(service: ApiKeyService): Hono {
  const routes = new Hono();

  // GET /api/keys - List all key groups
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
    const id = parseInt(c.req.param("id"), 10);
    if (isNaN(id)) {
      return c.json({ error: "Invalid key ID" }, 400);
    }

    try {
      await service.removeKeyById(id);
      return c.json({ success: true });
    } catch (error) {
      if (error instanceof Error && error.message.includes("environment")) {
        return c.json({ error: "Cannot delete environment-provided management key" }, 403);
      }
      throw error;
    }
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
