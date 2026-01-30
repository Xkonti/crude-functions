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
      // Build create data - service will handle removing undefined fields
      const id = await service.createUser(
        {
          email: body.email,
          password: body.password,
          name: body.name,
        },
        new Headers()  // Better Auth admin API doesn't need request headers for user creation
      );

      // Fetch created user and strip roles from response
      const user = await service.getById(id);
      if (!user) {
        return c.json({ error: "Failed to retrieve created user" }, 500);
      }
      const { roles: _roles, ...publicUser } = user;

      return c.json(publicUser, 201);
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
    // Strip roles from response
    const publicUsers = users.map(({ roles: _roles, ...user }) => user);
    return c.json({ users: publicUsers });
  });

  // GET /api/users/:id - Get a single user by ID
  routes.get("/:id", async (c) => {
    const id = c.req.param("id");

    const user = await service.getById(id);
    if (!user) {
      return c.json({ error: "User not found" }, 404);
    }

    // Strip roles from response
    const { roles: _roles, ...publicUser } = user;
    return c.json(publicUser);
  });

  // PUT /api/users/:id - Update a user
  routes.put("/:id", async (c) => {
    const id = c.req.param("id");

    let body: {
      password?: string;
      passwordConfirmation?: string;
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
      await service.updateUser(
        id,
        {
          password: body.password,
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
