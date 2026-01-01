import { expect } from "@std/expect";
import { Hono } from "@hono/hono";
import type { Context } from "@hono/hono";
import { HeaderExtractor } from "./header_extractor.ts";
import { AuthorizationExtractor } from "./authorization_extractor.ts";
import { QueryParamExtractor } from "./query_extractor.ts";
import { createDefaultExtractors } from "./mod.ts";

// Helper to create a mock context from a Request
async function createContext(request: Request): Promise<Context> {
  const app = new Hono();
  let capturedContext: Context | null = null;

  app.all("*", (c) => {
    capturedContext = c;
    return c.text("ok");
  });

  await app.fetch(request);
  return capturedContext!;
}

// =====================
// HeaderExtractor tests
// =====================

Deno.test("HeaderExtractor extracts X-API-Key header", async () => {
  const extractor = new HeaderExtractor();
  const c = await createContext(
    new Request("http://localhost/test", {
      headers: { "X-API-Key": "secret123" },
    })
  );

  const result = extractor.extract(c);
  expect(result).not.toBeNull();
  expect(result!.key).toBe("secret123");
  expect(result!.source).toBe("X-API-Key header");
});

Deno.test("HeaderExtractor extracts X-Auth-Token header", async () => {
  const extractor = new HeaderExtractor();
  const c = await createContext(
    new Request("http://localhost/test", {
      headers: { "X-Auth-Token": "token456" },
    })
  );

  const result = extractor.extract(c);
  expect(result).not.toBeNull();
  expect(result!.key).toBe("token456");
  expect(result!.source).toBe("X-Auth-Token header");
});

Deno.test("HeaderExtractor extracts Api-Key header", async () => {
  const extractor = new HeaderExtractor();
  const c = await createContext(
    new Request("http://localhost/test", {
      headers: { "Api-Key": "apikey789" },
    })
  );

  const result = extractor.extract(c);
  expect(result).not.toBeNull();
  expect(result!.key).toBe("apikey789");
  expect(result!.source).toBe("Api-Key header");
});

Deno.test("HeaderExtractor extracts X-Access-Token header", async () => {
  const extractor = new HeaderExtractor();
  const c = await createContext(
    new Request("http://localhost/test", {
      headers: { "X-Access-Token": "access123" },
    })
  );

  const result = extractor.extract(c);
  expect(result).not.toBeNull();
  expect(result!.key).toBe("access123");
  expect(result!.source).toBe("X-Access-Token header");
});

Deno.test("HeaderExtractor respects priority order", async () => {
  const extractor = new HeaderExtractor();
  const c = await createContext(
    new Request("http://localhost/test", {
      headers: {
        "X-API-Key": "first",
        "X-Auth-Token": "second",
      },
    })
  );

  const result = extractor.extract(c);
  expect(result).not.toBeNull();
  expect(result!.key).toBe("first");
  expect(result!.source).toBe("X-API-Key header");
});

Deno.test("HeaderExtractor returns null when no header present", async () => {
  const extractor = new HeaderExtractor();
  const c = await createContext(new Request("http://localhost/test"));

  const result = extractor.extract(c);
  expect(result).toBeNull();
});

Deno.test("HeaderExtractor supports custom headers", async () => {
  const extractor = new HeaderExtractor(["Custom-Key", "Another-Key"]);
  const c = await createContext(
    new Request("http://localhost/test", {
      headers: { "Custom-Key": "custom123" },
    })
  );

  const result = extractor.extract(c);
  expect(result).not.toBeNull();
  expect(result!.key).toBe("custom123");
  expect(result!.source).toBe("Custom-Key header");
});

// ============================
// AuthorizationExtractor tests
// ============================

Deno.test("AuthorizationExtractor extracts Bearer token", async () => {
  const extractor = new AuthorizationExtractor();
  const c = await createContext(
    new Request("http://localhost/test", {
      headers: { Authorization: "Bearer mytoken123" },
    })
  );

  const result = extractor.extract(c);
  expect(result).not.toBeNull();
  expect(result!.key).toBe("mytoken123");
  expect(result!.source).toBe("Authorization Bearer");
});

Deno.test("AuthorizationExtractor extracts plain value (no space)", async () => {
  const extractor = new AuthorizationExtractor();
  const c = await createContext(
    new Request("http://localhost/test", {
      headers: { Authorization: "plainkey123" },
    })
  );

  const result = extractor.extract(c);
  expect(result).not.toBeNull();
  expect(result!.key).toBe("plainkey123");
  expect(result!.source).toBe("Authorization plain");
});

Deno.test("AuthorizationExtractor extracts plain value with unknown scheme", async () => {
  const extractor = new AuthorizationExtractor();
  const c = await createContext(
    new Request("http://localhost/test", {
      headers: { Authorization: "Token abc123" },
    })
  );

  const result = extractor.extract(c);
  expect(result).not.toBeNull();
  expect(result!.key).toBe("abc123");
  expect(result!.source).toBe("Authorization plain");
});

Deno.test("AuthorizationExtractor extracts Basic auth (key as password)", async () => {
  const extractor = new AuthorizationExtractor();
  // Base64 of ":secretpassword" (empty username, password is the key)
  const encoded = btoa(":secretpassword");
  const c = await createContext(
    new Request("http://localhost/test", {
      headers: { Authorization: `Basic ${encoded}` },
    })
  );

  const result = extractor.extract(c);
  expect(result).not.toBeNull();
  expect(result!.key).toBe("secretpassword");
  expect(result!.source).toBe("Authorization Basic");
});

