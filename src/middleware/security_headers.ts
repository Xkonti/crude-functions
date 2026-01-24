/**
 * Security headers middleware for the management app.
 *
 * Adds standard security headers to protect against common attacks:
 * - X-Frame-Options: DENY - Prevents clickjacking
 * - X-Content-Type-Options: nosniff - Prevents MIME type sniffing
 * - Content-Security-Policy: frame-ancestors 'none' - Additional clickjacking protection
 * - Referrer-Policy: no-referrer - Maximum privacy for internal tool
 */

import type { Context, Next } from "@hono/hono";

/**
 * Creates middleware that adds security headers to all management app responses.
 *
 * These headers protect against common web vulnerabilities:
 * - Clickjacking (X-Frame-Options, CSP frame-ancestors)
 * - MIME type confusion attacks (X-Content-Type-Options)
 * - Referrer leakage (Referrer-Policy)
 */
export function createSecurityHeadersMiddleware() {
  return async (c: Context, next: Next) => {
    await next();

    c.header("X-Frame-Options", "DENY");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Content-Security-Policy", "frame-ancestors 'none'");
    c.header("Referrer-Policy", "no-referrer");
  };
}

/**
 * Creates middleware that adds cache control headers to web UI HTML responses.
 *
 * This prevents browsers from caching sensitive admin pages, ensuring users
 * always see fresh content and preventing cached pages from being viewed
 * after logout.
 *
 * Only applies to HTML responses - static assets can still be cached normally.
 */
export function createWebCacheHeadersMiddleware() {
  return async (c: Context, next: Next) => {
    await next();

    // Only add no-store to HTML responses, not static assets
    const contentType = c.res.headers.get("Content-Type") || "";
    if (contentType.includes("text/html")) {
      c.header("Cache-Control", "no-store, no-cache, must-revalidate");
    }
  };
}
