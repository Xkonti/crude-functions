/** Metric types for execution tracking */
export type MetricType =
  | "single_execution"
  | "minute_avg" | "minute_max"
  | "hourly_avg" | "hourly_max"
  | "daily_avg" | "daily_max";

/** A stored execution metric entry */
export interface ExecutionMetric {
  id: number;
  routeId: number;
  type: MetricType;
  timeValueMs: number;
  timestamp: Date;
}

/** Input type for storing a new metric (id and timestamp are auto-generated) */
export type NewExecutionMetric = Omit<ExecutionMetric, "id" | "timestamp">;
