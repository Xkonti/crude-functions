import type { Surreal } from "surrealdb";
import type { SurrealConnectionFactory } from "./surreal_connection_factory.ts";
import {
  SurrealMigrationError,
  SurrealMigrationFileError,
  SurrealMigrationExecutionError,
} from "./surreal_errors.ts";

/**
 * Configuration options for the SurrealMigrationService
 */
export interface SurrealMigrationServiceOptions {
  /** Connection factory for creating database connections */
  connectionFactory: SurrealConnectionFactory;
  /** Path to the migrations directory */
  migrationsDir: string;
  /** Target namespace (optional - uses factory's default if not specified) */
  namespace?: string;
  /** Target database (optional - uses factory's default if not specified) */
  database?: string;
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
 * Each migration must self-register by including:
 * `CREATE schemaVersion SET version = X;`
 *
 * The schemaVersion table maintains a history of all applied migrations.
 * The special record `schemaVersion:current` always points to the latest version.
 *
 * @example
 * ```typescript
 * const migrationService = new SurrealMigrationService({
 *   connectionFactory: surrealFactory,
 *   migrationsDir: "./migrations",
 * });
 *
 * const result = await migrationService.migrate();
 * console.log(`Applied ${result.appliedCount} migrations`);
 * ```
 */
export class SurrealMigrationService {
  private readonly connectionFactory: SurrealConnectionFactory;
  private readonly migrationsDir: string;
  private readonly namespace: string;
  private readonly database: string;

  constructor(options: SurrealMigrationServiceOptions) {
    this.connectionFactory = options.connectionFactory;
    this.migrationsDir = options.migrationsDir;
    this.namespace = options.namespace ?? options.connectionFactory.namespace;
    this.database = options.database ?? options.connectionFactory.database;
  }

  /**
   * Gets the current schema version from the database.
   *
   * Checks the new schemaVersion table first, then falls back to the old
   * schema_version table for backwards compatibility with existing installations.
   *
   * @param db - Open database connection
   * @returns Current version number, or null if no migrations have been applied
   */
  private async getCurrentVersion(db: Surreal): Promise<number | null> {
    // Try new table first (schemaVersion)
    try {
      const result = await db.query<[{ version: number }[]]>(
        "SELECT version FROM schemaVersion:current"
      );
      const version = result?.[0]?.[0]?.version;
      if (version !== undefined) {
        return version;
      }
    } catch {
      // Table doesn't exist - try old table
    }

    // Fall back to old table (schema_version) for backwards compatibility
    try {
      const result = await db.query<[{ version: number }[]]>(
        "SELECT version FROM schema_version:current"
      );
      return result?.[0]?.[0]?.version ?? null;
    } catch {
      // Neither table exists - no migrations applied yet
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
   * Opens a connection, runs all pending migrations, and closes the connection.
   *
   * @returns SurrealMigrationResult with details about what was applied
   * @throws SurrealMigrationFileError if a migration file cannot be read
   * @throws SurrealMigrationExecutionError if a migration fails to execute
   */
  async migrate(): Promise<SurrealMigrationResult> {
    const db = await this.connectionFactory.connect({
      namespace: this.namespace,
      database: this.database,
    });

    try {
      const currentVersion = await this.getCurrentVersion(db);
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
        await this.applyMigration(db, migration);
      }

      const finalVersion = pendingMigrations[pendingMigrations.length - 1].version;

      return {
        appliedCount: pendingMigrations.length,
        fromVersion: currentVersion,
        toVersion: finalVersion,
      };
    } finally {
      await db.close();
    }
  }

  /**
   * Applies a single migration wrapped in a transaction.
   *
   * Migrations are self-registering: each migration file must include a
   * `CREATE schemaVersion SET version = X` statement to register itself.
   * The transaction ensures the migration and its version registration are atomic.
   *
   * @param db - Open database connection
   * @param migration - The migration to apply
   * @throws SurrealMigrationFileError if the migration file cannot be read
   * @throws SurrealMigrationExecutionError if the SurrealQL execution fails
   */
  private async applyMigration(
    db: Surreal,
    migration: SurrealMigration
  ): Promise<void> {
    // Read the migration file
    let surql: string;
    try {
      surql = await Deno.readTextFile(migration.path);
    } catch (error) {
      throw new SurrealMigrationFileError(migration.path, error);
    }

    // Execute migration wrapped in a transaction
    try {
      const wrappedSql = `BEGIN;\n\n${surql}\n\nCOMMIT;`;
      await db.query(wrappedSql);
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
}
