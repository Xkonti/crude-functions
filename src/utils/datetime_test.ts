import { assertEquals } from "@std/assert";
import {
  formatForDisplay,
} from "./datetime.ts";

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
