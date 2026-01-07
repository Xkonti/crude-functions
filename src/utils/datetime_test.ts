import { assertEquals } from "@std/assert";
import {
  formatForDisplay,
  formatForSqlite,
  parseSqliteTimestamp,
} from "./datetime.ts";

Deno.test("formatForSqlite - produces correct SQLite format", () => {
  const date = new Date("2026-01-02T18:08:36.123Z");
  const result = formatForSqlite(date);

  assertEquals(result, "2026-01-02 18:08:36");
});

Deno.test("formatForSqlite - removes milliseconds", () => {
  const date = new Date("2026-01-02T18:08:36.999Z");
  const result = formatForSqlite(date);

  // Should not include .999
  assertEquals(result, "2026-01-02 18:08:36");
  assertEquals(result.includes("."), false);
});

Deno.test("formatForSqlite - removes timezone suffix", () => {
  const date = new Date("2026-01-02T18:08:36.000Z");
  const result = formatForSqlite(date);

  // Should not include Z
  assertEquals(result.includes("Z"), false);
  // Should not include T
  assertEquals(result.includes("T"), false);
});

Deno.test("formatForSqlite - handles UTC correctly", () => {
  // Midnight UTC
  const date = new Date("2026-01-02T00:00:00.000Z");
  const result = formatForSqlite(date);

  assertEquals(result, "2026-01-02 00:00:00");
});

Deno.test("formatForDisplay - produces correct display format with milliseconds", () => {
  const date = new Date("2026-01-02T18:08:36.123Z");
  const result = formatForDisplay(date);

  assertEquals(result, "2026-01-02 18:08:36.123");
});

Deno.test("formatForDisplay - includes milliseconds with zero-padding", () => {
  const date = new Date("2026-01-02T18:08:36.001Z");
  const result = formatForDisplay(date);

  // Should zero-pad milliseconds
  assertEquals(result, "2026-01-02 18:08:36.001");
});

Deno.test("formatForDisplay - handles zero milliseconds", () => {
  const date = new Date("2026-01-02T18:08:36.000Z");
  const result = formatForDisplay(date);

  assertEquals(result, "2026-01-02 18:08:36.000");
});

Deno.test("parseSqliteTimestamp - parses SQLite format correctly", () => {
  const result = parseSqliteTimestamp("2026-01-02 18:08:36");
  const expected = new Date("2026-01-02T18:08:36.000Z");

  assertEquals(result.getTime(), expected.getTime());
});

Deno.test("parseSqliteTimestamp - parses ISO format correctly (backward compat)", () => {
  const result = parseSqliteTimestamp("2026-01-02T18:08:36.000Z");
  const expected = new Date("2026-01-02T18:08:36.000Z");

  assertEquals(result.getTime(), expected.getTime());
});

Deno.test("parseSqliteTimestamp - both formats produce same Date for same instant", () => {
  const sqliteFormat = parseSqliteTimestamp("2026-01-02 18:08:36");
  const isoFormat = parseSqliteTimestamp("2026-01-02T18:08:36.000Z");

  assertEquals(sqliteFormat.getTime(), isoFormat.getTime());
});

Deno.test("parseSqliteTimestamp - handles SQLite format as UTC", () => {
  const result = parseSqliteTimestamp("2026-01-02 00:00:00");

  // Should parse as UTC midnight
  assertEquals(result.toISOString(), "2026-01-02T00:00:00.000Z");
});

Deno.test("parseSqliteTimestamp - handles ISO format with milliseconds", () => {
  const result = parseSqliteTimestamp("2026-01-02T18:08:36.123Z");
  const expected = new Date("2026-01-02T18:08:36.123Z");

  assertEquals(result.getTime(), expected.getTime());
});

Deno.test("roundtrip - formatForSqlite -> parseSqliteTimestamp preserves timestamp", () => {
  const original = new Date("2026-01-02T18:08:36.123Z");
  const formatted = formatForSqlite(original);
  const parsed = parseSqliteTimestamp(formatted);

  // Note: milliseconds are lost in SQLite format (by design)
  // Compare only to second precision
  assertEquals(
    parsed.toISOString().slice(0, 19),
    original.toISOString().slice(0, 19),
  );
});
