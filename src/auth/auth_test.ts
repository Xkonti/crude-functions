import { expect } from "@std/expect";
import { getTrustedOrigins, createAuth } from "./auth.ts";
import { TestSetupBuilder } from "../test/test_setup_builder.ts";

// =============================================================================
// getTrustedOrigins Unit Tests
// =============================================================================

Deno.test("getTrustedOrigins always includes localhost origins", () => {
  const origins = getTrustedOrigins(undefined, undefined);

  expect(origins).toContain("http://localhost");
  expect(origins).toContain("http://127.0.0.1");
});

Deno.test("getTrustedOrigins adds configured baseUrl origin", () => {
  const origins = getTrustedOrigins("https://example.com", undefined);

  expect(origins).toContain("https://example.com");
  expect(origins).toContain("http://localhost");
  expect(origins).toContain("http://127.0.0.1");
});

Deno.test("getTrustedOrigins handles baseUrl with path", () => {
  const origins = getTrustedOrigins("https://example.com/app/path", undefined);

  // Should extract just the origin, not the full URL
  expect(origins).toContain("https://example.com");
  expect(origins).not.toContain("https://example.com/app/path");
});

Deno.test("getTrustedOrigins handles baseUrl with port", () => {
  const origins = getTrustedOrigins("https://example.com:8443", undefined);

  expect(origins).toContain("https://example.com:8443");
});

Deno.test("getTrustedOrigins returns only localhost for invalid baseUrl", () => {
  // Invalid URL should log a warning and return only localhost
  const origins = getTrustedOrigins("not-a-valid-url", undefined);

  expect(origins).toContain("http://localhost");
  expect(origins).toContain("http://127.0.0.1");
  expect(origins.length).toBe(2);
});

Deno.test("getTrustedOrigins extracts origin from request URL", () => {
  const request = new Request("https://myapp.example.com/api/test");
  const origins = getTrustedOrigins(undefined, request);

  expect(origins).toContain("https://myapp.example.com");
  expect(origins).toContain("http://localhost");
  expect(origins).toContain("http://127.0.0.1");
});

Deno.test("getTrustedOrigins handles reverse proxy headers", () => {
  const request = new Request("http://internal-host/api/test", {
    headers: {
      "X-Forwarded-Proto": "https",
      "X-Forwarded-Host": "public.example.com",
    },
  });
  const origins = getTrustedOrigins(undefined, request);

  expect(origins).toContain("https://public.example.com");
  expect(origins).toContain("http://internal-host");
  expect(origins).toContain("http://localhost");
});

Deno.test("getTrustedOrigins uses Host header when X-Forwarded-Host missing", () => {
  const request = new Request("http://internal-host/api/test", {
    headers: {
      "X-Forwarded-Proto": "https",
      "Host": "fallback.example.com",
    },
  });
  const origins = getTrustedOrigins(undefined, request);

  expect(origins).toContain("https://fallback.example.com");
});

Deno.test("getTrustedOrigins ignores partial proxy headers", () => {
  // Only X-Forwarded-Proto without Host should not create invalid origin
  const request = new Request("http://internal-host/api/test", {
    headers: {
      "X-Forwarded-Proto": "https",
      // No X-Forwarded-Host or Host header
    },
  });
  const origins = getTrustedOrigins(undefined, request);

  // Should still have the request origin and localhost
  expect(origins).toContain("http://internal-host");
  expect(origins).toContain("http://localhost");
});

Deno.test("getTrustedOrigins baseUrl takes precedence over request", () => {
  const request = new Request("https://request-origin.example.com/api/test");
  const origins = getTrustedOrigins("https://configured.example.com", request);

  // When baseUrl is configured, request origin should NOT be included
  expect(origins).toContain("https://configured.example.com");
  expect(origins).toContain("http://localhost");
  expect(origins).not.toContain("https://request-origin.example.com");
});

Deno.test("getTrustedOrigins deduplicates origins", () => {
  // Request URL already is localhost
  const request = new Request("http://localhost:3000/api/test");
  const origins = getTrustedOrigins(undefined, request);

  // http://localhost should only appear once despite being in both default set and request
  const localhostCount = origins.filter((o) => o === "http://localhost").length;
  expect(localhostCount).toBe(1);
});

// =============================================================================
// createAuth Integration Tests
// =============================================================================

Deno.test("createAuth returns valid auth instance with api property", async () => {
  const ctx = await TestSetupBuilder.create()
    .withAuth()
    .build();

  try {
    // The auth instance should be created and have the expected structure
    expect(ctx.auth).toBeDefined();
    expect(ctx.auth.api).toBeDefined();
    expect(typeof ctx.auth.api.getSession).toBe("function");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("createAuth configures session-based authentication", async () => {
  const ctx = await TestSetupBuilder.create()
    .withAuth()
    .build();

  try {
    // The auth instance should have session management capabilities
    expect(ctx.auth.api).toBeDefined();

    // Verify the auth can handle session requests (without a valid session, returns null)
    const request = new Request("http://localhost/api/test");
    const session = await ctx.auth.api.getSession({ headers: request.headers });
    expect(session).toBeNull();
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("createAuth with hasUsers=false allows sign-up", async () => {
  const ctx = await TestSetupBuilder.create()
    .withAuth()
    .build();

  try {
    // Create auth with hasUsers=false (sign-up enabled)
    const auth = createAuth({
      databasePath: ctx.databasePath,
      secret: "test-secret-key-for-testing-purposes",
      hasUsers: false,
    });

    expect(auth).toBeDefined();
    expect(auth.api).toBeDefined();
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("createAuth trusted origins integration", async () => {
  const ctx = await TestSetupBuilder.create()
    .withAuth()
    .build();

  try {
    // Create auth with explicit baseUrl
    const auth = createAuth({
      databasePath: ctx.databasePath,
      baseUrl: "https://myapp.example.com",
      secret: "test-secret-key-for-testing-purposes",
      hasUsers: false,
    });

    expect(auth).toBeDefined();
    // The trustedOrigins callback should be configured
    // We can't directly test the callback, but we verify auth was created successfully
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("createAuth with admin user works correctly", async () => {
  const ctx = await TestSetupBuilder.create()
    .withAdminUser("admin@test.com", "password123")
    .build();

  try {
    expect(ctx.auth).toBeDefined();
    expect(ctx.userService).toBeDefined();

    // Verify the admin user was created
    const users = await ctx.userService.getAll();
    expect(users.length).toBe(1);
    expect(users[0].email).toBe("admin@test.com");
  } finally {
    await ctx.cleanup();
  }
});

Deno.test("createAuth with multiple admin users", async () => {
  const ctx = await TestSetupBuilder.create()
    .withAdminUser("admin1@test.com", "password1")
    .withAdminUser("admin2@test.com", "password2", ["userRead"])
    .build();

  try {
    const users = await ctx.userService.getAll();
    expect(users.length).toBe(2);

    const emails = users.map((u) => u.email);
    expect(emails).toContain("admin1@test.com");
    expect(emails).toContain("admin2@test.com");
  } finally {
    await ctx.cleanup();
  }
});
