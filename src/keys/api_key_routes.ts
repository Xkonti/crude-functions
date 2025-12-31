import { Hono } from "@hono/hono";
import { ApiKeyService, validateKeyName, validateKeyValue } from "./api_key_service.ts";

export function createApiKeyRoutes(service: ApiKeyService): Hono {
  const routes = new Hono();

  // GET /api/keys - List all key names
  routes.get("/", async (c) => {
    const all = await service.getAll();
    const names = [...all.keys()].sort();
    return c.json({ names });
  });

  // GET /api/keys/:name - Get keys for a specific name
  routes.get("/:name", async (c) => {
    const name = c.req.param("name").toLowerCase();
    const keys = await service.getKeys(name);

    if (!keys) {
      return c.json({ error: `Key name '${name}' not found` }, 404);
    }

    return c.json({ name, keys });
  });

  // POST /api/keys/:name - Add a new key
  routes.post("/:name", async (c) => {
    const name = c.req.param("name").toLowerCase();

    if (!validateKeyName(name)) {
      return c.json({ error: "Invalid key name. Must be lowercase alphanumeric with dashes/underscores." }, 400);
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

    await service.addKey(name, body.value, body.description);
    return c.json({ success: true }, 201);
  });

  // DELETE /api/keys/:name - Delete all keys for a name
  routes.delete("/:name", async (c) => {
    const name = c.req.param("name").toLowerCase();
    const keys = await service.getKeys(name);

    if (!keys) {
      return c.json({ error: `Key name '${name}' not found` }, 404);
    }

    await service.removeName(name);
    return c.json({ success: true });
  });

  // DELETE /api/keys/:name/:keyValue - Delete a specific key
  routes.delete("/:name/:keyValue", async (c) => {
    const name = c.req.param("name").toLowerCase();
    const keyValue = c.req.param("keyValue");

    // Check if key exists
    const hasKey = await service.hasKey(name, keyValue);
    if (!hasKey) {
      return c.json({ error: `Key not found` }, 404);
    }

    try {
      await service.removeKey(name, keyValue);
      return c.json({ success: true });
    } catch (error) {
      if (error instanceof Error && error.message.includes("environment")) {
        return c.json({ error: "Cannot delete environment-provided management key" }, 403);
      }
      throw error;
    }
  });

  return routes;
}
