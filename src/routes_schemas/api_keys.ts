import { z } from "zod";
import { IdSchema } from "../schemas/common.ts";

/**
 * API Key Group schemas
 */

export const ApiKeyGroupSchema = z.object({
  id: IdSchema,
  name: z.string().openapi({
    example: "production",
    description: "Unique group name (lowercase alphanumeric with dashes/underscores)",
  }),
  description: z.string().nullable().openapi({
    example: "Production environment keys",
    description: "Optional description of the key group",
  }),
}).openapi("ApiKeyGroup");

/**
 * Request body for POST /api/key-groups - Create group
 */
export const CreateGroupRequestSchema = z.object({
  name: z.string().regex(/^[a-z0-9_-]+$/).openapi({
    example: "production",
    description: "Group name (lowercase alphanumeric with dashes/underscores)",
  }),
  description: z.string().optional().openapi({
    example: "Production environment keys",
    description: "Optional description of the key group",
  }),
}).openapi("CreateGroupRequest");

/**
 * Response schema for POST /api/key-groups
 */
export const CreateGroupResponseSchema = z.object({
  id: IdSchema,
  name: z.string().openapi({
    example: "production",
    description: "Created group name",
  }),
}).openapi("CreateGroupResponse");

/**
 * Response schema for GET /api/key-groups
 */
export const GetGroupsResponseSchema = z.object({
  groups: z.array(ApiKeyGroupSchema).openapi({
    description: "Array of all key groups",
  }),
}).openapi("GetGroupsResponse");

/**
 * Path parameter for group ID
 */
export const GroupIdParamSchema = z.object({
  groupId: IdSchema.openapi({
    param: {
      name: "groupId",
      in: "path",
    },
    description: "API Key Group ID",
  }),
});

/**
 * Request body for PUT /api/key-groups/:groupId - Update group
 */
export const UpdateGroupRequestSchema = z.object({
  description: z.string().optional().openapi({
    example: "Updated production keys description",
    description: "New description for the group",
  }),
}).openapi("UpdateGroupRequest");

/**
 * Response schema for PUT /api/key-groups/:groupId
 */
export const UpdateGroupResponseSchema = z.object({
  success: z.boolean().openapi({
    example: true,
  }),
}).openapi("UpdateGroupResponse");

/**
 * Response schema for DELETE /api/key-groups/:groupId
 */
export const DeleteGroupResponseSchema = z.object({
  success: z.boolean().openapi({
    example: true,
  }),
}).openapi("DeleteGroupResponse");

/**
 * API Key schemas
 */

export const ApiKeySchema = z.object({
  id: IdSchema,
  groupId: IdSchema.openapi({
    example: 1,
    description: "ID of the group this key belongs to",
  }),
  name: z.string().openapi({
    example: "deploy-key",
    description: "Unique key name within group (lowercase alphanumeric with dashes/underscores)",
  }),
  value: z.string().openapi({
    example: "MTIzNDU2Nzg5MGFiY2RlZmdoaWprbG1ub3A",
    description: "The actual API key value",
  }),
  description: z.string().nullable().openapi({
    example: "Deployment automation key",
    description: "Optional description of the key",
  }),
}).openapi("ApiKey");

/**
 * Query parameters for GET /api/keys
 */
export const GetKeysQuerySchema = z.object({
  groupId: z.coerce.number().int().positive().optional().openapi({
    example: 1,
    description: "Optional filter by group ID",
  }),
});

/**
 * Response schema for GET /api/keys
 */
export const GetKeysResponseSchema = z.object({
  keys: z.array(ApiKeySchema).openapi({
    description: "Array of API keys (optionally filtered by group)",
  }),
}).openapi("GetKeysResponse");

/**
 * Request body for POST /api/keys - Create key
 */
export const CreateKeyRequestSchema = z.object({
  groupId: z.number().int().positive().openapi({
    example: 1,
    description: "ID of the group this key will belong to",
  }),
  name: z.string().regex(/^[a-z0-9_-]+$/).openapi({
    example: "deploy-key",
    description: "Key name (lowercase alphanumeric with dashes/underscores)",
  }),
  value: z.string().regex(/^[a-zA-Z0-9_-]+$/).optional().openapi({
    example: "MTIzNDU2Nzg5MGFiY2RlZmdoaWprbG1ub3A",
    description: "Optional key value (auto-generated if not provided)",
  }),
  description: z.string().optional().openapi({
    example: "Deployment automation key",
    description: "Optional description of the key",
  }),
}).openapi("CreateKeyRequest");

/**
 * Response schema for POST /api/keys
 */
export const CreateKeyResponseSchema = z.object({
  id: IdSchema,
  name: z.string().openapi({
    example: "deploy-key",
    description: "Created key name",
  }),
  value: z.string().openapi({
    example: "MTIzNDU2Nzg5MGFiY2RlZmdoaWprbG1ub3A",
    description: "The API key value (important if auto-generated)",
  }),
}).openapi("CreateKeyResponse");

/**
 * Path parameter for key ID
 */
export const KeyIdParamSchema = z.object({
  keyId: IdSchema.openapi({
    param: {
      name: "keyId",
      in: "path",
    },
    description: "API Key ID",
  }),
});

/**
 * Response schema for GET /api/keys/:keyId
 */
export const GetKeyResponseSchema = z.object({
  key: ApiKeySchema,
  group: ApiKeyGroupSchema,
}).openapi("GetKeyResponse");

/**
 * Request body for PUT /api/keys/:keyId - Update key
 */
export const UpdateKeyRequestSchema = z.object({
  name: z.string().regex(/^[a-z0-9_-]+$/).optional().openapi({
    example: "new-deploy-key",
    description: "New key name (lowercase alphanumeric with dashes/underscores)",
  }),
  value: z.string().regex(/^[a-zA-Z0-9_-]+$/).optional().openapi({
    example: "bmV3S2V5VmFsdWUxMjM0NTY3ODkw",
    description: "New key value",
  }),
  description: z.string().optional().openapi({
    example: "Updated deployment key description",
    description: "New description for the key",
  }),
}).refine(
  (data) => data.name !== undefined || data.value !== undefined || data.description !== undefined,
  {
    message: "At least one field (name, value, or description) must be provided",
  }
).openapi("UpdateKeyRequest");

/**
 * Response schema for PUT /api/keys/:keyId
 */
export const UpdateKeyResponseSchema = z.object({
  success: z.boolean().openapi({
    example: true,
  }),
}).openapi("UpdateKeyResponse");

/**
 * Response schema for DELETE /api/keys/:keyId
 */
export const DeleteKeyResponseSchema = z.object({
  success: z.boolean().openapi({
    example: true,
  }),
}).openapi("DeleteKeyResponse");
