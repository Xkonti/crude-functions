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
// getCurrentVersion tests
// =====================

Deno.test("getCurrentVersion returns null when schema_version table does not exist", async () => {
  // Create temp migrations dir (empty - no migrations)
  const tempMigrationsDir = await Deno.makeTempDir({ prefix: "surreal_mig_test_" });

  const ctx = await TestSetupBuilder.create()
    .withMigrationsDir(tempMigrationsDir)
    .withSurrealDB()
    .build();

  try {
    const migrationService = new SurrealMigrationService({
      db: ctx.surrealDb,
      migrationsDir: tempMigrationsDir,
    });
    const version = await migrationService.getCurrentVersion();
    expect(version).toBeNull();
  } finally {
    await ctx.cleanup();
    await Deno.remove(tempMigrationsDir, { recursive: true });
  }
});

Deno.test("getCurrentVersion returns version when schema_version exists", async () => {
  const tempMigrationsDir = await Deno.makeTempDir({ prefix: "surreal_mig_test_" });

  const ctx = await TestSetupBuilder.create()
    .withMigrationsDir(tempMigrationsDir)
    .withSurrealDB()
    .build();

  try {
    // Manually create schema_version table and record
    await ctx.surrealDb.query(`
      DEFINE TABLE schema_version SCHEMAFULL;
      DEFINE FIELD version ON schema_version TYPE int;
    `);
    await ctx.surrealDb.query("CREATE schema_version:current SET version = 5");

    const migrationService = new SurrealMigrationService({
      db: ctx.surrealDb,
      migrationsDir: tempMigrationsDir,
    });
    const version = await migrationService.getCurrentVersion();
    expect(version).toBe(5);
  } finally {
    await ctx.cleanup();
    await Deno.remove(tempMigrationsDir, { recursive: true });
  }
});

// =====================
// getAvailableMigrations tests
// =====================

Deno.test("getAvailableMigrations returns empty array for empty directory", async () => {
  const tempMigrationsDir = await Deno.makeTempDir({ prefix: "surreal_mig_test_" });

  const ctx = await TestSetupBuilder.create()
    .withMigrationsDir(tempMigrationsDir)
    .withSurrealDB()
    .build();

  try {
    const migrationService = new SurrealMigrationService({
      db: ctx.surrealDb,
      migrationsDir: tempMigrationsDir,
    });
    const migrations = await migrationService.getAvailableMigrations();
    expect(migrations).toEqual([]);
  } finally {
    await ctx.cleanup();
    await Deno.remove(tempMigrationsDir, { recursive: true });
  }
});

