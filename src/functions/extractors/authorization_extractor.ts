import type { Context } from "@hono/hono";
import type { ApiKeyExtractor, ApiKeyExtractResult } from "./types.ts";
import { logger } from "../../utils/logger.ts";

/**
 * Extracts API keys from the Authorization header.
 * Supports:
 * - Bearer token: "Authorization: Bearer <key>"
 * - Plain value: "Authorization: <key>" (no prefix)
 * - Basic auth: "Authorization: Basic <base64>" where key is the password (username empty)
 */
export class AuthorizationExtractor implements ApiKeyExtractor {
  readonly name = "Authorization";

  extract(c: Context): ApiKeyExtractResult | null {
    const authHeader = c.req.header("Authorization");
    if (!authHeader) {
      return null;
    }

    // 1. Try Bearer token first
    if (authHeader.startsWith("Bearer ")) {
      const key = authHeader.slice(7); // Remove "Bearer " prefix
      if (key) {
        logger.debug("API key extracted from Authorization Bearer header");
        return {
          key,
          source: "Authorization Bearer",
        };
      }
    }

    // 2. Try plain value (no recognized prefix)
    // Check if it looks like a known scheme that we should skip
    const knownSchemes = ["bearer", "basic", "digest", "hoba", "mutual", "negotiate", "oauth", "scram-sha-1", "scram-sha-256", "vapid"];
    const firstSpace = authHeader.indexOf(" ");
    if (firstSpace === -1) {
      // No space - could be plain value OR just a scheme name (malformed)
      // Reject known scheme names used alone (e.g., "Bearer" without a token)
      if (knownSchemes.includes(authHeader.toLowerCase())) {
        return null;
      }
      // Not a known scheme - treat entire value as the key
      logger.debug("API key extracted from Authorization header (plain value)");
      return {
        key: authHeader,
        source: "Authorization plain",
      };
    }

    const scheme = authHeader.slice(0, firstSpace).toLowerCase();

    // 3. Try Basic auth (key as password, username empty)
    if (scheme === "basic") {
      const base64 = authHeader.slice(6); // Remove "Basic " prefix
      try {
        const decoded = atob(base64);
        // Format: ":password" (empty username, key as password)
        if (decoded.startsWith(":")) {
          const key = decoded.slice(1);
          if (key) {
            logger.debug("API key extracted from Authorization Basic header (as password)");
            return {
              key,
              source: "Authorization Basic",
            };
          }
        }
      } catch {
        // Invalid base64, ignore
      }
      return null;
    }

    // Unknown scheme - skip
    if (knownSchemes.includes(scheme)) {
      return null;
    }

    // Not a known scheme, treat the value after the space as the key
    // (e.g., "Token abc123" -> "abc123")
    const key = authHeader.slice(firstSpace + 1);
    if (key) {
      logger.debug(`API key extracted from Authorization header (custom scheme: ${scheme})`);
      return {
        key,
        source: "Authorization plain",
      };
    }

    return null;
  }
}
