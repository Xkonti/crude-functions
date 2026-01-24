/**
 * CSRF protection middleware for Hono.
 *
 * Implements double-submit cookie pattern:
 * 1. Sets a CSRF token cookie on every request
 * 2. Validates the token on state-changing requests (POST, PUT, DELETE, PATCH)
 * 3. Skips validation for API key authenticated requests
 */

import type { Context, Next } from "@hono/hono";
import { getCookie, setCookie } from "@hono/hono/cookie";
import type { CsrfService } from "./csrf_service.ts";

const CSRF_COOKIE_NAME = "csrf_token";
const CSRF_HEADER_NAME = "X-CSRF-Token";
const CSRF_FORM_FIELD = "_csrf";

/**
 * Safe HTTP methods that don't require CSRF validation.
 */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Creates CSRF protection middleware.
 *
 * This middleware:
 * - Ensures a valid CSRF token cookie exists on every request
 * - Stores the token in context for form rendering (c.get("csrfToken"))
 * - Validates CSRF token on state-changing requests
 * - Skips validation for API key authenticated requests
 *
 * Token can be submitted via:
 * - X-CSRF-Token header (for SPA/AJAX requests)
 * - _csrf form field (for traditional form submissions)
 */
export function createCsrfMiddleware(csrfService: CsrfService) {
  return async (c: Context, next: Next) => {
    // Get existing token from cookie
    let token = getCookie(c, CSRF_COOKIE_NAME);

    // Validate existing token or generate new one
    if (!token || !(await csrfService.validateToken(token))) {
      token = await csrfService.generateToken();
      setCookie(c, CSRF_COOKIE_NAME, token, {
        path: "/",
        httpOnly: false, // Must be readable by JavaScript for SPA
        sameSite: "Strict",
        secure: false, // Works over HTTP (user handles HTTPS via proxy)
      });
    }

    // Store token in context for form rendering
    c.set("csrfToken", token);

    // Skip validation for safe methods
    if (SAFE_METHODS.has(c.req.method)) {
      return next();
    }

    // Skip validation for API key authenticated requests
    // API key requests are authenticated per-request and don't need CSRF protection
    if (c.get("authMethod") === "api-key") {
      return next();
    }

    // Validate CSRF token for state-changing requests
    const headerToken = c.req.header(CSRF_HEADER_NAME);

    // Try to get form token - need to be careful not to consume the body
    // for non-form requests
    let formToken: string | undefined;
    const contentType = c.req.header("Content-Type") || "";

    if (
      contentType.includes("application/x-www-form-urlencoded") ||
      contentType.includes("multipart/form-data")
    ) {
      try {
        // Clone the request to avoid consuming the body
        const clonedRequest = c.req.raw.clone();
        const formData = await clonedRequest.formData();
        formToken = formData.get(CSRF_FORM_FIELD)?.toString();
      } catch {
        // If parsing fails, formToken remains undefined
      }
    }

    const submittedToken = headerToken || formToken;

    // If no token submitted, reject
    if (!submittedToken) {
      return c.json({ error: "CSRF token missing" }, 403);
    }

    // Validate the submitted token matches the cookie
    if (submittedToken !== token) {
      return c.json({ error: "Invalid CSRF token" }, 403);
    }

    return next();
  };
}
