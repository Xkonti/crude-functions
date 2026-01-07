import type { DatabaseService } from "../database/database_service.ts";
import type { MetricsStateKey } from "./types.ts";

/** Database row shape for metricsState queries */
interface MetricsStateRow {
  id: number;
  key: string;
  value: string;
  updatedAt: string;
  [key: string]: unknown;
}

/**
 * Options for constructing a MetricsStateService.
 */
export interface MetricsStateServiceOptions {
  db: DatabaseService;
}

/**
 * Service for managing metrics aggregation state (watermarks).
 *
 * Stores timestamps that track aggregation progress:
 * - lastProcessedMinute: last minute that was aggregated
 * - lastProcessedHour: last hour that was aggregated
 * - lastProcessedDay: last day that was aggregated
 */
export class MetricsStateService {
  private readonly db: DatabaseService;

  constructor(options: MetricsStateServiceOptions) {
    this.db = options.db;
  }

  /**
   * Get a marker value by key.
   * @param key - The marker key
   * @returns The marker timestamp, or null if not found
   */
  async getMarker(key: MetricsStateKey): Promise<Date | null> {
    const row = await this.db.queryOne<MetricsStateRow>(
      `SELECT * FROM metricsState WHERE key = ?`,
      [key]
    );

    if (!row) return null;

    return new Date(row.value);
  }

  /**
   * Set a marker value (upsert - insert or update if exists).
   * @param key - The marker key
   * @param value - The timestamp to store
   */
  async setMarker(key: MetricsStateKey, value: Date): Promise<void> {
    await this.db.execute(
      `INSERT INTO metricsState (key, value, updatedAt)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT (key)
       DO UPDATE SET value = ?, updatedAt = CURRENT_TIMESTAMP`,
      [key, value.toISOString(), value.toISOString()]
    );
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
    if (existing) return existing;

    await this.setMarker(key, defaultValue);
    return defaultValue;
  }
}
