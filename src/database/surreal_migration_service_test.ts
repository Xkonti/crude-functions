import { integrationTest } from "../test/test_helpers.ts";
import { expect } from "@std/expect";
import { TestSetupBuilder } from "../test/test_setup_builder.ts";
import { SurrealMigrationService } from "./surreal_migration_service.ts";
import {
  SurrealMigrationError,
  SurrealMigrationFileError,
  SurrealMigrationExecutionError,
} from "./surreal_errors.ts";

async function writeMigration(
  migrationsDir: string,
  filename: string,
  surql: string
): Promise<void> {
  await Deno.writeTextFile(`${migrationsDir}/${filename}`, surql);
}

// =====================
// getAvailableMigrations tests
// =====================

integrationTest("getAvailableMigrations returns empty array for empty directory", async () => {
  const tempMigrationsDir = await Deno.makeTempDir({ prefix: "surreal_mig_test_" });

  const ctx = await TestSetupBuilder.create()
    .withMigrationsDir(tempMigrationsDir)
    .withoutSurrealMigrations()
    .withBaseOnly()
    .build();

  try {
    const migrationService = new SurrealMigrationService({
      connectionFactory: ctx.surrealFactory,
      migrationsDir: tempMigrationsDir,
      namespace: ctx.surrealNamespace,
      database: ctx.surrealDatabase,
    });
    const migrations = await migrationService.getAvailableMigrations();
    expect(migrations).toEqual([]);
  } finally {
    await ctx.cleanup();
    await Deno.remove(tempMigrationsDir, { recursive: true });
  }
});

integrationTest("getAvailableMigrations parses migration files correctly", async () => {
  const tempMigrationsDir = await Deno.makeTempDir({ prefix: "surreal_mig_test_" });

  try {
    await writeMigration(tempMigrationsDir, "000-init.surql", "-- init");
    await writeMigration(tempMigrationsDir, "001-add-users.surql", "-- users");
    await writeMigration(tempMigrationsDir, "005-add-indexes.surql", "-- indexes");

    const ctx = await TestSetupBuilder.create()
      .withMigrationsDir(tempMigrationsDir)
        .withoutSurrealMigrations()
      .withBaseOnly()
      .build();

    try {
      const migrationService = new SurrealMigrationService({
        connectionFactory: ctx.surrealFactory,
        migrationsDir: tempMigrationsDir,
        namespace: ctx.surrealNamespace,
        database: ctx.surrealDatabase,
      });
      const migrations = await migrationService.getAvailableMigrations();

      expect(migrations.length).toBe(3);
      expect(migrations[0].version).toBe(0);
      expect(migrations[0].filename).toBe("000-init.surql");
      expect(migrations[1].version).toBe(1);
      expect(migrations[1].filename).toBe("001-add-users.surql");
      expect(migrations[2].version).toBe(5);
      expect(migrations[2].filename).toBe("005-add-indexes.surql");
    } finally {
      await ctx.cleanup();
    }
  } finally {
    await Deno.remove(tempMigrationsDir, { recursive: true });
  }
});

integrationTest("getAvailableMigrations ignores non-matching files", async () => {
  const tempMigrationsDir = await Deno.makeTempDir({ prefix: "surreal_mig_test_" });

  try {
    await writeMigration(tempMigrationsDir, "000-init.surql", "-- valid");
    await writeMigration(tempMigrationsDir, "readme.md", "# Migrations");
    await writeMigration(tempMigrationsDir, "backup.surql", "-- no prefix");
    await writeMigration(tempMigrationsDir, "00-short.surql", "-- only 2 digits");
    await writeMigration(tempMigrationsDir, "0001-four-digits.surql", "-- 4 digits");
    await writeMigration(tempMigrationsDir, "000-init.sql", "-- wrong extension");

    const ctx = await TestSetupBuilder.create()
      .withMigrationsDir(tempMigrationsDir)
        .withoutSurrealMigrations()
      .withBaseOnly()
      .build();

    try {
      const migrationService = new SurrealMigrationService({
        connectionFactory: ctx.surrealFactory,
        migrationsDir: tempMigrationsDir,
        namespace: ctx.surrealNamespace,
        database: ctx.surrealDatabase,
      });
      const migrations = await migrationService.getAvailableMigrations();

      expect(migrations.length).toBe(1);
      expect(migrations[0].filename).toBe("000-init.surql");
    } finally {
      await ctx.cleanup();
    }
  } finally {
    await Deno.remove(tempMigrationsDir, { recursive: true });
  }
});

