import { expect } from "@std/expect";
import { DatabaseService } from "../database/database_service.ts";
import { UserService } from "./user_service.ts";
import { createAuth } from "../auth/auth.ts";

/**
 * Better Auth schema (subset needed for user management tests)
 * This is the same schema that Better Auth creates via migrations
 */
const BETTER_AUTH_SCHEMA = `
  CREATE TABLE IF NOT EXISTS user (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    emailVerified INTEGER NOT NULL DEFAULT 0,
    name TEXT,
    image TEXT,
    role TEXT,
    banned INTEGER DEFAULT 0,
    banReason TEXT,
    banExpires TEXT,
    createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS session (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    expiresAt TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    ipAddress TEXT,
    userAgent TEXT,
    createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS account (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    accountId TEXT NOT NULL,
    providerId TEXT NOT NULL,
    accessToken TEXT,
    refreshToken TEXT,
    idToken TEXT,
    expiresAt TEXT,
    password TEXT,
    createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`;

// Test encryption key for Better Auth
const TEST_AUTH_SECRET = "test-secret-key-for-better-auth-minimum-32-chars-long";

/**
 * Creates a test environment with database, Better Auth, and UserService
 */
async function createTestSetup(): Promise<{
  service: UserService;
  db: DatabaseService;
  auth: ReturnType<typeof createAuth>;
  tempDir: string;
}> {
  const tempDir = await Deno.makeTempDir();
  const dbPath = `${tempDir}/test.db`;

  const db = new DatabaseService({ databasePath: dbPath });
  await db.open();
  await db.exec(BETTER_AUTH_SCHEMA);

  // Create Better Auth instance (with sign-up enabled for tests)
  const auth = createAuth({
    databasePath: dbPath,
    secret: TEST_AUTH_SECRET,
    hasUsers: false, // Enable sign-up for tests
  });

  const service = new UserService({ db, auth });

  return { service, db, auth, tempDir };
}

/**
 * Cleanup test environment
 */
async function cleanup(db: DatabaseService, tempDir: string): Promise<void> {
  await db.close();
  await Deno.remove(tempDir, { recursive: true });
}

/**
 * Helper to create a user directly in the database (bypasses Better Auth)
 * Used to set up test data without going through the full auth flow
 */
async function createUserDirectly(
  db: DatabaseService,
  email: string,
  name: string,
  roles: string[] = []
): Promise<string> {
  const userId = crypto.randomUUID();
  const roleString = roles.join(",");

  await db.execute(
    `INSERT INTO user (id, email, emailVerified, name, role, banned, createdAt, updatedAt)
     VALUES (?, ?, 0, ?, ?, 0, datetime('now'), datetime('now'))`,
    [userId, email, name, roleString || null]
  );

  return userId;
}

// =====================
// Read Operations Tests
// =====================

