-- Metrics state table - tracks aggregation watermarks
-- Uses fixed record IDs for O(1) access: metricsState:lastProcessedMinute, etc.
DEFINE TABLE IF NOT EXISTS metricsState SCHEMAFULL TYPE NORMAL;

-- Marker key (stored for clarity, ID is the primary access pattern)
DEFINE FIELD IF NOT EXISTS key ON TABLE metricsState TYPE string;

-- Marker value (datetime for watermark timestamps)
DEFINE FIELD IF NOT EXISTS value ON TABLE metricsState TYPE datetime;

-- Last update timestamp
DEFINE FIELD IF NOT EXISTS updatedAt ON TABLE metricsState TYPE datetime VALUE time::now();