integrationTest("getAvailableMigrations returns migrations sorted by version", async () => {
  const tempMigrationsDir = await Deno.makeTempDir({ prefix: "surreal_mig_test_" });

  try {
    // Write in non-sorted order
    await writeMigration(tempMigrationsDir, "005-last.surql", "-- last");
    await writeMigration(tempMigrationsDir, "001-second.surql", "-- second");
    await writeMigration(tempMigrationsDir, "000-first.surql", "-- first");

    const ctx = await TestSetupBuilder.create()
      .withMigrationsDir(tempMigrationsDir)
        .withoutSurrealMigrations()
      .withBaseOnly()
      .build();

    try {
      const migrationService = new SurrealMigrationService({
        connectionFactory: ctx.surrealFactory,
        migrationsDir: tempMigrationsDir,
        namespace: ctx.surrealNamespace,
        database: ctx.surrealDatabase,
      });
      const migrations = await migrationService.getAvailableMigrations();

      expect(migrations.length).toBe(3);
      expect(migrations[0].version).toBe(0);
      expect(migrations[1].version).toBe(1);
      expect(migrations[2].version).toBe(5);
    } finally {
      await ctx.cleanup();
    }
  } finally {
    await Deno.remove(tempMigrationsDir, { recursive: true });
  }
});

// =====================
// migrate tests
// =====================

integrationTest("migrate applies all migrations on fresh database", async () => {
  const tempMigrationsDir = await Deno.makeTempDir({ prefix: "surreal_mig_test_" });

  try {
    await writeMigration(
      tempMigrationsDir,
      "000-init.surql",
      `
      DEFINE TABLE schemaVersion SCHEMAFULL;
      DEFINE FIELD version ON schemaVersion TYPE int;
      DEFINE FIELD createdAt ON schemaVersion TYPE datetime VALUE time::now() READONLY;
      DEFINE FIELD updatedAt ON schemaVersion TYPE datetime VALUE time::now();
      CREATE schemaVersion SET version = 0;

      DEFINE TABLE users SCHEMAFULL;
      DEFINE FIELD name ON users TYPE string;
    `
    );
    await writeMigration(
      tempMigrationsDir,
      "001-add-email.surql",
      `
      DEFINE FIELD email ON users TYPE option<string>;
      CREATE schemaVersion SET version = 1;
      `
    );

    const ctx = await TestSetupBuilder.create()
      .withMigrationsDir(tempMigrationsDir)
        .withoutSurrealMigrations()
      .withBaseOnly()
      .build();

    try {
      const migrationService = new SurrealMigrationService({
        connectionFactory: ctx.surrealFactory,
        migrationsDir: tempMigrationsDir,
        namespace: ctx.surrealNamespace,
        database: ctx.surrealDatabase,
      });

      const result = await migrationService.migrate();

      expect(result.appliedCount).toBe(2);
      expect(result.fromVersion).toBeNull();
      expect(result.toVersion).toBe(1);

      // Verify users table exists by querying it
      const [users] = await ctx.surrealDb.query<[unknown[]]>("SELECT * FROM users");
      expect(Array.isArray(users)).toBe(true);
    } finally {
      await ctx.cleanup();
    }
  } finally {
    await Deno.remove(tempMigrationsDir, { recursive: true });
  }
});