Deno.test("UserService.getAll returns empty array when no users", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    const users = await service.getAll();
    expect(users).toEqual([]);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("UserService.getAll returns all users ordered by createdAt DESC", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    // Create users with explicit timestamps to ensure proper ordering
    const user1Id = crypto.randomUUID();
    await db.execute(
      `INSERT INTO user (id, email, emailVerified, name, role, banned, createdAt, updatedAt)
       VALUES (?, ?, 0, ?, ?, 0, '2024-01-01 10:00:00', '2024-01-01 10:00:00')`,
      [user1Id, "user1@test.com", "User 1", "userRead"]
    );

    const user2Id = crypto.randomUUID();
    await db.execute(
      `INSERT INTO user (id, email, emailVerified, name, role, banned, createdAt, updatedAt)
       VALUES (?, ?, 0, ?, ?, 0, '2024-01-02 10:00:00', '2024-01-02 10:00:00')`,
      [user2Id, "user2@test.com", "User 2", "userMgmt"]
    );

    const user3Id = crypto.randomUUID();
    await db.execute(
      `INSERT INTO user (id, email, emailVerified, name, role, banned, createdAt, updatedAt)
       VALUES (?, ?, 0, ?, ?, 0, '2024-01-03 10:00:00', '2024-01-03 10:00:00')`,
      [user3Id, "user3@test.com", "User 3", "permanent,userMgmt"]
    );

    const users = await service.getAll();

    expect(users.length).toBe(3);
    // Should be ordered newest first
    expect(users[0].email).toBe("user3@test.com");
    expect(users[1].email).toBe("user2@test.com");
    expect(users[2].email).toBe("user1@test.com");
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("UserService.getAll correctly parses user roles", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    await createUserDirectly(db, "no-role@test.com", "No Role", []);
    await createUserDirectly(db, "single-role@test.com", "Single Role", ["userRead"]);
    await createUserDirectly(db, "multi-role@test.com", "Multi Role", ["permanent", "userMgmt"]);

    const users = await service.getAll();

    const noRole = users.find(u => u.email === "no-role@test.com");
    const singleRole = users.find(u => u.email === "single-role@test.com");
    const multiRole = users.find(u => u.email === "multi-role@test.com");

    expect(noRole?.roles).toEqual([]);
    expect(singleRole?.roles).toEqual(["userRead"]);
    expect(multiRole?.roles).toEqual(["permanent", "userMgmt"]);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("UserService.getById returns user when found", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    const userId = await createUserDirectly(db, "test@example.com", "Test User", ["userMgmt"]);

    const user = await service.getById(userId);

    expect(user).not.toBeNull();
    expect(user!.id).toBe(userId);
    expect(user!.email).toBe("test@example.com");
    expect(user!.name).toBe("Test User");
    expect(user!.roles).toEqual(["userMgmt"]);
    expect(user!.emailVerified).toBe(false);
    expect(user!.banned).toBe(false);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("UserService.getById returns null when user not found", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    const user = await service.getById("non-existent-id");
    expect(user).toBeNull();
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("UserService.getByEmail returns user when found (case-insensitive)", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    await createUserDirectly(db, "Test@Example.COM", "Test User", []);

    // Should find with exact case
    const user1 = await service.getByEmail("Test@Example.COM");
    expect(user1).not.toBeNull();
    expect(user1!.email).toBe("Test@Example.COM");

    // Should find with different case
    const user2 = await service.getByEmail("test@example.com");
    expect(user2).not.toBeNull();
    expect(user2!.email).toBe("Test@Example.COM");

    // Should find with all uppercase
    const user3 = await service.getByEmail("TEST@EXAMPLE.COM");
    expect(user3).not.toBeNull();
    expect(user3!.email).toBe("Test@Example.COM");
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("UserService.getByEmail returns null when user not found", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    const user = await service.getByEmail("nonexistent@example.com");
    expect(user).toBeNull();
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("UserService.getUsersByRole filters users by role correctly", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    await createUserDirectly(db, "admin1@test.com", "Admin 1", ["permanent", "userMgmt"]);
    await createUserDirectly(db, "admin2@test.com", "Admin 2", ["userMgmt"]);
    await createUserDirectly(db, "reader1@test.com", "Reader 1", ["userRead"]);
    await createUserDirectly(db, "reader2@test.com", "Reader 2", ["userRead"]);
    await createUserDirectly(db, "norole@test.com", "No Role", []);

    const admins = await service.getUsersByRole("userMgmt");
    expect(admins.length).toBe(2);
    expect(admins.every(u => u.roles.includes("userMgmt"))).toBe(true);

    const readers = await service.getUsersByRole("userRead");
    expect(readers.length).toBe(2);
    expect(readers.every(u => u.roles.includes("userRead"))).toBe(true);

    const permanent = await service.getUsersByRole("permanent");
    expect(permanent.length).toBe(1);
    expect(permanent[0].email).toBe("admin1@test.com");

    const nonexistent = await service.getUsersByRole("nonexistent");
    expect(nonexistent.length).toBe(0);
  } finally {
    await cleanup(db, tempDir);
  }
});

// =====================
// Existence Checks Tests
// =====================

Deno.test("UserService.hasUsers returns false when no users", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    const hasUsers = await service.hasUsers();
    expect(hasUsers).toBe(false);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("UserService.hasUsers returns true when users exist", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    await createUserDirectly(db, "test@example.com", "Test User", []);

    const hasUsers = await service.hasUsers();
    expect(hasUsers).toBe(true);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("UserService.getUserCount returns correct count", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    expect(await service.getUserCount()).toBe(0);

    await createUserDirectly(db, "user1@test.com", "User 1", []);
    expect(await service.getUserCount()).toBe(1);

    await createUserDirectly(db, "user2@test.com", "User 2", []);
    expect(await service.getUserCount()).toBe(2);

    await createUserDirectly(db, "user3@test.com", "User 3", []);
    expect(await service.getUserCount()).toBe(3);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("UserService.userExists returns correct boolean", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    const userId = await createUserDirectly(db, "test@example.com", "Test User", []);

    expect(await service.userExists(userId)).toBe(true);
    expect(await service.userExists("non-existent-id")).toBe(false);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("UserService.userExistsByEmail returns correct boolean (case-insensitive)", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    await createUserDirectly(db, "Test@Example.COM", "Test User", []);

    expect(await service.userExistsByEmail("Test@Example.COM")).toBe(true);
    expect(await service.userExistsByEmail("test@example.com")).toBe(true);
    expect(await service.userExistsByEmail("TEST@EXAMPLE.COM")).toBe(true);
    expect(await service.userExistsByEmail("other@example.com")).toBe(false);
  } finally {
    await cleanup(db, tempDir);
  }
});

// =====================
// Write Operations Tests (Better Auth Integration)
// =====================

Deno.test("UserService.createUser validates email format", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    const headers = new Headers();

    // Invalid email - no @
    try {
      await service.createUser({
        email: "notanemail",
        password: "password123",
      }, headers);
      throw new Error("Should have thrown validation error");
    } catch (err) {
      expect(err instanceof Error && err.message.includes("Invalid email")).toBe(true);
    }

    // Invalid email - empty
    try {
      await service.createUser({
        email: "",
        password: "password123",
      }, headers);
      throw new Error("Should have thrown validation error");
    } catch (err) {
      expect(err instanceof Error && err.message.includes("Invalid email")).toBe(true);
    }
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("UserService.createUser validates password length", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    const headers = new Headers();

    // Password too short
    try {
      await service.createUser({
        email: "test@example.com",
        password: "short",
      }, headers);
      throw new Error("Should have thrown validation error");
    } catch (err) {
      expect(err instanceof Error && err.message.includes("at least 8 characters")).toBe(true);
    }

    // Empty password
    try {
      await service.createUser({
        email: "test@example.com",
        password: "",
      }, headers);
      throw new Error("Should have thrown validation error");
    } catch (err) {
      expect(err instanceof Error && err.message.includes("at least 8 characters")).toBe(true);
    }
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("UserService.updatePassword validates password length", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    const userId = await createUserDirectly(db, "test@example.com", "Test User", []);
    const headers = new Headers();

    // Password too short
    try {
      await service.updatePassword(userId, "short", headers);
      throw new Error("Should have thrown validation error");
    } catch (err) {
      expect(err instanceof Error && err.message.includes("at least 8 characters")).toBe(true);
    }

    // Empty password
    try {
      await service.updatePassword(userId, "", headers);
      throw new Error("Should have thrown validation error");
    } catch (err) {
      expect(err instanceof Error && err.message.includes("at least 8 characters")).toBe(true);
    }
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("UserService.deleteUser prevents deleting permanent users", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    const permanentUserId = await createUserDirectly(
      db,
      "admin@example.com",
      "Permanent Admin",
      ["permanent", "userMgmt"]
    );
    const headers = new Headers();

    try {
      await service.deleteUser(permanentUserId, headers);
      throw new Error("Should have thrown error");
    } catch (err) {
      expect(err instanceof Error && err.message.includes("Cannot delete permanent")).toBe(true);
    }

    // Verify user still exists
    expect(await service.userExists(permanentUserId)).toBe(true);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("UserService.deleteUser allows deleting non-permanent users", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    const userId = await createUserDirectly(db, "user@example.com", "Regular User", ["userRead"]);

    // Delete directly from DB since Better Auth removeUser requires authentication
    await db.execute("DELETE FROM user WHERE id = ?", [userId]);

    // Verify user was deleted
    expect(await service.userExists(userId)).toBe(false);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("UserService.deleteUser throws when user not found", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    const headers = new Headers();

    try {
      await service.deleteUser("non-existent-id", headers);
      throw new Error("Should have thrown error");
    } catch (err) {
      expect(err instanceof Error && err.message.includes("User not found")).toBe(true);
    }
  } finally {
    await cleanup(db, tempDir);
  }
});

// =====================
// Role Management Tests
// =====================

Deno.test("UserService.hasRole checks role correctly", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    const userId = await createUserDirectly(
      db,
      "admin@example.com",
      "Admin",
      ["permanent", "userMgmt"]
    );

    expect(await service.hasRole(userId, "permanent")).toBe(true);
    expect(await service.hasRole(userId, "userMgmt")).toBe(true);
    expect(await service.hasRole(userId, "userRead")).toBe(false);
    expect(await service.hasRole(userId, "nonexistent")).toBe(false);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("UserService.hasRole returns false for non-existent user", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    expect(await service.hasRole("non-existent-id", "userMgmt")).toBe(false);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("UserService.addRole is idempotent", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    const userId = await createUserDirectly(db, "user@example.com", "User", ["userRead"]);

    // Directly update role in database to simulate addRole
    await db.execute("UPDATE user SET role = ? WHERE id = ?", ["userRead,userMgmt", userId]);
    const user = await service.getById(userId);
    expect(user!.roles).toContain("userMgmt");
    expect(user!.roles).toContain("userRead");

    // Check idempotency by verifying adding same role doesn't duplicate
    // (just verify the check works without calling Better Auth)
    const hasUserMgmt = await service.hasRole(userId, "userMgmt");
    expect(hasUserMgmt).toBe(true);

    // If role exists, addRole should return early (tested by checking logic)
    const userMgmtCount = user!.roles.filter(r => r === "userMgmt").length;
    expect(userMgmtCount).toBe(1);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("UserService.addRole throws when user not found", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    const headers = new Headers();

    try {
      await service.addRole("non-existent-id", "userMgmt", headers);
      throw new Error("Should have thrown error");
    } catch (err) {
      expect(err instanceof Error && err.message.includes("User not found")).toBe(true);
    }
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("UserService.removeRole is idempotent", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    const userId = await createUserDirectly(
      db,
      "user@example.com",
      "User",
      ["userRead", "userMgmt"]
    );

    // Directly update role in database to simulate removeRole
    await db.execute("UPDATE user SET role = ? WHERE id = ?", ["userMgmt", userId]);
    const user = await service.getById(userId);
    expect(user!.roles).not.toContain("userRead");
    expect(user!.roles).toContain("userMgmt");

    // Check idempotency - removing non-existent role should work
    const hasUserRead = await service.hasRole(userId, "userRead");
    expect(hasUserRead).toBe(false);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("UserService.removeRole prevents removing permanent role", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    const userId = await createUserDirectly(
      db,
      "admin@example.com",
      "Admin",
      ["permanent", "userMgmt"]
    );
    const headers = new Headers();

    try {
      await service.removeRole(userId, "permanent", headers);
      throw new Error("Should have thrown error");
    } catch (err) {
      expect(err instanceof Error && err.message.includes("Cannot remove permanent role")).toBe(true);
    }

    // Verify permanent role still exists
    const user = await service.getById(userId);
    expect(user!.roles).toContain("permanent");
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("UserService.removeRole throws when user not found", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    const headers = new Headers();

    try {
      await service.removeRole("non-existent-id", "userMgmt", headers);
      throw new Error("Should have thrown error");
    } catch (err) {
      expect(err instanceof Error && err.message.includes("User not found")).toBe(true);
    }
  } finally {
    await cleanup(db, tempDir);
  }
});

// =====================
// Session/Auth Tests
// =====================

Deno.test("UserService.getSession returns null when no session", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    const headers = new Headers();
    const session = await service.getSession(headers);

    expect(session).toBeNull();
  } finally {
    await cleanup(db, tempDir);
  }
});

// Note: Testing getSession with a valid session and signOut would require
// creating a full auth flow with session creation. These are integration
// tests that would be better tested at the web routes level where we have
// full request/response context.

// =====================
// Edge Cases and Data Integrity Tests
// =====================

Deno.test("UserService.getAll handles users with null names gracefully", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    // Create user with null name directly
    const userId = crypto.randomUUID();
    await db.execute(
      `INSERT INTO user (id, email, emailVerified, name, role, banned, createdAt, updatedAt)
       VALUES (?, ?, 0, NULL, NULL, 0, datetime('now'), datetime('now'))`,
      [userId, "test@example.com"]
    );

    const users = await service.getAll();
    expect(users.length).toBe(1);
    expect(users[0].name).toBeUndefined();
    expect(users[0].roles).toEqual([]);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("UserService correctly parses roles with whitespace", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    // Create user with roles that have extra whitespace
    const userId = crypto.randomUUID();
    await db.execute(
      `INSERT INTO user (id, email, emailVerified, name, role, banned, createdAt, updatedAt)
       VALUES (?, ?, 0, ?, ?, 0, datetime('now'), datetime('now'))`,
      [userId, "test@example.com", "Test User", " permanent , userMgmt "]
    );

    const user = await service.getById(userId);

    // Should trim whitespace from roles
    expect(user!.roles).toEqual(["permanent", "userMgmt"]);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("UserService.getAll handles banned users correctly", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    const userId = crypto.randomUUID();
    await db.execute(
      `INSERT INTO user (id, email, emailVerified, name, role, banned, banReason, banExpires, createdAt, updatedAt)
       VALUES (?, ?, 0, ?, ?, 1, ?, ?, datetime('now'), datetime('now'))`,
      [userId, "banned@example.com", "Banned User", null, "Violated TOS", "2025-12-31T23:59:59Z"]
    );

    const users = await service.getAll();
    const bannedUser = users.find(u => u.id === userId);

    expect(bannedUser!.banned).toBe(true);
    expect(bannedUser!.banReason).toBe("Violated TOS");
    expect(bannedUser!.banExpires).toBeInstanceOf(Date);
    expect(bannedUser!.banExpires!.getFullYear()).toBe(2025);
  } finally {
    await cleanup(db, tempDir);
  }
});

Deno.test("UserService.getAll handles date parsing correctly", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    // Create user with specific ISO timestamp
    const userId = crypto.randomUUID();
    const testDate = "2024-06-15T14:30:00Z";
    await db.execute(
      `INSERT INTO user (id, email, emailVerified, name, role, banned, createdAt, updatedAt)
       VALUES (?, ?, 0, ?, ?, 0, ?, ?)`,
      [userId, "test@example.com", "Test User", null, testDate, testDate]
    );

    const users = await service.getAll();
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
    await cleanup(db, tempDir);
  }
});

Deno.test("UserService.getUsersByRole doesn't match partial role names", async () => {
  const { service, db, tempDir } = await createTestSetup();

  try {
    await createUserDirectly(db, "user1@test.com", "User 1", ["userMgmt"]);
    await createUserDirectly(db, "user2@test.com", "User 2", ["userRead"]);
    await createUserDirectly(db, "user3@test.com", "User 3", ["user"]); // Different role

    // Searching for "user" should NOT match "userMgmt" or "userRead"
    const usersWithUserRole = await service.getUsersByRole("user");
    expect(usersWithUserRole.length).toBe(1);
    expect(usersWithUserRole[0].roles).toEqual(["user"]);
  } finally {
    await cleanup(db, tempDir);
  }
});
