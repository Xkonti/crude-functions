import { betterAuth } from "better-auth";
import { Database } from "@db/sqlite";

/**
 * Options for creating the Better Auth instance.
 */
export interface AuthOptions {
  /** Path to the SQLite database file */
  databasePath: string;
  /** Base URL for the application (used for redirects and callbacks) */
  baseUrl: string;
  /** Secret key for signing sessions */
  secret: string;
}

/**
 * Creates and configures the Better Auth instance.
 *
 * Creates its own SQLite connection to the database file.
 * Better Auth wraps it with Kysely internally.
 * This is safe because SQLite in WAL mode supports multiple connections.
 */
export function createAuth(options: AuthOptions) {
  // Create a new database connection for Better Auth
  // Better Auth will wrap it with Kysely internally
  const sqliteDb = new Database(options.databasePath);

  return betterAuth({
    database: sqliteDb,
    baseURL: options.baseUrl,
    secret: options.secret,

    // Email/password authentication only (no OAuth providers)
    emailAndPassword: {
      enabled: true,
      disableSignUp: true, // Only admin can create accounts
    },

    // Session configuration
    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // Refresh if session is older than 1 day
    },

    // Trust the configured base URL for redirects
    trustedOrigins: [options.baseUrl],

    // Performance: Use JOINs for session lookups (2-3x faster)
    experimental: {
      joins: true,
    },

    // Custom user fields
    user: {
      additionalFields: {
        permissions: {
          type: "string",
          required: false,
          defaultValue: null,
          input: false, // Don't allow user to set permissions
        },
      },
    },
  });
}

/**
 * Type of the Better Auth instance returned by createAuth.
 */
export type Auth = ReturnType<typeof createAuth>;
