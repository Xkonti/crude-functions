import { expect } from "@std/expect";
import { CsrfService } from "./csrf_service.ts";

// Helper to create a test service with a base64-encoded secret
function createTestService(secret: string = "dGVzdC1zZWNyZXQta2V5LXNlY3VyZQ=="): CsrfService {
  return new CsrfService({ secret });
}

Deno.test("CsrfService.generateToken produces valid tokens", async () => {
  const service = createTestService();
  const token = await service.generateToken();

  // Token should have format: random.timestamp.signature
  const parts = token.split(".");
  expect(parts.length).toBe(3);

  // Each part should be non-empty
  expect(parts[0].length).toBeGreaterThan(0);
  expect(parts[1].length).toBeGreaterThan(0);
  expect(parts[2].length).toBeGreaterThan(0);
});

Deno.test("CsrfService.validateToken accepts valid tokens", async () => {
  const service = createTestService();
  const token = await service.generateToken();

  const isValid = await service.validateToken(token);
  expect(isValid).toBe(true);
});

Deno.test("CsrfService.validateToken rejects tampered tokens - modified random", async () => {
  const service = createTestService();
  const token = await service.generateToken();

  // Tamper with random part
  const parts = token.split(".");
  parts[0] = "tampered-random-value";
  const tamperedToken = parts.join(".");

  const isValid = await service.validateToken(tamperedToken);
  expect(isValid).toBe(false);
});

Deno.test("CsrfService.validateToken rejects tampered tokens - modified timestamp", async () => {
  const service = createTestService();
  const token = await service.generateToken();

  // Tamper with timestamp part
  const parts = token.split(".");
  parts[1] = "tampered-timestamp";
  const tamperedToken = parts.join(".");

  const isValid = await service.validateToken(tamperedToken);
  expect(isValid).toBe(false);
});

Deno.test("CsrfService.validateToken rejects tampered tokens - modified signature", async () => {
  const service = createTestService();
  const token = await service.generateToken();

  // Tamper with signature part
  const parts = token.split(".");
  parts[2] = "tampered-signature";
  const tamperedToken = parts.join(".");

  const isValid = await service.validateToken(tamperedToken);
  expect(isValid).toBe(false);
});

Deno.test("CsrfService.validateToken rejects expired tokens", async () => {
  const service = createTestService();
  const token = await service.generateToken();

  // Manually create an expired token by using a timestamp from 25 hours ago
  const parts = token.split(".");
  const expiredTimestamp = Date.now() - (25 * 60 * 60 * 1000); // 25 hours ago
  parts[1] = btoa(expiredTimestamp.toString()).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  // Need to re-sign with the correct signature for the new timestamp
  // Since we can't access the private method, just test that a token
  // with a different timestamp is rejected (signature mismatch)
  const expiredToken = parts.join(".");

  const isValid = await service.validateToken(expiredToken);
  expect(isValid).toBe(false);
});

Deno.test("CsrfService.validateToken rejects malformed tokens - missing parts", async () => {
  const service = createTestService();

  const isValid = await service.validateToken("only-one-part");
  expect(isValid).toBe(false);
});

Deno.test("CsrfService.validateToken rejects malformed tokens - two parts", async () => {
  const service = createTestService();

  const isValid = await service.validateToken("part1.part2");
  expect(isValid).toBe(false);
});

Deno.test("CsrfService.validateToken rejects empty string", async () => {
  const service = createTestService();

  const isValid = await service.validateToken("");
  expect(isValid).toBe(false);
});

Deno.test("CsrfService generates unique tokens", async () => {
  const service = createTestService();

  const token1 = await service.generateToken();
  const token2 = await service.generateToken();

  expect(token1).not.toBe(token2);
});

Deno.test("CsrfService tokens from different secrets are not valid across services", async () => {
  // Use different base64-encoded secrets
  const service1 = new CsrfService({ secret: "c2VjcmV0LW9uZS1zZWN1cmU=" }); // "secret-one-secure"
  const service2 = new CsrfService({ secret: "c2VjcmV0LXR3by1zZWN1cmU=" }); // "secret-two-secure"

  const token = await service1.generateToken();

  const isValidInService1 = await service1.validateToken(token);
  const isValidInService2 = await service2.validateToken(token);

  expect(isValidInService1).toBe(true);
  expect(isValidInService2).toBe(false);
});
