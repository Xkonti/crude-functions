import type { Auth } from "./auth.ts";
import type { DatabaseService } from "../database/database_service.ts";

/**
 * Options for the AdminSeeder.
 */
export interface AdminSeederOptions {
  /** Better Auth instance */
  auth: Auth;
  /** Database service for direct user lookups */
  db: DatabaseService;
  /** Admin email from environment */
  adminEmail?: string;
  /** Admin password from environment */
  adminPassword?: string;
}

/**
 * Seeds the initial admin user on application startup.
 *
 * Creates the admin user if credentials are provided via environment
 * variables and the user doesn't already exist. Safe to run on every
 * startup (idempotent).
 */
export class AdminSeeder {
  private readonly auth: Auth;
  private readonly db: DatabaseService;
  private readonly adminEmail?: string;
  private readonly adminPassword?: string;

  constructor(options: AdminSeederOptions) {
    this.auth = options.auth;
    this.db = options.db;
    this.adminEmail = options.adminEmail;
    this.adminPassword = options.adminPassword;
  }

  /**
   * Seeds the admin user if credentials are configured and user doesn't exist.
   */
  async seed(): Promise<void> {
    if (!this.adminEmail || !this.adminPassword) {
      console.log("No admin credentials provided - skipping admin user creation");
      return;
    }

    // Check if user already exists
    const existingUser = await this.db.queryOne<{ id: string }>(
      "SELECT id FROM user WHERE email = ?",
      [this.adminEmail]
    );

    if (existingUser) {
      console.log(`Admin user ${this.adminEmail} already exists`);
      return;
    }

    // Create admin user via Better Auth's signUp API
    try {
      await this.auth.api.signUpEmail({
        body: {
          email: this.adminEmail,
          password: this.adminPassword,
          name: "Admin",
        },
      });

      console.log(`Created admin user: ${this.adminEmail}`);
    } catch (error) {
      console.error("Failed to create admin user:", error);
      throw new Error("Admin user creation failed");
    }
  }
}
