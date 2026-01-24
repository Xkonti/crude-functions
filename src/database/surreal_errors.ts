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
