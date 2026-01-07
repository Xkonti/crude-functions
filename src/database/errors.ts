/**
 * Base error class for database-related errors
 */
export class DatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseError";
  }
}

/**
 * Thrown when attempting operations on a closed database connection
 */
export class DatabaseNotOpenError extends DatabaseError {
  constructor() {
    super("Database connection is not open");
    this.name = "DatabaseNotOpenError";
  }
}

/**
 * Thrown when the database file or directory cannot be accessed
 */
export class DatabaseAccessError extends DatabaseError {
  public readonly path: string;
  public readonly originalError: unknown;

  constructor(path: string, originalError: unknown) {
    super(`Cannot access database at: ${path}`);
    this.name = "DatabaseAccessError";
    this.path = path;
    this.originalError = originalError;
  }
}

/**
 * Thrown when a SQL query fails to execute
 */
export class QueryError extends DatabaseError {
  public readonly sql: string;
  public readonly originalError: unknown;

  constructor(sql: string, originalError: unknown) {
    // In production, don't include SQL in error message to prevent information leakage
    const isProduction = Deno.env.get("DENO_ENV") === "production";
    let message: string;

    if (isProduction) {
      message = "Query execution failed";
    } else {
      const truncatedSql = sql.length > 100 ? `${sql.substring(0, 100)}...` : sql;
      message = `Query execution failed: ${truncatedSql}`;
    }

    super(message);
    this.name = "QueryError";
    this.sql = sql; // Still stored for debugging/logging purposes
    this.originalError = originalError;
  }
}

/**
 * Thrown when attempting to start a transaction while already in a transaction
 */
export class NestedTransactionError extends DatabaseError {
  constructor(message = "Nested transactions are not supported") {
    super(message);
    this.name = "NestedTransactionError";
  }
}

/**
 * Thrown when a transaction operation fails (BEGIN, COMMIT, ROLLBACK)
 */
export class TransactionError extends DatabaseError {
  public override readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "TransactionError";
    this.cause = cause;
  }
}

