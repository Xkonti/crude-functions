import { DatabaseError } from "./errors.ts";

/**
 * Base error class for migration-related errors
 */
export class MigrationError extends DatabaseError {
  constructor(message: string) {
    super(message);
    this.name = "MigrationError";
  }
}

/**
 * Thrown when a migration file cannot be read or parsed
 */
export class MigrationFileError extends MigrationError {
  public readonly filePath: string;
  public readonly originalError: unknown;

  constructor(filePath: string, originalError: unknown) {
    super(`Failed to read migration file: ${filePath}`);
    this.name = "MigrationFileError";
    this.filePath = filePath;
    this.originalError = originalError;
  }
}

/**
 * Thrown when a migration SQL execution fails
 */
export class MigrationExecutionError extends MigrationError {
  public readonly version: number;
  public readonly filename: string;
  public readonly originalError: unknown;

  constructor(version: number, filename: string, originalError: unknown) {
    super(`Migration ${version} (${filename}) failed to execute`);
    this.name = "MigrationExecutionError";
    this.version = version;
    this.filename = filename;
    this.originalError = originalError;
  }
}
