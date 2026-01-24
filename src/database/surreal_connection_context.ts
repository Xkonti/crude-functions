import { AsyncLocalStorage } from "node:async_hooks";
import { SurrealDatabaseService } from "./surreal_database_service.ts";

/**
 * Context for a request-scoped SurrealDB connection.
 */
export interface SurrealConnectionContext {
  /** The scoped connection for this request */
  connection: SurrealDatabaseService;
  /** Request ID for logging/tracing */
  requestId: string;
  /** Whether this connection should be closed after the request */
  isTemporary: boolean;
}

/**
 * AsyncLocalStorage instance for SurrealDB connection context.
 *
 * This allows code anywhere in the call stack to access the current
 * request's SurrealDB connection without passing it through every function.
 */
const connectionContextStorage = new AsyncLocalStorage<SurrealConnectionContext>();

/**
 * Get the current request's SurrealDB connection.
 *
 * Returns undefined if called outside a connection context.
 *
 * @example
 * ```typescript
 * function doSomeWork() {
 *   const db = getCurrentSurrealConnection();
 *   if (!db) {
 *     throw new Error("No SurrealDB connection available");
 *   }
 *   return db.query("SELECT * FROM user");
 * }
 * ```
 */
export function getCurrentSurrealConnection(): SurrealDatabaseService | undefined {
  return connectionContextStorage.getStore()?.connection;
}

/**
 * Get the current request's SurrealDB connection context.
 *
 * Returns undefined if called outside a connection context.
 */
export function getCurrentSurrealConnectionContext(): SurrealConnectionContext | undefined {
  return connectionContextStorage.getStore();
}

/**
 * Get the current request's SurrealDB connection or throw an error.
 *
 * @throws If called outside a connection context
 *
 * @example
 * ```typescript
 * const db = requireSurrealConnection();
 * const users = await db.select("user");
 * ```
 */
export function requireSurrealConnection(): SurrealDatabaseService {
  const connection = getCurrentSurrealConnection();
  if (!connection) {
    throw new Error(
      "No SurrealDB connection available. This code must run within a connection context."
    );
  }
  return connection;
}

/**
 * Run a function within a scoped SurrealDB connection context.
 *
 * The connection is available via `getCurrentSurrealConnection()` anywhere
 * in the call stack during the function's execution.
 *
 * @param context - The connection context
 * @param fn - The function to run
 * @returns The result of the function
 *
 * @example
 * ```typescript
 * const result = await runWithSurrealConnection({
 *   connection: surrealDb,
 *   requestId: "abc-123",
 *   isTemporary: true,
 * }, async () => {
 *   // getCurrentSurrealConnection() returns surrealDb here
 *   const db = requireSurrealConnection();
 *   return await db.select("user");
 * });
 * ```
 */
export function runWithSurrealConnection<T>(
  context: SurrealConnectionContext,
  fn: () => T | Promise<T>
): T | Promise<T> {
  return connectionContextStorage.run(context, fn);
}

/**
 * Check if code is currently running within a SurrealDB connection context.
 */
export function isInSurrealConnectionContext(): boolean {
  return connectionContextStorage.getStore() !== undefined;
}
