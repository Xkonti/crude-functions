import { SurrealDatabaseService } from "../database/surreal_database_service.ts";

/**
 * Simple experiment to validate SurrealDB integration.
 *
 * Tests basic CRUD operations and queries.
 */

interface TestUser {
  name: string;
  email: string;
  age: number;
  tags: string[];
}

export async function runSurrealExperiment(
  surrealDb: SurrealDatabaseService
): Promise<{ success: boolean; message: string; data?: unknown }> {
  console.log("Starting SurrealDB experiment...");

  try {
    // 0. Get version info
    const versionInfo = await surrealDb.version();
    console.log("SurrealDB version:", versionInfo);

    // 1. Create some test records
    console.log("Creating test users...");

    const alice = await surrealDb.create("test_user", {
      name: "Alice",
      email: "alice@example.com",
      age: 30,
      tags: ["admin", "developer"],
    });
    console.log("Created Alice:", alice);

    const bob = await surrealDb.create("test_user", {
      name: "Bob",
      email: "bob@example.com",
      age: 25,
      tags: ["developer"],
    });
    console.log("Created Bob:", bob);

    // 2. Select all records
    console.log("\nSelecting all test_users...");
    const allUsers = await surrealDb.select<TestUser & { id: unknown }>(
      "test_user"
    );
    console.log(`Found ${allUsers.length} users:`, allUsers);

    // 3. Run a SurrealQL query with filtering
    console.log("\nQuerying users with age > 25...");
    const olderUsers = await surrealDb.query<TestUser & { id: unknown }>(
      "SELECT * FROM test_user WHERE age > $minAge",
      { minAge: 25 }
    );
    console.log("Older users:", olderUsers);

    // 4. Update a record
    console.log("\nUpdating Alice's age...");
    // Extract the ID from the RecordId - it may be a string or have a toString
    const aliceIdRaw = alice.id;
    const aliceIdStr = String(aliceIdRaw);
    // Format: "test_user:xxx" - extract the xxx part
    const aliceId = aliceIdStr.includes(":")
      ? aliceIdStr.split(":")[1]
      : aliceIdStr;
    const updatedAlice = await surrealDb.merge<TestUser>("test_user", aliceId, {
      age: 31,
    });
    console.log("Updated Alice:", updatedAlice);

    // 5. Verify the update
    console.log("\nVerifying update...");
    const verifyAlice = await surrealDb.selectOne<TestUser & { id: unknown }>(
      "test_user",
      aliceId
    );
    console.log("Verified Alice:", verifyAlice);

    // 6. Clean up - delete test records
    console.log("\nCleaning up test data...");
    await surrealDb.deleteAll("test_user");

    const remaining = await surrealDb.select("test_user");
    console.log(`Remaining records after cleanup: ${remaining.length}`);

    console.log("\nSurrealDB experiment completed successfully!");

    return {
      success: true,
      message: "All SurrealDB operations completed successfully",
      data: {
        createdUsers: 2,
        queriedOlderUsers: olderUsers.length,
        cleanedUp: true,
      },
    };
  } catch (error) {
    console.error("SurrealDB experiment failed:", error);
    return {
      success: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
