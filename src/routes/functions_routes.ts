import { Hono } from "@hono/hono";
import {
  FunctionsService,
  type FunctionDefinition,
  type NewFunctionDefinition,
} from "./functions_service.ts";
import {
  validateFunctionName,
  validateFunctionPath,
  validateMethods,
} from "../validation/routes.ts";
import { validateSurrealId } from "../validation/common.ts";
import { recordIdToString } from "../database/surreal_helpers.ts";
import type { CorsConfig } from "../functions/types.ts";

/**
 * Normalize a FunctionDefinition for API responses.
 * - Converts RecordId to string
 * - Maps internal 'routePath' to API field name 'route'
 */
function normalizeFunctionDef(func: FunctionDefinition): Record<string, unknown> {
  return {
    id: recordIdToString(func.id),
    name: func.name,
    description: func.description ?? null,
    handler: func.handler,
    route: func.routePath, // API uses 'route', internal uses 'routePath'
    methods: func.methods,
    keys: func.keys ?? null,
    cors: func.cors ?? null,
    enabled: func.enabled,
  };
}

/**
 * Validate CORS configuration from API request body.
 * Returns validated CorsConfig or null if not provided.
 * Throws Error with descriptive message if invalid.
 */
function validateCorsConfig(cors: unknown): CorsConfig | undefined {
  if (cors === undefined || cors === null) {
    return undefined;
  }

  if (typeof cors !== "object" || Array.isArray(cors)) {
    throw new Error("cors must be an object");
  }

  const config = cors as Record<string, unknown>;

  // Validate origins (required when cors is provided)
  if (!Array.isArray(config.origins) || config.origins.length === 0) {
    throw new Error("cors.origins must be a non-empty array of strings");
  }
  for (const origin of config.origins) {
    if (typeof origin !== "string" || origin.length === 0) {
      throw new Error("cors.origins must contain only non-empty strings");
    }
    // Validate origin format (must be "*" or a valid URL)
    if (origin !== "*") {
      try {
        new URL(origin);
      } catch {
        throw new Error(`cors.origins contains invalid URL: ${origin}`);
      }
    }
  }

  // Validate credentials (optional boolean)
  if (config.credentials !== undefined && typeof config.credentials !== "boolean") {
    throw new Error("cors.credentials must be a boolean");
  }

  // credentials: true cannot be used with origin "*"
  if (config.credentials === true && config.origins.includes("*")) {
    throw new Error("cors.credentials cannot be true when origins includes '*'");
  }

  // Validate maxAge (optional positive integer)
  if (config.maxAge !== undefined) {
    if (typeof config.maxAge !== "number" || !Number.isInteger(config.maxAge) || config.maxAge < 0) {
      throw new Error("cors.maxAge must be a non-negative integer");
    }
  }

  // Validate allowHeaders (optional array of strings)
  if (config.allowHeaders !== undefined) {
    if (!Array.isArray(config.allowHeaders)) {
      throw new Error("cors.allowHeaders must be an array of strings");
    }
    for (const header of config.allowHeaders) {
      if (typeof header !== "string" || header.length === 0) {
        throw new Error("cors.allowHeaders must contain only non-empty strings");
      }
    }
  }

  // Validate exposeHeaders (optional array of strings)
  if (config.exposeHeaders !== undefined) {
    if (!Array.isArray(config.exposeHeaders)) {
      throw new Error("cors.exposeHeaders must be an array of strings");
    }
    for (const header of config.exposeHeaders) {
      if (typeof header !== "string" || header.length === 0) {
        throw new Error("cors.exposeHeaders must contain only non-empty strings");
      }
    }
  }

  return {
    origins: config.origins as string[],
    credentials: config.credentials as boolean | undefined,
    maxAge: config.maxAge as number | undefined,
    allowHeaders: config.allowHeaders as string[] | undefined,
    exposeHeaders: config.exposeHeaders as string[] | undefined,
  };
}

export function createFunctionsRoutes(service: FunctionsService): Hono {
  const routes = new Hono();

  // GET /api/functions - List all functions
  routes.get("/", async (c) => {
    const allFunctions = await service.getAll();
    return c.json({ functions: allFunctions.map(normalizeFunctionDef) });
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

    return c.json({ function: normalizeFunctionDef(func) });
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
      cors?: unknown;
    };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    // Validate required fields
    if (!body.name || !validateFunctionName(body.name)) {
      return c.json({ error: "Invalid or missing name" }, 400);
    }
    if (!body.handler || body.handler.trim() === "") {
      return c.json({ error: "Invalid or missing handler" }, 400);
    }
    if (!body.route || !validateFunctionPath(body.route)) {
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

    // Validate CORS config if provided
    let corsConfig: CorsConfig | undefined;
    try {
      corsConfig = validateCorsConfig(body.cors);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Invalid CORS config" }, 400);
    }

    const newFunction: NewFunctionDefinition = {
      name: body.name,
      handler: body.handler,
      routePath: body.route, // Map API 'route' to internal 'routePath'
      methods: body.methods,
      description: body.description,
      keys: body.keys,
      cors: corsConfig,
    };

    try {
      const created = await service.addFunction(newFunction);
      return c.json({ function: normalizeFunctionDef(created) }, 201);
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
      cors?: unknown;
    };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    // Validate required fields
    if (!body.name || !validateFunctionName(body.name)) {
      return c.json({ error: "Invalid or missing name" }, 400);
    }
    if (!body.handler || body.handler.trim() === "") {
      return c.json({ error: "Invalid or missing handler" }, 400);
    }
    if (!body.route || !validateFunctionPath(body.route)) {
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

    // Validate CORS config if provided
    let corsConfig: CorsConfig | undefined;
    try {
      corsConfig = validateCorsConfig(body.cors);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Invalid CORS config" }, 400);
    }

    const updatedFunction: NewFunctionDefinition = {
      name: body.name,
      handler: body.handler,
      routePath: body.route, // Map API 'route' to internal 'routePath'
      methods: body.methods,
      description: body.description,
      keys: body.keys,
      cors: corsConfig,
    };

    try {
      const updated = await service.updateFunction(id, updatedFunction);
      return c.json({ function: normalizeFunctionDef(updated) });
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

    await service.removeFunctionById(id);
    return c.body(null, 204);
  });

  // PUT /api/functions/:id/enable - Enable function (idempotent)
  routes.put("/:id/enable", async (c) => {
    const id = validateSurrealId(c.req.param("id"));
    if (id === null) {
      return c.json({ error: "Invalid function ID" }, 400);
    }

    try {
      const updated = await service.setFunctionEnabled(id, true);
      return c.json({ function: normalizeFunctionDef(updated) });
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
      const updated = await service.setFunctionEnabled(id, false);
      return c.json({ function: normalizeFunctionDef(updated) });
    } catch (error) {
      if (error instanceof Error && error.message.includes("not found")) {
        return c.json({ error: error.message }, 404);
      }
      throw error;
    }
  });

  return routes;
}
