import type { DatabaseService } from "./database_service.ts";
import type { TransactionContext } from "./types.ts";
import {
  MigrationError,
  MigrationFileError,
  MigrationExecutionError,
} from "./migration_errors.ts";

/**
 * Configuration options for the MigrationService
 */
export interface MigrationServiceOptions {
  /** Database service instance */
  db: DatabaseService;
  /** Path to the migrations directory */
  migrationsDir: string;
}

/**
 * Represents a single migration file
 */
export interface Migration {
  /** Version number parsed from filename (e.g., 0, 1, 5) */
  version: number;
  /** Original filename (e.g., "000-init.sql") */
  filename: string;
  /** Full path to the migration file */
  path: string;
}

/**
 * Result of running migrations
 */
export interface MigrationResult {
  /** Number of migrations applied */
  appliedCount: number;
  /** Version before migration (null if none applied) */
  fromVersion: number | null;
  /** Version after migration */
  toVersion: number;
}

/** Regex to match migration filenames: 3-digit prefix followed by anything, ending in .sql */
const MIGRATION_FILENAME_REGEX = /^(\d{3})-.+\.sql$/;

/**
 * Simple forward-only migration service for SQLite databases.
 *
 * Migrations are SQL files in the migrations directory with names like:
 * - 000-init.sql
 * - 001-add-users.sql
 * - 005-add-indexes.sql (gaps are allowed)
 *
 * The first migration (000) should create the schemaVersion table.
 *
 * @example
 * ```typescript
 * const migrationService = new MigrationService({
 *   db,
 *   migrationsDir: "./migrations",
 * });
 *
 * const result = await migrationService.migrate();
 * console.log(`Applied ${result.appliedCount} migrations`);
 * ```
 */
export class MigrationService {
  private readonly db: DatabaseService;
  private readonly migrationsDir: string;

  constructor(options: MigrationServiceOptions) {
    this.db = options.db;
    this.migrationsDir = options.migrationsDir;
  }

  /**
   * Gets the current schema version from the database.
   *
   * @returns Current version number, or null if no migrations have been applied
   *          (schemaVersion table doesn't exist or is empty)
   */
  async getCurrentVersion(): Promise<number | null> {
    try {
      const row = await this.db.queryOne<{ version: number }>(
        "SELECT version FROM schemaVersion LIMIT 1"
      );
      return row?.version ?? null;
    } catch {
      // Table doesn't exist - no migrations applied yet
      return null;
    }
  }

  /**
   * Scans the migrations directory and returns all available migrations
   * sorted by version number in ascending order.
   *
   * @returns Array of Migration objects sorted by version
   * @throws MigrationError if the migrations directory cannot be read
   */
  async getAvailableMigrations(): Promise<Migration[]> {
    const migrations: Migration[] = [];

    try {
      for await (const entry of Deno.readDir(this.migrationsDir)) {
        if (!entry.isFile) continue;

        const match = entry.name.match(MIGRATION_FILENAME_REGEX);
        if (!match) continue;

        const version = parseInt(match[1], 10);
        migrations.push({
          version,
          filename: entry.name,
          path: `${this.migrationsDir}/${entry.name}`,
        });
      }
    } catch (error) {
      throw new MigrationError(
        `Failed to read migrations directory: ${this.migrationsDir}: ${error}`
      );
    }

    // Sort by version ascending
    migrations.sort((a, b) => a.version - b.version);
    return migrations;
  }

  /**
   * Applies all pending migrations in order.
   *
   * @returns MigrationResult with details about what was applied
   * @throws MigrationFileError if a migration file cannot be read
   * @throws MigrationExecutionError if a migration fails to execute
   */
  async migrate(): Promise<MigrationResult> {
    const currentVersion = await this.getCurrentVersion();
    const availableMigrations = await this.getAvailableMigrations();

    // Filter to only migrations newer than current version
    const pendingMigrations = availableMigrations.filter(
      (m) => currentVersion === null || m.version > currentVersion
    );

    if (pendingMigrations.length === 0) {
      return {
        appliedCount: 0,
        fromVersion: currentVersion,
        toVersion: currentVersion ?? 0,
      };
    }

    // Apply each migration in order
    for (const migration of pendingMigrations) {
      await this.applyMigration(migration);
    }

    const finalVersion = pendingMigrations[pendingMigrations.length - 1].version;

    return {
      appliedCount: pendingMigrations.length,
      fromVersion: currentVersion,
      toVersion: finalVersion,
    };
  }

  /**
   * Applies a single migration and updates the schema version.
   * The migration SQL and version update are executed atomically within a transaction.
   *
   * @param migration - The migration to apply
   * @throws MigrationFileError if the migration file cannot be read
   * @throws MigrationExecutionError if the SQL execution fails
   */
  private async applyMigration(migration: Migration): Promise<void> {
    // Read the migration file
    let sql: string;
    try {
      sql = await Deno.readTextFile(migration.path);
    } catch (error) {
      throw new MigrationFileError(migration.path, error);
    }

    // Execute migration and version update atomically
    try {
      await this.db.transaction(async (tx) => {
        // Execute the migration SQL
        await tx.exec(sql);

        // Update the schema version (now atomic with migration)
        await this.updateVersionInTransaction(tx, migration.version);
      });
    } catch (error) {
      // If it's already a MigrationFileError, re-throw as is
      if (error instanceof MigrationFileError) {
        throw error;
      }
      // Otherwise wrap in MigrationExecutionError
      throw new MigrationExecutionError(
        migration.version,
        migration.filename,
        error
      );
    }
  }

  /**
   * Updates the schema version in the database.
   * Inserts if no version exists, updates otherwise.
   */
  private async updateVersion(version: number): Promise<void> {
    // Check if a version row exists
    const existing = await this.db.queryOne<{ version: number }>(
      "SELECT version FROM schemaVersion LIMIT 1"
    );

    if (existing === null) {
      // Insert initial version
      await this.db.execute("INSERT INTO schemaVersion (version) VALUES (?)", [
        version,
      ]);
    } else {
      // Update existing version
      await this.db.execute("UPDATE schemaVersion SET version = ?", [version]);
    }
  }

  /**
   * Updates the schema version within a transaction context.
   * Inserts if no version exists, updates otherwise.
   *
   * @param tx - Transaction context
   * @param version - Version number to set
   */
  private async updateVersionInTransaction(
    tx: TransactionContext,
    version: number
  ): Promise<void> {
    // Check if a version row exists
    const existing = await tx.queryOne<{ version: number }>(
      "SELECT version FROM schemaVersion LIMIT 1"
    );

    if (existing === null) {
      // Insert initial version
      await tx.execute("INSERT INTO schemaVersion (version) VALUES (?)", [
        version,
      ]);
    } else {
      // Update existing version
      await tx.execute("UPDATE schemaVersion SET version = ?", [version]);
    }
  }
}
