import type { OpenAPIHono } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";
import { createOpenAPIApp } from "../openapi_app.ts";
import type { UserService } from "./user_service.ts";
import {
  CreateUserRequestSchema,
  CreateUserResponseSchema,
  GetUsersResponseSchema,
  UserIdParamSchema,
  UserSchema,
  UpdateUserRequestSchema,
  UpdateUserResponseSchema,
  DeleteUserResponseSchema,
} from "../routes_schemas/users.ts";
import { ErrorResponseSchema } from "../schemas/responses.ts";

/**
 * POST /api/users - Create a new user
 */
const createUserRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Users"],
  summary: "Create user",
  description:
    "Create a new user account with email, password, and optional name and roles. " +
    "Password must be at least 8 characters and match confirmation. " +
    "Returns 409 if user with email already exists.",
  request: {
    body: {
      content: {
        "application/json": {
          schema: CreateUserRequestSchema,
        },
      },
    },
  },
  responses: {
    201: {
      content: {
        "application/json": {
          schema: CreateUserResponseSchema,
        },
      },
      description: "User created successfully",
    },
    400: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Invalid input - validation failed",
    },
    409: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "User with this email already exists",
    },
  },
});

/**
 * GET /api/users - List all users
 */
const getUsersRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Users"],
  summary: "List users",
  description: "Retrieve a list of all user accounts in the system.",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: GetUsersResponseSchema,
        },
      },
      description: "Users retrieved successfully",
    },
  },
});

/**
 * GET /api/users/:id - Get a single user by ID
 */
const getUserRoute = createRoute({
  method: "get",
  path: "/{id}",
  tags: ["Users"],
  summary: "Get user",
  description: "Retrieve a single user by their ID.",
  request: {
    params: UserIdParamSchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: UserSchema,
        },
      },
      description: "User retrieved successfully",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "User not found",
    },
  },
});

/**
 * PUT /api/users/:id - Update a user
 */
const updateUserRoute = createRoute({
  method: "put",
  path: "/{id}",
  tags: ["Users"],
  summary: "Update user",
  description:
    "Update user password and/or roles. " +
    "If updating password, it must be at least 8 characters and confirmation is required.",
  request: {
    params: UserIdParamSchema,
    body: {
      content: {
        "application/json": {
          schema: UpdateUserRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: UpdateUserResponseSchema,
        },
      },
      description: "User updated successfully",
    },
    400: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Invalid input - validation failed",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "User not found",
    },
  },
});

/**
 * DELETE /api/users/:id - Delete a user
 */
const deleteUserRoute = createRoute({
  method: "delete",
  path: "/{id}",
  tags: ["Users"],
  summary: "Delete user",
  description:
    "Delete a user account. Cannot delete your own account. " +
    "Returns 403 if attempting to delete yourself or a permanent system user.",
  request: {
    params: UserIdParamSchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: DeleteUserResponseSchema,
        },
      },
      description: "User deleted successfully",
    },
    403: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Cannot delete your own account or permanent user",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "User not found",
    },
  },
});

export function createUserRoutes(service: UserService): OpenAPIHono {
  const routes = createOpenAPIApp();

  // POST /api/users - Create a new user
  routes.openapi(createUserRoute, async (c) => {
    const body = c.req.valid("json");

    try {
      // Convert roles array to comma-separated string for service
      const roleString = body.roles?.join(",");

      // Build create data - service will handle removing undefined fields
      const id = await service.createUser(
        {
          email: body.email,
          password: body.password,
          name: body.name,
          role: roleString,
        },
        new Headers() // Better Auth admin API doesn't need request headers for user creation
      );

      return c.json(
        {
          id,
          email: body.email,
          roles: body.roles || [],
        },
        201
      );
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes("already exists")) {
          return c.json({ error: error.message }, 409);
        }
      }
      throw error;
    }
  });

  // GET /api/users - List all users
  routes.openapi(getUsersRoute, async (c) => {
    const users = await service.getAll();
    // Map to API schema format
    const mappedUsers = users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name ?? null,
      roles: u.roles,
      createdAt: u.createdAt.toISOString(),
    }));
    return c.json({ users: mappedUsers }, 200);
  });

  // GET /api/users/:id - Get a single user by ID
  routes.openapi(getUserRoute, async (c) => {
    const { id } = c.req.valid("param");

    const user = await service.getById(id);
    if (!user) {
      return c.json({ error: "User not found" }, 404);
    }

    // Map to API schema format
    const mappedUser = {
      id: user.id,
      email: user.email,
      name: user.name ?? null,
      roles: user.roles,
      createdAt: user.createdAt.toISOString(),
    };

    return c.json(mappedUser, 200);
  });

  // PUT /api/users/:id - Update a user
  routes.openapi(updateUserRoute, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    try {
      // Convert roles to comma-separated string for service
      const roleString = body.roles !== undefined
        ? body.roles.join(",")
        : undefined;

      await service.updateUser(
        id,
        {
          password: body.password,
          role: roleString,
        },
        new Headers() // Better Auth admin API doesn't need request headers
      );

      return c.json({ success: true }, 200);
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes("not found")) {
          return c.json({ error: error.message }, 404);
        }
      }
      throw error;
    }
  });

  // DELETE /api/users/:id - Delete a user
  routes.openapi(deleteUserRoute, async (c) => {
    const { id } = c.req.valid("param");
    const currentUser = c.get("user" as never) as { id: string } | undefined;

    // Prevent self-deletion
    if (currentUser?.id === id) {
      return c.json({ error: "Cannot delete your own account" }, 403);
    }

    try {
      await service.deleteUser(id, new Headers()); // Better Auth admin API doesn't need request headers
      return c.json({ success: true }, 200);
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes("not found")) {
          return c.json({ error: error.message }, 404);
        }
        if (error.message.includes("permanent")) {
          return c.json({ error: error.message }, 403);
        }
      }
      throw error;
    }
  });

  return routes;
}