integrationTest("migrate only applies new migrations on partially migrated database", async () => {
  const tempMigrationsDir = await Deno.makeTempDir({ prefix: "surreal_mig_test_" });

  const ctx = await TestSetupBuilder.create()
    .withMigrationsDir(tempMigrationsDir)
    .withoutSurrealMigrations()
    .withBaseOnly()
    .build();

  try {
    // Simulate already having run migration 000 (using new table name)
    await ctx.surrealDb.query(`
      DEFINE TABLE schemaVersion SCHEMAFULL;
      DEFINE FIELD version ON schemaVersion TYPE int;
      DEFINE FIELD createdAt ON schemaVersion TYPE datetime VALUE time::now() READONLY;
      DEFINE FIELD updatedAt ON schemaVersion TYPE datetime VALUE time::now();
      CREATE schemaVersion SET version = 0;
      CREATE schemaVersion:current SET version = 0;

      DEFINE TABLE users SCHEMAFULL;
      DEFINE FIELD name ON users TYPE string;
    `);

    // Write all migrations (including already-applied 000)
    await writeMigration(
      tempMigrationsDir,
      "000-init.surql",
      `
      DEFINE TABLE schemaVersion SCHEMAFULL;
      DEFINE FIELD version ON schemaVersion TYPE int;
      DEFINE FIELD createdAt ON schemaVersion TYPE datetime VALUE time::now() READONLY;
      DEFINE FIELD updatedAt ON schemaVersion TYPE datetime VALUE time::now();
      CREATE schemaVersion SET version = 0;
      DEFINE TABLE users SCHEMAFULL;
      DEFINE FIELD name ON users TYPE string;
    `
    );
    await writeMigration(
      tempMigrationsDir,
      "001-add-email.surql",
      `
      DEFINE FIELD email ON users TYPE option<string>;
      CREATE schemaVersion SET version = 1;
      `
    );
    await writeMigration(
      tempMigrationsDir,
      "002-add-posts.surql",
      `
      DEFINE TABLE posts SCHEMAFULL;
      DEFINE FIELD title ON posts TYPE string;
      CREATE schemaVersion SET version = 2;
    `
    );

    const migrationService = new SurrealMigrationService({
      connectionFactory: ctx.surrealFactory,
      migrationsDir: tempMigrationsDir,
      namespace: ctx.surrealNamespace,
      database: ctx.surrealDatabase,
    });

    const result = await migrationService.migrate();

    expect(result.appliedCount).toBe(2); // Only 001 and 002
    expect(result.fromVersion).toBe(0);
    expect(result.toVersion).toBe(2);
  } finally {
    await ctx.cleanup();
    await Deno.remove(tempMigrationsDir, { recursive: true });
  }
});

integrationTest("migrate returns zero applied when no pending migrations", async () => {
  const tempMigrationsDir = await Deno.makeTempDir({ prefix: "surreal_mig_test_" });

  const ctx = await TestSetupBuilder.create()
    .withMigrationsDir(tempMigrationsDir)
    .withoutSurrealMigrations()
    .withBaseOnly()
    .build();

  try {
    // Simulate already having run all migrations
    await ctx.surrealDb.query(`
      DEFINE TABLE schemaVersion SCHEMAFULL;
      DEFINE FIELD version ON schemaVersion TYPE int;
      DEFINE FIELD createdAt ON schemaVersion TYPE datetime VALUE time::now() READONLY;
      DEFINE FIELD updatedAt ON schemaVersion TYPE datetime VALUE time::now();
      CREATE schemaVersion SET version = 0;
      CREATE schemaVersion SET version = 1;
      CREATE schemaVersion:current SET version = 1;
    `);

    await writeMigration(tempMigrationsDir, "000-init.surql", "CREATE schemaVersion SET version = 0;");
    await writeMigration(tempMigrationsDir, "001-add-users.surql", "CREATE schemaVersion SET version = 1;");

    const migrationService = new SurrealMigrationService({
      connectionFactory: ctx.surrealFactory,
      migrationsDir: tempMigrationsDir,
      namespace: ctx.surrealNamespace,
      database: ctx.surrealDatabase,
    });

    const result = await migrationService.migrate();

    expect(result.appliedCount).toBe(0);
    expect(result.fromVersion).toBe(1);
    expect(result.toVersion).toBe(1);
  } finally {
    await ctx.cleanup();
    await Deno.remove(tempMigrationsDir, { recursive: true });
  }
});

