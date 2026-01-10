import type { OpenAPIHono } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";
import { createOpenAPIApp } from "../openapi_app.ts";
import { ApiKeyService } from "./api_key_service.ts";
import {
  ApiKeyGroupSchema,
  CreateGroupRequestSchema,
  CreateGroupResponseSchema,
  GetGroupsResponseSchema,
  GroupIdParamSchema,
  UpdateGroupRequestSchema,
  UpdateGroupResponseSchema,
  DeleteGroupResponseSchema,
  ApiKeySchema,
  GetKeysQuerySchema,
  GetKeysResponseSchema,
  CreateKeyRequestSchema,
  CreateKeyResponseSchema,
  KeyIdParamSchema,
  GetKeyResponseSchema,
  UpdateKeyRequestSchema,
  UpdateKeyResponseSchema,
  DeleteKeyResponseSchema,
} from "../routes_schemas/api_keys.ts";
import { ErrorResponseSchema } from "../schemas/responses.ts";

/**
 * Generate a URL-safe base64-encoded UUID for API keys.
 */
function generateApiKey(): string {
  const uuid = crypto.randomUUID().replace(/-/g, "");
  return btoa(uuid).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/**
 * GET /api/key-groups - List all groups
 */
const getGroupsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["API Keys"],
  summary: "List key groups",
  description: "Retrieve all API key groups in the system.",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: GetGroupsResponseSchema,
        },
      },
      description: "Groups retrieved successfully",
    },
  },
});

/**
 * POST /api/key-groups - Create new group
 */
const createGroupRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["API Keys"],
  summary: "Create key group",
  description: "Create a new API key group with a unique name.",
  request: {
    body: {
      content: {
        "application/json": {
          schema: CreateGroupRequestSchema,
        },
      },
    },
  },
  responses: {
    201: {
      content: {
        "application/json": {
          schema: CreateGroupResponseSchema,
        },
      },
      description: "Group created successfully",
    },
    400: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Invalid input",
    },
    409: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Group with this name already exists",
    },
  },
});

/**
 * GET /api/key-groups/:groupId - Get group by ID
 */
const getGroupRoute = createRoute({
  method: "get",
  path: "/{groupId}",
  tags: ["API Keys"],
  summary: "Get key group",
  description: "Retrieve a specific API key group by ID.",
  request: {
    params: GroupIdParamSchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: ApiKeyGroupSchema,
        },
      },
      description: "Group retrieved successfully",
    },
    400: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Invalid group ID",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Group not found",
    },
  },
});

/**
 * PUT /api/key-groups/:groupId - Update group
 */
const updateGroupRoute = createRoute({
  method: "put",
  path: "/{groupId}",
  tags: ["API Keys"],
  summary: "Update key group",
  description: "Update an API key group's description.",
  request: {
    params: GroupIdParamSchema,
    body: {
      content: {
        "application/json": {
          schema: UpdateGroupRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: UpdateGroupResponseSchema,
        },
      },
      description: "Group updated successfully",
    },
    400: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Invalid group ID",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Group not found",
    },
  },
});

/**
 * DELETE /api/key-groups/:groupId - Delete group
 */
const deleteGroupRoute = createRoute({
  method: "delete",
  path: "/{groupId}",
  tags: ["API Keys"],
  summary: "Delete key group",
  description: "Delete an API key group. Group must be empty and cannot be the management group.",
  request: {
    params: GroupIdParamSchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: DeleteGroupResponseSchema,
        },
      },
      description: "Group deleted successfully",
    },
    400: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Invalid group ID",
    },
    403: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Cannot delete management group",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Group not found",
    },
    409: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Cannot delete group with existing keys",
    },
  },
});

/**
 * Create routes for API key group management.
 * Mounted at /api/key-groups
 */
