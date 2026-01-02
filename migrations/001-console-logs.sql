-- Console logs table
-- Stores captured console output from function handlers

CREATE TABLE IF NOT EXISTS console_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL,
  route_id INTEGER,                       -- References routes.id (not FK, allows route deletion)
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  args TEXT,
  timestamp TEXT DEFAULT CURRENT_TIMESTAMP
);

-- For querying logs by request
CREATE INDEX IF NOT EXISTS idx_console_logs_request_id ON console_logs(request_id);

-- For web UI: filter by route, ordered oldest to newest (by id ASC)
CREATE INDEX IF NOT EXISTS idx_console_logs_route_id ON console_logs(route_id, id);

-- For filtering by route + level
CREATE INDEX IF NOT EXISTS idx_console_logs_route_level ON console_logs(route_id, level, id);

-- For time-based cleanup/retention
CREATE INDEX IF NOT EXISTS idx_console_logs_timestamp ON console_logs(timestamp);

-- Execution metrics table
-- Stores execution timing data for analytics
-- Types: 'execution' (single), 'minute', 'hour', 'day' (aggregated)

CREATE TABLE IF NOT EXISTS execution_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  route_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('execution', 'minute', 'hour', 'day')),
  avg_time_ms REAL NOT NULL,
  max_time_ms INTEGER NOT NULL,
  execution_count INTEGER NOT NULL DEFAULT 1,
  timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_execution_metrics_route_id ON execution_metrics(route_id);
CREATE INDEX IF NOT EXISTS idx_execution_metrics_type_route_timestamp
  ON execution_metrics(type, route_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_execution_metrics_timestamp ON execution_metrics(timestamp);