integrationTest("migrate handles version gaps correctly", async () => {
  const tempMigrationsDir = await Deno.makeTempDir({ prefix: "surreal_mig_test_" });

  try {
    await writeMigration(
      tempMigrationsDir,
      "000-init.surql",
      `
      DEFINE TABLE schemaVersion SCHEMAFULL;
      DEFINE FIELD version ON schemaVersion TYPE int;
      DEFINE FIELD createdAt ON schemaVersion TYPE datetime VALUE time::now() READONLY;
      DEFINE FIELD updatedAt ON schemaVersion TYPE datetime VALUE time::now();
      CREATE schemaVersion SET version = 0;
    `
    );
    await writeMigration(
      tempMigrationsDir,
      "005-skip-to-five.surql",
      `
      DEFINE TABLE five SCHEMAFULL;
      DEFINE FIELD id ON five TYPE int;
      CREATE schemaVersion SET version = 5;
    `
    );
    await writeMigration(
      tempMigrationsDir,
      "010-skip-to-ten.surql",
      `
      DEFINE TABLE ten SCHEMAFULL;
      DEFINE FIELD id ON ten TYPE int;
      CREATE schemaVersion SET version = 10;
    `
    );

    const ctx = await TestSetupBuilder.create()
      .withMigrationsDir(tempMigrationsDir)
        .withoutSurrealMigrations()
      .withBaseOnly()
      .build();

    try {
      const migrationService = new SurrealMigrationService({
        connectionFactory: ctx.surrealFactory,
        migrationsDir: tempMigrationsDir,
        namespace: ctx.surrealNamespace,
        database: ctx.surrealDatabase,
      });

      const result = await migrationService.migrate();

      expect(result.appliedCount).toBe(3);
      expect(result.fromVersion).toBeNull();
      expect(result.toVersion).toBe(10);
    } finally {
      await ctx.cleanup();
    }
  } finally {
    await Deno.remove(tempMigrationsDir, { recursive: true });
  }
});

integrationTest("migrate throws SurrealMigrationExecutionError on SurrealQL failure", async () => {
  const tempMigrationsDir = await Deno.makeTempDir({ prefix: "surreal_mig_test_" });

  try {
    await writeMigration(
      tempMigrationsDir,
      "000-init.surql",
      `
      DEFINE TABLE schemaVersion SCHEMAFULL;
      DEFINE FIELD version ON schemaVersion TYPE int;
      DEFINE FIELD createdAt ON schemaVersion TYPE datetime VALUE time::now() READONLY;
      DEFINE FIELD updatedAt ON schemaVersion TYPE datetime VALUE time::now();
      CREATE schemaVersion SET version = 0;
    `
    );
    await writeMigration(
      tempMigrationsDir,
      "001-bad.surql",
      "THIS IS NOT VALID SURREALQL %%% SYNTAX ERROR"
    );

    const ctx = await TestSetupBuilder.create()
      .withMigrationsDir(tempMigrationsDir)
        .withoutSurrealMigrations()
      .withBaseOnly()
      .build();

    try {
      const migrationService = new SurrealMigrationService({
        connectionFactory: ctx.surrealFactory,
        migrationsDir: tempMigrationsDir,
        namespace: ctx.surrealNamespace,
        database: ctx.surrealDatabase,
      });

      await expect(migrationService.migrate()).rejects.toThrow(
        SurrealMigrationExecutionError
      );
    } finally {
      await ctx.cleanup();
    }
  } finally {
    await Deno.remove(tempMigrationsDir, { recursive: true });
  }
});

integrationTest("migrate returns correct result when no migrations exist", async () => {
  const tempMigrationsDir = await Deno.makeTempDir({ prefix: "surreal_mig_test_" });

  const ctx = await TestSetupBuilder.create()
    .withMigrationsDir(tempMigrationsDir)
    .withoutSurrealMigrations()
    .withBaseOnly()
    .build();

  try {
    const migrationService = new SurrealMigrationService({
      connectionFactory: ctx.surrealFactory,
      migrationsDir: tempMigrationsDir,
      namespace: ctx.surrealNamespace,
      database: ctx.surrealDatabase,
    });

    const result = await migrationService.migrate();

    expect(result.appliedCount).toBe(0);
    expect(result.fromVersion).toBeNull();
    expect(result.toVersion).toBeNull();
  } finally {
    await ctx.cleanup();
    await Deno.remove(tempMigrationsDir, { recursive: true });
  }
});

// =====================
// Error type tests (don't need SurrealDB)
// =====================

integrationTest("SurrealMigrationFileError contains file path", () => {
  const error = new SurrealMigrationFileError("/path/to/migration.surql", new Error("ENOENT"));

  expect(error.name).toBe("SurrealMigrationFileError");
  expect(error.filePath).toBe("/path/to/migration.surql");
  expect(error.message).toContain("/path/to/migration.surql");
  expect(error.originalError).toBeInstanceOf(Error);
});

