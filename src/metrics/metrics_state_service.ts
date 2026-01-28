import { Mutex } from "@core/asyncutil/mutex";
import { RecordId } from "surrealdb";
import type { SurrealConnectionFactory } from "../database/surreal_connection_factory.ts";
import { toDate } from "../database/surreal_helpers.ts";
import type { MetricsStateKey, MetricsStateRow } from "./types.ts";

/**
 * Options for constructing a MetricsStateService.
 */
export interface MetricsStateServiceOptions {
  surrealFactory: SurrealConnectionFactory;
}

/**
 * Service for managing metrics aggregation state (watermarks).
 *
 * Stores timestamps that track aggregation progress:
 * - lastProcessedMinute: last minute that was aggregated
 * - lastProcessedHour: last hour that was aggregated
 * - lastProcessedDay: last day that was aggregated
 *
 * Uses fixed RecordIds for O(1) lookups: metricsState:lastProcessedMinute, etc.
 * Write operations are mutex-protected to prevent transaction conflicts.
 */
export class MetricsStateService {
  private readonly surrealFactory: SurrealConnectionFactory;
  private readonly writeMutex = new Mutex();

  constructor(options: MetricsStateServiceOptions) {
    this.surrealFactory = options.surrealFactory;
  }

  /**
   * Get a marker value by key.
   * Uses fixed RecordId for O(1) lookup.
   *
   * @param key - The marker key
   * @returns The marker timestamp, or null if not found
   */
  async getMarker(key: MetricsStateKey): Promise<Date | null> {
    const recordId = new RecordId("metricsState", key);
    const result = await this.surrealFactory.withSystemConnection(
      {},
      async (db) => {
        const [row] = await db.query<[MetricsStateRow | undefined]>(
          `RETURN $recordId.*`,
          { recordId }
        );
        return row;
      }
    );
    return result?.value ? toDate(result.value) : null;
  }

  /**
   * Set a marker value (upsert - insert or update if exists).
   * Uses fixed RecordId for direct access.
   *
   * @param key - The marker key
   * @param value - The timestamp to store
   */
  async setMarker(key: MetricsStateKey, value: Date): Promise<void> {
    using _lock = await this.writeMutex.acquire();
    const recordId = new RecordId("metricsState", key);
    await this.surrealFactory.withSystemConnection({}, async (db) => {
      await db.query(`UPSERT $recordId SET key = $key, value = $value`, {
        recordId,
        key,
        value,
      });
    });
  }

  /**
   * Get a marker, or bootstrap it to a default value if not found.
   * Used during aggregation startup to initialize watermarks.
   *
   * @param key - The marker key
   * @param defaultValue - Value to use if marker doesn't exist
   * @returns The marker timestamp (existing or newly set)
   */
  async getOrBootstrapMarker(
    key: MetricsStateKey,
    defaultValue: Date
  ): Promise<Date> {
    const existing = await this.getMarker(key);
    if (existing !== null) {
      return existing;
    }
    await this.setMarker(key, defaultValue);
    return defaultValue;
  }
}
