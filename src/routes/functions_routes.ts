import { Hono } from "@hono/hono";
import {
  RoutesService,
  type FunctionRoute,
  type NewFunctionRoute,
} from "./routes_service.ts";
import {
  validateRouteName,
  validateRoutePath,
  validateMethods,
} from "../validation/routes.ts";
import { validateSurrealId } from "../validation/common.ts";
import { recordIdToString } from "../database/surreal_helpers.ts";

/**
 * Normalize a FunctionRoute for API responses.
 * - Converts RecordId to string
 * - Maps internal 'routePath' to API field name 'route'
 */
function normalizeRoute(route: FunctionRoute): Record<string, unknown> {
  return {
    id: recordIdToString(route.id),
    name: route.name,
    description: route.description ?? null,
    handler: route.handler,
    route: route.routePath, // API uses 'route', internal uses 'routePath'
    methods: route.methods,
    keys: route.keys ?? null,
    enabled: route.enabled,
  };
}

export function createFunctionsRoutes(service: RoutesService): Hono {
  const routes = new Hono();

  // GET /api/functions - List all functions
  routes.get("/", async (c) => {
    const allFunctions = await service.getAll();
    return c.json({ functions: allFunctions.map(normalizeRoute) });
  });

  // GET /api/functions/:id - Get function by ID
  routes.get("/:id", async (c) => {
    const id = validateSurrealId(c.req.param("id"));
    if (id === null) {
      return c.json({ error: "Invalid function ID" }, 400);
    }

    const func = await service.getById(id);
    if (!func) {
      return c.json({ error: `Function with id '${id}' not found` }, 404);
    }

    return c.json({ function: normalizeRoute(func) });
  });

  // POST /api/functions - Create new function (returns created resource)
  routes.post("/", async (c) => {
    // API body type - uses 'route' as the external field name
    let body: {
      name?: string;
      handler?: string;
      route?: string; // API field name
      methods?: string[];
      description?: string;
      keys?: string[];
    };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    // Validate required fields
    if (!body.name || !validateRouteName(body.name)) {
      return c.json({ error: "Invalid or missing name" }, 400);
    }
    if (!body.handler || body.handler.trim() === "") {
      return c.json({ error: "Invalid or missing handler" }, 400);
    }
    if (!body.route || !validateRoutePath(body.route)) {
      return c.json({ error: "Invalid or missing route path" }, 400);
    }
    if (!body.methods || !validateMethods(body.methods)) {
      return c.json({ error: "Invalid or missing methods" }, 400);
    }

    // Validate keys are array of string IDs (group IDs) if provided
    if (body.keys !== undefined && body.keys !== null) {
      if (!Array.isArray(body.keys)) {
        return c.json({ error: "keys must be an array of group IDs" }, 400);
      }
      for (const keyId of body.keys) {
        if (typeof keyId !== "string" || keyId.length === 0 || !/^[a-zA-Z0-9_-]+$/.test(keyId)) {
          return c.json({ error: "keys must be an array of valid string group IDs" }, 400);
        }
      }
    }

    const newFunction: NewFunctionRoute = {
      name: body.name,
      handler: body.handler,
      routePath: body.route, // Map API 'route' to internal 'routePath'
      methods: body.methods,
      description: body.description,
      keys: body.keys,
    };

    try {
      const created = await service.addRoute(newFunction);
      return c.json({ function: normalizeRoute(created) }, 201);
    } catch (error) {
      if (error instanceof Error && error.message.includes("already exists")) {
        return c.json({ error: error.message }, 409);
      }
      throw error;
    }
  });

  // PUT /api/functions/:id - Update function (returns updated resource)
  routes.put("/:id", async (c) => {
    const id = validateSurrealId(c.req.param("id"));
    if (id === null) {
      return c.json({ error: "Invalid function ID" }, 400);
    }

    // API body type - uses 'route' as the external field name
    let body: {
      name?: string;
      handler?: string;
      route?: string; // API field name
      methods?: string[];
      description?: string;
      keys?: string[];
    };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    // Validate required fields
    if (!body.name || !validateRouteName(body.name)) {
      return c.json({ error: "Invalid or missing name" }, 400);
    }
    if (!body.handler || body.handler.trim() === "") {
      return c.json({ error: "Invalid or missing handler" }, 400);
    }
    if (!body.route || !validateRoutePath(body.route)) {
      return c.json({ error: "Invalid or missing route path" }, 400);
    }
    if (!body.methods || !validateMethods(body.methods)) {
      return c.json({ error: "Invalid or missing methods" }, 400);
    }

    // Validate keys are array of string IDs (group IDs) if provided
    if (body.keys !== undefined && body.keys !== null) {
      if (!Array.isArray(body.keys)) {
        return c.json({ error: "keys must be an array of group IDs" }, 400);
      }
      for (const keyId of body.keys) {
        if (typeof keyId !== "string" || keyId.length === 0 || !/^[a-zA-Z0-9_-]+$/.test(keyId)) {
          return c.json({ error: "keys must be an array of valid string group IDs" }, 400);
        }
      }
    }

    const updatedFunction: NewFunctionRoute = {
      name: body.name,
      handler: body.handler,
      routePath: body.route, // Map API 'route' to internal 'routePath'
      methods: body.methods,
      description: body.description,
      keys: body.keys,
    };

    try {
      const updated = await service.updateRoute(id, updatedFunction);
      return c.json({ function: normalizeRoute(updated) });
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

  // DELETE /api/functions/:id - Delete function (returns 204 No Content)
  routes.delete("/:id", async (c) => {
    const id = validateSurrealId(c.req.param("id"));
    if (id === null) {
      return c.json({ error: "Invalid function ID" }, 400);
    }

    const existing = await service.getById(id);
    if (!existing) {
      return c.json({ error: `Function with id '${id}' not found` }, 404);
    }

    await service.removeRouteById(id);
    return c.body(null, 204);
  });

  // PUT /api/functions/:id/enable - Enable function (idempotent)
  routes.put("/:id/enable", async (c) => {
    const id = validateSurrealId(c.req.param("id"));
    if (id === null) {
      return c.json({ error: "Invalid function ID" }, 400);
    }

    try {
      const updated = await service.setRouteEnabled(id, true);
      return c.json({ function: normalizeRoute(updated) });
    } catch (error) {
      if (error instanceof Error && error.message.includes("not found")) {
        return c.json({ error: error.message }, 404);
      }
      throw error;
    }
  });

  // PUT /api/functions/:id/disable - Disable function (idempotent)
  routes.put("/:id/disable", async (c) => {
    const id = validateSurrealId(c.req.param("id"));
    if (id === null) {
      return c.json({ error: "Invalid function ID" }, 400);
    }

    try {
      const updated = await service.setRouteEnabled(id, false);
      return c.json({ function: normalizeRoute(updated) });
    } catch (error) {
      if (error instanceof Error && error.message.includes("not found")) {
        return c.json({ error: error.message }, 404);
      }
      throw error;
    }
  });

  return routes;
}
