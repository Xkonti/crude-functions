import type { Database, BindValue } from "@db/sqlite";
import type { ExecuteResult, Row } from "./types.ts";
import { QueryError } from "./errors.ts";

/**
 * Transaction context for executing database operations within a transaction.
 * Provides the same query API as DatabaseService but operates within an
 * active transaction without acquiring mutex locks.
 *
 * This class should not be instantiated directly - it's created by
 * DatabaseService.transaction() and passed to the transaction callback.
 *
 * @example
 * ```typescript
 * await db.transaction(async (tx) => {
 *   await tx.execute("INSERT INTO users (name) VALUES (?)", ["Alice"]);
 *   await tx.execute("INSERT INTO posts (user_id) VALUES (?)", [1]);
 *   // Both inserts commit together, or roll back together on error
 * });
 * ```
 */
export class TransactionContext {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * Executes a SQL statement within the transaction (INSERT, UPDATE, DELETE).
   * Does NOT acquire mutex - the parent transaction already holds it.
   *
   * @param sql - The SQL statement to execute
   * @param params - Optional parameters to bind to the statement
   * @returns ExecuteResult with changes count and lastInsertRowId
   * @throws QueryError if the query fails
   */
  async execute(sql: string, params?: BindValue[]): Promise<ExecuteResult> {
    // Synchronous operation, wrapped in promise for API consistency
    await Promise.resolve();

    try {
      const stmt = this.db.prepare(sql);
      try {
        const changes = params && params.length > 0
          ? stmt.run(...params)
          : stmt.run();
        return {
          changes,
          lastInsertRowId: this.db.lastInsertRowId,
        };
      } finally {
        stmt.finalize();
      }
    } catch (error) {
      throw new QueryError(sql, error);
    }
  }

  /**
   * Executes a SQL query and returns all matching rows within the transaction.
   *
   * @param sql - The SQL query to execute
   * @param params - Optional parameters to bind to the query
   * @returns Array of row objects, empty array if no matches
   * @throws QueryError if the query fails
   */
  async queryAll<T extends Row = Row>(
    sql: string,
    params?: BindValue[]
  ): Promise<T[]> {
    // Synchronous operation, wrapped in promise for API consistency
    await Promise.resolve();

    try {
      const stmt = this.db.prepare(sql);
      try {
        return params && params.length > 0
          ? stmt.all<T>(...params)
          : stmt.all<T>();
      } finally {
        stmt.finalize();
      }
    } catch (error) {
      throw new QueryError(sql, error);
    }
  }

  /**
   * Executes a SQL query and returns the first matching row within the transaction.
   *
   * @param sql - The SQL query to execute
   * @param params - Optional parameters to bind to the query
   * @returns Single row object or null if no match
   * @throws QueryError if the query fails
   */
  async queryOne<T extends Row = Row>(
    sql: string,
    params?: BindValue[]
  ): Promise<T | null> {
    // Synchronous operation, wrapped in promise for API consistency
    await Promise.resolve();

    try {
      const stmt = this.db.prepare(sql);
      try {
        const result = params && params.length > 0
          ? stmt.get<T>(...params)
          : stmt.get<T>();
        return result ?? null;
      } finally {
        stmt.finalize();
      }
    } catch (error) {
      throw new QueryError(sql, error);
    }
  }

  /**
   * Executes SQL for DDL or pragma operations within the transaction.
   *
   * @param sql - The SQL statement(s) to execute
   * @returns Number of changes made by the last statement
   * @throws QueryError if the execution fails
   */
  async exec(sql: string): Promise<number> {
    // Synchronous operation, wrapped in promise for API consistency
    await Promise.resolve();

    try {
      return this.db.exec(sql);
    } catch (error) {
      throw new QueryError(sql, error);
    }
  }
}
