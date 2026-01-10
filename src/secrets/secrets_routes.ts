import type { OpenAPIHono } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";
import { createOpenAPIApp } from "../openapi_app.ts";
import type { SecretsService } from "./secrets_service.ts";
import type { Secret, SecretRow } from "./types.ts";
import { SecretScope } from "./types.ts";
import {
  SecretsQuerySchema,
  GetSecretsResponseSchema,
  SecretsByNameQuerySchema,
  SecretNameParamSchema,
  GetSecretsByNameResponseSchema,
  SecretIdParamSchema,
  SecretSchema,
  CreateSecretRequestSchema,
  CreateSecretResponseSchema,
  UpdateSecretRequestSchema,
  UpdateSecretResponseSchema,
  DeleteSecretResponseSchema,
} from "../routes_schemas/secrets.ts";
import { ErrorResponseSchema } from "../schemas/responses.ts";

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

/**
 * GET /api/secrets/by-name/:name - Search secrets by name
 */
const getSecretsByNameRoute = createRoute({
  method: "get",
  path: "/by-name/{name}",
  tags: ["Secrets"],
  summary: "Search secrets by name",
  description:
    "Find all secrets with a specific name across all scopes or filtered by scope. " +
    "Multiple secrets can share the same name if they have different scopes.",
  request: {
    params: SecretNameParamSchema,
    query: SecretsByNameQuerySchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: GetSecretsByNameResponseSchema,
        },
      },
      description: "Secrets found",
    },
    400: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Invalid scope parameter",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "No secrets found with this name",
    },
  },
});

/**
 * GET /api/secrets - List all secrets with optional filtering
 */
const getSecretsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Secrets"],
  summary: "List secrets",
  description:
    "Retrieve all secrets with optional filtering by scope, function, group, or key. " +
    "Secret values are not included by default - set includeValues=true to decrypt and include them.",
  request: {
    query: SecretsQuerySchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: GetSecretsResponseSchema,
        },
      },
      description: "Secrets retrieved successfully",
    },
    400: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Invalid query parameters",
    },
  },
});

/**
 * GET /api/secrets/:id - Get secret by ID
 */
const getSecretRoute = createRoute({
  method: "get",
  path: "/{id}",
  tags: ["Secrets"],
  summary: "Get secret",
  description: "Retrieve a specific secret by ID, including its decrypted value.",
  request: {
    params: SecretIdParamSchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: SecretSchema,
        },
      },
      description: "Secret retrieved successfully",
    },
    400: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Invalid secret ID",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Secret not found",
    },
  },
});

/**
 * POST /api/secrets - Create a new secret
 */
const createSecretRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Secrets"],
  summary: "Create secret",
  description:
    "Create a new encrypted secret. Secrets can be scoped to global, function, group, or key level. " +
    "Scope-specific ID (functionId/groupId/keyId) is required based on the chosen scope.",
  request: {
    body: {
      content: {
        "application/json": {
          schema: CreateSecretRequestSchema,
        },
      },
    },
  },
  responses: {
    201: {
      content: {
        "application/json": {
          schema: CreateSecretResponseSchema,
        },
      },
      description: "Secret created successfully",
    },
    400: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Invalid input or foreign key constraint failed",
    },
    409: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Secret with this name already exists at this scope",
    },
  },
});

/**
 * PUT /api/secrets/:id - Update a secret
 */
const updateSecretRoute = createRoute({
  method: "put",
  path: "/{id}",
  tags: ["Secrets"],
  summary: "Update secret",
  description:
    "Update a secret's name, value, or comment. At least one field must be provided. " +
    "Cannot change the scope or scope ID.",
  request: {
    params: SecretIdParamSchema,
    body: {
      content: {
        "application/json": {
          schema: UpdateSecretRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: UpdateSecretResponseSchema,
        },
      },
      description: "Secret updated successfully",
    },
    400: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Invalid input",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Secret not found",
    },
    409: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Secret with this name already exists at this scope",
    },
  },
});

/**
 * DELETE /api/secrets/:id - Delete a secret
 */
const deleteSecretRoute = createRoute({
  method: "delete",
  path: "/{id}",
  tags: ["Secrets"],
  summary: "Delete secret",
  description: "Permanently delete a secret. This action cannot be undone.",
  request: {
    params: SecretIdParamSchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: DeleteSecretResponseSchema,
        },
      },
      description: "Secret deleted successfully",
    },
    400: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Invalid secret ID",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Secret not found",
    },
  },
});

export function createSecretsRoutes(service: SecretsService): OpenAPIHono {
  const routes = createOpenAPIApp();

  // GET /api/secrets/by-name/:name - Search secrets by name
  // Must be before /:id to avoid name being treated as ID
  routes.openapi(getSecretsByNameRoute, async (c) => {
    const { name } = c.req.valid("param");
    const { scope } = c.req.valid("query");

    const secrets = await service.getSecretsByName(name, scope);

    if (secrets.length === 0) {
      return c.json({ error: `No secrets found with name '${name}'` }, 404);
    }

    return c.json(
      {
        name,
        secrets: secrets.map(normalizeSecret) as unknown as Array<{
          id: number;
          name: string;
          comment: string | null;
          scope: "global" | "function" | "group" | "key";
          scopeId: number | null;
          createdAt: string;
          updatedAt: string;
          value?: string;
          decryptionError?: string | null;
        }>,
      },
      200
    );
  });

  // GET /api/secrets - List all secrets with optional filtering
  routes.openapi(getSecretsRoute, async (c) => {
    const { scope, functionId, groupId, keyId, includeValues } = c.req.valid(
      "query"
    );

    // Parse includeValues boolean
    const includeValuesBoolean = includeValues === "true";

    const secrets = await service.getAllSecrets({
      scope,
      functionId,
      groupId,
      keyId,
      includeValues: includeValuesBoolean,
    });

    return c.json(
      {
        secrets: secrets.map(normalizeSecret) as unknown as Array<{
          id: number;
          name: string;
          comment: string | null;
          scope: "global" | "function" | "group" | "key";
          scopeId: number | null;
          createdAt: string;
          updatedAt: string;
          value?: string;
          decryptionError?: string | null;
        }>,
      },
      200
    );
  });

  // GET /api/secrets/:id - Get secret by ID
  routes.openapi(getSecretRoute, async (c) => {
    const { id } = c.req.valid("param");

    const secret = await service.getSecretById(id);
    if (!secret) {
      return c.json({ error: "Secret not found" }, 404);
    }

    return c.json(
      normalizeSecret(secret) as unknown as {
        id: number;
        name: string;
        comment: string | null;
        scope: "global" | "function" | "group" | "key";
        scopeId: number | null;
        createdAt: string;
        updatedAt: string;
        value?: string;
        decryptionError?: string | null;
      },
      200
    );
  });

  // POST /api/secrets - Create a new secret
  routes.openapi(createSecretRoute, async (c) => {
    const body = c.req.valid("json");

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
  routes.openapi(updateSecretRoute, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    try {
      await service.updateSecretById(id, {
        name: body.name,
        value: body.value,
        comment: body.comment,
      });

      return c.json({ success: true }, 200);
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
  routes.openapi(deleteSecretRoute, async (c) => {
    const { id } = c.req.valid("param");

    try {
      await service.deleteSecretById(id);
      return c.json({ success: true }, 200);
    } catch (error) {
      if (error instanceof Error && error.message.includes("not found")) {
        return c.json({ error: error.message }, 404);
      }
      throw error;
    }
  });

  return routes;
}
