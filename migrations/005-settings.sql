-- Migration 005: Settings System
-- Stores application settings (global and per-user)

CREATE TABLE settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  user_id TEXT REFERENCES user(id) ON DELETE CASCADE,
  value TEXT,
  is_encrypted INTEGER NOT NULL DEFAULT 0,
  modified_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Unique constraint: one setting per name per user (or global if user_id is NULL)
-- Uses COALESCE trick to allow multiple NULLs while preventing duplicate global settings
CREATE UNIQUE INDEX idx_settings_name_user
ON settings(name, COALESCE(user_id, ''));

-- Index for fast lookups by name (global settings)
CREATE INDEX idx_settings_name ON settings(name);

-- Index for user-specific settings lookup
CREATE INDEX idx_settings_user ON settings(user_id) WHERE user_id IS NOT NULL;
