/**
 * Base error class for SurrealDB-related errors
 */
export class SurrealDatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SurrealDatabaseError";
  }
}

/**
 * Thrown when attempting operations on a closed SurrealDB connection
 */
export class SurrealDatabaseNotOpenError extends SurrealDatabaseError {
  constructor() {
    super("SurrealDB connection is not open");
    this.name = "SurrealDatabaseNotOpenError";
  }
}

/**
 * Thrown when the SurrealDB storage path cannot be accessed
 */
export class SurrealDatabaseAccessError extends SurrealDatabaseError {
  public readonly path: string;
  public readonly originalError: unknown;

  constructor(path: string, originalError: unknown) {
    super(`Cannot access SurrealDB storage at: ${path}`);
    this.name = "SurrealDatabaseAccessError";
    this.path = path;
    this.originalError = originalError;
  }
}

/**
 * Thrown when a SurrealQL query fails
 */
export class SurrealQueryError extends SurrealDatabaseError {
  public readonly query: string;
  public readonly originalError: unknown;

  constructor(query: string, originalError: unknown) {
    const isProduction = Deno.env.get("DENO_ENV") === "production";
    const message = isProduction
      ? "SurrealQL query execution failed"
      : `SurrealQL query failed: ${query.substring(0, 100)}${query.length > 100 ? "..." : ""}`;

    super(message);
    this.name = "SurrealQueryError";
    this.query = query;
    this.originalError = originalError;
  }
}

/**
 * Thrown when the SurrealDB process fails to start
 */
export class SurrealProcessStartError extends SurrealDatabaseError {
  public readonly binaryPath: string;
  public readonly originalError: unknown;

  constructor(binaryPath: string, originalError: unknown) {
    super(`Failed to start SurrealDB process from: ${binaryPath}`);
    this.name = "SurrealProcessStartError";
    this.binaryPath = binaryPath;
    this.originalError = originalError;
  }
}

/**
 * Thrown when SurrealDB process fails to become ready within timeout
 */
export class SurrealProcessReadinessError extends SurrealDatabaseError {
  public readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`SurrealDB process failed to become ready within ${timeoutMs}ms`);
    this.name = "SurrealProcessReadinessError";
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Thrown when the SurrealDB process exits unexpectedly
 */
export class SurrealProcessExitError extends SurrealDatabaseError {
  public readonly exitCode: number | null;

  constructor(exitCode: number | null) {
    super(`SurrealDB process exited unexpectedly with code: ${exitCode}`);
    this.name = "SurrealProcessExitError";
    this.exitCode = exitCode;
  }
}

// ============== Pool Errors ==============

/**
 * Thrown when attempting to use the connection pool before initialization
 */
export class SurrealPoolNotInitializedError extends SurrealDatabaseError {
  constructor() {
    super("SurrealDB connection pool is not initialized. Call initializePool() first.");
    this.name = "SurrealPoolNotInitializedError";
  }
}

/**
 * Thrown when a pooled connection fails to establish
 */
export class SurrealPoolConnectionError extends SurrealDatabaseError {
  public readonly namespace: string;
  public readonly database: string;
  public readonly originalError: unknown;

  constructor(namespace: string, database: string, originalError: unknown) {
    super(`Failed to get pooled connection for ${namespace}/${database}`);
    this.name = "SurrealPoolConnectionError";
    this.namespace = namespace;
    this.database = database;
    this.originalError = originalError;
  }
}

// ============== Migration Errors ==============

/**
 * Base error for SurrealDB migration failures
 */
export class SurrealMigrationError extends SurrealDatabaseError {
  constructor(message: string) {
    super(message);
    this.name = "SurrealMigrationError";
  }
}

/**
 * Thrown when a migration file cannot be read
 */
export class SurrealMigrationFileError extends SurrealMigrationError {
  public readonly filePath: string;
  public readonly originalError: unknown;

  constructor(filePath: string, originalError: unknown) {
    super(`Failed to read SurrealDB migration file: ${filePath}`);
    this.name = "SurrealMigrationFileError";
    this.filePath = filePath;
    this.originalError = originalError;
  }
}

/**
 * Thrown when a migration fails to execute
 */
export class SurrealMigrationExecutionError extends SurrealMigrationError {
  public readonly version: number;
  public readonly filename: string;
  public readonly originalError: unknown;

  constructor(version: number, filename: string, originalError: unknown) {
    super(`SurrealDB migration ${version} (${filename}) failed to execute`);
    this.name = "SurrealMigrationExecutionError";
    this.version = version;
    this.filename = filename;
    this.originalError = originalError;
  }
}
