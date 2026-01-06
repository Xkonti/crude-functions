-- Migration 006: Add name field to API keys
-- Adds a required name field with uniqueness constraint per group

-- Add name column as NOT NULL (no existing data to migrate)
ALTER TABLE api_keys ADD COLUMN name TEXT NOT NULL DEFAULT '';

-- Drop old index on (group_id, value)
DROP INDEX idx_api_keys_group_value;

-- Create new unique index on (group_id, name)
CREATE UNIQUE INDEX idx_api_keys_group_name ON api_keys(group_id, name);