export function createApiKeyGroupRoutes(service: ApiKeyService): OpenAPIHono {
  const routes = createOpenAPIApp();

  // GET /api/key-groups - List all groups
  routes.openapi(getGroupsRoute, async (c) => {
    const groupsRaw = await service.getGroups();
    // Map to API schema format
    const groups = groupsRaw.map((g) => ({
      id: g.id,
      name: g.name,
      description: g.description ?? null,
    }));
    return c.json({ groups }, 200);
  });

  // POST /api/key-groups - Create a new group
  routes.openapi(createGroupRoute, async (c) => {
    const body = c.req.valid("json");

    const name = body.name.toLowerCase();

    // Check if group already exists
    const existing = await service.getGroupByName(name);
    if (existing) {
      return c.json({ error: `Group '${name}' already exists` }, 409);
    }

    const id = await service.createGroup(name, body.description);
    return c.json({ id, name }, 201);
  });

  // GET /api/key-groups/:groupId - Get a group by ID
  routes.openapi(getGroupRoute, async (c) => {
    const { groupId } = c.req.valid("param");

    const group = await service.getGroupById(groupId);
    if (!group) {
      return c.json({ error: "Group not found" }, 404);
    }

    // Map to API schema format
    return c.json({
      id: group.id,
      name: group.name,
      description: group.description ?? null,
    }, 200);
  });

  // PUT /api/key-groups/:groupId - Update a group
  routes.openapi(updateGroupRoute, async (c) => {
    const { groupId } = c.req.valid("param");
    const body = c.req.valid("json");

    const group = await service.getGroupById(groupId);
    if (!group) {
      return c.json({ error: "Group not found" }, 404);
    }

    await service.updateGroup(groupId, body.description ?? "");
    return c.json({ success: true }, 200);
  });

  // DELETE /api/key-groups/:groupId - Delete a group (must be empty)
  routes.openapi(deleteGroupRoute, async (c) => {
    const { groupId } = c.req.valid("param");

    const group = await service.getGroupById(groupId);
    if (!group) {
      return c.json({ error: "Group not found" }, 404);
    }

    // Prevent deleting management group
    if (group.name === "management") {
      return c.json({ error: "Cannot delete management group" }, 403);
    }

    // Check if group has keys
    const keyCount = await service.getKeyCountForGroup(groupId);
    if (keyCount > 0) {
      return c.json({
        error: `Cannot delete group with ${keyCount} existing key(s). Delete keys first.`
      }, 409);
    }

    await service.deleteGroup(groupId);
    return c.json({ success: true }, 200);
  });

  return routes;
}

/**
 * GET /api/keys - List all keys
 */
const getKeysRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["API Keys"],
  summary: "List API keys",
  description: "Retrieve all API keys, optionally filtered by group ID.",
  request: {
    query: GetKeysQuerySchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: GetKeysResponseSchema,
        },
      },
      description: "Keys retrieved successfully",
    },
    400: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Invalid groupId parameter",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Group not found",
    },
  },
});

/**
 * POST /api/keys - Create new key
 */
const createKeyRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["API Keys"],
  summary: "Create API key",
  description: "Create a new API key in a group. Key value is auto-generated if not provided.",
  request: {
    body: {
      content: {
        "application/json": {
          schema: CreateKeyRequestSchema,
        },
      },
    },
  },
  responses: {
    201: {
      content: {
        "application/json": {
          schema: CreateKeyResponseSchema,
        },
      },
      description: "Key created successfully",
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
      description: "Group not found",
    },
    409: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Key with this name already exists in group",
    },
  },
});

/**
 * GET /api/keys/:keyId - Get key by ID
 */
const getKeyRoute = createRoute({
  method: "get",
  path: "/{keyId}",
  tags: ["API Keys"],
  summary: "Get API key",
  description: "Retrieve a specific API key by ID along with its group information.",
  request: {
    params: KeyIdParamSchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: GetKeyResponseSchema,
        },
      },
      description: "Key retrieved successfully",
    },
    400: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Invalid key ID",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Key not found",
    },
  },
});

/**
 * PUT /api/keys/:keyId - Update key
 */
