import type { Context, Next } from "@hono/hono";
import type { Auth } from "./auth.ts";
import type { ApiKeyService } from "../keys/api_key_service.ts";
import type { SettingsService } from "../settings/settings_service.ts";
import { SettingNames } from "../settings/types.ts";

/**
 * Options for the session-only auth middleware.
 */
export interface SessionAuthMiddlewareOptions {
  /** Better Auth instance */
  auth: Auth;
  /** URL to redirect to when unauthenticated */
  loginUrl?: string;
}

/**
 * Creates middleware that validates Better Auth sessions.
 * Redirects to login page if unauthenticated.
 *
 * Used for Web UI routes that require browser-based authentication.
 *
 * Sets on context:
 * - `user`: The authenticated user object
 * - `session`: The session object
 */
export function createSessionAuthMiddleware(options: SessionAuthMiddlewareOptions) {
  const loginUrl = options.loginUrl ?? "/web/login";

  return async (c: Context, next: Next) => {
    const { auth } = options;

    // Get session from cookies/headers
    const session = await auth.api.getSession({
      headers: c.req.raw.headers,
    });

    if (!session) {
      // Build redirect URL with callback
      const currentPath = new URL(c.req.url).pathname;
      const redirectUrl = `${loginUrl}?callbackUrl=${encodeURIComponent(currentPath)}`;
      return c.redirect(redirectUrl);
    }

    // Store session data in context for route handlers
    c.set("user", session.user);
    c.set("session", session.session);

    await next();
  };
}

/**
 * Options for the hybrid auth middleware.
 */
export interface HybridAuthMiddlewareOptions {
  /** Better Auth instance */
  auth: Auth;
  /** API key service for fallback authentication */
  apiKeyService: ApiKeyService;
  /** Settings service for reading access group configuration */
  settingsService: SettingsService;
}

/**
 * Creates middleware that validates EITHER Better Auth session OR API key.
 * Returns 401 JSON error if both authentication methods fail.
 *
 * Used for Management API routes that need both browser and programmatic access.
 *
 * API key validation checks against groups configured in the api.access-groups setting.
 *
 * Sets on context:
 * - `user`: The authenticated user object (if session auth)
 * - `session`: The session object (if session auth)
 * - `authMethod`: "session" or "api-key"
 * - `apiKeyGroup`: The matched API key group name (if api-key auth)
 */
export function createHybridAuthMiddleware(options: HybridAuthMiddlewareOptions) {
  return async (c: Context, next: Next) => {
    const { auth, apiKeyService, settingsService } = options;

    // 1. Try Better Auth session first
    const session = await auth.api.getSession({
      headers: c.req.raw.headers,
    });

    if (session) {
      c.set("user", session.user);
      c.set("session", session.session);
      c.set("authMethod", "session");
      await next();
      return;
    }

    // 2. Fall back to API key validation against configured groups
    const apiKey = c.req.header("X-API-Key");

    if (apiKey) {
      // Get allowed group IDs from settings
      const accessGroupsSetting = await settingsService.getGlobalSetting(
        SettingNames.API_ACCESS_GROUPS
      );

      if (accessGroupsSetting) {
        // Parse comma-separated numeric IDs
        const groupIds = accessGroupsSetting
          .split(",")
          .map((id) => parseInt(id.trim(), 10))
          .filter((id) => !isNaN(id));

        // Check API key against each allowed group by ID
        for (const groupId of groupIds) {
          if (await apiKeyService.hasKeyInGroup(groupId, apiKey)) {
            // Fetch group name for context
            const group = await apiKeyService.getGroupById(groupId);
            c.set("authMethod", "api-key");
            c.set("apiKeyGroup", group?.name ?? `group-${groupId}`);
            await next();
            return;
          }
        }
      }
    }

    // 3. Both failed - unauthorized
    return c.json({ error: "Unauthorized" }, 401);
  };
}
