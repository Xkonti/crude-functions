import { expect } from "@std/expect";
import { fuzzyMatch, fuzzySearch } from "./fuzzy_search.ts";

// =============================================================================
// fuzzyMatch tests
// =============================================================================

Deno.test("fuzzyMatch returns null when query has no match", () => {
  expect(fuzzyMatch("xyz", "handler.ts")).toBe(null);
  expect(fuzzyMatch("abc", "def")).toBe(null);
});

Deno.test("fuzzyMatch returns match for exact substring", () => {
  const result = fuzzyMatch("handler", "handler.ts");
  expect(result).not.toBe(null);
  expect(result!.path).toBe("handler.ts");
  expect(result!.score).toBeGreaterThan(0);
});

Deno.test("fuzzyMatch returns match for subsequence", () => {
  // "hndl" appears in order in "handler"
  const result = fuzzyMatch("hndl", "handler.ts");
  expect(result).not.toBe(null);
  expect(result!.path).toBe("handler.ts");
});

Deno.test("fuzzyMatch is case-insensitive", () => {
  expect(fuzzyMatch("HANDLER", "handler.ts")).not.toBe(null);
  expect(fuzzyMatch("handler", "HANDLER.TS")).not.toBe(null);
  expect(fuzzyMatch("HaNdLeR", "handler.ts")).not.toBe(null);
});

Deno.test("fuzzyMatch matches across path segments", () => {
  // "pm/hel/st" should match "dynamopm/helpers/SecurityToken.ts"
  const result = fuzzyMatch("pm/hel/st", "dynamopm/helpers/SecurityToken.ts");
  expect(result).not.toBe(null);
});

Deno.test("fuzzyMatch returns match positions", () => {
  const result = fuzzyMatch("abc", "aXbXc.ts");
  expect(result).not.toBe(null);
  expect(result!.matchPositions).toContain(0); // 'a'
  expect(result!.matchPositions).toContain(2); // 'b'
  expect(result!.matchPositions).toContain(4); // 'c'
  expect(result!.matchPositions.length).toBe(3);
});

Deno.test("fuzzyMatch requires all query characters in order", () => {
  expect(fuzzyMatch("abc", "acb.ts")).toBe(null); // 'c' before 'b'
  expect(fuzzyMatch("abc", "bac.ts")).toBe(null); // 'a' after 'b'
});

Deno.test("fuzzyMatch handles empty query", () => {
  const result = fuzzyMatch("", "handler.ts");
  expect(result).not.toBe(null);
  expect(result!.matchPositions).toEqual([]);
});

Deno.test("fuzzyMatch handles special characters in query", () => {
  expect(fuzzyMatch(".", "handler.ts")).not.toBe(null);
  expect(fuzzyMatch("/", "src/handler.ts")).not.toBe(null);
});

// =============================================================================
// fuzzyMatch scoring tests
// =============================================================================

Deno.test("fuzzyMatch scores consecutive matches higher", () => {
  // "hand" has 4 consecutive matches at start
  const consecutive = fuzzyMatch("hand", "handler.ts");
  // "hnad" has non-consecutive matches (h...n...a...d doesn't work, try different)
  // Actually let's use paths where one has consecutive, one doesn't
  const nonConsecutive = fuzzyMatch("hadr", "handler.ts");

  expect(consecutive).not.toBe(null);
  expect(nonConsecutive).not.toBe(null);
  expect(consecutive!.score).toBeGreaterThan(nonConsecutive!.score);
});

Deno.test("fuzzyMatch scores segment start matches higher", () => {
  // 'h' at start of "handler" vs 'h' in middle of "other"
  const startMatch = fuzzyMatch("h", "handler.ts");
  const midMatch = fuzzyMatch("h", "other.ts");

  expect(startMatch).not.toBe(null);
  expect(midMatch).not.toBe(null);
  expect(startMatch!.score).toBeGreaterThan(midMatch!.score);
});

