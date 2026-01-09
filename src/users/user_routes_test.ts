import { expect } from "@std/expect";
import { Hono } from "@hono/hono";
import { createUserRoutes } from "./user_routes.ts";
import type { UserService } from "./user_service.ts";
import type { User } from "./types.ts";

/**
 * Creates a mock UserService for testing route handlers.
 * This avoids Better Auth's admin API authorization requirements.
 */
function createMockUserService(): {
  service: UserService;
  users: Map<string, User>;
} {
  const users = new Map<string, User>();
  let idCounter = 1;

  const service = {
    async createUser(data: { email: string; password: string; name?: string; role?: string }): Promise<string> {
      // Check for duplicate email
      for (const user of users.values()) {
        if (user.email.toLowerCase() === data.email.toLowerCase()) {
          throw new Error(`User with email '${data.email}' already exists`);
        }
      }

      const id = `user-${idCounter++}`;
      const roles = data.role ? data.role.split(",").map(r => r.trim()).filter(Boolean) : [];

      users.set(id, {
        id,
        email: data.email,
        emailVerified: false,
        name: data.name,
        roles,
        banned: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      return id;
    },

    async getAll(): Promise<User[]> {
      return Array.from(users.values()).sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
      );
    },

    async getById(id: string): Promise<User | null> {
      return users.get(id) ?? null;
    },

    async getByEmail(email: string): Promise<User | null> {
      for (const user of users.values()) {
        if (user.email.toLowerCase() === email.toLowerCase()) {
          return user;
        }
      }
      return null;
    },

    async updateUser(id: string, data: { password?: string; role?: string }): Promise<void> {
      const user = users.get(id);
      if (!user) {
        throw new Error(`User with id '${id}' not found`);
      }

      if (data.role !== undefined) {
        user.roles = data.role ? data.role.split(",").map(r => r.trim()).filter(Boolean) : [];
      }
      user.updatedAt = new Date();
    },

    async deleteUser(id: string): Promise<void> {
      const user = users.get(id);
      if (!user) {
        throw new Error(`User with id '${id}' not found`);
      }
      if (user.roles.includes("permanent")) {
        throw new Error("Cannot delete permanent admin user");
      }
      users.delete(id);
    },
  } as unknown as UserService;

  return { service, users };
}

/**
 * Creates a Hono app with user routes using a mock service.
 */
function createTestApp(service: UserService): Hono {
  const app = new Hono();
  app.route("/api/users", createUserRoutes(service));
  return app;
}

/**
 * Creates a Hono app with user routes and a mocked session user.
 * Used for testing self-deletion prevention.
 */
function createTestAppWithSession(service: UserService, userId: string): Hono {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("user" as never, { id: userId } as never);
    await next();
  });
  app.route("/api/users", createUserRoutes(service));
  return app;
}

// ============== POST /api/users - Create User Tests ==============

Deno.test("POST /api/users creates user with all fields", async () => {
  const { service, users } = createMockUserService();
  const app = createTestApp(service);

  const res = await app.request("/api/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "test@example.com",
      password: "password123",
      passwordConfirmation: "password123",
      name: "Test User",
      roles: ["userMgmt"],
    }),
  });

  expect(res.status).toBe(201);
  const json = await res.json();
  expect(json.id).toBeDefined();
  expect(json.email).toBe("test@example.com");
  expect(json.roles).toEqual(["userMgmt"]);

  // Verify user was actually created in mock
  const user = users.get(json.id);
  expect(user).toBeDefined();
  expect(user!.name).toBe("Test User");
  expect(user!.roles).toEqual(["userMgmt"]);
});

Deno.test("POST /api/users creates user with minimal fields", async () => {
  const { service, users } = createMockUserService();
  const app = createTestApp(service);

  const res = await app.request("/api/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "minimal@example.com",
      password: "password123",
      passwordConfirmation: "password123",
    }),
  });

  expect(res.status).toBe(201);
  const json = await res.json();
  expect(json.id).toBeDefined();
  expect(json.email).toBe("minimal@example.com");
  expect(json.roles).toEqual([]);

  // Verify user was created without name
  const user = users.get(json.id);
  expect(user).toBeDefined();
  expect(user!.name).toBeUndefined();
  expect(user!.roles).toEqual([]);
});

Deno.test("POST /api/users creates user with multiple roles", async () => {
  const { service, users } = createMockUserService();
  const app = createTestApp(service);

  const res = await app.request("/api/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "admin@example.com",
      password: "password123",
      passwordConfirmation: "password123",
      roles: ["userMgmt", "permanent"],
    }),
  });

  expect(res.status).toBe(201);
  const json = await res.json();
  expect(json.roles).toEqual(["userMgmt", "permanent"]);

  // Verify roles stored correctly
  const user = users.get(json.id);
  expect(user!.roles).toEqual(["userMgmt", "permanent"]);
});

