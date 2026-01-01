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
    const truncatedSql = sql.length > 100 ? `${sql.substring(0, 100)}...` : sql;
    super(`Query execution failed: ${truncatedSql}`);
    this.name = "QueryError";
    this.sql = sql;
    this.originalError = originalError;
  }
}

/**
 * Thrown when a transaction operation (begin, commit, rollback) fails
 */
export class TransactionError extends DatabaseError {
  public readonly operation: "begin" | "commit" | "rollback";
  public readonly originalError: unknown;

  constructor(operation: "begin" | "commit" | "rollback", originalError: unknown) {
    super(`Transaction ${operation} failed`);
    this.name = "TransactionError";
    this.operation = operation;
    this.originalError = originalError;
  }
}

/**
 * Thrown when attempting to begin a transaction while one is already active
 */
export class TransactionAlreadyActiveError extends DatabaseError {
  constructor() {
    super("A transaction is already active");
    this.name = "TransactionAlreadyActiveError";
  }
}

/**
 * Thrown when attempting to commit or rollback without an active transaction
 */
export class NoActiveTransactionError extends DatabaseError {
  constructor() {
    super("No active transaction to commit or rollback");
    this.name = "NoActiveTransactionError";
  }
}