integrationTest("SurrealMigrationExecutionError contains version and filename", () => {
  const error = new SurrealMigrationExecutionError(
    5,
    "005-add-users.surql",
    new Error("syntax error")
  );

  expect(error.name).toBe("SurrealMigrationExecutionError");
  expect(error.version).toBe(5);
  expect(error.filename).toBe("005-add-users.surql");
  expect(error.message).toContain("5");
  expect(error.message).toContain("005-add-users.surql");
  expect(error.originalError).toBeInstanceOf(Error);
});

integrationTest("getAvailableMigrations throws SurrealMigrationError when directory read fails", async () => {
  const tempMigrationsDir = await Deno.makeTempDir({ prefix: "surreal_mig_test_" });

  const ctx = await TestSetupBuilder.create()
    .withMigrationsDir(tempMigrationsDir)
    .withoutSurrealMigrations()
    .withBaseOnly()
    .build();

  try {
    const badMigrationService = new SurrealMigrationService({
      connectionFactory: ctx.surrealFactory,
      migrationsDir: `${tempMigrationsDir}/nonexistent`,
      namespace: ctx.surrealNamespace,
      database: ctx.surrealDatabase,
    });

    await expect(badMigrationService.getAvailableMigrations()).rejects.toThrow(
      SurrealMigrationError
    );
  } finally {
    await ctx.cleanup();
    await Deno.remove(tempMigrationsDir, { recursive: true });
  }
});

// =====================
// schemaVersion security tests
// =====================

// Helper to set up schemaVersion table with all events (mirrors migration 001)
const SCHEMA_VERSION_SETUP = `
DEFINE TABLE schemaVersion SCHEMAFULL TYPE NORMAL;
DEFINE FIELD version ON schemaVersion TYPE int;
DEFINE FIELD createdAt ON schemaVersion TYPE datetime VALUE time::now() READONLY;
DEFINE FIELD updatedAt ON schemaVersion TYPE datetime VALUE time::now();
DEFINE INDEX idx_schemaVersion_version ON schemaVersion FIELDS version;

-- CREATE event: Validate uniqueness and update current pointer
DEFINE EVENT schemaVersion_on_create ON TABLE schemaVersion
WHEN $event = "CREATE" AND <string>$value.id != "schemaVersion:current"
THEN {
    LET $count = (SELECT count() FROM schemaVersion
        WHERE version = $value.version
        AND <string>id != "schemaVersion:current"
        GROUP ALL)[0].count ?? 0;

    IF $count > 1 {
        THROW "[CODE] DUPLICATE_MIGRATION [CODE] Migration version [VERSION] " + <string>$value.version + " [VERSION] has already been applied";
    };

    UPSERT schemaVersion:current SET version = $value.version;
};

-- UPDATE event: Restrict updates
DEFINE EVENT schemaVersion_on_update ON TABLE schemaVersion
WHEN $event = "UPDATE"
THEN {
    IF <string>$value.id != "schemaVersion:current" {
        THROW "[CODE] IMMUTABLE_RECORD [CODE] Cannot update schema version history records - they are immutable";
    };

    LET $maxVersion = (SELECT VALUE version FROM schemaVersion
        WHERE <string>id != "schemaVersion:current"
        ORDER BY version DESC LIMIT 1)[0];

    IF $after.version != $maxVersion {
        THROW "[CODE] INVALID_VERSION [CODE] schemaVersion:current can only be set to the highest version [MAX_VERSION] " + <string>$maxVersion + " [MAX_VERSION], attempted [ATTEMPTED_VERSION] " + <string>$after.version + " [ATTEMPTED_VERSION]";
    };

    IF $before.version IS NOT NONE AND $after.version <= $before.version {
        THROW "[CODE] VERSION_NOT_INCREMENTING [CODE] Version must increase from [BEFORE_VERSION] " + <string>$before.version + " [BEFORE_VERSION] to [AFTER_VERSION] " + <string>$after.version + " [AFTER_VERSION]";
    };
};

-- DELETE event: Prevent deletion
DEFINE EVENT schemaVersion_on_delete ON TABLE schemaVersion
WHEN $event = "DELETE"
THEN {
    THROW "[CODE] DELETE_NOT_ALLOWED [CODE] Cannot delete schema version records - version [VERSION] " + <string>$before.version + " [VERSION]";
};
`;

