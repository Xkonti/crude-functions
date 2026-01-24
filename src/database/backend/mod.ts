/**
 * Database backend abstraction layer.
 *
 * Provides common interfaces for both SQLite and SurrealDB backends,
 * enabling gradual migration between database systems.
 */

export type {
  DatabaseBackend,
  SqliteBackend,
  SurrealBackend,
  AnyDatabaseBackend,
  WriteResult,
  QueryOptions,
  TransactionContext,
} from "./types.ts";

export { isSqliteBackend, isSurrealBackend } from "./types.ts";
