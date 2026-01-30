-- Execution metrics table - stores execution timing data for functions
-- Designed for high-frequency inserts from function executions
DEFINE TABLE IF NOT EXISTS executionMetric SCHEMAFULL TYPE NORMAL;

-- Function reference (optional - NONE for global/combined metrics)
DEFINE FIELD IF NOT EXISTS functionId ON TABLE executionMetric TYPE option<record<functionDef>>;

-- Metric type as integer for efficiency:
-- 0 = execution (raw), 1 = minute, 2 = hour, 3 = day (aggregated)
DEFINE FIELD IF NOT EXISTS type ON TABLE executionMetric TYPE int;

-- Timing data using duration type (enables future in-database processing)
DEFINE FIELD IF NOT EXISTS avgTime ON TABLE executionMetric TYPE duration;
DEFINE FIELD IF NOT EXISTS maxTime ON TABLE executionMetric TYPE duration;

-- Execution count (for aggregation weighting)
DEFINE FIELD IF NOT EXISTS executionCount ON TABLE executionMetric TYPE int DEFAULT 1;

-- Timestamp for the metric (when execution occurred or aggregation window start)
DEFINE FIELD IF NOT EXISTS timestamp ON TABLE executionMetric TYPE datetime DEFAULT time::now();

-- Record creation timestamp
DEFINE FIELD IF NOT EXISTS createdAt ON TABLE executionMetric TYPE datetime VALUE time::now() READONLY;

-- Indexes optimized for aggregation queries
-- Primary: type + timestamp range for watermark-based aggregation windows
DEFINE INDEX IF NOT EXISTS idx_metric_type_timestamp ON executionMetric FIELDS type, timestamp;

-- Per-function metrics lookup by type and time range
DEFINE INDEX IF NOT EXISTS idx_metric_function_type_timestamp ON executionMetric FIELDS functionId, type, timestamp;
