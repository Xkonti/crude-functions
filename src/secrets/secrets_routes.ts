import { Hono } from "@hono/hono";
import type { SecretsService } from "./secrets_service.ts";
import type { Secret, SecretScopeType } from "./types.ts";
import {
  validateSecretName,
  validateScope,
  validateSecretValue,
} from "../validation/secrets.ts";
import { recordIdToString } from "../database/surreal_helpers.ts";

/**
 * Normalize a secret for API response.
 * Converts RecordId to string at the API boundary.
 * @param secret - The secret to normalize
 * @param includeValue - Whether to include the secret value (default: true)
 */
function normalizeSecret(secret: Secret, includeValue = true): Record<string, unknown> {
  const result: Record<string, unknown> = {
    id: recordIdToString(secret.id),
    name: secret.name,
    comment: secret.comment,
    scopeType: secret.scopeType,
    scopeRef: secret.scopeRef ? recordIdToString(secret.scopeRef) : null,
    createdAt: secret.createdAt,
    updatedAt: secret.updatedAt,
  };

  if (includeValue) {
    result.value = secret.value;
    result.decryptionError = secret.decryptionError ?? null;
  }

  return result;
}

export function createSecretsRoutes(service: SecretsService): Hono {
  const routes = new Hono();

  // GET /api/secrets/by-name/:name - Search secrets by name
  // Must be before /:id to avoid name being treated as ID
  routes.get("/by-name/:name", async (c) => {
    const name = c.req.param("name");
    const scope = c.req.query("scope") as SecretScopeType | undefined;

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
      secrets: secrets.map(s => normalizeSecret(s)),
    });
  });

  // GET /api/secrets - List all secrets with optional filtering
  routes.get("/", async (c) => {
    const scope = c.req.query("scope") as SecretScopeType | undefined;
    const functionIdStr = c.req.query("functionId");
    const groupIdStr = c.req.query("groupId");
    const keyIdStr = c.req.query("keyId");
    const includeValues = c.req.query("includeValues") === "true";

    // Validate scope
    if (scope && !validateScope(scope)) {
      return c.json(
        { error: `Invalid scope '${scope}'. Must be one of: global, function, group, key` },
        400
      );
    }

    // Parse IDs
    let functionId: number | undefined;
    let groupId: string | undefined;
    let keyId: string | undefined;

    if (functionIdStr) {
      const parsed = parseInt(functionIdStr, 10);
      if (isNaN(parsed)) {
        return c.json({ error: "Invalid functionId" }, 400);
      }
      functionId = parsed;
    }

    // groupId and keyId are now strings (SurrealDB IDs)
    if (groupIdStr) {
      groupId = groupIdStr;
    }

    if (keyIdStr) {
      keyId = keyIdStr;
    }

    const secrets = await service.getAllSecrets({
      scopeType: scope,
      functionId,
      groupId,
      keyId,
    });

    return c.json({
      secrets: secrets.map(s => normalizeSecret(s, includeValues)),
    });
  });

  // GET /api/secrets/:id - Get secret by ID
  routes.get("/:id", async (c) => {
    const id = c.req.param("id");
    if (!id || id.trim() === "") {
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
      scopeType?: string;
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

    if (!body.scopeType) {
      return c.json({ error: "Missing required field: scopeType" }, 400);
    }

    if (!validateScope(body.scopeType)) {
      return c.json(
        { error: `Invalid scopeType '${body.scopeType}'. Must be one of: global, function, group, key` },
        400
      );
    }

    // Validate scope-specific requirements
    if (body.scopeType === "function" && body.functionId === undefined) {
      return c.json(
        { error: "functionId is required for function-scoped secrets" },
        400
      );
    }

    if (body.scopeType === "group" && body.groupId === undefined) {
      return c.json(
        { error: "groupId is required for group-scoped secrets" },
        400
      );
    }

    if (body.scopeType === "key" && body.keyId === undefined) {
      return c.json(
        { error: "keyId is required for key-scoped secrets" },
        400
      );
    }

    try {
      const recordId = await service.createSecret({
        name: body.name,
        value: body.value,
        comment: body.comment,
        scopeType: body.scopeType as SecretScopeType,
        functionId: body.functionId,
        groupId: body.groupId,
        keyId: body.keyId,
      });

      return c.json(
        {
          id: recordIdToString(recordId),
          name: body.name,
          scopeType: body.scopeType,
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
    const id = c.req.param("id");
    if (!id || id.trim() === "") {
      return c.json({ error: "Invalid secret ID" }, 400);
    }

    let body: {
      value?: string;
      comment?: string;
    };

    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    // Require at least one field
    if (body.value === undefined && body.comment === undefined) {
      return c.json(
        { error: "At least one field (value or comment) must be provided" },
        400
      );
    }

    // Validate value if provided
    if (body.value !== undefined && !validateSecretValue(body.value)) {
      return c.json({ error: "Secret value cannot be empty" }, 400);
    }

    try {
      await service.updateSecretById(id, {
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
    const id = c.req.param("id");
    if (!id || id.trim() === "") {
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
