/**
 * SurrealDB adapter for Better Auth.
 *
 * Implements the Better Auth adapter interface using SurrealDB as the backend.
 * Uses createAdapterFactory for proper integration with Better Auth's schema
 * transformation and field mapping utilities.
 */

import { createAdapterFactory } from "better-auth/adapters";
import { RecordId } from "surrealdb";
import type { SurrealConnectionFactory } from "../database/surreal_connection_factory.ts";

/**
 * Configuration for the SurrealDB adapter.
 */
export interface SurrealAdapterConfig {
  /** SurrealDB connection factory for database access */
  surrealFactory: SurrealConnectionFactory;
}

/**
 * Where clause item from Better Auth (CleanedWhere type).
 * Structure: { field, value, operator, connector }
 */
interface WhereClauseItem {
  field: string;
  value: unknown;
  operator: string;
  connector: "AND" | "OR";
}

/**
 * Sort specification from Better Auth.
 */
interface SortBy {
  field: string;
  direction: "asc" | "desc";
}

/**
 * Maps Better Auth operators to SurrealQL operators/functions.
 */
function mapOperator(operator: string, field: string, paramName: string): string {
  switch (operator) {
    case "eq":
      return `${field} = $${paramName}`;
    case "ne":
      return `${field} != $${paramName}`;
    case "gt":
      return `${field} > $${paramName}`;
    case "gte":
      return `${field} >= $${paramName}`;
    case "lt":
      return `${field} < $${paramName}`;
    case "lte":
      return `${field} <= $${paramName}`;
    case "contains":
      return `${field} CONTAINS $${paramName}`;
    case "starts_with":
      return `string::starts_with(${field}, $${paramName})`;
    case "ends_with":
      return `string::ends_with(${field}, $${paramName})`;
    case "in":
      return `${field} IN $${paramName}`;
    default:
      return `${field} = $${paramName}`;
  }
}

/**
 * Builds a SurrealQL WHERE clause from Better Auth where conditions.
 *
 * @param where - Array of where clause items from Better Auth
 * @param params - Object to populate with parameter values
 * @returns SurrealQL WHERE clause string (without "WHERE" keyword)
 */
function buildWhereClause(
  where: WhereClauseItem[],
  params: Record<string, unknown>
): string {
  if (!where || where.length === 0) {
    return "";
  }

  const conditions: string[] = [];

  for (let i = 0; i < where.length; i++) {
    const item = where[i];
    const paramName = `w${i}`;

    // Convert userId string to RecordId if this is a foreign key field
    let value = item.value;
    if (item.field === "userId" && typeof value === "string") {
      value = new RecordId("user", value);
    }

    params[paramName] = value;

    const condition = mapOperator(item.operator, item.field, paramName);

    if (i === 0) {
      conditions.push(condition);
    } else {
      conditions.push(`${item.connector} ${condition}`);
    }
  }

  return conditions.join(" ");
}

/**
 * Extracts the string ID from a SurrealDB record ID.
 * SurrealDB returns IDs as RecordId objects; Better Auth expects strings.
 */
function extractId(id: unknown): string {
  if (typeof id === "string") {
    // Already a string, but might be in "table:id" format
    if (id.includes(":")) {
      return id.split(":")[1];
    }
    return id;
  }
  if (id && typeof id === "object" && "id" in id) {
    // RecordId object
    return String((id as RecordId).id);
  }
  return String(id);
}

/**
 * Transforms a SurrealDB row to Better Auth format.
 * - Extracts string IDs from RecordId objects
 * - Converts foreign key RecordIds to strings
 * - Handles datetime to Date conversion
 */
