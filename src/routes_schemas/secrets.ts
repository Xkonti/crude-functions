import { z } from "zod";
import { IdSchema } from "../schemas/common.ts";

/**
 * Secret scope enum
 */
export const SecretScopeSchema = z.enum(["global", "function", "group", "key"]).openapi({
  example: "global",
  description: "Scope of the secret (global, function, group, or key)",
});

/**
 * Secret data returned from API
 */
export const SecretSchema = z.object({
  id: IdSchema,
  name: z.string().openapi({
    example: "DATABASE_URL",
    description: "Secret name (alphanumeric, underscore, hyphen)",
  }),
  comment: z.string().nullable().openapi({
    example: "Production database connection string",
    description: "Optional comment describing the secret",
  }),
  scope: SecretScopeSchema,
  scopeId: z.number().int().nullable().openapi({
    example: 123,
    description: "ID of the parent entity (function, group, or key) if scoped",
  }),
  value: z.string().optional().openapi({
    example: "postgres://user:pass@host:5432/db",
    description: "Decrypted secret value (only included when requested)",
  }),
  decryptionError: z.string().nullable().optional().openapi({
    example: null,
    description: "Error message if secret decryption failed",
  }),
  createdAt: z.string().datetime().openapi({
    example: "2026-01-10T12:34:56.789Z",
    description: "When the secret was created",
  }),
  updatedAt: z.string().datetime().openapi({
    example: "2026-01-10T12:34:56.789Z",
    description: "When the secret was last updated",
  }),
}).openapi("Secret");

/**
 * Query parameters for GET /api/secrets - List secrets
 */
export const SecretsQuerySchema = z.object({
  scope: SecretScopeSchema.optional().openapi({
    description: "Filter by scope",
  }),
  functionId: z.coerce.number().int().positive().optional().openapi({
    example: 123,
    description: "Filter by function ID (for function-scoped secrets)",
  }),
  groupId: z.coerce.number().int().positive().optional().openapi({
    example: 456,
    description: "Filter by API key group ID (for group-scoped secrets)",
  }),
  keyId: z.coerce.number().int().positive().optional().openapi({
    example: 789,
    description: "Filter by API key ID (for key-scoped secrets)",
  }),
  includeValues: z.enum(["true", "false"]).optional().openapi({
    example: "false",
    description: "Whether to include decrypted secret values (default: false)",
  }),
});

/**
 * Response schema for GET /api/secrets
 */
export const GetSecretsResponseSchema = z.object({
  secrets: z.array(SecretSchema).openapi({
    description: "Array of secrets matching the filter criteria",
  }),
}).openapi("GetSecretsResponse");

/**
 * Query parameters for GET /api/secrets/by-name/:name
 */
export const SecretsByNameQuerySchema = z.object({
  scope: SecretScopeSchema.optional().openapi({
    description: "Filter by scope",
  }),
});

/**
 * Path parameter for secret name lookup
 */
export const SecretNameParamSchema = z.object({
  name: z.string().openapi({
    param: {
      name: "name",
      in: "path",
    },
    example: "DATABASE_URL",
    description: "Secret name to search for",
  }),
});

/**
 * Response schema for GET /api/secrets/by-name/:name
 */
export const GetSecretsByNameResponseSchema = z.object({
  name: z.string().openapi({
    example: "DATABASE_URL",
    description: "The secret name that was searched for",
  }),
  secrets: z.array(SecretSchema).openapi({
    description: "Array of secrets with this name (may have different scopes)",
  }),
}).openapi("GetSecretsByNameResponse");

/**
 * Path parameter for secret ID
 */
export const SecretIdParamSchema = z.object({
  id: IdSchema.openapi({
    param: {
      name: "id",
      in: "path",
    },
    description: "Secret ID",
  }),
});

/**
 * Request body for POST /api/secrets - Create secret
 */
export const CreateSecretRequestSchema = z.object({
  name: z.string().regex(/^[a-zA-Z0-9_-]+$/).openapi({
    example: "DATABASE_URL",
    description: "Secret name (alphanumeric, underscore, hyphen only)",
  }),
  value: z.string().min(1).openapi({
    example: "postgres://user:pass@host:5432/db",
    description: "Secret value (will be encrypted)",
  }),
  comment: z.string().optional().openapi({
    example: "Production database connection string",
    description: "Optional comment describing the secret",
  }),
  scope: SecretScopeSchema,
  functionId: z.number().int().positive().optional().openapi({
    example: 123,
    description: "Required for function-scoped secrets",
  }),
  groupId: z.number().int().positive().optional().openapi({
    example: 456,
    description: "Required for group-scoped secrets",
  }),
  keyId: z.number().int().positive().optional().openapi({
    example: 789,
    description: "Required for key-scoped secrets",
  }),
}).refine(
  (data) => {
    if (data.scope === "function") return data.functionId !== undefined;
    if (data.scope === "group") return data.groupId !== undefined;
    if (data.scope === "key") return data.keyId !== undefined;
    return true;
  },
  {
    message: "Scope-specific ID is required (functionId/groupId/keyId)",
    path: ["scope"],
  }
).openapi("CreateSecretRequest");

/**
 * Response schema for POST /api/secrets
 */
export const CreateSecretResponseSchema = z.object({
  id: IdSchema,
  name: z.string().openapi({
    example: "DATABASE_URL",
    description: "Created secret name",
  }),
  scope: SecretScopeSchema,
}).openapi("CreateSecretResponse");

/**
 * Request body for PUT /api/secrets/:id - Update secret
 */
export const UpdateSecretRequestSchema = z.object({
  name: z.string().regex(/^[a-zA-Z0-9_-]+$/).optional().openapi({
    example: "DATABASE_URL_NEW",
    description: "New secret name (alphanumeric, underscore, hyphen only)",
  }),
  value: z.string().min(1).optional().openapi({
    example: "postgres://user:pass@newhost:5432/db",
    description: "New secret value (will be encrypted)",
  }),
  comment: z.string().optional().openapi({
    example: "Updated production database connection string",
    description: "New comment for the secret",
  }),
}).refine(
  (data) => data.name !== undefined || data.value !== undefined || data.comment !== undefined,
  {
    message: "At least one field (name, value, or comment) must be provided",
  }
).openapi("UpdateSecretRequest");

/**
 * Response schema for PUT /api/secrets/:id
 */
export const UpdateSecretResponseSchema = z.object({
  success: z.boolean().openapi({
    example: true,
  }),
}).openapi("UpdateSecretResponse");

/**
 * Response schema for DELETE /api/secrets/:id
 */
export const DeleteSecretResponseSchema = z.object({
  success: z.boolean().openapi({
    example: true,
  }),
}).openapi("DeleteSecretResponse");
