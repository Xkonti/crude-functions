import type { SurrealConnectionFactory } from "../database/surreal_connection_factory.ts";
import type { betterAuth } from "better-auth";
import type { User, CreateUserData, UpdateUserData, UserSession } from "./types.ts";
import { RecordId } from "surrealdb";

/**
 * Raw database row type from the SurrealDB user table.
 * Internal to the service - consumers never see this.
 */
interface SurrealUserRow {
  id: RecordId<"user">;
  email: string;
  emailVerified: boolean;
  name: string | null;
  image: string | null;
  role: string | null;
  banned: boolean;
  banReason: string | null;
  banExpires: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserServiceOptions {
  /** SurrealDB connection factory for querying user table */
  surrealFactory: SurrealConnectionFactory;
  /** Better Auth instance for Admin API calls */
  auth: ReturnType<typeof betterAuth>;
}

/**
 * Service for managing users stored in the database.
 *
 * Abstracts all direct user table queries and Better Auth Admin API calls,
 * providing a single source of truth for user management operations.
 *
 * No caching - always reads from database for simplicity and consistency.
 */
export class UserService {
  private readonly surrealFactory: SurrealConnectionFactory;
  private readonly auth: ReturnType<typeof betterAuth>;

  constructor(options: UserServiceOptions) {
    this.surrealFactory = options.surrealFactory;
    this.auth = options.auth;
  }

  // ============== Read Operations ==============

  /**
   * Get all users from the database.
   * @returns Array of users, ordered by creation date (newest first)
   */
  async getAll(): Promise<User[]> {
    const rows = await this.surrealFactory.withSystemConnection({}, async (db) => {
      const [result] = await db.query<[SurrealUserRow[]]>(
        `SELECT * FROM user ORDER BY createdAt DESC`
      );
      return result ?? [];
    });

    return rows.map((row) => this.rowToUser(row));
  }

  /**
   * Get a single user by ID.
   * @param id - User ID
   * @returns User object or null if not found
   */
  async getById(id: string): Promise<User | null> {
    const row = await this.surrealFactory.withSystemConnection({}, async (db) => {
      const recordId = new RecordId("user", id);
      const [result] = await db.query<[SurrealUserRow | undefined]>(
        `RETURN $recordId.*`,
        { recordId }
      );
      return result ?? null;
    });

    return row ? this.rowToUser(row) : null;
  }

  /**
   * Get a single user by email.
   * @param email - User email (case-insensitive lookup)
   * @returns User object or null if not found
   */
  async getByEmail(email: string): Promise<User | null> {
    const row = await this.surrealFactory.withSystemConnection({}, async (db) => {
      // SurrealDB uses string::lowercase for case-insensitive comparison
      const [result] = await db.query<[SurrealUserRow[]]>(
        `SELECT * FROM user WHERE string::lowercase(email) = string::lowercase($email) LIMIT 1`,
        { email }
      );
      return result?.[0] ?? null;
    });

    return row ? this.rowToUser(row) : null;
  }

  /**
   * Get all users with a specific role.
   * @param role - Role to filter by (e.g., "userMgmt")
   * @returns Array of users with that role
   */
  async getUsersByRole(role: string): Promise<User[]> {
    const rows = await this.surrealFactory.withSystemConnection({}, async (db) => {
      // Use CONTAINS to check if role string contains the role
      // Then filter in-memory for exact match
      const [result] = await db.query<[SurrealUserRow[]]>(
        `SELECT * FROM user WHERE role CONTAINS $role ORDER BY createdAt DESC`,
        { role }
      );
      return result ?? [];
    });

    // Filter in-memory to ensure exact role match (not substring)
    const users = rows.map((row) => this.rowToUser(row));
    return users.filter((user) => user.roles.includes(role));
  }

  // ============== Existence Checks & Counts ==============

  /**
   * Check if any users exist in the database.
   * Used to determine if sign-up should be enabled.
   * @returns True if at least one user exists
   */
  async hasUsers(): Promise<boolean> {
    return await this.surrealFactory.withSystemConnection({}, async (db) => {
      const [result] = await db.query<[{ id: RecordId }[]]>(
        `SELECT id FROM user LIMIT 1`
      );
      return (result?.length ?? 0) > 0;
    });
  }

  /**
   * Get total user count.
   * @returns Number of users in the database
   */
  async getUserCount(): Promise<number> {
    return await this.surrealFactory.withSystemConnection({}, async (db) => {
      const [result] = await db.query<[{ count: number }[]]>(
        `SELECT count() FROM user GROUP ALL`
      );
      return result?.[0]?.count ?? 0;
    });
  }

  /**
   * Check if a user with the given email exists.
   * @param email - Email to check
   * @returns True if user exists
   */
  async userExistsByEmail(email: string): Promise<boolean> {
    return await this.surrealFactory.withSystemConnection({}, async (db) => {
      const [result] = await db.query<[{ id: RecordId }[]]>(
        `SELECT id FROM user WHERE string::lowercase(email) = string::lowercase($email) LIMIT 1`,
        { email }
      );
      return (result?.length ?? 0) > 0;
    });
  }

