import { expect } from "@std/expect";
import { stub } from "@std/testing/mock";
import { DatabaseService } from "./database_service.ts";
import { MigrationService } from "./migration_service.ts";
import {
  MigrationError,
  MigrationExecutionError,
  MigrationFileError,
} from "./migration_errors.ts";

interface TestContext {
  db: DatabaseService;
  migrationService: MigrationService;
  tempDir: string;
  migrationsDir: string;
}

async function createTestContext(): Promise<TestContext> {
  const tempDir = await Deno.makeTempDir();
  const dbPath = `${tempDir}/test.db`;
  const migrationsDir = `${tempDir}/migrations`;

  await Deno.mkdir(migrationsDir);

  const db = new DatabaseService({ databasePath: dbPath });
  await db.open();

  const migrationService = new MigrationService({
    db,
    migrationsDir,
  });

  return { db, migrationService, tempDir, migrationsDir };
}

async function cleanup(tempDir: string): Promise<void> {
  await Deno.remove(tempDir, { recursive: true });
}

async function writeMigration(
  migrationsDir: string,
  filename: string,
  sql: string
): Promise<void> {
  await Deno.writeTextFile(`${migrationsDir}/${filename}`, sql);
}

// =====================
// getCurrentVersion tests
// =====================

Deno.test("getCurrentVersion returns null when schema_version table does not exist", async () => {
  const { db, migrationService, tempDir } = await createTestContext();

  try {
    const version = await migrationService.getCurrentVersion();
    expect(version).toBeNull();
    await db.close();
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("getCurrentVersion returns version when schema_version exists", async () => {
  const { db, migrationService, tempDir } = await createTestContext();

  try {
    // Manually create schema_version table and insert a version
    await db.exec("CREATE TABLE schema_version (version INTEGER NOT NULL)");
    await db.execute("INSERT INTO schema_version (version) VALUES (?)", [5]);

    const version = await migrationService.getCurrentVersion();
    expect(version).toBe(5);
    await db.close();
  } finally {
    await cleanup(tempDir);
  }
});

// =====================
// getAvailableMigrations tests
// =====================

Deno.test("getAvailableMigrations returns empty array for empty directory", async () => {
  const { db, migrationService, tempDir } = await createTestContext();

  try {
    const migrations = await migrationService.getAvailableMigrations();
    expect(migrations).toEqual([]);
    await db.close();
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("getAvailableMigrations parses migration files correctly", async () => {
  const { db, migrationService, tempDir, migrationsDir } =
    await createTestContext();

  try {
    await writeMigration(migrationsDir, "000-init.sql", "SELECT 1");
    await writeMigration(migrationsDir, "001-add-users.sql", "SELECT 2");
    await writeMigration(migrationsDir, "005-add-indexes.sql", "SELECT 3");

    const migrations = await migrationService.getAvailableMigrations();

    expect(migrations.length).toBe(3);
    expect(migrations[0].version).toBe(0);
    expect(migrations[0].filename).toBe("000-init.sql");
    expect(migrations[1].version).toBe(1);
    expect(migrations[1].filename).toBe("001-add-users.sql");
    expect(migrations[2].version).toBe(5);
    expect(migrations[2].filename).toBe("005-add-indexes.sql");

    await db.close();
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("getAvailableMigrations ignores non-matching files", async () => {
  const { db, migrationService, tempDir, migrationsDir } =
    await createTestContext();

  try {
    await writeMigration(migrationsDir, "000-init.sql", "SELECT 1");
    await writeMigration(migrationsDir, "readme.md", "# Migrations");
    await writeMigration(migrationsDir, "backup.sql", "SELECT 2");
    await writeMigration(migrationsDir, "00-short.sql", "SELECT 3"); // Only 2 digits
    await writeMigration(migrationsDir, "0001-four-digits.sql", "SELECT 4"); // 4 digits

    const migrations = await migrationService.getAvailableMigrations();

    expect(migrations.length).toBe(1);
    expect(migrations[0].filename).toBe("000-init.sql");

    await db.close();
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("getAvailableMigrations returns migrations sorted by version", async () => {
  const { db, migrationService, tempDir, migrationsDir } =
    await createTestContext();

  try {
    // Write in non-sorted order
    await writeMigration(migrationsDir, "005-last.sql", "SELECT 5");
    await writeMigration(migrationsDir, "001-second.sql", "SELECT 1");
    await writeMigration(migrationsDir, "000-first.sql", "SELECT 0");

    const migrations = await migrationService.getAvailableMigrations();

    expect(migrations.length).toBe(3);
    expect(migrations[0].version).toBe(0);
    expect(migrations[1].version).toBe(1);
    expect(migrations[2].version).toBe(5);

    await db.close();
  } finally {
    await cleanup(tempDir);
  }
});

// =====================
// migrate tests
// =====================

Deno.test("migrate applies all migrations on fresh database", async () => {
  const { db, migrationService, tempDir, migrationsDir } =
    await createTestContext();

  try {
    await writeMigration(
      migrationsDir,
      "000-init.sql",
      `
      CREATE TABLE schema_version (version INTEGER NOT NULL);
      CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
    `
    );
    await writeMigration(
      migrationsDir,
      "001-add-email.sql",
      "ALTER TABLE users ADD COLUMN email TEXT"
    );

    const result = await migrationService.migrate();

    expect(result.appliedCount).toBe(2);
    expect(result.fromVersion).toBeNull();
    expect(result.toVersion).toBe(1);

    // Verify schema_version was updated
    const version = await migrationService.getCurrentVersion();
    expect(version).toBe(1);

    // Verify tables exist
    const tables = await db.queryAll<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    );
    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain("schema_version");
    expect(tableNames).toContain("users");

    await db.close();
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("migrate only applies new migrations on partially migrated database", async () => {
  const { db, migrationService, tempDir, migrationsDir } =
    await createTestContext();

  try {
    // Simulate already having run migration 000
    await db.exec("CREATE TABLE schema_version (version INTEGER NOT NULL)");
    await db.execute("INSERT INTO schema_version (version) VALUES (?)", [0]);
    await db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");

    // Write all migrations (including already-applied 000)
    await writeMigration(
      migrationsDir,
      "000-init.sql",
      "CREATE TABLE schema_version (version INTEGER NOT NULL); CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)"
    );
    await writeMigration(
      migrationsDir,
      "001-add-email.sql",
      "ALTER TABLE users ADD COLUMN email TEXT"
    );
    await writeMigration(
      migrationsDir,
      "002-add-posts.sql",
      "CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT)"
    );

    const result = await migrationService.migrate();

    expect(result.appliedCount).toBe(2); // Only 001 and 002
    expect(result.fromVersion).toBe(0);
    expect(result.toVersion).toBe(2);

    // Verify schema_version was updated
    const version = await migrationService.getCurrentVersion();
    expect(version).toBe(2);

    await db.close();
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("migrate returns zero applied when no pending migrations", async () => {
  const { db, migrationService, tempDir, migrationsDir } =
    await createTestContext();

  try {
    // Simulate already having run all migrations
    await db.exec("CREATE TABLE schema_version (version INTEGER NOT NULL)");
    await db.execute("INSERT INTO schema_version (version) VALUES (?)", [1]);

    await writeMigration(migrationsDir, "000-init.sql", "SELECT 1");
    await writeMigration(migrationsDir, "001-add-users.sql", "SELECT 2");

    const result = await migrationService.migrate();

    expect(result.appliedCount).toBe(0);
    expect(result.fromVersion).toBe(1);
    expect(result.toVersion).toBe(1);

    await db.close();
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("migrate handles version gaps correctly", async () => {
  const { db, migrationService, tempDir, migrationsDir } =
    await createTestContext();

  try {
    await writeMigration(
      migrationsDir,
      "000-init.sql",
      "CREATE TABLE schema_version (version INTEGER NOT NULL)"
    );
    await writeMigration(
      migrationsDir,
      "005-skip-to-five.sql",
      "CREATE TABLE five (id INTEGER)"
    );
    await writeMigration(
      migrationsDir,
      "010-skip-to-ten.sql",
      "CREATE TABLE ten (id INTEGER)"
    );

    const result = await migrationService.migrate();

    expect(result.appliedCount).toBe(3);
    expect(result.fromVersion).toBeNull();
    expect(result.toVersion).toBe(10);

    const version = await migrationService.getCurrentVersion();
    expect(version).toBe(10);

    await db.close();
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("migrate throws MigrationExecutionError on SQL failure", async () => {
  const { db, migrationService, tempDir, migrationsDir } =
    await createTestContext();

  try {
    await writeMigration(
      migrationsDir,
      "000-init.sql",
      "CREATE TABLE schema_version (version INTEGER NOT NULL)"
    );
    await writeMigration(
      migrationsDir,
      "001-bad.sql",
      "THIS IS NOT VALID SQL"
    );

    await expect(migrationService.migrate()).rejects.toThrow(
      MigrationExecutionError
    );

    // Version should be 0 (first migration succeeded, second failed)
    const version = await migrationService.getCurrentVersion();
    expect(version).toBe(0);

    await db.close();
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("MigrationFileError contains file path", () => {
  const error = new MigrationFileError("/path/to/migration.sql", new Error("ENOENT"));

  expect(error.name).toBe("MigrationFileError");
  expect(error.filePath).toBe("/path/to/migration.sql");
  expect(error.message).toContain("/path/to/migration.sql");
  expect(error.originalError).toBeInstanceOf(Error);
});

Deno.test("migrate returns correct result when no migrations exist", async () => {
  const { db, migrationService, tempDir } = await createTestContext();

  try {
    const result = await migrationService.migrate();

    expect(result.appliedCount).toBe(0);
    expect(result.fromVersion).toBeNull();
    expect(result.toVersion).toBe(0);

    await db.close();
  } finally {
    await cleanup(tempDir);
  }
});

// =====================
// Mocking tests
// =====================

Deno.test("migrate throws MigrationFileError when Deno.readTextFile fails", async () => {
  const { db, migrationService, tempDir, migrationsDir } =
    await createTestContext();

  // Pre-read the first migration content before stubbing
  const firstMigrationContent =
    "CREATE TABLE schema_version (version INTEGER NOT NULL)";
  await writeMigration(migrationsDir, "000-init.sql", firstMigrationContent);
  await writeMigration(migrationsDir, "001-second.sql", "SELECT 1");

  // Store original function
  const originalReadTextFile = Deno.readTextFile.bind(Deno);

  // Stub Deno.readTextFile to fail on the second migration
  const readTextFileStub = stub(Deno, "readTextFile", (path: string | URL) => {
    const pathStr = path.toString();
    if (pathStr.includes("001-second.sql")) {
      return Promise.reject(new Error("Permission denied"));
    }
    return originalReadTextFile(path);
  });

  try {
    await expect(migrationService.migrate()).rejects.toThrow(MigrationFileError);

    // Verify first migration was applied
    const version = await migrationService.getCurrentVersion();
    expect(version).toBe(0);

    await db.close();
  } finally {
    readTextFileStub.restore();
    await cleanup(tempDir);
  }
});

Deno.test("getAvailableMigrations throws MigrationError when directory read fails", async () => {
  const { db, tempDir } = await createTestContext();

  try {
    const badMigrationService = new MigrationService({
      db,
      migrationsDir: `${tempDir}/nonexistent`,
    });

    await expect(badMigrationService.getAvailableMigrations()).rejects.toThrow(
      MigrationError
    );

    await db.close();
  } finally {
    await cleanup(tempDir);
  }
});

Deno.test("MigrationExecutionError contains version and filename", () => {
  const error = new MigrationExecutionError(
    5,
    "005-add-users.sql",
    new Error("syntax error")
  );

  expect(error.name).toBe("MigrationExecutionError");
  expect(error.version).toBe(5);
  expect(error.filename).toBe("005-add-users.sql");
  expect(error.message).toContain("5");
  expect(error.message).toContain("005-add-users.sql");
  expect(error.originalError).toBeInstanceOf(Error);
});

Deno.test("MigrationService - failed migration rolls back atomically", async () => {
  const tempDir = await Deno.makeTempDir();
  const dbPath = `${tempDir}/test.db`;
  const migrationsDir = `${tempDir}/migrations`;

  try {
    await Deno.mkdir(migrationsDir);

    // Create initial migration
    await Deno.writeTextFile(
      `${migrationsDir}/000-init.sql`,
      `CREATE TABLE schema_version (version INTEGER);
       INSERT INTO schema_version (version) VALUES (0);`
    );

    const db = new DatabaseService({ databasePath: dbPath });
    await db.open();

    const service = new MigrationService({ db, migrationsDir });

    // Apply init migration
    await service.migrate();
    expect(await service.getCurrentVersion()).toBe(0);

    // Create migration with syntax error AFTER first migration succeeds
    await Deno.writeTextFile(
      `${migrationsDir}/001-broken.sql`,
      `CREATE TABLE users (id INTEGER);
       INSERT INTO users VALUES (1);
       THIS IS INVALID SQL;
       INSERT INTO users VALUES (2);`
    );

    // Attempt broken migration - should fail
    await expect(service.migrate()).rejects.toThrow(MigrationExecutionError);

    // Verify rollback - version unchanged
    expect(await service.getCurrentVersion()).toBe(0);

    // Verify rollback - table not created
    const tables = await db.queryAll<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='users'"
    );
    expect(tables.length).toBe(0);

    await db.close();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