Deno.test("POST /api/users returns 400 when email is missing", async () => {
  const { service } = createMockUserService();
  const app = createTestApp(service);

  const res = await app.request("/api/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      password: "password123",
      passwordConfirmation: "password123",
    }),
  });

  expect(res.status).toBe(400);
  const json = await res.json();
  expect(json.error).toBe("Missing required field: email");
});

Deno.test("POST /api/users returns 400 when email is invalid", async () => {
  const { service } = createMockUserService();
  const app = createTestApp(service);

  const res = await app.request("/api/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "invalid-email",
      password: "password123",
      passwordConfirmation: "password123",
    }),
  });

  expect(res.status).toBe(400);
  const json = await res.json();
  expect(json.error).toBe("Invalid email format");
});

Deno.test("POST /api/users returns 400 when password is missing", async () => {
  const { service } = createMockUserService();
  const app = createTestApp(service);

  const res = await app.request("/api/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "test@example.com",
      passwordConfirmation: "password123",
    }),
  });

  expect(res.status).toBe(400);
  const json = await res.json();
  expect(json.error).toBe("Missing required field: password");
});

Deno.test("POST /api/users returns 400 when password is too short", async () => {
  const { service } = createMockUserService();
  const app = createTestApp(service);

  const res = await app.request("/api/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "test@example.com",
      password: "short",
      passwordConfirmation: "short",
    }),
  });

  expect(res.status).toBe(400);
  const json = await res.json();
  expect(json.error).toBe("Password must be at least 8 characters");
});

Deno.test("POST /api/users returns 400 when passwordConfirmation is missing", async () => {
  const { service } = createMockUserService();
  const app = createTestApp(service);

  const res = await app.request("/api/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "test@example.com",
      password: "password123",
    }),
  });

  expect(res.status).toBe(400);
  const json = await res.json();
  expect(json.error).toBe("Missing required field: passwordConfirmation");
});

Deno.test("POST /api/users returns 400 when passwords do not match", async () => {
  const { service } = createMockUserService();
  const app = createTestApp(service);

  const res = await app.request("/api/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "test@example.com",
      password: "password123",
      passwordConfirmation: "different123",
    }),
  });

  expect(res.status).toBe(400);
  const json = await res.json();
  expect(json.error).toBe("Passwords do not match");
});

Deno.test("POST /api/users returns 409 when email already exists", async () => {
  const { service } = createMockUserService();

  // Create first user via service
  await service.createUser(
    {
      email: "existing@example.com",
      password: "password123",
    },
    new Headers()
  );

  const app = createTestApp(service);
  const res = await app.request("/api/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "existing@example.com",
      password: "password123",
      passwordConfirmation: "password123",
    }),
  });

  expect(res.status).toBe(409);
  const json = await res.json();
  expect(json.error).toContain("already exists");
});

Deno.test("POST /api/users returns 400 for invalid JSON", async () => {
  const { service } = createMockUserService();
  const app = createTestApp(service);

  const res = await app.request("/api/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "invalid json{",
  });

  expect(res.status).toBe(400);
  const json = await res.json();
  expect(json.error).toBe("Invalid JSON body");
});

// ============== GET /api/users - List Users Tests ==============

Deno.test("GET /api/users returns empty array when no users", async () => {
  const { service } = createMockUserService();
  const app = createTestApp(service);

  const res = await app.request("/api/users");
  expect(res.status).toBe(200);

  const json = await res.json();
  expect(json.users).toEqual([]);
});

Deno.test("GET /api/users returns all users", async () => {
  const { service } = createMockUserService();

  // Create multiple users
  await service.createUser(
    { email: "user1@example.com", password: "password123" },
    new Headers()
  );
  await service.createUser(
    { email: "user2@example.com", password: "password123" },
    new Headers()
  );

  const app = createTestApp(service);
  const res = await app.request("/api/users");
  expect(res.status).toBe(200);

  const json = await res.json();
  expect(json.users.length).toBe(2);
});

Deno.test("GET /api/users returns users with roles as array", async () => {
  const { service } = createMockUserService();

  await service.createUser(
    {
      email: "admin@example.com",
      password: "password123",
      role: "userMgmt,permanent",
    },
    new Headers()
  );

  const app = createTestApp(service);
  const res = await app.request("/api/users");
  expect(res.status).toBe(200);

  const json = await res.json();
  expect(json.users[0].roles).toEqual(["userMgmt", "permanent"]);
});