  /**
   * Check if a user with the given ID exists.
   * @param id - User ID to check
   * @returns True if user exists
   */
  async userExists(id: string): Promise<boolean> {
    return await this.surrealFactory.withSystemConnection({}, async (db) => {
      const recordId = new RecordId("user", id);
      const [result] = await db.query<[SurrealUserRow | undefined]>(
        `RETURN $recordId.*`,
        { recordId }
      );
      return result !== null && result !== undefined;
    });
  }

  // ============== Write Operations (Better Auth Admin API) ==============

  /**
   * Create a new user.
   * Uses Better Auth Admin API to handle password hashing and account creation.
   * @param data - User creation data
   * @param headers - Request headers (required by Better Auth for session context)
   * @returns The created user's ID
   * @throws Error if email already exists or validation fails
   */
  async createUser(data: CreateUserData, headers: Headers): Promise<string> {
    this.validateEmail(data.email);
    this.validatePassword(data.password);

    // Build body with only provided fields (Better Auth doesn't accept undefined)
    const createBody: {
      email: string;
      password: string;
      name?: string;
      role?: string;
    } = {
      email: data.email,
      password: data.password,
      name: data.name,
      role: data.role,
    };

    // Remove undefined fields - Better Auth validates strictly
    if (!createBody.name) delete createBody.name;
    if (!createBody.role) delete createBody.role;

    try {
      // @ts-expect-error - Better Auth admin plugin API not fully typed
      const result = await this.auth.api.createUser({
        body: createBody,
        headers,
      });
      return result.data?.id ?? "";
    } catch (err) {
      // Better Auth errors can have various formats - extract message
      let message = "Unknown error";
      if (err && typeof err === "object") {
        // Better Auth APIError has status field
        if ("status" in err) {
          message = String(err.status);
        } else if (err instanceof Error) {
          message = err.message;
        }
      }
      throw new Error(`Failed to create user: ${message}`);
    }
  }

  /**
   * Update an existing user.
   * Can update password, role, and/or name.
   * @param id - User ID to update
   * @param data - Fields to update (only provided fields are updated)
   * @param headers - Request headers (required by Better Auth)
   * @throws Error if user not found or validation fails
   */
  async updateUser(
    id: string,
    data: UpdateUserData,
    headers: Headers
  ): Promise<void> {
    // Verify user exists
    const user = await this.getById(id);
    if (!user) {
      throw new Error("User not found");
    }

    // Update password if provided
    if (data.password) {
      await this.updatePassword(id, data.password, headers);
    }

    // Update role if provided
    if (data.role !== undefined) {
      await this.updateRole(id, data.role, headers);
    }

    // Note: Better Auth doesn't have a direct API to update name or email
    // These would need to be updated via direct database access or other Better Auth APIs
    // For now, we'll focus on password and role which are most commonly used
  }

