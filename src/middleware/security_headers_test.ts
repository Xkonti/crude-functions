import { expect } from "@std/expect";
import { Hono } from "@hono/hono";
import {
  createSecurityHeadersMiddleware,
  createWebCacheHeadersMiddleware,
} from "./security_headers.ts";

Deno.test("createSecurityHeadersMiddleware sets X-Frame-Options header", async () => {
  const app = new Hono();
  app.use("/*", createSecurityHeadersMiddleware());
  app.get("/test", (c) => c.text("ok"));

  const res = await app.request("/test");

  expect(res.headers.get("X-Frame-Options")).toBe("DENY");
});

Deno.test("createSecurityHeadersMiddleware sets X-Content-Type-Options header", async () => {
  const app = new Hono();
  app.use("/*", createSecurityHeadersMiddleware());
  app.get("/test", (c) => c.text("ok"));

  const res = await app.request("/test");

  expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
});

Deno.test("createSecurityHeadersMiddleware sets Content-Security-Policy header", async () => {
  const app = new Hono();
  app.use("/*", createSecurityHeadersMiddleware());
  app.get("/test", (c) => c.text("ok"));

  const res = await app.request("/test");

  expect(res.headers.get("Content-Security-Policy")).toBe("frame-ancestors 'none'");
});

Deno.test("createSecurityHeadersMiddleware sets Referrer-Policy header", async () => {
  const app = new Hono();
  app.use("/*", createSecurityHeadersMiddleware());
  app.get("/test", (c) => c.text("ok"));

  const res = await app.request("/test");

  expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
});

Deno.test("createSecurityHeadersMiddleware sets all headers on single response", async () => {
  const app = new Hono();
  app.use("/*", createSecurityHeadersMiddleware());
  app.get("/test", (c) => c.json({ message: "ok" }));

  const res = await app.request("/test");

  expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(res.headers.get("Content-Security-Policy")).toBe("frame-ancestors 'none'");
  expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
});

Deno.test("createWebCacheHeadersMiddleware sets Cache-Control for HTML responses", async () => {
  const app = new Hono();
  app.use("/*", createWebCacheHeadersMiddleware());
  app.get("/test", (c) => c.html("<html><body>Test</body></html>"));

  const res = await app.request("/test");

  expect(res.headers.get("Cache-Control")).toBe("no-store, no-cache, must-revalidate");
});

Deno.test("createWebCacheHeadersMiddleware does not set Cache-Control for JSON responses", async () => {
  const app = new Hono();
  app.use("/*", createWebCacheHeadersMiddleware());
  app.get("/test", (c) => c.json({ message: "ok" }));

  const res = await app.request("/test");

  // Should not have the no-store header for JSON
  expect(res.headers.get("Cache-Control")).toBeNull();
});

Deno.test("createWebCacheHeadersMiddleware does not set Cache-Control for plain text responses", async () => {
  const app = new Hono();
  app.use("/*", createWebCacheHeadersMiddleware());
  app.get("/test", (c) => c.text("plain text"));

  const res = await app.request("/test");

  // Should not have the no-store header for plain text
  expect(res.headers.get("Cache-Control")).toBeNull();
});

Deno.test("both middlewares can be combined", async () => {
  const app = new Hono();
  app.use("/*", createSecurityHeadersMiddleware());
  app.use("/*", createWebCacheHeadersMiddleware());
  app.get("/test", (c) => c.html("<html><body>Test</body></html>"));

  const res = await app.request("/test");

  // Security headers should be present
  expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(res.headers.get("Content-Security-Policy")).toBe("frame-ancestors 'none'");
  expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");

  // Cache header should be present for HTML
  expect(res.headers.get("Cache-Control")).toBe("no-store, no-cache, must-revalidate");
});