function transformRow(row: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(row)) {
    if (key === "id") {
      // Extract string ID from RecordId
      result[key] = extractId(value);
    } else if (key === "userId" && value !== null && value !== undefined) {
      // Foreign key - extract string ID
      result[key] = extractId(value);
    } else if (value instanceof Date) {
      // Keep as Date (Better Auth expects Date objects)
      result[key] = value;
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Prepares data for SurrealDB insert/update.
 * - Converts userId strings to RecordId
 * - Removes id field (will be set via CREATE table:id syntax)
 */
function prepareDataForSurreal(
  data: Record<string, unknown>
): { id: string | undefined; content: Record<string, unknown> } {
  const id = data.id as string | undefined;
  const content: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    if (key === "id") {
      // Skip id - will be used in CREATE table:id
      continue;
    } else if (key === "userId" && typeof value === "string") {
      // Convert userId to RecordId
      content[key] = new RecordId("user", value);
    } else {
      content[key] = value;
    }
  }

  return { id, content };
}

/**
 * Creates a SurrealDB adapter for Better Auth.
 *
 * @param config - Adapter configuration with SurrealDB connection factory
 * @returns Better Auth adapter factory
 */
export const surrealAdapter = (config: SurrealAdapterConfig) =>
  createAdapterFactory({
    config: {
      // Unique identifier for this adapter
      adapterId: "surrealdb",
      // SurrealDB has native boolean type
      supportsBooleans: true,
      // SurrealDB has native datetime type
      supportsDates: true,
      // SurrealDB does not use auto-incrementing numeric IDs
      supportsNumericIds: false,
    },
    adapter: ({ getModelName }) => {
      const { surrealFactory } = config;

      return {
        /**
         * Creates a new record in the database.
         */
        create: async <T extends Record<string, unknown>>({
          model,
          data,
        }: {
          model: string;
          data: T;
          select?: string[];
        }): Promise<T> => {
          const tableName = getModelName(model);
          const { id, content } = prepareDataForSurreal(data);

          return await surrealFactory.withSystemConnection({}, async (db) => {
            let result: Record<string, unknown>[];

            if (id) {
              // Use specific ID
              const recordId = new RecordId(tableName, id);
              [result] = await db.query<[Record<string, unknown>[]]>(
                `CREATE $recordId CONTENT $content RETURN AFTER`,
                { recordId, content }
              );
            } else {
              // Let SurrealDB generate ID
              [result] = await db.query<[Record<string, unknown>[]]>(
                `CREATE type::table($table) CONTENT $content RETURN AFTER`,
                { table: tableName, content }
              );
            }

            if (!result || result.length === 0) {
              throw new Error(`Failed to create record in ${tableName}`);
            }

            return transformRow(result[0]) as T;
          });
        },

        /**
         * Finds a single record matching the where clause.
         */
        findOne: async <T>({
          model,
          where,
        }: {
          model: string;
          where: WhereClauseItem[];
          select?: string[];
        }): Promise<T | null> => {
          const tableName = getModelName(model);
          const params: Record<string, unknown> = { table: tableName };
          const whereClause = buildWhereClause(where, params);

          return await surrealFactory.withSystemConnection({}, async (db) => {
            const query = whereClause
              ? `SELECT * FROM type::table($table) WHERE ${whereClause} LIMIT 1`
              : `SELECT * FROM type::table($table) LIMIT 1`;

            const [result] = await db.query<[Record<string, unknown>[]]>(query, params);

            if (!result || result.length === 0) {
              return null;
            }

            return transformRow(result[0]) as T;
          });
        },

        /**
         * Finds multiple records matching the where clause.
         */
        findMany: async <T>({
          model,
          where,
          limit,
          offset,
          sortBy,
        }: {
          model: string;
          where?: WhereClauseItem[];
          limit: number;
          offset?: number;
          sortBy?: SortBy;
        }): Promise<T[]> => {
          const tableName = getModelName(model);
          const params: Record<string, unknown> = { table: tableName };
          const whereClause = where ? buildWhereClause(where, params) : "";

          return await surrealFactory.withSystemConnection({}, async (db) => {
            let query = `SELECT * FROM type::table($table)`;

            if (whereClause) {
              query += ` WHERE ${whereClause}`;
            }

            if (sortBy) {
              const direction = sortBy.direction.toUpperCase();
              query += ` ORDER BY ${sortBy.field} ${direction}`;
            }

            query += ` LIMIT ${limit}`;

            if (offset !== undefined) {
              query += ` START ${offset}`;
            }

            const [result] = await db.query<[Record<string, unknown>[]]>(query, params);

            if (!result) {
              return [];
            }

            return result.map((row) => transformRow(row) as T);
          });
        },

        /**
         * Updates a single record matching the where clause.
         * Better Auth passes the update data in the `update` parameter.
         */
        update: async <T>({
          model,
          where,
          update: updateData,
        }: {
          model: string;
          where: WhereClauseItem[];
          update: T;
        }): Promise<T | null> => {
          const tableName = getModelName(model);
          const params: Record<string, unknown> = { table: tableName };
          const whereClause = buildWhereClause(where, params);

          // Prepare update data (convert userId if needed, remove id)
          const { content: preparedUpdateData } = prepareDataForSurreal(
            updateData as Record<string, unknown>
          );
          params.updateData = preparedUpdateData;

          return await surrealFactory.withSystemConnection({}, async (db) => {
            const query = whereClause
              ? `UPDATE type::table($table) MERGE $updateData WHERE ${whereClause} LIMIT 1 RETURN AFTER`
              : `UPDATE type::table($table) MERGE $updateData LIMIT 1 RETURN AFTER`;

            const [result] = await db.query<[Record<string, unknown>[]]>(query, params);

            if (!result || result.length === 0) {
              return null;
            }

            return transformRow(result[0]) as T;
          });
        },

        /**
         * Updates multiple records matching the where clause.
         * Returns the count of updated records.
         */
        updateMany: async ({
          model,
          where,
          update: updateData,
        }: {
          model: string;
          where: WhereClauseItem[];
          update: Record<string, unknown>;
        }): Promise<number> => {
          const tableName = getModelName(model);
          const params: Record<string, unknown> = { table: tableName };
          const whereClause = buildWhereClause(where, params);

          const { content: preparedUpdateData } = prepareDataForSurreal(updateData);
          params.updateData = preparedUpdateData;

          return await surrealFactory.withSystemConnection({}, async (db) => {
            const query = whereClause
              ? `UPDATE type::table($table) MERGE $updateData WHERE ${whereClause} RETURN AFTER`
              : `UPDATE type::table($table) MERGE $updateData RETURN AFTER`;

            const [result] = await db.query<[Record<string, unknown>[]]>(query, params);

            return result?.length ?? 0;
          });
        },

        /**
         * Deletes a single record matching the where clause.
         * Also handles cascade deletes for user records.
         */
        delete: async ({
          model,
          where,
        }: {
          model: string;
          where: WhereClauseItem[];
        }): Promise<void> => {
          const tableName = getModelName(model);
          const params: Record<string, unknown> = { table: tableName };
          const whereClause = buildWhereClause(where, params);

          await surrealFactory.withSystemConnection({}, async (db) => {
            // For user deletes, cascade to session and account
            if (tableName === "user") {
              // Find the user ID first
              const findQuery = `SELECT id FROM type::table($table) WHERE ${whereClause} LIMIT 1`;
              const [findResult] = await db.query<[{ id: RecordId }[]]>(findQuery, params);

              if (findResult && findResult.length > 0) {
                const userId = findResult[0].id;
                // Delete related sessions and accounts
                await db.query(`DELETE FROM session WHERE userId = $userId`, { userId });
                await db.query(`DELETE FROM account WHERE userId = $userId`, { userId });
              }
            }

            // Delete the record
            const query = whereClause
              ? `DELETE FROM type::table($table) WHERE ${whereClause} LIMIT 1`
              : `DELETE FROM type::table($table) LIMIT 1`;

            await db.query(query, params);
          });
        },

        /**
         * Deletes multiple records matching the where clause.
         * Returns the count of deleted records.
         */
        deleteMany: async ({
          model,
          where,
        }: {
          model: string;
          where: WhereClauseItem[];
        }): Promise<number> => {
          const tableName = getModelName(model);
          const params: Record<string, unknown> = { table: tableName };
          const whereClause = buildWhereClause(where, params);

          return await surrealFactory.withSystemConnection({}, async (db) => {
            // For user deletes, cascade to sessions and accounts
            if (tableName === "user") {
              // Find all user IDs first
              const findQuery = whereClause
                ? `SELECT id FROM type::table($table) WHERE ${whereClause}`
                : `SELECT id FROM type::table($table)`;
              const [findResult] = await db.query<[{ id: RecordId }[]]>(findQuery, params);

              if (findResult && findResult.length > 0) {
                for (const row of findResult) {
                  const userId = row.id;
                  await db.query(`DELETE FROM session WHERE userId = $userId`, { userId });
                  await db.query(`DELETE FROM account WHERE userId = $userId`, { userId });
                }
              }
            }

            // Delete the records
            const query = whereClause
              ? `DELETE FROM type::table($table) WHERE ${whereClause} RETURN BEFORE`
              : `DELETE FROM type::table($table) RETURN BEFORE`;

            const [result] = await db.query<[Record<string, unknown>[]]>(query, params);

            return result?.length ?? 0;
          });
        },

        /**
         * Counts records matching the where clause.
         */
        count: async ({
          model,
          where,
        }: {
          model: string;
          where?: WhereClauseItem[];
        }): Promise<number> => {
          const tableName = getModelName(model);
          const params: Record<string, unknown> = { table: tableName };
          const whereClause = where ? buildWhereClause(where, params) : "";

          return await surrealFactory.withSystemConnection({}, async (db) => {
            const query = whereClause
              ? `SELECT count() FROM type::table($table) WHERE ${whereClause} GROUP ALL`
              : `SELECT count() FROM type::table($table) GROUP ALL`;

            const [result] = await db.query<[{ count: number }[]]>(query, params);

            if (!result || result.length === 0) {
              return 0;
            }

            return result[0].count ?? 0;
          });
        },
      };
    },
  });