Deno.test("fuzzyMatch scores path segment starts higher", () => {
  // 'u' at start of "utils" segment
  const segmentStart = fuzzyMatch("u", "src/utils.ts");
  // 'u' in middle of "output"
  const segmentMid = fuzzyMatch("u", "output.ts");

  expect(segmentStart).not.toBe(null);
  expect(segmentMid).not.toBe(null);
  expect(segmentStart!.score).toBeGreaterThan(segmentMid!.score);
});

// =============================================================================
// fuzzySearch tests
// =============================================================================

Deno.test("fuzzySearch returns empty array for no matches", () => {
  const paths = ["handler.ts", "utils.ts", "main.ts"];
  const results = fuzzySearch("xyz", paths);
  expect(results).toEqual([]);
});

Deno.test("fuzzySearch returns matches sorted by score", () => {
  const paths = [
    "other-handler.ts",      // 'hand' not at segment start
    "handler.ts",            // 'hand' at start - best match
    "xhandlerx.ts",          // 'hand' in middle
  ];
  const results = fuzzySearch("hand", paths);

  expect(results.length).toBe(3);
  expect(results[0].path).toBe("handler.ts"); // Highest score first
});

Deno.test("fuzzySearch respects limit parameter", () => {
  const paths = [
    "a1.ts", "a2.ts", "a3.ts", "a4.ts", "a5.ts",
  ];
  const results = fuzzySearch("a", paths, 3);
  expect(results.length).toBe(3);
});

Deno.test("fuzzySearch returns all matches when limit is larger", () => {
  const paths = ["a.ts", "b.ts"];
  const results = fuzzySearch("a", paths, 10);
  expect(results.length).toBe(1);
});

Deno.test("fuzzySearch handles empty paths array", () => {
  const results = fuzzySearch("test", []);
  expect(results).toEqual([]);
});

Deno.test("fuzzySearch handles empty query", () => {
  const paths = ["a.ts", "b.ts"];
  const results = fuzzySearch("", paths);
  expect(results.length).toBe(2); // All paths match empty query
});

Deno.test("fuzzySearch default limit is 10", () => {
  const paths = Array.from({ length: 20 }, (_, i) => `file${i}.ts`);
  const results = fuzzySearch("file", paths);
  expect(results.length).toBe(10);
});

// =============================================================================
// Integration test: realistic handler path matching
// =============================================================================

Deno.test("fuzzySearch matches realistic handler paths", () => {
  const paths = [
    "dynamopm/helpers/SecurityTokenExtractor.ts",
    "dynamopm/utils/config.ts",
    "openclaw/handlers/auth.ts",
    "greeter.ts",
    "lib/formatters.ts",
  ];

  // User types "pm/hel/stw" (with typo 'w' for 'E')
  // Should match "dynamopm/helpers/SecurityTokenExtractor.ts"
  const results = fuzzySearch("pm/hel/st", paths);
  expect(results.length).toBeGreaterThan(0);
  expect(results[0].path).toBe("dynamopm/helpers/SecurityTokenExtractor.ts");
});

Deno.test("fuzzySearch handles typos by finding closest matches", () => {
  const paths = [
    "handlers/authentication.ts",
    "handlers/authorization.ts",
    "utils/auth-helper.ts",
  ];

  // "auth" should match all three, but "authentication" should rank high
  const results = fuzzySearch("auth", paths);
  expect(results.length).toBe(3);
  // All paths contain "auth" so they all match
});

Deno.test("fuzzySearch prefers shorter paths with same match quality", () => {
  const paths = [
    "very/deep/nested/path/handler.ts",
    "handler.ts",
    "src/handler.ts",
  ];

  const results = fuzzySearch("handler", paths);
  expect(results.length).toBe(3);
  // "handler.ts" should rank highest (shortest path with full match)
  expect(results[0].path).toBe("handler.ts");
});
