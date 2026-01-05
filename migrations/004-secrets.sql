-- Migration 004: Secrets Management
-- Adds the secrets table for multi-scope secret storage

CREATE TABLE secrets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  value TEXT NOT NULL,
  comment TEXT,
  scope INTEGER NOT NULL,
  function_id INTEGER REFERENCES routes(id) ON DELETE CASCADE,
  api_group_id INTEGER REFERENCES api_key_groups(id) ON DELETE CASCADE,
  api_key_id INTEGER REFERENCES api_keys(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  modified_at TEXT DEFAULT CURRENT_TIMESTAMP
);
