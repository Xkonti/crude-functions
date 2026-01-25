import { betterAuth } from "better-auth";
import { admin } from "better-auth/plugins";
import { createAccessControl } from "better-auth/plugins/access";
import { surrealAdapter } from "./surreal_adapter.ts";
import type { SurrealConnectionFactory } from "../database/surreal_connection_factory.ts";

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
  /** SurrealDB connection factory for database access */
  surrealFactory: SurrealConnectionFactory;
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
      console.warn(`Invalid AUTH_BASE_URL: ${configuredBaseUrl}`, error);
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
 * Uses SurrealDB adapter for database operations.
 * The adapter handles all record ID conversions and foreign key relationships.
 */
export function createAuth(options: AuthOptions) {
  return betterAuth({
    database: surrealAdapter({
      surrealFactory: options.surrealFactory,
    }),
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

    // SurrealDB adapter doesn't support JOINs, so disable this
    experimental: {
      joins: false,
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