Deno.test("getAvailableMigrations parses migration files correctly", async () => {
  const tempMigrationsDir = await Deno.makeTempDir({ prefix: "surreal_mig_test_" });

  try {
    await writeMigration(tempMigrationsDir, "000-init.surql", "-- init");
    await writeMigration(tempMigrationsDir, "001-add-users.surql", "-- users");
    await writeMigration(tempMigrationsDir, "005-add-indexes.surql", "-- indexes");

    const ctx = await TestSetupBuilder.create()
      .withMigrationsDir(tempMigrationsDir)
      .withSurrealDB()
      .build();

    try {
      const migrationService = new SurrealMigrationService({
        db: ctx.surrealDb,
        migrationsDir: tempMigrationsDir,
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

Deno.test("getAvailableMigrations ignores non-matching files", async () => {
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
      .withSurrealDB()
      .build();

    try {
      const migrationService = new SurrealMigrationService({
        db: ctx.surrealDb,
        migrationsDir: tempMigrationsDir,
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

Deno.test("getAvailableMigrations returns migrations sorted by version", async () => {
  const tempMigrationsDir = await Deno.makeTempDir({ prefix: "surreal_mig_test_" });

  try {
    // Write in non-sorted order
    await writeMigration(tempMigrationsDir, "005-last.surql", "-- last");
    await writeMigration(tempMigrationsDir, "001-second.surql", "-- second");
    await writeMigration(tempMigrationsDir, "000-first.surql", "-- first");

    const ctx = await TestSetupBuilder.create()
      .withMigrationsDir(tempMigrationsDir)
      .withSurrealDB()
      .build();

    try {
      const migrationService = new SurrealMigrationService({
        db: ctx.surrealDb,
        migrationsDir: tempMigrationsDir,
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

Deno.test("migrate applies all migrations on fresh database", async () => {
  const tempMigrationsDir = await Deno.makeTempDir({ prefix: "surreal_mig_test_" });

  try {
    await writeMigration(
      tempMigrationsDir,
      "000-init.surql",
      `
      DEFINE TABLE schema_version SCHEMAFULL;
      DEFINE FIELD version ON schema_version TYPE int;
      CREATE schema_version:current SET version = 0;

      DEFINE TABLE users SCHEMAFULL;
      DEFINE FIELD name ON users TYPE string;
    `
    );
    await writeMigration(
      tempMigrationsDir,
      "001-add-email.surql",
      "DEFINE FIELD email ON users TYPE option<string>;"
    );

    const ctx = await TestSetupBuilder.create()
      .withMigrationsDir(tempMigrationsDir)
      .withSurrealDB()
      .build();

    try {
      const migrationService = new SurrealMigrationService({
        db: ctx.surrealDb,
        migrationsDir: tempMigrationsDir,
      });

      const result = await migrationService.migrate();

      expect(result.appliedCount).toBe(2);
      expect(result.fromVersion).toBeNull();
      expect(result.toVersion).toBe(1);

      // Verify schema_version was updated
      const version = await migrationService.getCurrentVersion();
      expect(version).toBe(1);

      // Verify users table exists by querying it
      const users = await ctx.surrealDb.select("users");
      expect(Array.isArray(users)).toBe(true);
    } finally {
      await ctx.cleanup();
    }
  } finally {
    await Deno.remove(tempMigrationsDir, { recursive: true });
  }
});

Deno.test("migrate only applies new migrations on partially migrated database", async () => {
  const tempMigrationsDir = await Deno.makeTempDir({ prefix: "surreal_mig_test_" });

  const ctx = await TestSetupBuilder.create()
    .withMigrationsDir(tempMigrationsDir)
    .withSurrealDB()
    .build();

  try {
    // Simulate already having run migration 000
    await ctx.surrealDb.query(`
      DEFINE TABLE schema_version SCHEMAFULL;
      DEFINE FIELD version ON schema_version TYPE int;
      CREATE schema_version:current SET version = 0;

      DEFINE TABLE users SCHEMAFULL;
      DEFINE FIELD name ON users TYPE string;
    `);

    // Write all migrations (including already-applied 000)
    await writeMigration(
      tempMigrationsDir,
      "000-init.surql",
      `
      DEFINE TABLE schema_version SCHEMAFULL;
      DEFINE FIELD version ON schema_version TYPE int;
      CREATE schema_version:current SET version = 0;
      DEFINE TABLE users SCHEMAFULL;
      DEFINE FIELD name ON users TYPE string;
    `
    );
    await writeMigration(
      tempMigrationsDir,
      "001-add-email.surql",
      "DEFINE FIELD email ON users TYPE option<string>;"
    );
    await writeMigration(
      tempMigrationsDir,
      "002-add-posts.surql",
      `
      DEFINE TABLE posts SCHEMAFULL;
      DEFINE FIELD title ON posts TYPE string;
    `
    );

    const migrationService = new SurrealMigrationService({
      db: ctx.surrealDb,
      migrationsDir: tempMigrationsDir,
    });

    const result = await migrationService.migrate();

    expect(result.appliedCount).toBe(2); // Only 001 and 002
    expect(result.fromVersion).toBe(0);
    expect(result.toVersion).toBe(2);

    // Verify schema_version was updated
    const version = await migrationService.getCurrentVersion();
    expect(version).toBe(2);
  } finally {
    await ctx.cleanup();
    await Deno.remove(tempMigrationsDir, { recursive: true });
  }
});

Deno.test("migrate returns zero applied when no pending migrations", async () => {
  const tempMigrationsDir = await Deno.makeTempDir({ prefix: "surreal_mig_test_" });

  const ctx = await TestSetupBuilder.create()
    .withMigrationsDir(tempMigrationsDir)
    .withSurrealDB()
    .build();

  try {
    // Simulate already having run all migrations
    await ctx.surrealDb.query(`
      DEFINE TABLE schema_version SCHEMAFULL;
      DEFINE FIELD version ON schema_version TYPE int;
      CREATE schema_version:current SET version = 1;
    `);

    await writeMigration(tempMigrationsDir, "000-init.surql", "-- init");
    await writeMigration(tempMigrationsDir, "001-add-users.surql", "-- users");

    const migrationService = new SurrealMigrationService({
      db: ctx.surrealDb,
      migrationsDir: tempMigrationsDir,
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

Deno.test("migrate handles version gaps correctly", async () => {
  const tempMigrationsDir = await Deno.makeTempDir({ prefix: "surreal_mig_test_" });

  try {
    await writeMigration(
      tempMigrationsDir,
      "000-init.surql",
      `
      DEFINE TABLE schema_version SCHEMAFULL;
      DEFINE FIELD version ON schema_version TYPE int;
      CREATE schema_version:current SET version = 0;
    `
    );
    await writeMigration(
      tempMigrationsDir,
      "005-skip-to-five.surql",
      `
      DEFINE TABLE five SCHEMAFULL;
      DEFINE FIELD id ON five TYPE int;
    `
    );
    await writeMigration(
      tempMigrationsDir,
      "010-skip-to-ten.surql",
      `
      DEFINE TABLE ten SCHEMAFULL;
      DEFINE FIELD id ON ten TYPE int;
    `
    );

    const ctx = await TestSetupBuilder.create()
      .withMigrationsDir(tempMigrationsDir)
      .withSurrealDB()
      .build();

    try {
      const migrationService = new SurrealMigrationService({
        db: ctx.surrealDb,
        migrationsDir: tempMigrationsDir,
      });

      const result = await migrationService.migrate();

      expect(result.appliedCount).toBe(3);
      expect(result.fromVersion).toBeNull();
      expect(result.toVersion).toBe(10);

      const version = await migrationService.getCurrentVersion();
      expect(version).toBe(10);
    } finally {
      await ctx.cleanup();
    }
  } finally {
    await Deno.remove(tempMigrationsDir, { recursive: true });
  }
});

Deno.test("migrate throws SurrealMigrationExecutionError on SurrealQL failure", async () => {
  const tempMigrationsDir = await Deno.makeTempDir({ prefix: "surreal_mig_test_" });

  try {
    await writeMigration(
      tempMigrationsDir,
      "000-init.surql",
      `
      DEFINE TABLE schema_version SCHEMAFULL;
      DEFINE FIELD version ON schema_version TYPE int;
      CREATE schema_version:current SET version = 0;
    `
    );
    await writeMigration(
      tempMigrationsDir,
      "001-bad.surql",
      "THIS IS NOT VALID SURREALQL %%% SYNTAX ERROR"
    );

    const ctx = await TestSetupBuilder.create()
      .withMigrationsDir(tempMigrationsDir)
      .withSurrealDB()
      .build();

    try {
      const migrationService = new SurrealMigrationService({
        db: ctx.surrealDb,
        migrationsDir: tempMigrationsDir,
      });

      await expect(migrationService.migrate()).rejects.toThrow(
        SurrealMigrationExecutionError
      );

      // Version should be 0 (first migration succeeded, second failed)
      const version = await migrationService.getCurrentVersion();
      expect(version).toBe(0);
    } finally {
      await ctx.cleanup();
    }
  } finally {
    await Deno.remove(tempMigrationsDir, { recursive: true });
  }
});

Deno.test("migrate returns correct result when no migrations exist", async () => {
  const tempMigrationsDir = await Deno.makeTempDir({ prefix: "surreal_mig_test_" });

  const ctx = await TestSetupBuilder.create()
    .withMigrationsDir(tempMigrationsDir)
    .withSurrealDB()
    .build();

  try {
    const migrationService = new SurrealMigrationService({
      db: ctx.surrealDb,
      migrationsDir: tempMigrationsDir,
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

Deno.test("SurrealMigrationFileError contains file path", () => {
  const error = new SurrealMigrationFileError("/path/to/migration.surql", new Error("ENOENT"));

  expect(error.name).toBe("SurrealMigrationFileError");
  expect(error.filePath).toBe("/path/to/migration.surql");
  expect(error.message).toContain("/path/to/migration.surql");
  expect(error.originalError).toBeInstanceOf(Error);
});

Deno.test("SurrealMigrationExecutionError contains version and filename", () => {
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

Deno.test("getAvailableMigrations throws SurrealMigrationError when directory read fails", async () => {
  const tempMigrationsDir = await Deno.makeTempDir({ prefix: "surreal_mig_test_" });

  const ctx = await TestSetupBuilder.create()
    .withMigrationsDir(tempMigrationsDir)
    .withSurrealDB()
    .build();

  try {
    const badMigrationService = new SurrealMigrationService({
      db: ctx.surrealDb,
      migrationsDir: `${tempMigrationsDir}/nonexistent`,
    });

    await expect(badMigrationService.getAvailableMigrations()).rejects.toThrow(
      SurrealMigrationError
    );
  } finally {
    await ctx.cleanup();
    await Deno.remove(tempMigrationsDir, { recursive: true });
  }
});
