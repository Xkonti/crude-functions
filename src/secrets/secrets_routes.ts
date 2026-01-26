import { Hono } from "@hono/hono";
import type { SecretsService } from "./secrets_service.ts";
import type { Secret, SecretRow } from "./types.ts";
import { SecretScope } from "./types.ts";
import {
  validateSecretName,
  validateScope,
  validateSecretValue,
} from "../validation/secrets.ts";
import { validateId } from "../validation/common.ts";

/**
 * Convert numeric scope enum to string
 */
function scopeToString(scope: number): string {
  switch (scope) {
    case SecretScope.Global:
      return "global";
    case SecretScope.Function:
      return "function";
    case SecretScope.Group:
      return "group";
    case SecretScope.Key:
      return "key";
    default:
      return "unknown";
  }
}

/**
 * Get the scopeId from a secret (the parent entity ID)
 */
function getScopeId(secret: Secret | SecretRow): number | null {
  const row = secret as Record<string, unknown>;
  if (row.functionId !== null && row.functionId !== undefined) {
    return row.functionId as number;
  }
  if (row.apiGroupId !== null && row.apiGroupId !== undefined) {
    return row.apiGroupId as number;
  }
  if (row.apiKeyId !== null && row.apiKeyId !== undefined) {
    return row.apiKeyId as number;
  }
  return null;
}

/**
 * Normalize a secret for API response
 */
function normalizeSecret(
  secret: Secret | SecretRow
): Record<string, unknown> {
  const row = secret as Record<string, unknown>;
  const scope = typeof row.scope === "number" ? row.scope : 0;
  const normalized: Record<string, unknown> = {
    id: secret.id,
    name: secret.name,
    comment: secret.comment,
    scope: scopeToString(scope),
    scopeId: getScopeId(secret),
    createdAt: secret.createdAt,
    updatedAt: secret.updatedAt,
  };

  // Include value and decryptionError if present (Secret type)
  if ("value" in secret) {
    normalized.value = (secret as Secret).value;
    normalized.decryptionError = (secret as Secret).decryptionError ?? null;
  }

  return normalized;
}

