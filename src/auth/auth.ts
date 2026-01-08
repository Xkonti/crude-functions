import { betterAuth } from "better-auth";
import { admin } from "better-auth/plugins";
import { createAccessControl } from "better-auth/plugins/access";
import { Database } from "@db/sqlite";
import { DenoSqlite3Dialect } from "@soapbox/kysely-deno-sqlite";

/**
 * Access control statement defining resources and their available actions.
 * Used by the admin plugin for role-based access control.
 */
const statement = {
  user: ["create", "list", "set-role", "ban", "impersonate", "delete", "set-password"],
} as const;

const ac = createAccessControl(statement);

/**
 * Custom role for user management access.
 * Users with this role can manage other users through the admin API.
 */
const userMgmt = ac.newRole({
  user: ["create", "list", "set-role", "delete", "set-password"],
});

/**
 * Custom role for read-only user access.
 * Users with this role can only list users, not make changes.
 */
const userRead = ac.newRole({
  user: ["list"],
});

/**
 * Options for creating the Better Auth instance.
 */
export interface AuthOptions {
  /** Path to the SQLite database file */
  databasePath: string;
  /** Base URL for the application (optional - auto-detected from requests if not set) */
  baseUrl?: string;
  /** Secret key for signing sessions */
  secret: string;
  /** Whether users exist in the database (controls sign-up availability) */
  hasUsers: boolean;
}

/**
 * Determines trusted origins for Better Auth based on configuration and request.
 *
 * Resolution order:
 * 1. If baseUrl is explicitly configured, trust only that origin
 * 2. Otherwise, trust the request's origin (for self-hosted deployments)
 * 3. Always trust localhost origins for development
 *
 * Future: Can be extended to include database-stored origins
 */
export function getTrustedOrigins(
  configuredBaseUrl: string | undefined,
  request?: Request
): string[] {
  const origins: Set<string> = new Set();

  // Always trust localhost for development (all ports)
  origins.add("http://localhost");
  origins.add("http://127.0.0.1");

  // If explicit base URL is configured, trust only that
  if (configuredBaseUrl) {
    try {
      const url = new URL(configuredBaseUrl);
      origins.add(url.origin);
    } catch (error) {
      console.warn(`Invalid BETTER_AUTH_BASE_URL: ${configuredBaseUrl}`, error);
    }
    return Array.from(origins);
  }

  // Auto-detect from request origin if available
  if (request) {
    const requestOrigin = new URL(request.url).origin;
    origins.add(requestOrigin);

    // Check for reverse proxy headers
    const forwardedProto = request.headers.get("X-Forwarded-Proto");
    const forwardedHost = request.headers.get("X-Forwarded-Host") || request.headers.get("Host");

    if (forwardedProto && forwardedHost) {
      origins.add(`${forwardedProto}://${forwardedHost}`);
    }
  }

  return Array.from(origins);
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

    // Dynamic origin validation based on incoming request
    trustedOrigins: (request?: Request) => {
      return getTrustedOrigins(options.baseUrl, request);
    },

    // Performance: Use JOINs for session lookups (2-3x faster)
    experimental: {
      joins: true,
    },

    // Admin plugin for user management
    plugins: [
      admin({
        ac,
        roles: {
          userMgmt,
          userRead,
        },
        defaultRole: "userMgmt",
        adminRoles: ["userMgmt"],
      }),
    ],
  });
}

/**
 * Type of the Better Auth instance returned by createAuth.
 */
export type Auth = ReturnType<typeof createAuth>;