integrationTest("schemaVersion: cannot modify existing version history record", async () => {
  const tempMigrationsDir = await Deno.makeTempDir({ prefix: "surreal_mig_test_" });

  const ctx = await TestSetupBuilder.create()
    .withMigrationsDir(tempMigrationsDir)
    .withoutSurrealMigrations()
    .withBaseOnly()
    .build();

  try {
    // Set up schemaVersion table with events
    await ctx.surrealDb.query(SCHEMA_VERSION_SETUP);

    // Create initial versions
    await ctx.surrealDb.query("CREATE schemaVersion SET version = 0;");
    await ctx.surrealDb.query("CREATE schemaVersion SET version = 1;");

    // Get the history record for version 0
    const [records] = await ctx.surrealDb.query<[{ id: { id: string } }[]]>(
      "SELECT id FROM schemaVersion WHERE version = 0 AND <string>id != 'schemaVersion:current'"
    );
    const historyRecordId = records[0].id;

    // Try to modify the history record - should fail
    await expect(
      ctx.surrealDb.query(`UPDATE $recordId SET version = 99`, { recordId: historyRecordId })
    ).rejects.toThrow("IMMUTABLE_RECORD");
  } finally {
    await ctx.cleanup();
    await Deno.remove(tempMigrationsDir, { recursive: true });
  }
});

integrationTest("schemaVersion: cannot set current to version without history entry", async () => {
  const tempMigrationsDir = await Deno.makeTempDir({ prefix: "surreal_mig_test_" });

  const ctx = await TestSetupBuilder.create()
    .withMigrationsDir(tempMigrationsDir)
    .withoutSurrealMigrations()
    .withBaseOnly()
    .build();

  try {
    // Set up schemaVersion table with events
    await ctx.surrealDb.query(SCHEMA_VERSION_SETUP);

    // Create version 0 (this also creates/updates current to 0)
    await ctx.surrealDb.query("CREATE schemaVersion SET version = 0;");

    // Try to set current to version 5 which doesn't exist as a history entry
    await expect(
      ctx.surrealDb.query("UPDATE schemaVersion:current SET version = 5")
    ).rejects.toThrow("INVALID_VERSION");
  } finally {
    await ctx.cleanup();
    await Deno.remove(tempMigrationsDir, { recursive: true });
  }
});

integrationTest("schemaVersion: cannot delete version entries", async () => {
  const tempMigrationsDir = await Deno.makeTempDir({ prefix: "surreal_mig_test_" });

  const ctx = await TestSetupBuilder.create()
    .withMigrationsDir(tempMigrationsDir)
    .withoutSurrealMigrations()
    .withBaseOnly()
    .build();

  try {
    // Set up schemaVersion table with events
    await ctx.surrealDb.query(SCHEMA_VERSION_SETUP);

    // Create versions
    await ctx.surrealDb.query("CREATE schemaVersion SET version = 0;");
    await ctx.surrealDb.query("CREATE schemaVersion SET version = 1;");

    // Try to delete a history record - should fail
    await expect(
      ctx.surrealDb.query("DELETE schemaVersion WHERE version = 0 AND <string>id != 'schemaVersion:current'")
    ).rejects.toThrow("DELETE_NOT_ALLOWED");

    // Try to delete the current record - should also fail
    await expect(
      ctx.surrealDb.query("DELETE schemaVersion:current")
    ).rejects.toThrow("DELETE_NOT_ALLOWED");
  } finally {
    await ctx.cleanup();
    await Deno.remove(tempMigrationsDir, { recursive: true });
  }
});

integrationTest("schemaVersion: cannot add duplicate version", async () => {
  const tempMigrationsDir = await Deno.makeTempDir({ prefix: "surreal_mig_test_" });

  const ctx = await TestSetupBuilder.create()
    .withMigrationsDir(tempMigrationsDir)
    .withoutSurrealMigrations()
    .withBaseOnly()
    .build();

  try {
    // Set up schemaVersion table with events
    await ctx.surrealDb.query(SCHEMA_VERSION_SETUP);

    // Create version 0
    await ctx.surrealDb.query("CREATE schemaVersion SET version = 0;");

    // Try to create another record with version 0 - should fail
    await expect(
      ctx.surrealDb.query("CREATE schemaVersion SET version = 0;")
    ).rejects.toThrow("DUPLICATE_MIGRATION");
  } finally {
    await ctx.cleanup();
    await Deno.remove(tempMigrationsDir, { recursive: true });
  }
});