export function createSecretsRoutes(service: SecretsService): Hono {
  const routes = new Hono();

  // GET /api/secrets/by-name/:name - Search secrets by name
  // Must be before /:id to avoid name being treated as ID
  routes.get("/by-name/:name", async (c) => {
    const name = c.req.param("name");
    const scope = c.req.query("scope");

    // Validate scope if provided
    if (scope && !validateScope(scope)) {
      return c.json(
        { error: `Invalid scope '${scope}'. Must be one of: global, function, group, key` },
        400
      );
    }

    const secrets = await service.getSecretsByName(name, scope);

    if (secrets.length === 0) {
      return c.json({ error: `No secrets found with name '${name}'` }, 404);
    }

    return c.json({
      name,
      secrets: secrets.map(normalizeSecret),
    });
  });

  // GET /api/secrets - List all secrets with optional filtering
  routes.get("/", async (c) => {
    const scope = c.req.query("scope");
    const functionIdStr = c.req.query("functionId");
    const groupIdStr = c.req.query("groupId");
    const keyIdStr = c.req.query("keyId");
    const includeValuesStr = c.req.query("includeValues");

    // Validate scope
    if (scope && !validateScope(scope)) {
      return c.json(
        { error: `Invalid scope '${scope}'. Must be one of: global, function, group, key` },
        400
      );
    }

    // Parse numeric IDs
    let functionId: number | undefined;
    let groupId: number | undefined;
    let keyId: number | undefined;

    if (functionIdStr) {
      const parsed = validateId(functionIdStr);
      if (parsed === null) {
        return c.json({ error: "Invalid functionId" }, 400);
      }
      functionId = parsed;
    }

    if (groupIdStr) {
      const parsed = validateId(groupIdStr);
      if (parsed === null) {
        return c.json({ error: "Invalid groupId" }, 400);
      }
      groupId = parsed;
    }

    if (keyIdStr) {
      const parsed = validateId(keyIdStr);
      if (parsed === null) {
        return c.json({ error: "Invalid keyId" }, 400);
      }
      keyId = parsed;
    }

    // Parse includeValues boolean
    const includeValues = includeValuesStr === "true";

    const secrets = await service.getAllSecrets({
      scope,
      functionId,
      groupId,
      keyId,
      includeValues,
    });

    return c.json({
      secrets: secrets.map(normalizeSecret),
    });
  });

  // GET /api/secrets/:id - Get secret by ID
  routes.get("/:id", async (c) => {
    const id = validateId(c.req.param("id"));
    if (id === null) {
      return c.json({ error: "Invalid secret ID" }, 400);
    }

    const secret = await service.getSecretById(id);
    if (!secret) {
      return c.json({ error: "Secret not found" }, 404);
    }

    return c.json(normalizeSecret(secret));
  });

  // POST /api/secrets - Create a new secret
  routes.post("/", async (c) => {
    let body: {
      name?: string;
      value?: string;
      comment?: string;
      scope?: string;
      functionId?: number;
      groupId?: string;
      keyId?: string;
    };

    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    // Validate required fields
    if (!body.name) {
      return c.json({ error: "Missing required field: name" }, 400);
    }

    if (!validateSecretName(body.name)) {
      return c.json(
        { error: "Invalid secret name. Must match pattern [a-zA-Z0-9_-]+" },
        400
      );
    }

    if (!body.value) {
      return c.json({ error: "Missing required field: value" }, 400);
    }

    if (!validateSecretValue(body.value)) {
      return c.json({ error: "Secret value cannot be empty" }, 400);
    }

    if (!body.scope) {
      return c.json({ error: "Missing required field: scope" }, 400);
    }

    if (!validateScope(body.scope)) {
      return c.json(
        { error: `Invalid scope '${body.scope}'. Must be one of: global, function, group, key` },
        400
      );
    }

    // Validate scope-specific requirements
    if (body.scope === "function" && body.functionId === undefined) {
      return c.json(
        { error: "functionId is required for function-scoped secrets" },
        400
      );
    }

    if (body.scope === "group" && body.groupId === undefined) {
      return c.json(
        { error: "groupId is required for group-scoped secrets" },
        400
      );
    }

    if (body.scope === "key" && body.keyId === undefined) {
      return c.json(
        { error: "keyId is required for key-scoped secrets" },
        400
      );
    }

    try {
      const id = await service.createSecret({
        name: body.name,
        value: body.value,
        comment: body.comment,
        scope: body.scope,
        functionId: body.functionId,
        groupId: body.groupId,
        keyId: body.keyId,
      });

      return c.json(
        {
          id,
          name: body.name,
          scope: body.scope,
        },
        201
      );
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes("already exists")) {
          return c.json({ error: error.message }, 409);
        }
        if (
          error.message.includes("FOREIGN KEY") ||
          error.message.includes("not found")
        ) {
          return c.json({ error: error.message }, 400);
        }
      }
      throw error;
    }
  });

  // PUT /api/secrets/:id - Update a secret
  routes.put("/:id", async (c) => {
    const id = validateId(c.req.param("id"));
    if (id === null) {
      return c.json({ error: "Invalid secret ID" }, 400);
    }

    let body: {
      name?: string;
      value?: string;
      comment?: string;
    };

    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    // Require at least one field
    if (
      body.name === undefined &&
      body.value === undefined &&
      body.comment === undefined
    ) {
      return c.json(
        { error: "At least one field (name, value, or comment) must be provided" },
        400
      );
    }

    // Validate name if provided
    if (body.name !== undefined && !validateSecretName(body.name)) {
      return c.json(
        { error: "Invalid secret name. Must match pattern [a-zA-Z0-9_-]+" },
        400
      );
    }

    // Validate value if provided
    if (body.value !== undefined && !validateSecretValue(body.value)) {
      return c.json({ error: "Secret value cannot be empty" }, 400);
    }

    try {
      await service.updateSecretById(id, {
        name: body.name,
        value: body.value,
        comment: body.comment,
      });

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

  // DELETE /api/secrets/:id - Delete a secret
  routes.delete("/:id", async (c) => {
    const id = validateId(c.req.param("id"));
    if (id === null) {
      return c.json({ error: "Invalid secret ID" }, 400);
    }

    try {
      await service.deleteSecretById(id);
      return c.json({ success: true });
    } catch (error) {
      if (error instanceof Error && error.message.includes("not found")) {
        return c.json({ error: error.message }, 404);
      }
      throw error;
    }
  });

  return routes;
}
