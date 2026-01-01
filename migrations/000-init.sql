-- Schema version tracking table
-- Stores the current schema version number (single row)

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER NOT NULL
);

-- API Keys table
-- Stores API keys grouped by key_group (e.g., "management", "api", "readonly")

CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key_group TEXT NOT NULL,
  value TEXT NOT NULL,
  description TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Unique constraint on (group, value) pairs
-- Prevents duplicate keys within the same group
CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_group_value
ON api_keys(key_group, value);

-- Index for fast lookups by group
CREATE INDEX IF NOT EXISTS idx_api_keys_group
ON api_keys(key_group);

-- Routes table
-- Stores function routes with their configuration

CREATE TABLE IF NOT EXISTS routes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  handler TEXT NOT NULL,
  route TEXT NOT NULL,
  methods TEXT NOT NULL,  -- JSON array: ["GET", "POST"]
  keys TEXT,              -- JSON array: ["api"] or NULL
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Index for fast lookups by route path
CREATE INDEX IF NOT EXISTS idx_routes_route ON routes(route);
