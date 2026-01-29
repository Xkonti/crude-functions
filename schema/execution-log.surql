-- Execution logs table - stores captured console output from function handlers
-- Designed for batched inserts (50 entries at a time)
DEFINE TABLE IF NOT EXISTS executionLog SCHEMAFULL TYPE NORMAL;

-- Request identifier (UUID for correlating logs within a single execution)
DEFINE FIELD IF NOT EXISTS requestId ON TABLE executionLog TYPE string;

-- Function reference (optional - orphaned logs may have NONE functionId)
DEFINE FIELD IF NOT EXISTS functionId ON TABLE executionLog TYPE option<record<functionDef>>;

-- Log level
DEFINE FIELD IF NOT EXISTS level ON TABLE executionLog TYPE
    "log" | "debug" | "info" | "warn" | "error" | "trace" |
    "stdout" | "stderr" |
    "exec_start" | "exec_end" | "exec_reject";

-- Log message
DEFINE FIELD IF NOT EXISTS message ON TABLE executionLog TYPE string;

-- Additional arguments (JSON-serialized, optional)
DEFINE FIELD IF NOT EXISTS args ON TABLE executionLog TYPE option<string>;

-- Sequence number within batch for ordering (replaces microsecond timestamp hack)
DEFINE FIELD IF NOT EXISTS sequence ON TABLE executionLog TYPE int DEFAULT 0;

-- Timestamp when log was captured
DEFINE FIELD IF NOT EXISTS timestamp ON TABLE executionLog TYPE datetime DEFAULT time::now();

-- Record creation timestamp
DEFINE FIELD IF NOT EXISTS createdAt ON TABLE executionLog TYPE datetime VALUE time::now() READONLY;

-- Indexes for query patterns
-- Logs by request (debugging a specific execution)
DEFINE INDEX IF NOT EXISTS idx_log_requestId ON executionLog FIELDS requestId;

-- Logs by function with time-based pagination (newest first)
DEFINE INDEX IF NOT EXISTS idx_log_function_timestamp ON executionLog FIELDS functionId, timestamp;

-- Global time-based pagination
DEFINE INDEX IF NOT EXISTS idx_log_timestamp ON executionLog FIELDS timestamp;

-- Level filtering within function
DEFINE INDEX IF NOT EXISTS idx_log_function_level ON executionLog FIELDS functionId, level;

