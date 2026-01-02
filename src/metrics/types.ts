/** Metric types for execution tracking */
export type MetricType = "execution" | "minute" | "hour" | "day";

/** A stored execution metric entry */
export interface ExecutionMetric {
  id: number;
  routeId: number;
  type: MetricType;
  avgTimeMs: number;
  maxTimeMs: number;
  executionCount: number;
  timestamp: Date;
}

/** Input type for storing a new metric (id is auto-generated, timestamp optional for aggregates) */
export type NewExecutionMetric = Omit<ExecutionMetric, "id" | "timestamp"> & {
  timestamp?: Date;
};

/** Configuration for the metrics aggregation service */
export interface MetricsAggregationConfig {
  /** How often to run aggregation in seconds (default: 60) */
  aggregationIntervalSeconds: number;
  /** Number of days to retain daily metrics (default: 90) */
  retentionDays: number;
}