Deno.test("GET /api/users returns all user fields", async () => {
  const { service } = createMockUserService();

  await service.createUser(
    {
      email: "test@example.com",
      password: "password123",
      name: "Test User",
      role: "userMgmt",
    },
    new Headers()
  );

  const app = createTestApp(service);
  const res = await app.request("/api/users");
  expect(res.status).toBe(200);

  const json = await res.json();
  const user = json.users[0];
  expect(user.id).toBeDefined();
  expect(user.email).toBe("test@example.com");
  expect(user.emailVerified).toBeDefined();
  expect(user.name).toBe("Test User");
  expect(user.roles).toEqual(["userMgmt"]);
  expect(user.banned).toBeDefined();
  expect(user.createdAt).toBeDefined();
  expect(user.updatedAt).toBeDefined();
});

// ============== GET /api/users/:id - Get User Tests ==============

Deno.test("GET /api/users/:id returns user by ID", async () => {
  const { service } = createMockUserService();

  const userId = await service.createUser(
    {
      email: "test@example.com",
      password: "password123",
      name: "Test User",
    },
    new Headers()
  );

  const app = createTestApp(service);
  const res = await app.request(`/api/users/${userId}`);
  expect(res.status).toBe(200);

  const json = await res.json();
  expect(json.id).toBe(userId);
  expect(json.email).toBe("test@example.com");
  expect(json.name).toBe("Test User");
});

Deno.test("GET /api/users/:id returns user with roles as array", async () => {
  const { service } = createMockUserService();

  const userId = await service.createUser(
    {
      email: "admin@example.com",
      password: "password123",
      role: "userMgmt,permanent",
    },
    new Headers()
  );

  const app = createTestApp(service);
  const res = await app.request(`/api/users/${userId}`);
  expect(res.status).toBe(200);

  const json = await res.json();
  expect(json.roles).toEqual(["userMgmt", "permanent"]);
});

Deno.test("GET /api/users/:id returns all user fields", async () => {
  const { service } = createMockUserService();

  const userId = await service.createUser(
    {
      email: "test@example.com",
      password: "password123",
      name: "Test User",
    },
    new Headers()
  );

  const app = createTestApp(service);
  const res = await app.request(`/api/users/${userId}`);
  expect(res.status).toBe(200);

  const json = await res.json();
  expect(json.id).toBeDefined();
  expect(json.email).toBeDefined();
  expect(json.emailVerified).toBeDefined();
  expect(json.name).toBeDefined();
  expect(json.roles).toBeDefined();
  expect(json.banned).toBeDefined();
  expect(json.createdAt).toBeDefined();
  expect(json.updatedAt).toBeDefined();
});

Deno.test("GET /api/users/:id returns 404 for non-existent user", async () => {
  const { service } = createMockUserService();
  const app = createTestApp(service);

  const res = await app.request("/api/users/non-existent-id");
  expect(res.status).toBe(404);

  const json = await res.json();
  expect(json.error).toBe("User not found");
});

Deno.test("GET /api/users/:id returns 404 for invalid UUID", async () => {
  const { service } = createMockUserService();
  const app = createTestApp(service);

  const res = await app.request("/api/users/invalid-uuid");
  expect(res.status).toBe(404);

  const json = await res.json();
  expect(json.error).toBe("User not found");
});

// ============== PUT /api/users/:id - Update User Tests ==============

Deno.test("PUT /api/users/:id updates password", async () => {
  const { service } = createMockUserService();

  const userId = await service.createUser(
    {
      email: "test@example.com",
      password: "oldPassword123",
    },
    new Headers()
  );

  const app = createTestApp(service);
  const res = await app.request(`/api/users/${userId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      password: "newPassword123",
      passwordConfirmation: "newPassword123",
    }),
  });

  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.success).toBe(true);
});

Deno.test("PUT /api/users/:id updates roles", async () => {
  const { service, users } = createMockUserService();

  const userId = await service.createUser(
    {
      email: "test@example.com",
      password: "password123",
      role: "userMgmt",
    },
    new Headers()
  );

  const app = createTestApp(service);
  const res = await app.request(`/api/users/${userId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      roles: ["userMgmt", "userRead"],
    }),
  });

  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.success).toBe(true);

  // Verify roles were updated
  const user = users.get(userId);
  expect(user!.roles).toEqual(["userMgmt", "userRead"]);
});