const updateKeyRoute = createRoute({
  method: "put",
  path: "/{keyId}",
  tags: ["API Keys"],
  summary: "Update API key",
  description: "Update an API key's name, value, or description.",
  request: {
    params: KeyIdParamSchema,
    body: {
      content: {
        "application/json": {
          schema: UpdateKeyRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: UpdateKeyResponseSchema,
        },
      },
      description: "Key updated successfully",
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
      description: "Key not found",
    },
    409: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Key with this name already exists in group",
    },
  },
});

/**
 * DELETE /api/keys/:keyId - Delete key
 */
const deleteKeyRoute = createRoute({
  method: "delete",
  path: "/{keyId}",
  tags: ["API Keys"],
  summary: "Delete API key",
  description: "Permanently delete an API key. This action cannot be undone.",
  request: {
    params: KeyIdParamSchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: DeleteKeyResponseSchema,
        },
      },
      description: "Key deleted successfully",
    },
    400: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Invalid key ID",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Key not found",
    },
  },
});

/**
 * Create routes for API key management.
 * Mounted at /api/keys
 */
export function createApiKeyRoutes(service: ApiKeyService): OpenAPIHono {
  const routes = createOpenAPIApp();

  // GET /api/keys - List all keys (optional ?groupId= filter)
  routes.openapi(getKeysRoute, async (c) => {
    const { groupId } = c.req.valid("query");

    if (groupId !== undefined) {
      // Verify group exists
      const group = await service.getGroupById(groupId);
      if (!group) {
        return c.json({ error: "Group not found" }, 404);
      }
    }

    const keysRaw = await service.getAllKeys(groupId);
    // Map to API schema format (remove groupName, map description)
    const keys = keysRaw.map((k) => ({
      id: k.id,
      groupId: k.groupId,
      name: k.name,
      value: k.value,
      description: k.description ?? null,
    }));
    return c.json({ keys }, 200);
  });

  // POST /api/keys - Create a new key
  routes.openapi(createKeyRoute, async (c) => {
    const body = c.req.valid("json");

    // Verify group exists
    const group = await service.getGroupById(body.groupId);
    if (!group) {
      return c.json({ error: "Group not found" }, 404);
    }

    // Normalize name
    const name = body.name.trim().toLowerCase();

    // Auto-generate value if not provided
    const value = body.value ?? generateApiKey();

    try {
      const keyId = await service.addKeyToGroup(body.groupId, name, value, body.description);
      // Return the key value (important when auto-generated)
      return c.json({ id: keyId, name, value }, 201);
    } catch (error) {
      if (error instanceof Error && error.message.includes("already exists")) {
        return c.json({ error: error.message }, 409);
      }
      throw error;
    }
  });

  // GET /api/keys/:keyId - Get a key by ID
  routes.openapi(getKeyRoute, async (c) => {
    const { keyId } = c.req.valid("param");

    const result = await service.getById(keyId);
    if (!result) {
      return c.json({ error: "Key not found" }, 404);
    }

    // Map to API schema format
    return c.json({
      key: {
        id: result.key.id,
        groupId: result.group.id,
        name: result.key.name,
        value: result.key.value,
        description: result.key.description ?? null,
      },
      group: {
        id: result.group.id,
        name: result.group.name,
        description: result.group.description ?? null,
      },
    }, 200);
  });

  // PUT /api/keys/:keyId - Update a key
  routes.openapi(updateKeyRoute, async (c) => {
    const { keyId } = c.req.valid("param");
    const body = c.req.valid("json");

    // Normalize name if provided
    const normalizedBody = {
      ...body,
      name: body.name !== undefined ? body.name.trim().toLowerCase() : undefined,
    };

    try {
      await service.updateKey(keyId, normalizedBody);
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

  // DELETE /api/keys/:keyId - Delete a key
  routes.openapi(deleteKeyRoute, async (c) => {
    const { keyId } = c.req.valid("param");

    // Check if key exists
    const existing = await service.getById(keyId);
    if (!existing) {
      return c.json({ error: "Key not found" }, 404);
    }

    await service.removeKeyById(keyId);
    return c.json({ success: true }, 200);
  });

  return routes;
}
