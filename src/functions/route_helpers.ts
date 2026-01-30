/**
 * Route pattern utilities for function routing.
 *
 * Provides helpers for normalizing and comparing Hono route patterns
 * to detect potential collisions.
 */

/**
 * Normalize a Hono route pattern for collision detection.
 *
 * Converts route patterns to a canonical form by replacing named parameters
 * with wildcards while preserving regex constraints. This allows detection of
 * routes that would match the same URL paths.
 *
 * Normalization rules:
 * - Wildcard segments remain unchanged
 * - Named parameters become wildcards
 * - Optional parameters become wildcards
 * - Regex constraints are preserved
 *
 * @param routePattern A Hono route pattern
 * @returns Normalized pattern
 */
export function normalizeRoutePattern(routePattern: string): string {
  // Edge case: root path
  if (routePattern === "/") {
    return "/";
  }

  // Edge case: empty string
  if (routePattern === "") {
    return "";
  }

  // Split by slash to get segments
  const segments = routePattern.split("/");

  // Transform each segment according to normalization rules
  const normalized = segments.map((segment) => {
    // Empty segments (from leading/trailing slashes) - preserve
    if (segment === "") {
      return "";
    }

    // Wildcards stay unchanged
    if (segment === "*") {
      return "*";
    }

    // Check if segment is a parameter pattern
    // Pattern: :name with optional ? and/or {regex}
    // Regex breakdown:
    //   ^:           - starts with colon
    //   ([^?{]+)     - parameter name (capture group 1) - one or more chars that aren't ? or {
    //   (\?)?        - optional question mark (capture group 2)
    //   (\{.+\})?    - optional regex constraint in braces (capture group 3)
    //   $            - end of segment
    const paramMatch = segment.match(/^:([^?{]+)(\?)?(\{.+\})?$/);

    if (paramMatch) {
      // Extract the regex constraint part (if present)
      const regexPart = paramMatch[3];
      // Replace parameter with wildcard, preserve regex constraint
      return `*${regexPart ?? ""}`;
    }

    // Literal segment - keep as-is
    return segment;
  });

  // Rejoin segments and return
  return normalized.join("/");
}
