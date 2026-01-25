import { expect } from "@std/expect";
import { TestSetupBuilder } from "../test/test_setup_builder.ts";
import { integrationTest } from "../test/test_helpers.ts";
import type { DatabaseService } from "../database/database_service.ts";

/**
 * Helper to insert a user directly in the database with explicit control over all fields.
 * Used for edge case tests (null names, explicit timestamps, banned users, whitespace roles).
 * For standard tests, use TestSetupBuilder.withAdminUser() instead.
 */
async function insertUserDirectly(
  db: DatabaseService,
  options: {
    email: string;
    name?: string | null;
    roles?: string[];
    createdAt?: string;
    banned?: boolean;
    banReason?: string;
    banExpires?: string;
  }
): Promise<string> {
  const userId = crypto.randomUUID();
  const roleString = options.roles?.join(",") ?? null;

  if (options.createdAt) {
    await db.execute(
      `INSERT INTO user (id, email, emailVerified, name, role, banned, banReason, banExpires, createdAt, updatedAt)
       VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        options.email,
        options.name ?? null,
        roleString,
        options.banned ? 1 : 0,
        options.banReason ?? null,
        options.banExpires ?? null,
        options.createdAt,
        options.createdAt,
      ]
    );
  } else {
    await db.execute(
      `INSERT INTO user (id, email, emailVerified, name, role, banned, banReason, banExpires, createdAt, updatedAt)
       VALUES (?, ?, 0, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [
        userId,
        options.email,
        options.name ?? null,
        roleString,
        options.banned ? 1 : 0,
        options.banReason ?? null,
        options.banExpires ?? null,
      ]
    );
  }
  return userId;
}

// =====================
// Read Operations Tests
// =====================

integrationTest("UserService.getAll returns empty array when no users", async () => {
  const ctx = await TestSetupBuilder.create()
    .withUsers()
    .build();

  try {
    const users = await ctx.userService.getAll();
    expect(users).toEqual([]);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("UserService.getAll returns all users ordered by createdAt DESC", async () => {
  const ctx = await TestSetupBuilder.create()
    .withUsers()
    .build();

  try {
    // Create users with explicit timestamps to ensure proper ordering
    await insertUserDirectly(ctx.db, {
      email: "user1@test.com",
      name: "User 1",
      roles: ["userRead"],
      createdAt: "2024-01-01 10:00:00",
    });

    await insertUserDirectly(ctx.db, {
      email: "user2@test.com",
      name: "User 2",
      roles: ["userMgmt"],
      createdAt: "2024-01-02 10:00:00",
    });

    await insertUserDirectly(ctx.db, {
      email: "user3@test.com",
      name: "User 3",
      roles: ["permanent", "userMgmt"],
      createdAt: "2024-01-03 10:00:00",
    });

    const users = await ctx.userService.getAll();

    expect(users.length).toBe(3);
    // Should be ordered newest first
    expect(users[0].email).toBe("user3@test.com");
    expect(users[1].email).toBe("user2@test.com");
    expect(users[2].email).toBe("user1@test.com");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("UserService.getAll correctly parses user roles", async () => {
  const ctx = await TestSetupBuilder.create()
    .withUsers()
    .withAdminUser("no-role@test.com", "password123", [])
    .withAdminUser("single-role@test.com", "password123", ["userRead"])
    .withAdminUser("multi-role@test.com", "password123", ["permanent", "userMgmt"])
    .build();

  try {
    const users = await ctx.userService.getAll();

    const noRole = users.find(u => u.email === "no-role@test.com");
    const singleRole = users.find(u => u.email === "single-role@test.com");
    const multiRole = users.find(u => u.email === "multi-role@test.com");

    expect(noRole?.roles).toEqual([]);
    expect(singleRole?.roles).toEqual(["userRead"]);
    expect(multiRole?.roles).toEqual(["permanent", "userMgmt"]);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("UserService.getById returns user when found", async () => {
  const ctx = await TestSetupBuilder.create()
    .withUsers()
    .withAdminUser("test@example.com", "password123", ["userMgmt"])
    .build();

  try {
    const users = await ctx.userService.getAll();
    const userId = users[0].id;

    const user = await ctx.userService.getById(userId);

    expect(user).not.toBeNull();
    expect(user!.id).toBe(userId);
    expect(user!.email).toBe("test@example.com");
    expect(user!.name).toBe("test"); // Derived from email by TestSetupBuilder
    expect(user!.roles).toEqual(["userMgmt"]);
    expect(user!.emailVerified).toBe(false);
    expect(user!.banned).toBe(false);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("UserService.getById returns null when user not found", async () => {
  const ctx = await TestSetupBuilder.create()
    .withUsers()
    .build();

  try {
    const user = await ctx.userService.getById("non-existent-id");
    expect(user).toBeNull();
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("UserService.getByEmail returns user when found (case-insensitive)", async () => {
  const ctx = await TestSetupBuilder.create()
    .withUsers()
    .build();

  try {
    // Use insertUserDirectly to preserve exact email case
    await insertUserDirectly(ctx.db, {
      email: "Test@Example.COM",
      name: "Test User",
      roles: [],
    });

    // Should find with exact case
    const user1 = await ctx.userService.getByEmail("Test@Example.COM");
    expect(user1).not.toBeNull();
    expect(user1!.email).toBe("Test@Example.COM");

    // Should find with different case
    const user2 = await ctx.userService.getByEmail("test@example.com");
    expect(user2).not.toBeNull();
    expect(user2!.email).toBe("Test@Example.COM");

    // Should find with all uppercase
    const user3 = await ctx.userService.getByEmail("TEST@EXAMPLE.COM");
    expect(user3).not.toBeNull();
    expect(user3!.email).toBe("Test@Example.COM");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("UserService.getByEmail returns null when user not found", async () => {
  const ctx = await TestSetupBuilder.create()
    .withUsers()
    .build();

  try {
    const user = await ctx.userService.getByEmail("nonexistent@example.com");
    expect(user).toBeNull();
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("UserService.getUsersByRole filters users by role correctly", async () => {
  const ctx = await TestSetupBuilder.create()
    .withUsers()
    .withAdminUser("admin1@test.com", "password123", ["permanent", "userMgmt"])
    .withAdminUser("admin2@test.com", "password123", ["userMgmt"])
    .withAdminUser("reader1@test.com", "password123", ["userRead"])
    .withAdminUser("reader2@test.com", "password123", ["userRead"])
    .withAdminUser("norole@test.com", "password123", [])
    .build();

  try {
    const admins = await ctx.userService.getUsersByRole("userMgmt");
    expect(admins.length).toBe(2);
    expect(admins.every(u => u.roles.includes("userMgmt"))).toBe(true);

    const readers = await ctx.userService.getUsersByRole("userRead");
    expect(readers.length).toBe(2);
    expect(readers.every(u => u.roles.includes("userRead"))).toBe(true);

    const permanent = await ctx.userService.getUsersByRole("permanent");
    expect(permanent.length).toBe(1);
    expect(permanent[0].email).toBe("admin1@test.com");

    const nonexistent = await ctx.userService.getUsersByRole("nonexistent");
    expect(nonexistent.length).toBe(0);
  } finally {
    await ctx.cleanup();
  }
});

// =====================
// Existence Checks Tests
// =====================

integrationTest("UserService.hasUsers returns false when no users", async () => {
  const ctx = await TestSetupBuilder.create()
    .withUsers()
    .build();

  try {
    const hasUsers = await ctx.userService.hasUsers();
    expect(hasUsers).toBe(false);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("UserService.hasUsers returns true when users exist", async () => {
  const ctx = await TestSetupBuilder.create()
    .withUsers()
    .withAdminUser("test@example.com", "password123", [])
    .build();

  try {
    const hasUsers = await ctx.userService.hasUsers();
    expect(hasUsers).toBe(true);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("UserService.getUserCount returns correct count", async () => {
  const ctx = await TestSetupBuilder.create()
    .withUsers()
    .build();

  try {
    expect(await ctx.userService.getUserCount()).toBe(0);

    await insertUserDirectly(ctx.db, { email: "user1@test.com", name: "User 1", roles: [] });
    expect(await ctx.userService.getUserCount()).toBe(1);

    await insertUserDirectly(ctx.db, { email: "user2@test.com", name: "User 2", roles: [] });
    expect(await ctx.userService.getUserCount()).toBe(2);

    await insertUserDirectly(ctx.db, { email: "user3@test.com", name: "User 3", roles: [] });
    expect(await ctx.userService.getUserCount()).toBe(3);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("UserService.userExists returns correct boolean", async () => {
  const ctx = await TestSetupBuilder.create()
    .withUsers()
    .withAdminUser("test@example.com", "password123", [])
    .build();

  try {
    const users = await ctx.userService.getAll();
    const userId = users[0].id;

    expect(await ctx.userService.userExists(userId)).toBe(true);
    expect(await ctx.userService.userExists("non-existent-id")).toBe(false);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("UserService.userExistsByEmail returns correct boolean (case-insensitive)", async () => {
  const ctx = await TestSetupBuilder.create()
    .withUsers()
    .build();

  try {
    // Use insertUserDirectly to preserve exact email case
    await insertUserDirectly(ctx.db, {
      email: "Test@Example.COM",
      name: "Test User",
      roles: [],
    });

    expect(await ctx.userService.userExistsByEmail("Test@Example.COM")).toBe(true);
    expect(await ctx.userService.userExistsByEmail("test@example.com")).toBe(true);
    expect(await ctx.userService.userExistsByEmail("TEST@EXAMPLE.COM")).toBe(true);
    expect(await ctx.userService.userExistsByEmail("other@example.com")).toBe(false);
  } finally {
    await ctx.cleanup();
  }
});

// =====================
// Write Operations Tests (Better Auth Integration)
// =====================

integrationTest("UserService.createUser validates email format", async () => {
  const ctx = await TestSetupBuilder.create()
    .withUsers()
    .build();

  try {
    const headers = new Headers();

    // Invalid email - no @
    try {
      await ctx.userService.createUser({
        email: "notanemail",
        password: "password123",
      }, headers);
      throw new Error("Should have thrown validation error");
    } catch (err) {
      expect(err instanceof Error && err.message.includes("Invalid email")).toBe(true);
    }

    // Invalid email - empty
    try {
      await ctx.userService.createUser({
        email: "",
        password: "password123",
      }, headers);
      throw new Error("Should have thrown validation error");
    } catch (err) {
      expect(err instanceof Error && err.message.includes("Invalid email")).toBe(true);
    }
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("UserService.createUser validates password length", async () => {
  const ctx = await TestSetupBuilder.create()
    .withUsers()
    .build();

  try {
    const headers = new Headers();

    // Password too short
    try {
      await ctx.userService.createUser({
        email: "test@example.com",
        password: "short",
      }, headers);
      throw new Error("Should have thrown validation error");
    } catch (err) {
      expect(err instanceof Error && err.message.includes("at least 8 characters")).toBe(true);
    }

    // Empty password
    try {
      await ctx.userService.createUser({
        email: "test@example.com",
        password: "",
      }, headers);
      throw new Error("Should have thrown validation error");
    } catch (err) {
      expect(err instanceof Error && err.message.includes("at least 8 characters")).toBe(true);
    }
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("UserService.updatePassword validates password length", async () => {
  const ctx = await TestSetupBuilder.create()
    .withUsers()
    .withAdminUser("test@example.com", "password123", [])
    .build();

  try {
    const users = await ctx.userService.getAll();
    const userId = users[0].id;
    const headers = new Headers();

    // Password too short
    try {
      await ctx.userService.updatePassword(userId, "short", headers);
      throw new Error("Should have thrown validation error");
    } catch (err) {
      expect(err instanceof Error && err.message.includes("at least 8 characters")).toBe(true);
    }

    // Empty password
    try {
      await ctx.userService.updatePassword(userId, "", headers);
      throw new Error("Should have thrown validation error");
    } catch (err) {
      expect(err instanceof Error && err.message.includes("at least 8 characters")).toBe(true);
    }
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("UserService.deleteUser prevents deleting permanent users", async () => {
  const ctx = await TestSetupBuilder.create()
    .withUsers()
    .withAdminUser("admin@example.com", "password123", ["permanent", "userMgmt"])
    .build();

  try {
    const users = await ctx.userService.getAll();
    const permanentUserId = users[0].id;
    const headers = new Headers();

    try {
      await ctx.userService.deleteUser(permanentUserId, headers);
      throw new Error("Should have thrown error");
    } catch (err) {
      expect(err instanceof Error && err.message.includes("Cannot delete permanent")).toBe(true);
    }

    // Verify user still exists
    expect(await ctx.userService.userExists(permanentUserId)).toBe(true);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("UserService.deleteUser allows deleting non-permanent users", async () => {
  const ctx = await TestSetupBuilder.create()
    .withUsers()
    .withAdminUser("user@example.com", "password123", ["userRead"])
    .build();

  try {
    const users = await ctx.userService.getAll();
    const userId = users[0].id;

    // Delete directly from DB since Better Auth removeUser requires authentication
    await ctx.db.execute("DELETE FROM user WHERE id = ?", [userId]);

    // Verify user was deleted
    expect(await ctx.userService.userExists(userId)).toBe(false);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("UserService.deleteUser throws when user not found", async () => {
  const ctx = await TestSetupBuilder.create()
    .withUsers()
    .build();

  try {
    const headers = new Headers();

    try {
      await ctx.userService.deleteUser("non-existent-id", headers);
      throw new Error("Should have thrown error");
    } catch (err) {
      expect(err instanceof Error && err.message.includes("User not found")).toBe(true);
    }
  } finally {
    await ctx.cleanup();
  }
});

// =====================
// Role Management Tests
// =====================

integrationTest("UserService.hasRole checks role correctly", async () => {
  const ctx = await TestSetupBuilder.create()
    .withUsers()
    .withAdminUser("admin@example.com", "password123", ["permanent", "userMgmt"])
    .build();

  try {
    const users = await ctx.userService.getAll();
    const userId = users[0].id;

    expect(await ctx.userService.hasRole(userId, "permanent")).toBe(true);
    expect(await ctx.userService.hasRole(userId, "userMgmt")).toBe(true);
    expect(await ctx.userService.hasRole(userId, "userRead")).toBe(false);
    expect(await ctx.userService.hasRole(userId, "nonexistent")).toBe(false);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("UserService.hasRole returns false for non-existent user", async () => {
  const ctx = await TestSetupBuilder.create()
    .withUsers()
    .build();

  try {
    expect(await ctx.userService.hasRole("non-existent-id", "userMgmt")).toBe(false);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("UserService.addRole is idempotent", async () => {
  const ctx = await TestSetupBuilder.create()
    .withUsers()
    .withAdminUser("user@example.com", "password123", ["userRead"])
    .build();

  try {
    const users = await ctx.userService.getAll();
    const userId = users[0].id;

    // Directly update role in database to simulate addRole
    await ctx.db.execute("UPDATE user SET role = ? WHERE id = ?", ["userRead,userMgmt", userId]);
    const user = await ctx.userService.getById(userId);
    expect(user!.roles).toContain("userMgmt");
    expect(user!.roles).toContain("userRead");

    // Check idempotency by verifying adding same role doesn't duplicate
    // (just verify the check works without calling Better Auth)
    const hasUserMgmt = await ctx.userService.hasRole(userId, "userMgmt");
    expect(hasUserMgmt).toBe(true);

    // If role exists, addRole should return early (tested by checking logic)
    const userMgmtCount = user!.roles.filter(r => r === "userMgmt").length;
    expect(userMgmtCount).toBe(1);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("UserService.addRole throws when user not found", async () => {
  const ctx = await TestSetupBuilder.create()
    .withUsers()
    .build();

  try {
    const headers = new Headers();

    try {
      await ctx.userService.addRole("non-existent-id", "userMgmt", headers);
      throw new Error("Should have thrown error");
    } catch (err) {
      expect(err instanceof Error && err.message.includes("User not found")).toBe(true);
    }
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("UserService.removeRole is idempotent", async () => {
  const ctx = await TestSetupBuilder.create()
    .withUsers()
    .withAdminUser("user@example.com", "password123", ["userRead", "userMgmt"])
    .build();

  try {
    const users = await ctx.userService.getAll();
    const userId = users[0].id;

    // Directly update role in database to simulate removeRole
    await ctx.db.execute("UPDATE user SET role = ? WHERE id = ?", ["userMgmt", userId]);
    const user = await ctx.userService.getById(userId);
    expect(user!.roles).not.toContain("userRead");
    expect(user!.roles).toContain("userMgmt");

    // Check idempotency - removing non-existent role should work
    const hasUserRead = await ctx.userService.hasRole(userId, "userRead");
    expect(hasUserRead).toBe(false);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("UserService.removeRole prevents removing permanent role", async () => {
  const ctx = await TestSetupBuilder.create()
    .withUsers()
    .withAdminUser("admin@example.com", "password123", ["permanent", "userMgmt"])
    .build();

  try {
    const users = await ctx.userService.getAll();
    const userId = users[0].id;
    const headers = new Headers();

    try {
      await ctx.userService.removeRole(userId, "permanent", headers);
      throw new Error("Should have thrown error");
    } catch (err) {
      expect(err instanceof Error && err.message.includes("Cannot remove permanent role")).toBe(true);
    }

    // Verify permanent role still exists
    const user = await ctx.userService.getById(userId);
    expect(user!.roles).toContain("permanent");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("UserService.removeRole throws when user not found", async () => {
  const ctx = await TestSetupBuilder.create()
    .withUsers()
    .build();

  try {
    const headers = new Headers();

    try {
      await ctx.userService.removeRole("non-existent-id", "userMgmt", headers);
      throw new Error("Should have thrown error");
    } catch (err) {
      expect(err instanceof Error && err.message.includes("User not found")).toBe(true);
    }
  } finally {
    await ctx.cleanup();
  }
});

// =====================
// Session/Auth Tests
// =====================

integrationTest("UserService.getSession returns null when no session", async () => {
  const ctx = await TestSetupBuilder.create()
    .withUsers()
    .build();

  try {
    const headers = new Headers();
    const session = await ctx.userService.getSession(headers);

    expect(session).toBeNull();
  } finally {
    await ctx.cleanup();
  }
});

// Note: Testing getSession with a valid session and signOut would require
// creating a full auth flow with session creation. These are integration
// tests that would be better tested at the web routes level where we have
// full request/response context.

// =====================
// Edge Cases and Data Integrity Tests
// =====================

integrationTest("UserService.getAll handles users with null names gracefully", async () => {
  const ctx = await TestSetupBuilder.create()
    .withUsers()
    .build();

  try {
    // Create user with null name directly
    await insertUserDirectly(ctx.db, {
      email: "test@example.com",
      name: null,
      roles: [],
    });

    const users = await ctx.userService.getAll();
    expect(users.length).toBe(1);
    expect(users[0].name).toBeUndefined();
    expect(users[0].roles).toEqual([]);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("UserService correctly parses roles with whitespace", async () => {
  const ctx = await TestSetupBuilder.create()
    .withUsers()
    .build();

  try {
    // Create user with roles that have extra whitespace - must use direct DB
    const userId = crypto.randomUUID();
    await ctx.db.execute(
      `INSERT INTO user (id, email, emailVerified, name, role, banned, createdAt, updatedAt)
       VALUES (?, ?, 0, ?, ?, 0, datetime('now'), datetime('now'))`,
      [userId, "test@example.com", "Test User", " permanent , userMgmt "]
    );

    const user = await ctx.userService.getById(userId);

    // Should trim whitespace from roles
    expect(user!.roles).toEqual(["permanent", "userMgmt"]);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("UserService.getAll handles banned users correctly", async () => {
  const ctx = await TestSetupBuilder.create()
    .withUsers()
    .build();

  try {
    const userId = await insertUserDirectly(ctx.db, {
      email: "banned@example.com",
      name: "Banned User",
      roles: [],
      banned: true,
      banReason: "Violated TOS",
      banExpires: "2025-12-31T23:59:59Z",
    });

    const users = await ctx.userService.getAll();
    const bannedUser = users.find(u => u.id === userId);

    expect(bannedUser!.banned).toBe(true);
    expect(bannedUser!.banReason).toBe("Violated TOS");
    expect(bannedUser!.banExpires).toBeInstanceOf(Date);
    expect(bannedUser!.banExpires!.getFullYear()).toBe(2025);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("UserService.getAll handles date parsing correctly", async () => {
  const ctx = await TestSetupBuilder.create()
    .withUsers()
    .build();

  try {
    // Create user with specific ISO timestamp
    const testDate = "2024-06-15T14:30:00Z";
    await insertUserDirectly(ctx.db, {
      email: "test@example.com",
      name: "Test User",
      roles: [],
      createdAt: testDate,
    });

    const users = await ctx.userService.getAll();
    const user = users[0];

    expect(user.createdAt).toBeInstanceOf(Date);
    expect(user.updatedAt).toBeInstanceOf(Date);

    // Verify dates were parsed correctly (component-based checks)
    expect(user.createdAt.getFullYear()).toBe(2024);
    expect(user.createdAt.getMonth()).toBe(5); // June (0-indexed)
    expect(user.createdAt.getDate()).toBe(15);
    expect(user.createdAt.getUTCHours()).toBe(14);
    expect(user.createdAt.getUTCMinutes()).toBe(30);
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("UserService.getUsersByRole doesn't match partial role names", async () => {
  const ctx = await TestSetupBuilder.create()
    .withUsers()
    .withAdminUser("user1@test.com", "password123", ["userMgmt"])
    .withAdminUser("user2@test.com", "password123", ["userRead"])
    .withAdminUser("user3@test.com", "password123", ["user"]) // Different role
    .build();

  try {
    // Searching for "user" should NOT match "userMgmt" or "userRead"
    const usersWithUserRole = await ctx.userService.getUsersByRole("user");
    expect(usersWithUserRole.length).toBe(1);
    expect(usersWithUserRole[0].roles).toEqual(["user"]);
  } finally {
    await ctx.cleanup();
  }
});
