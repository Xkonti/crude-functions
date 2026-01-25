import { integrationTest } from "../test/test_helpers.ts";
import { expect } from "@std/expect";
import { TestSetupBuilder } from "../test/test_setup_builder.ts";
import type { MetricsStateKey } from "./types.ts";

// ============== Group 1: Basic Read/Write ==============

integrationTest("MetricsStateService.getMarker returns null for non-existent key", async () => {
  const ctx = await TestSetupBuilder.create().withMetricsStateService().build();
  try {
    const value = await ctx.metricsStateService.getMarker("lastProcessedMinute");
    expect(value).toBeNull();
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("MetricsStateService.setMarker creates new marker", async () => {
  const ctx = await TestSetupBuilder.create().withMetricsStateService().build();
  try {
    const testDate = new Date("2024-01-15T10:30:00.000Z");
    await ctx.metricsStateService.setMarker("lastProcessedMinute", testDate);

    const value = await ctx.metricsStateService.getMarker("lastProcessedMinute");
    expect(value).not.toBeNull();
    expect(value!.toISOString()).toBe(testDate.toISOString());
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("MetricsStateService.getMarker returns stored Date object", async () => {
  const ctx = await TestSetupBuilder.create().withMetricsStateService().build();
  try {
    const testDate = new Date("2024-06-20T14:45:30.000Z");
    await ctx.metricsStateService.setMarker("lastProcessedHour", testDate);

    const value = await ctx.metricsStateService.getMarker("lastProcessedHour");
    expect(value).toBeInstanceOf(Date);
    expect(value!.getTime()).toBe(testDate.getTime());
  } finally {
    await ctx.cleanup();
  }
});

// ============== Group 2: Upsert Behavior ==============

integrationTest("MetricsStateService.setMarker updates existing marker", async () => {
  const ctx = await TestSetupBuilder.create().withMetricsStateService().build();
  try {
    const firstDate = new Date("2024-01-01T00:00:00.000Z");
    const secondDate = new Date("2024-12-31T23:59:59.000Z");

    await ctx.metricsStateService.setMarker("lastProcessedDay", firstDate);
    await ctx.metricsStateService.setMarker("lastProcessedDay", secondDate);

    const value = await ctx.metricsStateService.getMarker("lastProcessedDay");
    expect(value!.toISOString()).toBe(secondDate.toISOString());
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("MetricsStateService.setMarker multiple sets produce single record", async () => {
  const ctx = await TestSetupBuilder.create().withMetricsStateService().build();
  try {
    await ctx.metricsStateService.setMarker(
      "lastProcessedMinute",
      new Date("2024-01-01T00:00:00.000Z")
    );
    await ctx.metricsStateService.setMarker(
      "lastProcessedMinute",
      new Date("2024-01-02T00:00:00.000Z")
    );
    await ctx.metricsStateService.setMarker(
      "lastProcessedMinute",
      new Date("2024-01-03T00:00:00.000Z")
    );

    const count = await ctx.db.queryOne<{ count: number }>(
      "SELECT COUNT(*) as count FROM metricsState WHERE key = ?",
      ["lastProcessedMinute"]
    );
    expect(count!.count).toBe(1);
  } finally {
    await ctx.cleanup();
  }
});

// ============== Group 3: Bootstrap Pattern ==============

integrationTest("MetricsStateService.getOrBootstrapMarker creates marker if not exists", async () => {
  const ctx = await TestSetupBuilder.create().withMetricsStateService().build();
  try {
    const defaultDate = new Date("2024-01-01T00:00:00.000Z");

    const result = await ctx.metricsStateService.getOrBootstrapMarker(
      "lastProcessedMinute",
      defaultDate
    );

    expect(result.toISOString()).toBe(defaultDate.toISOString());

    // Verify it was actually stored
    const stored = await ctx.metricsStateService.getMarker("lastProcessedMinute");
    expect(stored!.toISOString()).toBe(defaultDate.toISOString());
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("MetricsStateService.getOrBootstrapMarker returns existing marker without overwriting", async () => {
  const ctx = await TestSetupBuilder.create().withMetricsStateService().build();
  try {
    const existingDate = new Date("2024-06-15T12:00:00.000Z");
    const defaultDate = new Date("2024-01-01T00:00:00.000Z");

    // Set existing value first
    await ctx.metricsStateService.setMarker("lastProcessedHour", existingDate);

    // Bootstrap should return existing, not overwrite
    const result = await ctx.metricsStateService.getOrBootstrapMarker(
      "lastProcessedHour",
      defaultDate
    );

    expect(result.toISOString()).toBe(existingDate.toISOString());
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("MetricsStateService.getOrBootstrapMarker is idempotent", async () => {
  const ctx = await TestSetupBuilder.create().withMetricsStateService().build();
  try {
    const defaultDate = new Date("2024-03-15T08:00:00.000Z");

    const first = await ctx.metricsStateService.getOrBootstrapMarker(
      "lastProcessedDay",
      defaultDate
    );
    const second = await ctx.metricsStateService.getOrBootstrapMarker(
      "lastProcessedDay",
      defaultDate
    );

    expect(first.toISOString()).toBe(second.toISOString());
    expect(first.toISOString()).toBe(defaultDate.toISOString());

    // Still only one record
    const count = await ctx.db.queryOne<{ count: number }>(
      "SELECT COUNT(*) as count FROM metricsState WHERE key = ?",
      ["lastProcessedDay"]
    );
    expect(count!.count).toBe(1);
  } finally {
    await ctx.cleanup();
  }
});

// ============== Group 4: Key Independence ==============

integrationTest("MetricsStateService different keys are independent", async () => {
  const ctx = await TestSetupBuilder.create().withMetricsStateService().build();
  try {
    const minuteDate = new Date("2024-01-01T00:01:00.000Z");
    const hourDate = new Date("2024-01-01T01:00:00.000Z");
    const dayDate = new Date("2024-01-02T00:00:00.000Z");

    await ctx.metricsStateService.setMarker("lastProcessedMinute", minuteDate);
    await ctx.metricsStateService.setMarker("lastProcessedHour", hourDate);
    await ctx.metricsStateService.setMarker("lastProcessedDay", dayDate);

    const minute = await ctx.metricsStateService.getMarker("lastProcessedMinute");
    const hour = await ctx.metricsStateService.getMarker("lastProcessedHour");
    const day = await ctx.metricsStateService.getMarker("lastProcessedDay");

    expect(minute!.toISOString()).toBe(minuteDate.toISOString());
    expect(hour!.toISOString()).toBe(hourDate.toISOString());
    expect(day!.toISOString()).toBe(dayDate.toISOString());
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("MetricsStateService all MetricsStateKey values work correctly", async () => {
  const ctx = await TestSetupBuilder.create().withMetricsStateService().build();
  try {
    const keys: MetricsStateKey[] = [
      "lastProcessedMinute",
      "lastProcessedHour",
      "lastProcessedDay",
    ];

    for (const key of keys) {
      const testDate = new Date(`2024-01-15T10:00:00.000Z`);
      await ctx.metricsStateService.setMarker(key, testDate);

      const value = await ctx.metricsStateService.getMarker(key);
      expect(value).not.toBeNull();
      expect(value!.toISOString()).toBe(testDate.toISOString());
    }
  } finally {
    await ctx.cleanup();
  }
});

// ============== Group 5: Date Handling Edge Cases ==============

integrationTest("MetricsStateService stores and retrieves UTC dates correctly", async () => {
  const ctx = await TestSetupBuilder.create().withMetricsStateService().build();
  try {
    // Use a date with specific UTC time
    const utcDate = new Date("2024-07-04T16:30:45.123Z");
    await ctx.metricsStateService.setMarker("lastProcessedMinute", utcDate);

    const retrieved = await ctx.metricsStateService.getMarker("lastProcessedMinute");
    expect(retrieved!.toISOString()).toBe(utcDate.toISOString());
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("MetricsStateService handles epoch date", async () => {
  const ctx = await TestSetupBuilder.create().withMetricsStateService().build();
  try {
    const epochDate = new Date(0); // 1970-01-01T00:00:00.000Z
    await ctx.metricsStateService.setMarker("lastProcessedHour", epochDate);

    const retrieved = await ctx.metricsStateService.getMarker("lastProcessedHour");
    expect(retrieved!.getTime()).toBe(0);
    expect(retrieved!.toISOString()).toBe("1970-01-01T00:00:00.000Z");
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("MetricsStateService handles future dates", async () => {
  const ctx = await TestSetupBuilder.create().withMetricsStateService().build();
  try {
    const futureDate = new Date("2099-12-31T23:59:59.999Z");
    await ctx.metricsStateService.setMarker("lastProcessedDay", futureDate);

    const retrieved = await ctx.metricsStateService.getMarker("lastProcessedDay");
    expect(retrieved!.toISOString()).toBe(futureDate.toISOString());
  } finally {
    await ctx.cleanup();
  }
});
