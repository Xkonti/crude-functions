/**
 * Represents a migration failure with details about which migration failed.
 */
export interface MigrationError {
  /** The version number of the failed migration */
  version: number;
  /** The filename of the failed migration (e.g., "005-add-metrics.surql") */
  filename: string;
  /** The error message from the migration failure */
  message: string;
}

/**
 * In-memory service for tracking system-level errors that should be displayed
 * in the UI. This service holds error states that persist for the lifetime of
 * the application instance.
 *
 * Errors tracked here are typically set during startup and displayed as
 * prominent warnings in the web interface.
 */
export class ErrorStateService {
  private migrationError: MigrationError | null = null;

  /**
   * Records a migration failure.
   * This will cause a warning banner to appear in the web UI.
   */
  setMigrationError(error: MigrationError): void {
    this.migrationError = error;
  }

  /**
   * Returns the current migration error, or null if no migration has failed.
   */
  getMigrationError(): MigrationError | null {
    return this.migrationError;
  }

  /**
   * Clears any recorded migration error.
   */
  clearMigrationError(): void {
    this.migrationError = null;
  }

  /**
   * Returns true if there are any system-level errors recorded.
   */
  hasErrors(): boolean {
    return this.migrationError !== null;
  }
}
