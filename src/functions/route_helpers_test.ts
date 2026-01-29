import { expect } from "@std/expect";
import { normalizeRoutePattern } from "./route_helpers.ts";

// ========================================
// Simple Parameters
// ========================================

Deno.test("normalizeRoutePattern - single parameter", () => {
  expect(normalizeRoutePattern("/users/:id")).toBe("/users/*");
});

Deno.test("normalizeRoutePattern - multiple parameters", () => {
  expect(normalizeRoutePattern("/users/:userId/posts/:postId")).toBe(
    "/users/*/posts/*",
  );
});

Deno.test("normalizeRoutePattern - consecutive parameters", () => {
  expect(normalizeRoutePattern("/:a/:b/:c")).toBe("/*/*/*");
});

Deno.test("normalizeRoutePattern - single parameter only", () => {
  expect(normalizeRoutePattern("/:id")).toBe("/*");
});

// ========================================
// Optional Parameters
// ========================================

Deno.test("normalizeRoutePattern - optional parameter", () => {
  expect(normalizeRoutePattern("/product/:variant?")).toBe("/product/*");
});

Deno.test("normalizeRoutePattern - optional parameter in middle", () => {
  expect(normalizeRoutePattern("/api/:version?/users")).toBe("/api/*/users");
});

Deno.test("normalizeRoutePattern - multiple optional parameters", () => {
  expect(normalizeRoutePattern("/:a?/:b?/:c?")).toBe("/*/*/*");
});

// ========================================
// Regex Constraints
// ========================================

Deno.test("normalizeRoutePattern - parameter with numeric regex", () => {
  expect(normalizeRoutePattern("/:id{[0-9]+}")).toBe("/*{[0-9]+}");
});

Deno.test("normalizeRoutePattern - parameter with catch-all regex", () => {
  expect(normalizeRoutePattern("/:author/files/:path{.+}")).toBe(
    "/*/files/*{.+}",
  );
});

Deno.test("normalizeRoutePattern - parameter with alpha regex", () => {
  expect(normalizeRoutePattern("/:slug{[a-z-]+}")).toBe("/*{[a-z-]+}");
});

Deno.test("normalizeRoutePattern - multiple parameters with regex", () => {
  expect(normalizeRoutePattern("/:x{\\d+}/:y{\\w+}")).toBe(
    "/*{\\d+}/*{\\w+}",
  );
});

Deno.test("normalizeRoutePattern - parameter with complex regex", () => {
  expect(normalizeRoutePattern("/:service{(api|web)}")).toBe(
    "/*{(api|web)}",
  );
});

Deno.test("normalizeRoutePattern - parameter with git SHA regex", () => {
  expect(normalizeRoutePattern("/:org/:repo/commits/:sha{[0-9a-f]{40}}")).toBe(
    "/*/*/commits/*{[0-9a-f]{40}}",
  );
});

Deno.test("normalizeRoutePattern - parameter with escaped braces in regex", () => {
  expect(normalizeRoutePattern("/:id{\\{test\\}}")).toBe("/*{\\{test\\}}");
});

// ========================================
// Wildcards
// ========================================

Deno.test("normalizeRoutePattern - wildcard segment", () => {
  expect(normalizeRoutePattern("/api/*/endpoint")).toBe("/api/*/endpoint");
});

Deno.test("normalizeRoutePattern - multiple wildcards", () => {
  expect(normalizeRoutePattern("/*/admin/*")).toBe("/*/admin/*");
});

Deno.test("normalizeRoutePattern - wildcard only", () => {
  expect(normalizeRoutePattern("/*")).toBe("/*");
});

// ========================================
// Mixed Patterns
// ========================================

Deno.test("normalizeRoutePattern - wildcard and parameter", () => {
  expect(normalizeRoutePattern("/api/*/users/:id")).toBe("/api/*/users/*");
});

Deno.test("normalizeRoutePattern - parameter and wildcard", () => {
  expect(normalizeRoutePattern("/:version/api/*")).toBe("/*/api/*");
});

Deno.test("normalizeRoutePattern - complex mixed pattern", () => {
  expect(normalizeRoutePattern("/:org/:repo/*/commits/:sha{[0-9a-f]{40}}")).toBe(
    "/*/*/*/commits/*{[0-9a-f]{40}}",
  );
});

// ========================================
// Literal Paths (No Transformation)
// ========================================

Deno.test("normalizeRoutePattern - literal path unchanged", () => {
  expect(normalizeRoutePattern("/api/v1/users")).toBe("/api/v1/users");
});

Deno.test("normalizeRoutePattern - simple literal", () => {
  expect(normalizeRoutePattern("/hello")).toBe("/hello");
});

Deno.test("normalizeRoutePattern - nested literal path", () => {
  expect(normalizeRoutePattern("/api/v2/admin/settings")).toBe(
    "/api/v2/admin/settings",
  );
});

// ========================================
// Edge Cases
// ========================================

Deno.test("normalizeRoutePattern - root path", () => {
  expect(normalizeRoutePattern("/")).toBe("/");
});

Deno.test("normalizeRoutePattern - empty string", () => {
  expect(normalizeRoutePattern("")).toBe("");
});

Deno.test("normalizeRoutePattern - trailing slash", () => {
  expect(normalizeRoutePattern("/users/")).toBe("/users/");
});

Deno.test("normalizeRoutePattern - parameter with trailing slash", () => {
  expect(normalizeRoutePattern("/api/:id/")).toBe("/api/*/");
});

Deno.test("normalizeRoutePattern - leading and trailing slashes", () => {
  expect(normalizeRoutePattern("/api/:id/users/:userId/")).toBe(
    "/api/*/users/*/",
  );
});

// ========================================
// Real-World Examples
// ========================================

Deno.test("normalizeRoutePattern - example from user (product)", () => {
  expect(normalizeRoutePattern("/product/:id/:variant?")).toBe("/product/*/*");
});

Deno.test("normalizeRoutePattern - example from user (files)", () => {
  expect(normalizeRoutePattern("/:author/files/:path{.+}")).toBe(
    "/*/files/*{.+}",
  );
});

Deno.test("normalizeRoutePattern - GitHub-style route", () => {
  expect(normalizeRoutePattern("/:owner/:repo/issues/:number{[0-9]+}")).toBe(
    "/*/*/issues/*{[0-9]+}",
  );
});

Deno.test("normalizeRoutePattern - REST API route", () => {
  expect(normalizeRoutePattern("/api/v1/users/:userId/posts/:postId?")).toBe(
    "/api/v1/users/*/posts/*",
  );
});
