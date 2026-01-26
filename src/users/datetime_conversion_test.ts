/**
 * Simple test to verify SurrealDB SDK automatically converts datetime fields to JS Date objects.
 * This test validates whether the toDate() and toOptionalDate() helper methods are necessary.
 */

import { expect } from "@std/expect";
import { RecordId } from "surrealdb";
import { TestSetupBuilder } from "../test/test_setup_builder.ts";
import { integrationTest } from "../test/test_helpers.ts";

integrationTest("SurrealDB SDK automatically converts datetime to JS Date", async () => {
  const ctx = await TestSetupBuilder.create()
    .withUsers()
    .build();

  try {
    const db = ctx.surrealFactory;

    // Create a test record with datetime fields
    const testTime = new Date("2024-01-15T10:30:00Z");
    const userId = new RecordId("user", "test-datetime");

    await db.withSystemConnection({}, async (conn: any) => {
      await conn.query(
        `CREATE $userId SET
          email = "test@example.com",
          emailVerified = true,
          name = "Test User",
          image = NONE,
          role = NONE,
          banned = false,
          banReason = NONE,
          banExpires = NONE,
          createdAt = $createdAt,
          updatedAt = $updatedAt`,
        {
          userId,
          createdAt: testTime,
          updatedAt: testTime,
        }
      );
    });

    // Query the record back
    interface TestRow {
      id: RecordId;
      createdAt: any;
      updatedAt: any;
      banExpires: any;
    }

    const row = await db.withSystemConnection({}, async (conn: any) => {
      const [result] = await conn.query(
        `SELECT * FROM $userId`,
        { userId }
      );
      return result[0] as TestRow;
    });

    // Verify that createdAt and updatedAt are already Date objects
    console.log("✓ createdAt type:", typeof row.createdAt);
    console.log("✓ createdAt instanceof Date:", row.createdAt instanceof Date);
    console.log("✓ updatedAt type:", typeof row.updatedAt);
    console.log("✓ updatedAt instanceof Date:", row.updatedAt instanceof Date);
    console.log("✓ banExpires (NONE):", row.banExpires);

    // Assert that the SDK returns native Date objects
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.updatedAt).toBeInstanceOf(Date);
    expect(row.banExpires).toBeUndefined(); // NONE = undefined

    // Verify the dates match
    expect(row.createdAt.getTime()).toBe(testTime.getTime());
    expect(row.updatedAt.getTime()).toBe(testTime.getTime());
  } finally {
    await ctx.cleanup();
  }
});

integrationTest("SurrealDB SDK handles NULL datetime as null", async () => {
  const ctx = await TestSetupBuilder.create()
    .withUsers()
    .build();

  try {
    const db = ctx.surrealFactory;
    const userId = new RecordId("user", "test-null-datetime");

    await db.withSystemConnection({}, async (conn: any) => {
      await conn.query(
        `CREATE $userId SET
          email = "test@example.com",
          emailVerified = true,
          name = "Test User",
          image = NONE,
          role = NONE,
          banned = false,
          banReason = NONE,
          banExpires = NULL,
          createdAt = time::now(),
          updatedAt = time::now()`,
        { userId }
      );
    });

    interface TestRow {
      banExpires: any;
    }

    const row = await db.withSystemConnection({}, async (conn: any) => {
      const [result] = await conn.query(
        `SELECT banExpires FROM $userId`,
        { userId }
      );
      return result[0] as TestRow;
    });

    console.log("✓ banExpires (NULL in DB):", row.banExpires);
    expect(row.banExpires).toBeNull(); // NULL = null
  } finally {
    await ctx.cleanup();
  }
});
