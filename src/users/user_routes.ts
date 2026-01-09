import { Hono } from "@hono/hono";
import type { UserService } from "./user_service.ts";

export function createUserRoutes(service: UserService): Hono {
  const routes = new Hono();

  // POST /api/users - Create a new user
  routes.post("/", async (c) => {
    let body: {
      email?: string;
      password?: string;
      passwordConfirmation?: string;
      name?: string;
      roles?: string[];
    };

    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    // Validate required fields
    if (!body.email) {
      return c.json({ error: "Missing required field: email" }, 400);
    }

    if (!body.email.includes("@")) {
      return c.json({ error: "Invalid email format" }, 400);
    }

    if (!body.password) {
      return c.json({ error: "Missing required field: password" }, 400);
    }

    if (body.password.length < 8) {
      return c.json({ error: "Password must be at least 8 characters" }, 400);
    }

    if (!body.passwordConfirmation) {
      return c.json(
        { error: "Missing required field: passwordConfirmation" },
        400
      );
    }

    if (body.password !== body.passwordConfirmation) {
      return c.json({ error: "Passwords do not match" }, 400);
    }

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
        new Headers()  // Better Auth admin API doesn't need request headers for user creation
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
  routes.get("/", async (c) => {
    const users = await service.getAll();
    return c.json({ users });
  });

  // GET /api/users/:id - Get a single user by ID
  routes.get("/:id", async (c) => {
    const id = c.req.param("id");

    const user = await service.getById(id);
    if (!user) {
      return c.json({ error: "User not found" }, 404);
    }

    return c.json(user);
  });

  // PUT /api/users/:id - Update a user
  routes.put("/:id", async (c) => {
    const id = c.req.param("id");

    let body: {
      password?: string;
      passwordConfirmation?: string;
      roles?: string[];
    };

    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    // If password is provided, validate it
    if (body.password !== undefined) {
      if (body.password.length < 8) {
        return c.json(
          { error: "Password must be at least 8 characters" },
          400
        );
      }

      if (!body.passwordConfirmation) {
        return c.json(
          { error: "Password confirmation required when updating password" },
          400
        );
      }

      if (body.password !== body.passwordConfirmation) {
        return c.json({ error: "Passwords do not match" }, 400);
      }
    }

    try {
      // Convert roles to comma-separated string for service
      const roleString = body.roles !== undefined ? body.roles.join(",") : undefined;

      await service.updateUser(
        id,
        {
          password: body.password,
          role: roleString,
        },
        new Headers()  // Better Auth admin API doesn't need request headers
      );

      return c.json({ success: true });
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
  routes.delete("/:id", async (c) => {
    const id = c.req.param("id");
    const currentUser = c.get("user" as never) as { id: string } | undefined;

    // Prevent self-deletion
    if (currentUser?.id === id) {
      return c.json({ error: "Cannot delete your own account" }, 403);
    }

    try {
      await service.deleteUser(id, new Headers());  // Better Auth admin API doesn't need request headers
      return c.json({ success: true });
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
