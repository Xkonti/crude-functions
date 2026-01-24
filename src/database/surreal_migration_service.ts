import type { SurrealDatabaseService } from "./surreal_database_service.ts";
import {
  SurrealMigrationError,
  SurrealMigrationFileError,
  SurrealMigrationExecutionError,
} from "./surreal_errors.ts";

/**
 * Configuration options for the SurrealMigrationService
 */
export interface SurrealMigrationServiceOptions {
  /** SurrealDB database service instance */
  db: SurrealDatabaseService;
  /** Path to the migrations directory */
  migrationsDir: string;
}

/**
 * Represents a single migration file
 */
export interface SurrealMigration {
  /** Version number parsed from filename (e.g., 0, 1, 5) */
  version: number;
  /** Original filename (e.g., "000-surreal-init.surql") */
  filename: string;
  /** Full path to the migration file */
  path: string;
}

/**
 * Result of running migrations
 */
export interface SurrealMigrationResult {
  /** Number of migrations applied */
  appliedCount: number;
  /** Version before migration (null if none applied) */
  fromVersion: number | null;
  /** Version after migration (null if no migrations exist) */
  toVersion: number | null;
}

/** Regex to match migration filenames: 3-digit prefix followed by anything, ending in .surql */
const MIGRATION_FILENAME_REGEX = /^(\d{3})-.+\.surql$/;

/**
 * Simple forward-only migration service for SurrealDB databases.
 *
 * Migrations are SurrealQL files in the migrations directory with names like:
 * - 000-surreal-init.surql
 * - 001-surreal-users.surql
 * - 005-surreal-indexes.surql (gaps are allowed)
 *
 * The first migration (000) should create the schema_version table.
 *
 * @example
 * ```typescript
 * const migrationService = new SurrealMigrationService({
 *   db: surrealDb,
 *   migrationsDir: "./migrations",
 * });
 *
 * const result = await migrationService.migrate();
 * console.log(`Applied ${result.appliedCount} migrations`);
 * ```
 */
export class SurrealMigrationService {
  private readonly db: SurrealDatabaseService;
  private readonly migrationsDir: string;

  constructor(options: SurrealMigrationServiceOptions) {
    this.db = options.db;
    this.migrationsDir = options.migrationsDir;
  }

  /**
   * Gets the current schema version from the database.
   *
   * @returns Current version number, or null if no migrations have been applied
   *          (schema_version table doesn't exist or is empty)
   */
  async getCurrentVersion(): Promise<number | null> {
    try {
      const result = await this.db.selectOne<{ version: number }>(
        "schema_version",
        "current"
      );
      return result?.version ?? null;
    } catch {
      // Table doesn't exist or record doesn't exist - no migrations applied yet
      return null;
    }
  }

  /**
   * Scans the migrations directory and returns all available SurrealDB migrations
   * sorted by version number in ascending order.
   *
   * @returns Array of SurrealMigration objects sorted by version
   * @throws SurrealMigrationError if the migrations directory cannot be read
   */
  async getAvailableMigrations(): Promise<SurrealMigration[]> {
    const migrations: SurrealMigration[] = [];

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
      throw new SurrealMigrationError(
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
   * @returns SurrealMigrationResult with details about what was applied
   * @throws SurrealMigrationFileError if a migration file cannot be read
   * @throws SurrealMigrationExecutionError if a migration fails to execute
   */
  async migrate(): Promise<SurrealMigrationResult> {
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
        toVersion: currentVersion,
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
   *
   * Note: SurrealDB doesn't have explicit transaction support like SQLite,
   * so migrations are applied as individual queries. Each query within the
   * migration file is executed sequentially.
   *
   * @param migration - The migration to apply
   * @throws SurrealMigrationFileError if the migration file cannot be read
   * @throws SurrealMigrationExecutionError if the SurrealQL execution fails
   */
  private async applyMigration(migration: SurrealMigration): Promise<void> {
    // Read the migration file
    let surql: string;
    try {
      surql = await Deno.readTextFile(migration.path);
    } catch (error) {
      throw new SurrealMigrationFileError(migration.path, error);
    }

    // Execute migration
    try {
      // Execute the migration SurrealQL
      await this.db.query(surql);

      // Update the schema version
      await this.updateVersion(migration.version);
    } catch (error) {
      // If it's already a SurrealMigrationFileError, re-throw as is
      if (error instanceof SurrealMigrationFileError) {
        throw error;
      }
      // Otherwise wrap in SurrealMigrationExecutionError
      throw new SurrealMigrationExecutionError(
        migration.version,
        migration.filename,
        error
      );
    }
  }

  /**
   * Updates the schema version in the database.
   * Uses UPSERT semantics to create or update the version record.
   */
  private async updateVersion(version: number): Promise<void> {
    // Use UPSERT to create or update the version record
    await this.db.query(
      "UPSERT schema_version:current SET version = $version",
      { version }
    );
  }
}