  /**
   * Update a user's password.
   * Uses Better Auth Admin API for secure password hashing.
   * @param id - User ID
   * @param newPassword - New password (minimum 8 characters)
   * @param headers - Request headers
   * @throws Error if user not found or password too weak
   */
  async updatePassword(
    id: string,
    newPassword: string,
    headers: Headers
  ): Promise<void> {
    this.validatePassword(newPassword);

    try {
      // @ts-expect-error - Better Auth admin plugin API not fully typed
      await this.auth.api.setUserPassword({
        body: {
          userId: id,
          newPassword: newPassword,
        },
        headers,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      throw new Error(`Failed to update password: ${message}`);
    }
  }

  /**
   * Update a user's role.
   * Handles comma-separated role strings.
   * @param id - User ID
   * @param role - New role string (e.g., "permanent,userMgmt")
   * @param headers - Request headers
   * @throws Error if user not found
   */
  async updateRole(id: string, role: string, headers: Headers): Promise<void> {
    try {
      // @ts-expect-error - Better Auth admin plugin API not fully typed
      await this.auth.api.setRole({
        body: {
          userId: id,
          role: role,
        },
        headers,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      throw new Error(`Failed to update role: ${message}`);
    }
  }

  /**
   * Delete a user by ID.
   * Prevents deletion of users with "permanent" role.
   * @param id - User ID to delete
   * @param headers - Request headers
   * @throws Error if user not found or has permanent role
   */
  async deleteUser(id: string, headers: Headers): Promise<void> {
    const user = await this.getById(id);
    if (!user) {
      throw new Error("User not found");
    }

    if (user.roles.includes("permanent")) {
      throw new Error("Cannot delete permanent admin user");
    }

    try {
      // @ts-expect-error - Better Auth admin plugin API not fully typed
      await this.auth.api.removeUser({
        body: { userId: id },
        headers,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      throw new Error(`Failed to delete user: ${message}`);
    }
  }

  // ============== Authentication Operations ==============

  /**
   * Get the current session from request headers.
   * Wraps Better Auth's getSession API.
   * @param headers - Request headers containing session cookie
   * @returns Session object or null if not authenticated
   */
  async getSession(headers: Headers): Promise<UserSession | null> {
    try {
      const session = await this.auth.api.getSession({ headers });

      if (!session || !session.user || !session.session) {
        return null;
      }

      return {
        user: {
          id: session.user.id,
          email: session.user.email,
          name: session.user.name,
          emailVerified: session.user.emailVerified,
        },
        session: {
          id: session.session.id,
          userId: session.session.userId,
          expiresAt: new Date(session.session.expiresAt),
          token: session.session.token,
          ipAddress: session.session.ipAddress ?? undefined,
          userAgent: session.session.userAgent ?? undefined,
        },
      };
    } catch (_err) {
      return null;
    }
  }

  /**
   * Sign out the current session.
   * Wraps Better Auth's signOut API.
   * @param headers - Request headers containing session cookie
   */
  async signOut(headers: Headers): Promise<void> {
    try {
      await this.auth.api.signOut({ headers });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      throw new Error(`Failed to sign out: ${message}`);
    }
  }

  // ============== Role Management Utilities ==============

  /**
   * Check if a user has a specific role.
   * @param userId - User ID
   * @param role - Role to check for
   * @returns True if user has the role
   */
  async hasRole(userId: string, role: string): Promise<boolean> {
    const user = await this.getById(userId);
    if (!user) {
      return false;
    }
    return user.roles.includes(role);
  }

  /**
   * Add a role to a user.
   * Does nothing if user already has the role (idempotent).
   * @param userId - User ID
   * @param role - Role to add
   * @param headers - Request headers
   */
  async addRole(
    userId: string,
    role: string,
    headers: Headers
  ): Promise<void> {
    const user = await this.getById(userId);
    if (!user) {
      throw new Error("User not found");
    }

    if (user.roles.includes(role)) {
      return; // Already has role, nothing to do
    }

    const newRoles = [...user.roles, role];
    await this.updateRole(userId, newRoles.join(","), headers);
  }

  /**
   * Remove a role from a user.
   * Does nothing if user doesn't have the role (idempotent).
   * Cannot remove "permanent" role.
   * @param userId - User ID
   * @param role - Role to remove
   * @param headers - Request headers
   * @throws Error if attempting to remove permanent role
   */
  async removeRole(
    userId: string,
    role: string,
    headers: Headers
  ): Promise<void> {
    if (role === "permanent") {
      throw new Error("Cannot remove permanent role");
    }

    const user = await this.getById(userId);
    if (!user) {
      throw new Error("User not found");
    }

    if (!user.roles.includes(role)) {
      return; // Doesn't have role, nothing to do
    }

    const newRoles = user.roles.filter((r) => r !== role);
    await this.updateRole(userId, newRoles.join(","), headers);
  }

  // ============== Private Helper Methods ==============

  /**
   * Convert a value to Date, handling SurrealDB's datetime type.
   * SurrealDB may return Date objects or its own DateTime wrapper.
   */
  private toDate(value: Date | unknown): Date {
    if (value instanceof Date) {
      return value;
    }
    // SurrealDB's DateTime has a toDate() method
    if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
      return value.toDate() as Date;
    }
    // Try to construct from string/number
    return new Date(value as string | number);
  }

  /**
   * Convert an optional value to Date or undefined.
   */
  private toOptionalDate(value: Date | unknown | null): Date | undefined {
    if (value === null || value === undefined) {
      return undefined;
    }
    return this.toDate(value);
  }

  /**
   * Convert database row to public User type.
   * Handles role parsing and SurrealDB type conversions.
   * @param row - Raw database row
   * @returns Typed User object
   */
  private rowToUser(row: SurrealUserRow): User {
    return {
      id: row.id.id as string,
      email: row.email,
      emailVerified: row.emailVerified,
      name: row.name ?? undefined,
      image: row.image ?? undefined,
      roles: row.role ? row.role.split(",").map((r) => r.trim()) : [],
      banned: row.banned,
      banReason: row.banReason ?? undefined,
      banExpires: this.toOptionalDate(row.banExpires),
      createdAt: this.toDate(row.createdAt),
      updatedAt: this.toDate(row.updatedAt),
    };
  }

  /**
   * Validate email format.
   * @param email - Email to validate
   * @throws Error if email is invalid
   */
  private validateEmail(email: string): void {
    if (!email || !email.includes("@")) {
      throw new Error("Invalid email format");
    }
  }

  /**
   * Validate password strength.
   * @param password - Password to validate
   * @throws Error if password is too weak
   */
  private validatePassword(password: string): void {
    if (!password || password.length < 8) {
      throw new Error("Password must be at least 8 characters");
    }
  }
}