Deno.test("PUT /api/users/:id updates both password and roles", async () => {
  const { service, users } = createMockUserService();

  const userId = await service.createUser(
    {
      email: "test@example.com",
      password: "oldPassword123",
    },
    new Headers()
  );

  const app = createTestApp(service);
  const res = await app.request(`/api/users/${userId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      password: "newPassword123",
      passwordConfirmation: "newPassword123",
      roles: ["userMgmt"],
    }),
  });

  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.success).toBe(true);

  // Verify roles were updated
  const user = users.get(userId);
  expect(user!.roles).toEqual(["userMgmt"]);
});

Deno.test("PUT /api/users/:id accepts empty body (no-op)", async () => {
  const { service } = createMockUserService();

  const userId = await service.createUser(
    {
      email: "test@example.com",
      password: "password123",
    },
    new Headers()
  );

  const app = createTestApp(service);
  const res = await app.request(`/api/users/${userId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.success).toBe(true);
});

Deno.test("PUT /api/users/:id returns 400 when password is too short", async () => {
  const { service } = createMockUserService();

  const userId = await service.createUser(
    {
      email: "test@example.com",
      password: "password123",
    },
    new Headers()
  );

  const app = createTestApp(service);
  const res = await app.request(`/api/users/${userId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      password: "short",
      passwordConfirmation: "short",
    }),
  });

  expect(res.status).toBe(400);
  const json = await res.json();
  expect(json.error).toBe("Password must be at least 8 characters");
});

Deno.test("PUT /api/users/:id returns 400 when passwords do not match", async () => {
  const { service } = createMockUserService();

  const userId = await service.createUser(
    {
      email: "test@example.com",
      password: "password123",
    },
    new Headers()
  );

  const app = createTestApp(service);
  const res = await app.request(`/api/users/${userId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      password: "newPassword123",
      passwordConfirmation: "different123",
    }),
  });

  expect(res.status).toBe(400);
  const json = await res.json();
  expect(json.error).toBe("Passwords do not match");
});

Deno.test("PUT /api/users/:id returns 400 when password provided without confirmation", async () => {
  const { service } = createMockUserService();

  const userId = await service.createUser(
    {
      email: "test@example.com",
      password: "password123",
    },
    new Headers()
  );

  const app = createTestApp(service);
  const res = await app.request(`/api/users/${userId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      password: "newPassword123",
    }),
  });

  expect(res.status).toBe(400);
  const json = await res.json();
  expect(json.error).toBe(
    "Password confirmation required when updating password"
  );
});

Deno.test("PUT /api/users/:id returns 404 for non-existent user", async () => {
  const { service } = createMockUserService();
  const app = createTestApp(service);

  const res = await app.request("/api/users/non-existent-id", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      roles: ["userMgmt"],
    }),
  });

  expect(res.status).toBe(404);
  const json = await res.json();
  expect(json.error).toContain("not found");
});

Deno.test("PUT /api/users/:id returns 400 for invalid JSON", async () => {
  const { service } = createMockUserService();

  const userId = await service.createUser(
    {
      email: "test@example.com",
      password: "password123",
    },
    new Headers()
  );

  const app = createTestApp(service);
  const res = await app.request(`/api/users/${userId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: "invalid json{",
  });

  expect(res.status).toBe(400);
  const json = await res.json();
  expect(json.error).toBe("Invalid JSON body");
});

// ============== DELETE /api/users/:id - Delete User Tests ==============

Deno.test("DELETE /api/users/:id deletes user successfully", async () => {
  const { service, users } = createMockUserService();

  const userId = await service.createUser(
    {
      email: "test@example.com",
      password: "password123",
    },
    new Headers()
  );

  const app = createTestApp(service);
  const res = await app.request(`/api/users/${userId}`, {
    method: "DELETE",
  });

  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.success).toBe(true);

  // Verify user was deleted
  expect(users.get(userId)).toBeUndefined();
});

Deno.test("DELETE /api/users/:id returns 403 for self-deletion", async () => {
  const { service, users } = createMockUserService();

  const userId = await service.createUser(
    {
      email: "test@example.com",
      password: "password123",
    },
    new Headers()
  );

  // Create app with session user
  const app = createTestAppWithSession(service, userId);
  const res = await app.request(`/api/users/${userId}`, {
    method: "DELETE",
  });

  expect(res.status).toBe(403);
  const json = await res.json();
  expect(json.error).toBe("Cannot delete your own account");

  // Verify user was NOT deleted
  expect(users.get(userId)).toBeDefined();
});

Deno.test("DELETE /api/users/:id returns 403 for permanent role user", async () => {
  const { service, users } = createMockUserService();

  const userId = await service.createUser(
    {
      email: "admin@example.com",
      password: "password123",
      role: "permanent",
    },
    new Headers()
  );

  const app = createTestApp(service);
  const res = await app.request(`/api/users/${userId}`, {
    method: "DELETE",
  });

  expect(res.status).toBe(403);
  const json = await res.json();
  expect(json.error).toContain("permanent");

  // Verify user was NOT deleted
  expect(users.get(userId)).toBeDefined();
});

Deno.test("DELETE /api/users/:id returns 404 for non-existent user", async () => {
  const { service } = createMockUserService();
  const app = createTestApp(service);

  const res = await app.request("/api/users/non-existent-id", {
    method: "DELETE",
  });

  expect(res.status).toBe(404);
  const json = await res.json();
  expect(json.error).toContain("not found");
});