integrationTest("schemaVersion: can skip versions (e.g., v10 to v20)", async () => {
  const tempMigrationsDir = await Deno.makeTempDir({ prefix: "surreal_mig_test_" });

  const ctx = await TestSetupBuilder.create()
    .withMigrationsDir(tempMigrationsDir)
    .withoutSurrealMigrations()
    .withBaseOnly()
    .build();

  try {
    // Set up schemaVersion table with events
    await ctx.surrealDb.query(SCHEMA_VERSION_SETUP);

    // Create version 10
    await ctx.surrealDb.query("CREATE schemaVersion SET version = 10;");

    // Verify current is 10
    const [result1] = await ctx.surrealDb.query<[{ version: number }[]]>(
      "SELECT version FROM schemaVersion:current"
    );
    expect(result1[0].version).toBe(10);

    // Skip to version 20 (should succeed)
    await ctx.surrealDb.query("CREATE schemaVersion SET version = 20;");

    // Verify current is now 20
    const [result2] = await ctx.surrealDb.query<[{ version: number }[]]>(
      "SELECT version FROM schemaVersion:current"
    );
    expect(result2[0].version).toBe(20);

    // Verify we have both history entries
    const [history] = await ctx.surrealDb.query<[{ version: number }[]]>(
      "SELECT version FROM schemaVersion WHERE <string>id != 'schemaVersion:current' ORDER BY version"
    );
    expect(history.length).toBe(2);
    expect(history[0].version).toBe(10);
    expect(history[1].version).toBe(20);
  } finally {
    await ctx.cleanup();
    await Deno.remove(tempMigrationsDir, { recursive: true });
  }
});

integrationTest("schemaVersion: cannot update current to version lower than current", async () => {
  const tempMigrationsDir = await Deno.makeTempDir({ prefix: "surreal_mig_test_" });

  const ctx = await TestSetupBuilder.create()
    .withMigrationsDir(tempMigrationsDir)
    .withoutSurrealMigrations()
    .withBaseOnly()
    .build();

  try {
    // Set up schemaVersion table with events
    await ctx.surrealDb.query(SCHEMA_VERSION_SETUP);

    // Create versions 0, 1, 2
    await ctx.surrealDb.query("CREATE schemaVersion SET version = 0;");
    await ctx.surrealDb.query("CREATE schemaVersion SET version = 1;");
    await ctx.surrealDb.query("CREATE schemaVersion SET version = 2;");

    // Verify current is 2
    const [result] = await ctx.surrealDb.query<[{ version: number }[]]>(
      "SELECT version FROM schemaVersion:current"
    );
    expect(result[0].version).toBe(2);

    // Try to set current back to version 1 - should fail (even though v1 exists as history)
    // The max version is 2, so setting to 1 violates INVALID_VERSION
    await expect(
      ctx.surrealDb.query("UPDATE schemaVersion:current SET version = 1")
    ).rejects.toThrow("INVALID_VERSION");
  } finally {
    await ctx.cleanup();
    await Deno.remove(tempMigrationsDir, { recursive: true });
  }
});

integrationTest("schemaVersion: current is automatically updated when new version is created", async () => {
  const tempMigrationsDir = await Deno.makeTempDir({ prefix: "surreal_mig_test_" });

  const ctx = await TestSetupBuilder.create()
    .withMigrationsDir(tempMigrationsDir)
    .withoutSurrealMigrations()
    .withBaseOnly()
    .build();

  try {
    // Set up schemaVersion table with events
    await ctx.surrealDb.query(SCHEMA_VERSION_SETUP);

    // Create version 0
    await ctx.surrealDb.query("CREATE schemaVersion SET version = 0;");

    // Verify current was automatically set to 0
    const [result1] = await ctx.surrealDb.query<[{ version: number }[]]>(
      "SELECT version FROM schemaVersion:current"
    );
    expect(result1[0].version).toBe(0);

    // Create version 1
    await ctx.surrealDb.query("CREATE schemaVersion SET version = 1;");

    // Verify current was automatically updated to 1
    const [result2] = await ctx.surrealDb.query<[{ version: number }[]]>(
      "SELECT version FROM schemaVersion:current"
    );
    expect(result2[0].version).toBe(1);
  } finally {
    await ctx.cleanup();
    await Deno.remove(tempMigrationsDir, { recursive: true });
  }
});
