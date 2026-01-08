import { expect } from "@std/expect";
import { getContentType, isTextContentType } from "./content_type.ts";

// ============================================================================
// getContentType Tests
// ============================================================================

Deno.test("getContentType returns correct types for TypeScript files", () => {
  expect(getContentType("file.ts")).toBe("text/typescript");
  expect(getContentType("file.tsx")).toBe("text/typescript");
  expect(getContentType("file.mts")).toBe("text/typescript");
  expect(getContentType("file.cts")).toBe("text/typescript");
});

Deno.test("getContentType returns correct types for JavaScript files", () => {
  expect(getContentType("file.js")).toBe("text/javascript");
  expect(getContentType("file.jsx")).toBe("text/javascript");
  expect(getContentType("file.mjs")).toBe("text/javascript");
  expect(getContentType("file.cjs")).toBe("text/javascript");
});

Deno.test("getContentType returns correct types for web files", () => {
  expect(getContentType("file.html")).toBe("text/html");
  expect(getContentType("file.htm")).toBe("text/html");
  expect(getContentType("file.css")).toBe("text/css");
  expect(getContentType("file.json")).toBe("application/json");
});

Deno.test("getContentType returns correct types for images", () => {
  expect(getContentType("file.png")).toBe("image/png");
  expect(getContentType("file.jpg")).toBe("image/jpeg");
  expect(getContentType("file.jpeg")).toBe("image/jpeg");
  expect(getContentType("file.gif")).toBe("image/gif");
  expect(getContentType("file.webp")).toBe("image/webp");
  expect(getContentType("file.svg")).toBe("image/svg+xml");
  expect(getContentType("file.ico")).toBe("image/x-icon");
});

Deno.test("getContentType returns correct types for binary files", () => {
  expect(getContentType("file.wasm")).toBe("application/wasm");
  expect(getContentType("file.bin")).toBe("application/octet-stream");
  expect(getContentType("file.pdf")).toBe("application/pdf");
  expect(getContentType("file.zip")).toBe("application/zip");
});

Deno.test("getContentType returns correct types for audio/video", () => {
  expect(getContentType("file.mp3")).toBe("audio/mpeg");
  expect(getContentType("file.wav")).toBe("audio/wav");
  expect(getContentType("file.mp4")).toBe("video/mp4");
  expect(getContentType("file.webm")).toBe("video/webm");
});

Deno.test("getContentType returns correct types for config files", () => {
  expect(getContentType(".env")).toBe("text/plain");
  expect(getContentType(".gitignore")).toBe("text/plain");
  expect(getContentType(".prettierrc")).toBe("application/json");
  expect(getContentType("file.yaml")).toBe("text/yaml");
  expect(getContentType("file.yml")).toBe("text/yaml");
});

Deno.test("getContentType returns octet-stream for unknown extensions", () => {
  expect(getContentType("file.xyz")).toBe("application/octet-stream");
  expect(getContentType("file.unknown")).toBe("application/octet-stream");
  expect(getContentType("randomfile")).toBe("application/octet-stream");
});

Deno.test("getContentType handles files with no extension", () => {
  expect(getContentType("Makefile")).toBe("application/octet-stream");
  expect(getContentType("LICENSE")).toBe("application/octet-stream");
  expect(getContentType("README")).toBe("application/octet-stream");
});

Deno.test("getContentType is case-insensitive for extensions", () => {
  expect(getContentType("FILE.PNG")).toBe("image/png");
  expect(getContentType("file.TS")).toBe("text/typescript");
  expect(getContentType("FILE.JSON")).toBe("application/json");
  expect(getContentType("file.Html")).toBe("text/html");
});

Deno.test("getContentType handles nested paths", () => {
  expect(getContentType("path/to/file.ts")).toBe("text/typescript");
  expect(getContentType("deep/nested/image.png")).toBe("image/png");
});

Deno.test("getContentType handles files with multiple dots", () => {
  expect(getContentType("file.test.ts")).toBe("text/typescript");
  expect(getContentType("component.spec.tsx")).toBe("text/typescript");
  expect(getContentType("data.backup.json")).toBe("application/json");
});

// ============================================================================
// isTextContentType Tests
// ============================================================================

Deno.test("isTextContentType returns true for text/* types", () => {
  expect(isTextContentType("text/plain")).toBe(true);
  expect(isTextContentType("text/typescript")).toBe(true);
  expect(isTextContentType("text/javascript")).toBe(true);
  expect(isTextContentType("text/html")).toBe(true);
  expect(isTextContentType("text/css")).toBe(true);
  expect(isTextContentType("text/markdown")).toBe(true);
});

Deno.test("isTextContentType returns true for application/json", () => {
  expect(isTextContentType("application/json")).toBe(true);
});

Deno.test("isTextContentType returns true for application/xml", () => {
  expect(isTextContentType("application/xml")).toBe(true);
});

Deno.test("isTextContentType returns true for +json and +xml suffixes", () => {
  expect(isTextContentType("application/vnd.api+json")).toBe(true);
  expect(isTextContentType("application/rss+xml")).toBe(true);
  expect(isTextContentType("image/svg+xml")).toBe(true);
});

Deno.test("isTextContentType returns false for binary types", () => {
  expect(isTextContentType("image/png")).toBe(false);
  expect(isTextContentType("image/jpeg")).toBe(false);
  expect(isTextContentType("application/octet-stream")).toBe(false);
  expect(isTextContentType("application/pdf")).toBe(false);
  expect(isTextContentType("application/wasm")).toBe(false);
  expect(isTextContentType("application/zip")).toBe(false);
  expect(isTextContentType("audio/mpeg")).toBe(false);
  expect(isTextContentType("video/mp4")).toBe(false);
});