Deno.test("AuthorizationExtractor ignores Basic auth with username", async () => {
  const extractor = new AuthorizationExtractor();
  // Base64 of "user:password" (has username, not what we want)
  const encoded = btoa("user:password");
  const c = await createContext(
    new Request("http://localhost/test", {
      headers: { Authorization: `Basic ${encoded}` },
    })
  );

  const result = extractor.extract(c);
  expect(result).toBeNull();
});

Deno.test("AuthorizationExtractor ignores invalid base64 in Basic auth", async () => {
  const extractor = new AuthorizationExtractor();
  const c = await createContext(
    new Request("http://localhost/test", {
      headers: { Authorization: "Basic not-valid-base64!!!" },
    })
  );

  const result = extractor.extract(c);
  expect(result).toBeNull();
});

Deno.test("AuthorizationExtractor ignores Digest scheme", async () => {
  const extractor = new AuthorizationExtractor();
  const c = await createContext(
    new Request("http://localhost/test", {
      headers: { Authorization: "Digest username=\"test\"" },
    })
  );

  const result = extractor.extract(c);
  expect(result).toBeNull();
});

Deno.test("AuthorizationExtractor returns null when header missing", async () => {
  const extractor = new AuthorizationExtractor();
  const c = await createContext(new Request("http://localhost/test"));

  const result = extractor.extract(c);
  expect(result).toBeNull();
});

Deno.test("AuthorizationExtractor handles empty Bearer token", async () => {
  const extractor = new AuthorizationExtractor();
  const c = await createContext(
    new Request("http://localhost/test", {
      headers: { Authorization: "Bearer " },
    })
  );

  const result = extractor.extract(c);
  // Empty token after Bearer is treated as no match, falls through to plain
  expect(result).toBeNull();
});

// ==========================
// QueryParamExtractor tests
// ==========================

Deno.test("QueryParamExtractor extracts api_key param", async () => {
  const extractor = new QueryParamExtractor();
  const c = await createContext(
    new Request("http://localhost/test?api_key=querykey123")
  );

  const result = extractor.extract(c);
  expect(result).not.toBeNull();
  expect(result!.key).toBe("querykey123");
  expect(result!.source).toBe("query:api_key");
});

Deno.test("QueryParamExtractor extracts apiKey param", async () => {
  const extractor = new QueryParamExtractor();
  const c = await createContext(
    new Request("http://localhost/test?apiKey=camelkey456")
  );

  const result = extractor.extract(c);
  expect(result).not.toBeNull();
  expect(result!.key).toBe("camelkey456");
  expect(result!.source).toBe("query:apiKey");
});

Deno.test("QueryParamExtractor respects priority order", async () => {
  const extractor = new QueryParamExtractor();
  const c = await createContext(
    new Request("http://localhost/test?api_key=first&apiKey=second")
  );

  const result = extractor.extract(c);
  expect(result).not.toBeNull();
  expect(result!.key).toBe("first");
  expect(result!.source).toBe("query:api_key");
});

Deno.test("QueryParamExtractor returns null when no param present", async () => {
  const extractor = new QueryParamExtractor();
  const c = await createContext(
    new Request("http://localhost/test?other=value")
  );

  const result = extractor.extract(c);
  expect(result).toBeNull();
});

Deno.test("QueryParamExtractor supports custom param names", async () => {
  const extractor = new QueryParamExtractor(["token", "key"]);
  const c = await createContext(
    new Request("http://localhost/test?token=customtoken")
  );

  const result = extractor.extract(c);
  expect(result).not.toBeNull();
  expect(result!.key).toBe("customtoken");
  expect(result!.source).toBe("query:token");
});

// ============================
// Default extractor chain tests
// ============================

Deno.test("createDefaultExtractors returns extractors in correct order", () => {
  const extractors = createDefaultExtractors();

  expect(extractors.length).toBe(3);
  expect(extractors[0].name).toBe("Authorization");
  expect(extractors[1].name).toBe("Header");
  expect(extractors[2].name).toBe("QueryParam");
});

Deno.test("Default extractors prioritize Authorization Bearer over X-API-Key", async () => {
  const extractors = createDefaultExtractors();
  const c = await createContext(
    new Request("http://localhost/test", {
      headers: {
        Authorization: "Bearer bearer123",
        "X-API-Key": "header456",
      },
    })
  );

  // First extractor (Authorization) should find it first
  const result = extractors[0].extract(c);
  expect(result).not.toBeNull();
  expect(result!.key).toBe("bearer123");
  expect(result!.source).toBe("Authorization Bearer");
});

Deno.test("Default extractors fall back to X-API-Key when no Authorization", async () => {
  const extractors = createDefaultExtractors();
  const c = await createContext(
    new Request("http://localhost/test", {
      headers: { "X-API-Key": "header456" },
    })
  );

  // Authorization extractor returns null
  expect(extractors[0].extract(c)).toBeNull();
  // Header extractor finds it
  const result = extractors[1].extract(c);
  expect(result).not.toBeNull();
  expect(result!.key).toBe("header456");
});

Deno.test("Default extractors fall back to query param when no headers", async () => {
  const extractors = createDefaultExtractors();
  const c = await createContext(
    new Request("http://localhost/test?api_key=query789")
  );

  // Authorization extractor returns null
  expect(extractors[0].extract(c)).toBeNull();
  // Header extractor returns null
  expect(extractors[1].extract(c)).toBeNull();
  // Query param extractor finds it
  const result = extractors[2].extract(c);
  expect(result).not.toBeNull();
  expect(result!.key).toBe("query789");
});
