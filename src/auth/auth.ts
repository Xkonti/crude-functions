import { betterAuth } from "better-auth";
import { Database } from "@db/sqlite";
import { DenoSqlite3Dialect } from "@soapbox/kysely-deno-sqlite";

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
  /** Whether users exist in the database (controls sign-up availability) */
  hasUsers: boolean;
}

/**
 * Creates and configures the Better Auth instance.
 *
 * Uses DenoSqlite3Dialect for Kysely compatibility with Deno's @db/sqlite.
 * Creates its own SQLite connection - safe because SQLite WAL mode supports
 * multiple connections.
 */
export function createAuth(options: AuthOptions) {
  // Create a Kysely dialect compatible with Deno's @db/sqlite
  const sqliteDb = new Database(options.databasePath);
  const dialect = new DenoSqlite3Dialect({ database: sqliteDb });

  return betterAuth({
    database: {
      dialect,
      type: "sqlite",
    },
    baseURL: options.baseUrl,
    secret: options.secret,

    // Email/password authentication only (no OAuth providers)
    // Sign-up is only enabled during first-run setup (when no users exist)
    emailAndPassword: {
      enabled: true,
      disableSignUp: options.hasUsers,
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
