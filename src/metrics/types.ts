import type { RecordId } from "surrealdb";

/** Metric types for execution tracking */
export type MetricType = "execution" | "minute" | "hour" | "day";

/** Numeric type codes for SurrealDB storage */
export const MetricTypeCode = {
  execution: 0,
  minute: 1,
  hour: 2,
  day: 3,
} as const;

/** Reverse mapping from numeric code to MetricType */
export const MetricTypeFromCode: Record<number, MetricType> = {
  0: "execution",
  1: "minute",
  2: "hour",
  3: "day",
};

/** A stored execution metric entry */
export interface ExecutionMetric {
  /** Unique identifier (SurrealDB RecordId) */
  id: RecordId;
  /** Function reference (RecordId), or null for global/combined metrics */
  functionId: RecordId | null;
  type: MetricType;
  /** Average execution time in microseconds */
  avgTimeUs: number;
  /** Maximum execution time in microseconds */
  maxTimeUs: number;
  executionCount: number;
  timestamp: Date;
}

/** Input type for storing a new metric (id is auto-generated, timestamp optional for aggregates) */
export type NewExecutionMetric = Omit<ExecutionMetric, "id" | "timestamp"> & {
  timestamp?: Date;
};

/**
 * Database row type for SELECT queries with duration::micros() conversion.
 * Queries use duration::micros(avgTime) as avgTimeUs to get numeric values directly.
 */
export interface ExecutionMetricRow {
  id: RecordId;
  functionId: RecordId | undefined; // NONE in SurrealDB = undefined in JS
  type: number;
  avgTimeUs: number; // Converted from duration using duration::micros()
  maxTimeUs: number; // Converted from duration using duration::micros()
  executionCount: number;
  timestamp: Date;
  createdAt: Date;
}

/** Metrics state row type */
export interface MetricsStateRow {
  id: RecordId;
  key: string;
  value: Date;
  updatedAt: Date;
}

/** Configuration for the metrics aggregation service */
export interface MetricsAggregationConfig {
  /** How often to run aggregation in seconds (default: 60) */
  aggregationIntervalSeconds: number;
  /** Number of days to retain daily metrics (default: 90) */
  retentionDays: number;
}

/** Result of an aggregation query */
export interface AggregationResult {
  /** Average execution time in microseconds */
  avgTimeUs: number;
  /** Maximum execution time in microseconds */
  maxTimeUs: number;
  executionCount: number;
}

/** Keys used in metricsState table for tracking aggregation progress */
export type MetricsStateKey =
  | "lastProcessedMinute"
  | "lastProcessedHour"
  | "lastProcessedDay";
