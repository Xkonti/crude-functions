-- Migration 007: Add hash-based lookup for API keys
-- Adds value_hash column and index to eliminate O(n) decryption timing attack

-- Add value_hash column for HMAC-SHA256 hash of key value
-- This enables O(1) constant-time lookup without decryption
ALTER TABLE api_keys ADD COLUMN value_hash TEXT;

-- Create composite index for O(1) lookup within group
-- Using (group_id, value_hash) ensures lookups are scoped to group
CREATE INDEX idx_api_keys_hash ON api_keys(group_id, value_hash);
